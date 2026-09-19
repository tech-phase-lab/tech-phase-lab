"""Always-on official-source monitor with a small authenticated HTTP API."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import os
from pathlib import Path
import signal
import threading
import time
from urllib.parse import parse_qs, urlsplit

import monitor


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def positive_int(name, default, minimum):
    try:
        return max(minimum, int(os.environ.get(name, default)))
    except ValueError:
        return default


class AutomaticMonitor:
    def __init__(self, db_path, snapshot_path):
        self.db_path = Path(db_path)
        self.snapshot_path = Path(snapshot_path)
        self.fast_seconds = positive_int("RESEARCH_FAST_POLL_SECONDS", 3, 3)
        self.standard_seconds = positive_int("RESEARCH_STANDARD_POLL_SECONDS", 5, 5)
        self.workers = positive_int("RESEARCH_MAX_WORKERS", 8, 1)
        self.body_interval = positive_int("RESEARCH_BODY_FETCH_INTERVAL_SECONDS", 10, 5)
        self.body_batch = positive_int("RESEARCH_BODY_FETCH_BATCH", 2, 1)
        configured = [value.strip().upper() for value in os.environ.get("RESEARCH_TICKERS", "").split(",") if value.strip()]
        unknown = sorted(set(configured) - set(monitor.PROVIDERS))
        if unknown:
            raise ValueError("Unknown RESEARCH_TICKERS: " + ", ".join(unknown))
        self.tickers = configured or list(monitor.PROVIDERS)
        self.stop_event = threading.Event()
        self.db_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.state = {
            "ready": False,
            "startedAt": utc_now(),
            "lastCycleAt": None,
            "lastChangeAt": None,
            "cycles": 0,
            "newSources": 0,
            "sourceChecks": 0,
            "sourceFetchErrors": 0,
            "pendingBodies": 0,
            "tickerCount": len(self.tickers),
            "companies": {},
        }
        self.thread = threading.Thread(target=self.run, name="research-monitor", daemon=True)

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.thread.join(timeout=15)

    def interval_for(self, ticker):
        provider = monitor.PROVIDERS[ticker]
        if provider.get("pollSeconds"):
            return max(3, int(provider["pollSeconds"]))
        if provider["format"] == "rss" or provider.get("automaticSource") == "fallback":
            return self.fast_seconds
        return self.standard_seconds

    def public_state(self):
        with self.state_lock:
            return json.loads(json.dumps(self.state))

    def public_snapshot(self):
        with self.db_lock, monitor.connect(self.db_path) as db:
            return monitor.snapshot(db)

    def editorial_queue(self, limit=20):
        with self.db_lock, monitor.connect(self.db_path) as db:
            return monitor.private_brief_queue(db, limit)

    def save_brief(self, payload):
        with self.db_lock, monitor.connect(self.db_path) as db:
            result = monitor.save_brief_draft(
                db, payload.get("url", ""), payload.get("sha256", ""),
                payload.get("summaryJa", ""), payload.get("impactLabel", ""),
                payload.get("impactJa", ""), payload.get("confidence", ""),
                payload.get("evidence", {}),
            )
            monitor.write_snapshot(db, self.snapshot_path)
            return result

    def decide_brief(self, payload):
        with self.db_lock, monitor.connect(self.db_path) as db:
            result = monitor.review_brief(
                db, payload.get("url", ""), payload.get("sha256", ""),
                payload.get("decision", ""), payload.get("reviewer", ""), payload.get("reason", ""),
            )
            monitor.write_snapshot(db, self.snapshot_path)
            return result

    def body_candidates(self):
        """Prioritize new release events, then the oldest due source bodies."""
        due = utc_now()
        with self.db_lock, monitor.connect(self.db_path) as db:
            pending = db.execute(
                "SELECT count(*) FROM sources WHERE next_fetch_at IS NULL OR next_fetch_at<=?",
                (due,),
            ).fetchone()[0]
            rows = db.execute("""
              SELECT s.*
              FROM sources s LEFT JOIN release_events e ON e.url=s.url
              WHERE s.source_mode='remote' AND (s.next_fetch_at IS NULL OR s.next_fetch_at<=?)
              ORDER BY e.detected_at IS NULL, e.detected_at DESC,
                       s.checked_at IS NOT NULL, s.checked_at, s.discovered_at, s.url
              LIMIT ?
            """, (due, self.body_batch)).fetchall()
        return rows, pending

    def fetch_bodies(self, pool):
        rows, pending = self.body_candidates()
        if not rows:
            with self.state_lock:
                self.state["pendingBodies"] = pending
            return
        futures = {pool.submit(monitor.collect_source, row, monitor.fetch): row for row in rows}
        completed = []
        for future in as_completed(futures):
            row = futures[future]
            try:
                completed.append((row, future.result(), None))
            except Exception as exc:
                completed.append((row, None, exc))
        errors = 0
        with self.db_lock, monitor.connect(self.db_path) as db:
            for row, result, error in completed:
                if error is None:
                    monitor.save_source_check(db, row, result)
                else:
                    monitor.save_source_error(db, row, error)
                    errors += 1
            monitor.write_snapshot(db, self.snapshot_path)
        with self.state_lock:
            self.state["sourceChecks"] += len(completed)
            self.state["sourceFetchErrors"] += errors
            self.state["pendingBodies"] = max(0, pending - len(completed))

    def run(self):
        next_due = {ticker: 0.0 for ticker in self.tickers}
        signatures = {}
        known = {}
        baseline_ready = {}
        failure_streak = {ticker: 0 for ticker in self.tickers}
        next_body_fetch = 0.0
        with self.db_lock, monitor.connect(self.db_path) as db:
            for ticker in self.tickers:
                known[ticker] = {row[0] for row in db.execute("SELECT url FROM sources WHERE ticker=?", (ticker,))}
                baseline_ready[ticker] = db.execute(
                    "SELECT 1 FROM discovery_runs WHERE ticker=? AND status IN ('ok','fallback') LIMIT 1",
                    (ticker,),
                ).fetchone() is not None
            monitor.write_snapshot(db, self.snapshot_path)

        with ThreadPoolExecutor(max_workers=self.workers, thread_name_prefix="source") as pool:
            while not self.stop_event.is_set():
                current = time.monotonic()
                due = [ticker for ticker, at in next_due.items() if at <= current]
                if not due:
                    self.stop_event.wait(min(1.0, max(0.1, min(next_due.values()) - current)))
                    continue

                futures = {pool.submit(monitor.collect_discovery, ticker, monitor.fetch, True): ticker for ticker in due}
                collected = []
                for future in as_completed(futures):
                    ticker = futures[future]
                    try:
                        result, links = future.result()
                    except Exception as exc:
                        result = {
                            "ticker": ticker,
                            "status": "degraded",
                            "route": "none",
                            "sourceUrl": monitor.INDEXES[ticker],
                            "candidates": 0,
                            "error": str(exc),
                        }
                        links = {}
                    collected.append((ticker, result, links))
                    if result["status"] == "degraded":
                        failure_streak[ticker] += 1
                    else:
                        failure_streak[ticker] = 0
                    delay = min(300, self.interval_for(ticker) * (2 ** min(failure_streak[ticker], 6)))
                    next_due[ticker] = time.monotonic() + delay
                    result["nextPollSeconds"] = delay

                changed = False
                new_count = 0
                checked_at = utc_now()
                company_states = {}
                with self.db_lock, monitor.connect(self.db_path) as db:
                    for ticker, result, links in collected:
                        signature = (result["status"], result["sourceUrl"], tuple(sorted(links)))
                        new_urls = set(links) - known[ticker]
                        if signatures.get(ticker) != signature or new_urls:
                            inserted = monitor.save_discovery(db, ticker, result, links)
                            known[ticker].update(inserted)
                            if baseline_ready[ticker]:
                                monitor.add_release_events(db, ticker, inserted)
                                new_count += len(inserted)
                            elif result["status"] in {"ok", "fallback"}:
                                baseline_ready[ticker] = True
                            changed = True
                        signatures[ticker] = signature
                        company_states[ticker] = {
                            "status": result["status"],
                            "route": result["route"],
                            "candidates": result["candidates"],
                            "checkedAt": checked_at,
                            "pollSeconds": result["nextPollSeconds"],
                            "error": monitor.public_error(result["error"]),
                        }
                    if changed:
                        monitor.write_snapshot(db, self.snapshot_path)

                with self.state_lock:
                    self.state["ready"] = True
                    self.state["lastCycleAt"] = checked_at
                    self.state["cycles"] += 1
                    self.state["newSources"] += new_count
                    self.state["companies"].update(company_states)
                    if new_count:
                        self.state["lastChangeAt"] = checked_at

                if time.monotonic() >= next_body_fetch:
                    self.fetch_bodies(pool)
                    next_body_fetch = time.monotonic() + self.body_interval


class Handler(BaseHTTPRequestHandler):
    server_version = "TechPhaseMonitor/1.0"

    @property
    def app(self):
        return self.server.app

    def send_json(self, status, value):
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def authorized(self):
        token = os.environ.get("RESEARCH_API_TOKEN")
        if not token:
            return True
        supplied = self.headers.get("Authorization", "")
        return hmac.compare_digest(supplied, "Bearer " + token)

    def editor_authorized(self):
        token = os.environ.get("RESEARCH_EDITOR_TOKEN")
        if not token:
            return False
        supplied = self.headers.get("Authorization", "")
        return hmac.compare_digest(supplied, "Bearer " + token)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("invalid-content-length") from exc
        if not 1 <= length <= 64 * 1024:
            raise ValueError("invalid-request-size")
        try:
            value = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("invalid-json") from exc
        if not isinstance(value, dict):
            raise ValueError("invalid-json-object")
        return value

    def do_GET(self):
        parsed = urlsplit(self.path)
        path = parsed.path
        if path == "/health":
            state = self.app.public_state()
            self.send_json(200 if state["ready"] else 503, state)
            return
        if path == "/admin/briefs":
            if not self.editor_authorized():
                self.send_json(401, {"ok": False, "error": "unauthorized"})
                return
            try:
                limit = int(parse_qs(parsed.query).get("limit", ["20"])[0])
                self.send_json(200, {"ok": True, **self.app.editorial_queue(limit)})
            except (TypeError, ValueError):
                self.send_json(400, {"ok": False, "error": "invalid-request"})
            except Exception:
                self.send_json(503, {"ok": False, "error": "editorial-queue-unavailable"})
            return
        if path not in {"/snapshot", "/live"}:
            self.send_json(404, {"ok": False, "error": "not-found"})
            return
        if not self.authorized():
            self.send_json(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            snapshot = self.app.public_snapshot()
            if path == "/snapshot":
                self.send_json(200, snapshot)
            else:
                self.send_json(200, {"ok": True, "mode": "automatic", "monitor": self.app.public_state(), "snapshot": snapshot})
        except Exception:
            self.send_json(503, {"ok": False, "error": "snapshot-unavailable"})

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in {"/admin/briefs/draft", "/admin/briefs/review"}:
            self.send_json(404, {"ok": False, "error": "not-found"})
            return
        if not self.editor_authorized():
            self.send_json(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            payload = self.read_json()
            result = self.app.save_brief(payload) if path.endswith("/draft") else self.app.decide_brief(payload)
            self.send_json(200, {"ok": True, **result})
        except ValueError as exc:
            self.send_json(400, {"ok": False, "error": str(exc)})
        except Exception:
            self.send_json(503, {"ok": False, "error": "editorial-write-unavailable"})

    def log_message(self, message, *args):
        print("%s - %s" % (self.address_string(), message % args), flush=True)


def main():
    root = Path(__file__).resolve().parents[2]
    data_dir = Path(os.environ.get("RESEARCH_DATA_DIR", root / ".research-private"))
    db_path = os.environ.get("RESEARCH_DB_PATH", data_dir / "automatic.sqlite")
    snapshot_path = os.environ.get("RESEARCH_SNAPSHOT_PATH", data_dir / "automatic-snapshot.json")
    host = os.environ.get("HOST", "0.0.0.0")
    port = positive_int("PORT", 8080, 1)
    app = AutomaticMonitor(db_path, snapshot_path)
    server = ThreadingHTTPServer((host, port), Handler)
    server.app = app

    def shutdown(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    app.start()
    print(json.dumps({"event": "listening", "host": host, "port": port}), flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        app.stop()
        server.server_close()


if __name__ == "__main__":
    main()
