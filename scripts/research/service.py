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
import brief_generator
import persistence


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def positive_int(name, default, minimum):
    try:
        return max(minimum, int(os.environ.get(name, default)))
    except ValueError:
        return default


def timestamp_age_seconds(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return max(0, int((datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).total_seconds()))
    except (TypeError, ValueError):
        return None


class AutomaticMonitor:
    def __init__(self, db_path, snapshot_path):
        self.db_path = Path(db_path)
        self.snapshot_path = Path(snapshot_path)
        self.fast_seconds = positive_int("RESEARCH_FAST_POLL_SECONDS", 3, 3)
        self.standard_seconds = positive_int("RESEARCH_STANDARD_POLL_SECONDS", 5, 5)
        self.workers = positive_int("RESEARCH_MAX_WORKERS", 8, 1)
        self.body_interval = positive_int("RESEARCH_BODY_FETCH_INTERVAL_SECONDS", 10, 5)
        self.body_batch = positive_int("RESEARCH_BODY_FETCH_BATCH", 2, 1)
        self.backup_interval = positive_int("RESEARCH_BACKUP_INTERVAL_SECONDS", 3600, 300)
        self.backup_grace = positive_int("RESEARCH_BACKUP_GRACE_SECONDS", 600, 60)
        self.backup_retention = positive_int("RESEARCH_BACKUP_RETENTION", 24, 2)
        self.monitor_stale_seconds = positive_int("RESEARCH_MONITOR_STALE_SECONDS", 60, 15)
        self.backup_dir = Path(os.environ.get(
            "RESEARCH_BACKUP_DIR", str(self.db_path.parent / "backups")
        ))
        self.auto_drafts_requested = os.environ.get("RESEARCH_AUTO_DRAFTS", "").strip().lower() in {"1", "true", "yes"}
        self.generation_daily_limit = positive_int("RESEARCH_AUTO_DRAFT_DAILY_LIMIT", 20, 1)
        self.generation_token_limit = positive_int("RESEARCH_AUTO_DRAFT_TOKEN_LIMIT", 100_000, 10_000)
        self.generation_max_attempts = positive_int("RESEARCH_AUTO_DRAFT_MAX_ATTEMPTS", 3, 1)
        self.generation_interval = positive_int("RESEARCH_AUTO_DRAFT_INTERVAL_SECONDS", 5, 1)
        try:
            brief_generator.configuration()
            generation_configured = True
        except brief_generator.GenerationUnavailable:
            generation_configured = False
        self.auto_drafts_enabled = self.auto_drafts_requested and generation_configured
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
            "lastCycleDurationMs": None,
            "lastCycleCompanies": 0,
            "lastChangeAt": None,
            "cycles": 0,
            "newSources": 0,
            "sourceChecks": 0,
            "sourceFetchErrors": 0,
            "sourceNotModified": 0,
            "pendingBodies": 0,
            "tickerCount": len(self.tickers),
            "generation": {
                "requested": self.auto_drafts_requested, "configured": generation_configured,
                "enabled": self.auto_drafts_enabled, "dailyLimit": self.generation_daily_limit,
                "tokenLimit": self.generation_token_limit, "maxAttempts": self.generation_max_attempts,
            },
            "backup": {
                "enabled": True, "intervalSeconds": self.backup_interval,
                "graceSeconds": self.backup_grace,
                "retention": min(self.backup_retention, 168), "lastAttemptAt": None,
                "lastSuccessAt": None, "healthy": None, "backupCount": 0,
                "lastError": None,
            },
            "companies": {},
        }
        self.thread = threading.Thread(target=self.run, name="research-monitor", daemon=True)
        self.generation_thread = threading.Thread(target=self.run_generation, name="brief-generator", daemon=True)
        self.backup_thread = threading.Thread(target=self.run_backup, name="database-backup", daemon=True)

    def start(self):
        self.thread.start()
        self.generation_thread.start()
        self.backup_thread.start()

    def stop(self):
        self.stop_event.set()
        self.thread.join(timeout=15)
        self.generation_thread.join(timeout=45)
        self.backup_thread.join(timeout=15)

    def interval_for(self, ticker):
        provider = monitor.PROVIDERS[ticker]
        if provider.get("pollSeconds"):
            return max(3, int(provider["pollSeconds"]))
        if provider["format"] == "rss" or provider.get("automaticSource") == "fallback":
            return self.fast_seconds
        return self.standard_seconds

    def collect_discovery_timed(self, ticker):
        """Measure one official-source request separately from its polling interval."""
        started = time.monotonic()
        result, links = monitor.collect_discovery(ticker, monitor.fetch, True)
        return result, links, max(0, round((time.monotonic() - started) * 1000))

    def public_state(self):
        with self.state_lock:
            state = json.loads(json.dumps(self.state))
        cycle_age = timestamp_age_seconds(state["lastCycleAt"])
        state["lastCycleAgeSeconds"] = cycle_age
        backup = state["backup"]
        success_age = timestamp_age_seconds(backup["lastSuccessAt"])
        backup["lastSuccessAgeSeconds"] = success_age
        reference_age = success_age
        if reference_age is None:
            reference_age = timestamp_age_seconds(state["startedAt"])
        overdue_after = self.backup_interval + self.backup_grace
        backup["overdueAfterSeconds"] = overdue_after
        backup["overdue"] = reference_age is None or reference_age > overdue_after
        if backup["healthy"] is False:
            backup["status"] = "failed"
        elif backup["overdue"]:
            backup["status"] = "overdue"
        elif backup["healthy"] is True:
            backup["status"] = "ok"
        else:
            backup["status"] = "waiting"
        issues = []
        if state["ready"] and (cycle_age is None or cycle_age > self.monitor_stale_seconds):
            issues.append("monitor-stale")
        if backup["status"] == "failed":
            issues.append("backup-failed")
        elif backup["status"] == "overdue":
            issues.append("backup-overdue")
        state["health"] = {
            "status": "degraded" if issues else ("ready" if state["ready"] else "starting"),
            "issues": issues,
            "monitorStaleAfterSeconds": self.monitor_stale_seconds,
        }
        with self.db_lock, monitor.connect(self.db_path) as db:
            state["generation"].update(monitor.generation_queue_stats(
                db, self.generation_daily_limit, self.generation_token_limit
            ))
        return state

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

    def generate_brief(self, payload, transport=brief_generator.request_response):
        url, expected_sha = payload.get("url", ""), payload.get("sha256", "")
        with self.db_lock, monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            if not row or row["sha256"] != expected_sha or row["error"] or not row["extracted_text"]:
                raise ValueError("Source is missing, changed, failed, or has no extracted evidence")
            source = dict(row)
        generated = brief_generator.generate_draft(source, transport=transport)
        draft, audit = generated["draft"], generated["audit"]
        with self.db_lock, monitor.connect(self.db_path) as db:
            result = monitor.save_brief_draft(
                db, url, expected_sha, draft["summaryJa"], draft["impactLabel"],
                draft["impactJa"], draft["confidence"], draft["evidence"],
            )
            db.execute("""
              UPDATE briefs SET generation_provider=?,generation_model=?,generation_response_id=?,
                                generation_source_truncated=?,generation_input_tokens=?,
                                generation_output_tokens=?,generation_total_tokens=? WHERE url=?
            """, (audit["provider"], audit["model"], audit["responseId"], int(audit["sourceTruncated"]),
                  audit.get("inputTokens"), audit.get("outputTokens"), audit.get("totalTokens"), url))
            db.commit()
            monitor.write_snapshot(db, self.snapshot_path)
        return {**result, "generatedBy": audit["provider"], "model": audit["model"],
                "sourceTruncated": audit["sourceTruncated"], "usage": {
                    "inputTokens": audit.get("inputTokens"), "outputTokens": audit.get("outputTokens"),
                    "totalTokens": audit.get("totalTokens"),
                }}

    def generate_brief_budgeted(self, payload, transport=brief_generator.request_response):
        """Apply the same rolling budgets to authenticated manual generation."""
        brief_generator.configuration()
        url, expected_sha = payload.get("url", ""), payload.get("sha256", "")
        with self.db_lock, monitor.connect(self.db_path) as db:
            source = db.execute("SELECT extracted_text FROM sources WHERE url=?", (url,)).fetchone()
            reservation = brief_generator.token_reservation(source["extracted_text"] if source else "")
            claim = monitor.claim_manual_generation(
                db, url, expected_sha, reservation, self.generation_daily_limit, self.generation_token_limit
            )
        error_code = None
        usage = None
        try:
            result = self.generate_brief(payload, transport=transport)
            usage = result.get("usage")
            return result
        except brief_generator.GenerationUnavailable:
            error_code = "generation-not-configured"
            raise
        except brief_generator.GenerationFailed:
            error_code = "generation-failed"
            raise
        except ValueError:
            error_code = "validation-failed"
            raise
        except Exception:
            error_code = "worker-error"
            raise
        finally:
            with self.db_lock, monitor.connect(self.db_path) as db:
                monitor.finish_manual_generation(db, claim, error_code=error_code, usage=usage)

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
                """SELECT count(*) FROM sources
                   WHERE source_mode='remote' AND (next_fetch_at IS NULL OR next_fetch_at<=?)""",
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
        not_modified = 0
        with self.db_lock, monitor.connect(self.db_path) as db:
            for row, result, error in completed:
                if error is None:
                    monitor.save_source_check(db, row, result)
                    if result.get("notModified"):
                        not_modified += 1
                    else:
                        monitor.activate_generation_job(
                            db, row["url"], brief_generator.token_reservation(result["extractedText"])
                        )
                else:
                    monitor.save_source_error(db, row, error)
                    errors += 1
            monitor.write_snapshot(db, self.snapshot_path)
        with self.state_lock:
            self.state["sourceChecks"] += len(completed)
            self.state["sourceFetchErrors"] += errors
            self.state["sourceNotModified"] += not_modified
            self.state["pendingBodies"] = max(0, pending - len(completed))

    def process_generation_job(self):
        if not self.auto_drafts_enabled:
            return None
        with self.db_lock, monitor.connect(self.db_path) as db:
            claim = monitor.claim_generation_job(
                db, self.generation_daily_limit, self.generation_max_attempts, self.generation_token_limit
            )
        if not claim:
            return None
        error_code = None
        usage = None
        try:
            generated = self.generate_brief({"url": claim["url"], "sha256": claim["sha256"]})
            usage = generated.get("usage")
        except brief_generator.GenerationUnavailable:
            error_code = "generation-not-configured"
        except brief_generator.GenerationFailed:
            error_code = "generation-failed"
        except ValueError:
            error_code = "validation-failed"
        except Exception:
            error_code = "worker-error"
        with self.db_lock, monitor.connect(self.db_path) as db:
            return monitor.finish_generation_job(
                db, claim, error_code=error_code, max_attempts=self.generation_max_attempts, usage=usage
            )

    def run_generation(self):
        with self.db_lock, monitor.connect(self.db_path) as db:
            monitor.recover_generation_jobs(db)
        while not self.stop_event.is_set():
            self.process_generation_job()
            self.stop_event.wait(self.generation_interval)

    def perform_backup(self):
        attempted_at = utc_now()
        with self.state_lock:
            self.state["backup"]["lastAttemptAt"] = attempted_at
        try:
            with self.db_lock:
                result = persistence.create_backup(
                    self.db_path, self.backup_dir, self.backup_retention
                )
        except Exception:
            with self.state_lock:
                self.state["backup"].update({
                    "healthy": False, "lastError": "backup-failed",
                })
            return False
        with self.state_lock:
            self.state["backup"].update({
                "healthy": True, "lastSuccessAt": result["createdAt"],
                "backupCount": result["backupCount"], "lastError": None,
            })
        return True

    def run_backup(self):
        # The monitor initializes the schema under this same lock. Waiting for the
        # database file keeps a new deployment from reporting a false backup fault.
        while not self.stop_event.is_set() and not self.db_path.is_file():
            self.stop_event.wait(1)
        while not self.stop_event.is_set():
            self.perform_backup()
            self.stop_event.wait(self.backup_interval)

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

                cycle_started = time.monotonic()
                futures = {pool.submit(self.collect_discovery_timed, ticker): ticker for ticker in due}
                collected = []
                for future in as_completed(futures):
                    ticker = futures[future]
                    try:
                        result, links, request_duration_ms = future.result()
                    except Exception as exc:
                        request_duration_ms = max(0, round((time.monotonic() - cycle_started) * 1000))
                        result = {
                            "ticker": ticker,
                            "status": "degraded",
                            "route": "none",
                            "sourceUrl": monitor.INDEXES[ticker],
                            "candidates": 0,
                            "error": str(exc),
                        }
                        links = {}
                    collected.append((ticker, result, links, request_duration_ms))
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
                    for ticker, result, links, request_duration_ms in collected:
                        signature = (result["status"], result["sourceUrl"], tuple(sorted(links)))
                        new_urls = set(links) - known[ticker]
                        if signatures.get(ticker) != signature or new_urls:
                            inserted = monitor.save_discovery(db, ticker, result, links)
                            known[ticker].update(inserted)
                            if baseline_ready[ticker]:
                                events = monitor.add_release_events(db, ticker, inserted)
                                if self.auto_drafts_enabled:
                                    for url in events:
                                        source = db.execute("SELECT extracted_text FROM sources WHERE url=?", (url,)).fetchone()
                                        reservation = brief_generator.token_reservation(source["extracted_text"] if source else "")
                                        monitor.queue_generation_job(db, url, reservation)
                                new_count += len(events)
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
                            "basePollSeconds": self.interval_for(ticker),
                            "nextPollSeconds": result["nextPollSeconds"],
                            "requestDurationMs": request_duration_ms,
                            "error": monitor.public_error(result["error"]),
                        }
                    if changed:
                        monitor.write_snapshot(db, self.snapshot_path)

                with self.state_lock:
                    self.state["ready"] = True
                    self.state["lastCycleAt"] = checked_at
                    self.state["lastCycleDurationMs"] = max(0, round((time.monotonic() - cycle_started) * 1000))
                    self.state["lastCycleCompanies"] = len(due)
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
        if path not in {"/admin/briefs/generate", "/admin/briefs/draft", "/admin/briefs/review"}:
            self.send_json(404, {"ok": False, "error": "not-found"})
            return
        if not self.editor_authorized():
            self.send_json(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            payload = self.read_json()
            if path.endswith("/generate"):
                result = self.app.generate_brief_budgeted(payload)
            elif path.endswith("/draft"):
                result = self.app.save_brief(payload)
            else:
                result = self.app.decide_brief(payload)
            self.send_json(200, {"ok": True, **result})
        except brief_generator.GenerationUnavailable:
            self.send_json(503, {"ok": False, "error": "generation-not-configured"})
        except brief_generator.GenerationFailed:
            self.send_json(502, {"ok": False, "error": "generation-failed"})
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
