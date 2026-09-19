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
from urllib.parse import urlsplit

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
        self.fast_seconds = positive_int("RESEARCH_FAST_POLL_SECONDS", 10, 5)
        self.standard_seconds = positive_int("RESEARCH_STANDARD_POLL_SECONDS", 30, 10)
        self.workers = positive_int("RESEARCH_MAX_WORKERS", 8, 1)
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
            return max(5, int(provider["pollSeconds"]))
        if provider["format"] == "rss" or provider.get("automaticSource") == "fallback":
            return self.fast_seconds
        return self.standard_seconds

    def public_state(self):
        with self.state_lock:
            return json.loads(json.dumps(self.state))

    def public_snapshot(self):
        with self.db_lock, monitor.connect(self.db_path) as db:
            return monitor.snapshot(db)

    def run(self):
        next_due = {ticker: 0.0 for ticker in self.tickers}
        signatures = {}
        known = {}
        baseline_ready = {}
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
                    next_due[ticker] = time.monotonic() + self.interval_for(ticker)

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
                            "pollSeconds": self.interval_for(ticker),
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

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/health":
            state = self.app.public_state()
            self.send_json(200 if state["ready"] else 503, state)
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
