from concurrent.futures import ThreadPoolExecutor
import importlib.util
from pathlib import Path
import json
import os
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
monitor_spec = importlib.util.spec_from_file_location("monitor", ROOT / "scripts/research/monitor.py")
monitor = importlib.util.module_from_spec(monitor_spec)
monitor_spec.loader.exec_module(monitor)
sys.modules["monitor"] = monitor
generator_spec = importlib.util.spec_from_file_location("brief_generator", ROOT / "scripts/research/brief_generator.py")
brief_generator = importlib.util.module_from_spec(generator_spec)
generator_spec.loader.exec_module(brief_generator)
sys.modules["brief_generator"] = brief_generator
persistence_spec = importlib.util.spec_from_file_location("persistence", ROOT / "scripts/research/persistence.py")
persistence = importlib.util.module_from_spec(persistence_spec)
persistence_spec.loader.exec_module(persistence)
sys.modules["persistence"] = persistence
delivery_spec = importlib.util.spec_from_file_location("incident_delivery", ROOT / "scripts/research/incident_delivery.py")
incident_delivery = importlib.util.module_from_spec(delivery_spec)
delivery_spec.loader.exec_module(incident_delivery)
sys.modules["incident_delivery"] = incident_delivery
service_spec = importlib.util.spec_from_file_location("research_service", ROOT / "scripts/research/service.py")
service = importlib.util.module_from_spec(service_spec)
service_spec.loader.exec_module(service)


class ResearchServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "automatic.sqlite"
        self.snapshot_path = Path(self.temp.name) / "snapshot.json"
        with monitor.connect(self.db_path) as db:
            monitor.add_source(db, "NBIS", "https://nebius.com/newsroom/older", title="Older")
            monitor.add_source(db, "NBIS", "https://nebius.com/newsroom/new-release", title="New")
            monitor.add_release_events(db, "NBIS", ["https://nebius.com/newsroom/new-release"])

    def tearDown(self):
        self.temp.cleanup()

    def brief_validation_sha(self, app, url):
        return next(
            item["draft_validation_sha256"]
            for item in app.editorial_queue(50)["items"] if item["url"] == url
        )

    def test_legacy_full_ticker_roster_migrates_amzn_to_be(self):
        legacy = ",".join(service.LEGACY_FULL_TICKERS)
        with patch.dict(os.environ, {"RESEARCH_TICKERS": legacy}, clear=False):
            app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        self.assertEqual(len(app.tickers), 22)
        self.assertIn("BE", app.tickers)
        self.assertNotIn("AMZN", app.tickers)
        self.assertEqual(set(app.tickers), set(monitor.PROVIDERS))

    def test_partial_roster_still_rejects_retired_or_unknown_tickers(self):
        with patch.dict(os.environ, {"RESEARCH_TICKERS": "NBIS,AMZN"}, clear=False):
            with self.assertRaisesRegex(ValueError, "Unknown RESEARCH_TICKERS: AMZN"):
                service.AutomaticMonitor(self.db_path, self.snapshot_path)

    def test_liveness_does_not_wait_for_first_official_source_cycle(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
        server.app = app
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urlopen(f"{base}/livez", timeout=2) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read()), {"ok": True, "status": "alive"})
            with urlopen(f"{base}/health", timeout=2) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read())["health"]["status"], "starting")
            with self.assertRaises(HTTPError) as starting:
                urlopen(f"{base}/readyz", timeout=2)
            self.assertEqual(starting.exception.code, 503)
            self.assertEqual(json.loads(starting.exception.read())["health"]["status"], "starting")
        finally:
            server.shutdown()
            server.server_close()

    def test_body_fetch_prioritizes_new_event_and_exports_only_metadata(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 1
        original_fetch = monitor.fetch
        monitor.fetch = lambda *_: (b"<main><h1>New release</h1><p>Evidence body.</p></main>", "text/html")
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                app.fetch_bodies(pool)
        finally:
            monitor.fetch = original_fetch

        with monitor.connect(self.db_path) as db:
            newest = db.execute("SELECT * FROM sources WHERE url LIKE '%new-release'").fetchone()
            older = db.execute("SELECT * FROM sources WHERE url LIKE '%older'").fetchone()
            self.assertIsNotNone(newest["sha256"])
            self.assertIn("Evidence body.", newest["extracted_text"])
            self.assertIsNone(older["sha256"])
        exported = self.snapshot_path.read_text()
        self.assertIn('"extracted_chars"', exported)
        self.assertNotIn("Evidence body.", exported)
        self.assertEqual(app.public_state()["sourceChecks"], 1)

    def test_body_candidates_prioritize_missing_evidence_before_routine_rechecks(self):
        incomplete = "https://nebius.com/newsroom/legacy-evidence.pdf"
        with monitor.connect(self.db_path) as db:
            for url in (
                "https://nebius.com/newsroom/older",
                "https://nebius.com/newsroom/new-release",
            ):
                db.execute("""
                  UPDATE sources
                  SET sha256=?,raw_sha256=?,body_sha256=?,content_type='text/html',
                      extracted_text='Existing evidence.',extracted_chars=18,
                      checked_at='2026-09-20T00:00:00+00:00',next_fetch_at=NULL
                  WHERE url=?
                """, ("a" * 64, "a" * 64, "b" * 64, url))
            monitor.add_source(db, "NBIS", incomplete, title="Legacy PDF")
            db.execute("""
              UPDATE sources
              SET sha256=?,raw_sha256=?,body_sha256=?,content_type='application/pdf',
                  extracted_text='',extracted_chars=0,
                  checked_at='2026-09-21T00:00:00+00:00',next_fetch_at=NULL
              WHERE url=?
            """, ("c" * 64, "c" * 64, "d" * 64, incomplete))
            db.commit()

        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 1
        rows, pending = app.body_candidates()
        self.assertEqual(pending, 3)
        self.assertEqual(rows[0]["url"], incomplete)

    def test_body_candidates_keep_unseen_releases_ahead_of_missing_evidence(self):
        incomplete = "https://nebius.com/newsroom/legacy-evidence.pdf"
        with monitor.connect(self.db_path) as db:
            monitor.add_source(db, "NBIS", incomplete, title="Legacy PDF")
            db.execute("""
              UPDATE sources
              SET sha256=?,raw_sha256=?,body_sha256=?,content_type='application/pdf',
                  extracted_text='',extracted_chars=0,next_fetch_at=NULL
              WHERE url=?
            """, ("c" * 64, "c" * 64, "d" * 64, incomplete))
            db.commit()

        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 1
        rows, pending = app.body_candidates()
        self.assertEqual(pending, 3)
        self.assertTrue(rows[0]["url"].endswith("new-release"))

    def test_not_modified_body_check_does_not_reextract_or_requeue_generation(self):
        url = "https://nebius.com/newsroom/new-release"
        with monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "e" * 64, "contentType": "text/html", "contentBytes": 70,
                "extractedText": "Existing evidence remains current.", "extractedChars": 34,
                "responseEtag": '"revision-1"', "responseLastModified": None,
            })
            db.execute("UPDATE sources SET next_fetch_at=NULL WHERE url=?", (url,))
            db.commit()

        def not_modified(_url, _ticker, validators=None, include_metadata=False):
            self.assertEqual(validators["etag"], '"revision-1"')
            self.assertTrue(include_metadata)
            return {
                "content": None, "contentType": None, "etag": '"revision-1"',
                "lastModified": None, "notModified": True,
            }

        not_modified.supports_persistent_validators = True
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 1
        original_fetch = monitor.fetch
        monitor.fetch = not_modified
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                app.fetch_bodies(pool)
        finally:
            monitor.fetch = original_fetch
        with monitor.connect(self.db_path) as db:
            source = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            self.assertEqual(source["sha256"], "e" * 64)
            self.assertEqual(source["extracted_text"], "Existing evidence remains current.")
            self.assertEqual(db.execute(
                "SELECT count(*) FROM brief_generation_jobs WHERE url=?", (url,)
            ).fetchone()[0], 0)
        self.assertEqual(app.public_state()["sourceNotModified"], 1)

    def test_verified_backup_updates_public_health_without_exposing_storage_details(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.backup_dir = Path(self.temp.name) / "backups"
        self.assertTrue(app.perform_backup())
        state = app.public_state()["backup"]
        self.assertTrue(state["healthy"])
        self.assertEqual(state["backupCount"], 1)
        self.assertIsNotNone(state["lastSuccessAt"])
        self.assertNotIn("sha256", state)
        self.assertNotIn("filename", state)
        self.assertNotIn(str(app.backup_dir), json.dumps(state))

    def test_public_health_exposes_only_bounded_fetch_cache_totals(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        cache = app.public_state()["fetchCache"]
        self.assertEqual(set(cache), {"entries", "bytes", "maxEntries", "maxBytes"})
        self.assertLessEqual(cache["entries"], cache["maxEntries"])
        self.assertLessEqual(cache["bytes"], cache["maxBytes"])
        self.assertNotIn("https://", json.dumps(cache))

    def test_discovery_signature_detects_same_url_inline_feed_revisions(self):
        result = {
            "status": "ok", "route": "primary+supplemental",
            "sourceUrl": "https://investor.marvell.com/news-events/press-releases/rss",
            "sourceFormat": "rss+sec-json", "sourcesChecked": 2,
            "sourcesConfigured": 3, "error": None,
        }
        url = "https://investor.marvell.com/news-events/press-releases/detail/1234/example"
        initial = {
            url: {
                "title": "Marvell official update", "publishedOn": "2026-09-22",
                "contentType": "application/rss+xml", "contentBytes": 160,
                "inlineText": "Initial official evidence with enough verified article text.",
            }
        }
        unchanged = {url: dict(initial[url])}
        revised = {url: {
            **initial[url],
            "inlineText": "Revised official evidence with enough verified article text.",
        }}
        remote_only = {url: {
            "title": initial[url]["title"], "publishedOn": "2026-09-22",
        }}

        original_signature = service.discovery_signature(result, initial)
        self.assertEqual(original_signature, service.discovery_signature(result, unchanged))
        self.assertNotEqual(original_signature, service.discovery_signature(result, revised))
        self.assertNotEqual(original_signature, service.discovery_signature(result, remote_only))
        self.assertEqual(len(original_signature), 64)

    def test_public_health_exposes_url_free_priority_sec_evidence_counts(self):
        sources = {
            "TSM": "https://www.sec.gov/Archives/edgar/data/1046179/000119312526000001/tsm-6k.htm",
            "MRVL": "https://www.sec.gov/Archives/edgar/data/1835632/000183563226000001/mrvl-8k.htm",
            "ANET": "https://www.sec.gov/Archives/edgar/data/1596532/000159653226000001/anet-8k.htm",
            "VRT": "https://www.sec.gov/Archives/edgar/data/1674101/000167410126000001/vrt-8k.htm",
        }
        with monitor.connect(self.db_path) as db:
            for ticker, url in sources.items():
                monitor.add_source(db, ticker, url, title=f"{ticker} filing")
            db.execute("""
              UPDATE sources SET sha256=?,checked_at=?,extracted_chars=120,evidence_kind='direct'
              WHERE url=?
            """, ("a" * 64, "2026-09-22T00:01:00+00:00", sources["MRVL"]))
            db.execute("""
              UPDATE sources SET sha256=?,checked_at=?,extracted_chars=240,
                                 evidence_kind='sec-exhibit-99.1',
                                 evidence_url='https://www.sec.gov/Archives/edgar/data/1596532/000159653226000001/exhibit991.htm'
              WHERE url=?
            """, ("b" * 64, "2026-09-22T00:02:00+00:00", sources["ANET"]))
            db.execute("""
              UPDATE sources SET checked_at=?,error='sec-exhibit-unavailable'
              WHERE url=?
            """, ("2026-09-22T00:03:00+00:00", sources["VRT"]))
            db.commit()

        evidence = service.AutomaticMonitor(self.db_path, self.snapshot_path).public_state()["secEvidence"]
        self.assertEqual(
            {key: evidence[key] for key in ("total", "exhibit", "direct", "pending", "error")},
            {"total": 4, "exhibit": 1, "direct": 1, "pending": 1, "error": 1},
        )
        self.assertEqual(evidence["lastCheckedAt"], "2026-09-22T00:03:00+00:00")
        self.assertEqual(evidence["byTicker"]["PLTR"]["total"], 0)
        serialized = json.dumps(evidence)
        self.assertNotIn("https://", serialized)
        self.assertNotIn("sec-exhibit-unavailable", serialized)

    def test_backup_becomes_degraded_when_last_success_exceeds_deadline(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        with app.state_lock:
            app.state["ready"] = True
            app.state["lastCycleAt"] = service.utc_now()
            app.state["backup"].update({
                "healthy": True, "lastSuccessAt": "2020-01-01T00:00:00+00:00",
                "backupCount": 2,
            })
        state = app.public_state()
        self.assertEqual(state["backup"]["status"], "overdue")
        self.assertTrue(state["backup"]["overdue"])
        self.assertIn("backup-overdue", state["health"]["issues"])
        self.assertEqual(state["health"]["status"], "degraded")
        app.sync_health_incidents()
        state = app.public_state()
        self.assertEqual(state["incidents"]["open"], 1)
        self.assertFalse(state["incidents"]["deliveryEnabled"])
        self.assertEqual(state["incidents"]["recent"][0]["errorCode"], "backup-overdue")

    def test_successful_backup_resolves_a_persisted_failure_without_sending(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.backup_dir = Path(self.temp.name) / "backups"
        with patch.object(persistence, "create_backup", side_effect=OSError("private path must not leak")):
            self.assertFalse(app.perform_backup())
        with monitor.connect(self.db_path) as db:
            before = monitor.operational_incident_summary(db)
        self.assertEqual(before["open"], 1)
        self.assertEqual(before["heldNotifications"], 1)
        self.assertTrue(app.perform_backup())
        after = app.public_state()["incidents"]
        self.assertEqual(after["open"], 0)
        self.assertEqual(after["heldNotifications"], 2)
        self.assertFalse(after["deliveryEnabled"])

    def test_backup_failure_and_stalled_monitor_have_distinct_health_codes(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.backup_dir = Path(self.temp.name) / "backups"
        with patch.object(persistence, "create_backup", side_effect=OSError("private path must not leak")):
            self.assertFalse(app.perform_backup())
        with app.state_lock:
            app.state["ready"] = True
            app.state["lastCycleAt"] = "2020-01-01T00:00:00+00:00"
        app.sync_health_incidents()
        state = app.public_state()
        self.assertEqual(state["backup"]["status"], "failed")
        self.assertEqual(state["backup"]["lastError"], "backup-failed")
        self.assertCountEqual(state["health"]["issues"], ["monitor-stale", "backup-failed"])
        self.assertEqual(state["incidents"]["open"], 2)
        self.assertNotIn("private path", json.dumps(state))

    def test_public_health_reads_do_not_create_or_repeat_incidents(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        with app.state_lock:
            app.state["ready"] = True
            app.state["lastCycleAt"] = "2020-01-01T00:00:00+00:00"
        first = app.public_state()
        second = app.public_state()
        self.assertEqual(first["health"]["issues"], ["monitor-stale"])
        self.assertEqual(second["health"]["issues"], ["monitor-stale"])
        self.assertEqual(second["incidents"]["total"], 0)
        app.sync_health_incidents()
        recorded = app.public_state()["incidents"]
        self.assertEqual(recorded["open"], 1)
        self.assertEqual(recorded["recent"][0]["occurrences"], 1)

    def test_incident_watch_failure_is_visible_and_retried_without_raw_error(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        original = app.sync_health_incidents
        with patch.object(app, "sync_health_incidents", side_effect=OSError("private database path must not leak")):
            self.assertFalse(app.check_incident_watch_once())
        failed = app.public_state()
        self.assertIn("incident-watch-failed", failed["health"]["issues"])
        self.assertEqual(failed["incidentWatch"]["lastError"], "incident-watch-failed")
        self.assertNotIn("private database path", json.dumps(failed))
        app.sync_health_incidents = original
        self.assertTrue(app.check_incident_watch_once())
        recovered = app.public_state()
        self.assertNotIn("incident-watch-failed", recovered["health"]["issues"])
        self.assertTrue(recovered["incidentWatch"]["healthy"])
        self.assertEqual(recovered["incidents"]["open"], 0)
        self.assertEqual(recovered["incidents"]["heldNotifications"], 2)

    def test_incident_delivery_is_fail_closed_by_default(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        with monitor.connect(self.db_path) as db:
            monitor.record_operational_incident(
                db, "source:NBIS", "official-source", "NBIS", "warning", "timeout"
            )
        sent = []
        self.assertIsNone(app.process_incident_notification(
            transport=lambda config, claim: sent.append((config, claim))
        ))
        self.assertEqual(sent, [])
        state = app.public_state()
        self.assertFalse(state["notification"]["enabled"])
        self.assertFalse(state["incidents"]["deliveryEnabled"])
        self.assertEqual(state["incidents"]["heldNotifications"], 1)

    def test_explicit_cutover_delivers_only_new_incident_transitions(self):
        environment = {
            "RESEARCH_INCIDENT_DELIVERY_ENABLED": "true",
            "RESEARCH_INCIDENT_DELIVERY_START_AT": "2026-09-20T00:00:00Z",
            "RESEARCH_INCIDENT_WEBHOOK_URL": "https://alerts.example.com/incidents",
            "RESEARCH_INCIDENT_WEBHOOK_TOKEN": "x" * 40,
        }
        with monitor.connect(self.db_path) as db:
            monitor.record_operational_incident(
                db, "source:OLD", "official-source", "OLD", "warning", "timeout",
                "2026-09-19T23:59:59+00:00",
            )
            monitor.record_operational_incident(
                db, "source:NBIS", "official-source", "NBIS", "critical", "http-403",
                "2026-09-20T00:00:01+00:00",
            )
        delivered = []
        with patch.dict("os.environ", environment, clear=False):
            app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
            outcome = app.process_incident_notification(
                transport=lambda config, claim: delivered.append(
                    incident_delivery.public_payload(claim)
                )
            )
        self.assertEqual(outcome, "delivered")
        self.assertEqual(delivered[0]["incident"]["key"], "source:NBIS")
        self.assertNotIn("url", delivered[0]["incident"])
        state = app.public_state()
        self.assertTrue(state["incidents"]["deliveryEnabled"])
        self.assertEqual(state["incidents"]["heldNotifications"], 1)
        self.assertEqual(state["incidents"]["deliveredNotifications"], 1)

    def test_invalid_notification_configuration_never_attempts_delivery(self):
        environment = {
            "RESEARCH_INCIDENT_DELIVERY_ENABLED": "true",
            "RESEARCH_INCIDENT_DELIVERY_START_AT": "2026-09-20T00:00:00Z",
            "RESEARCH_INCIDENT_WEBHOOK_URL": "http://127.0.0.1/private",
            "RESEARCH_INCIDENT_WEBHOOK_TOKEN": "x" * 40,
        }
        with patch.dict("os.environ", environment, clear=False):
            app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        self.assertFalse(app.notification_enabled)
        self.assertEqual(app.state["notification"]["lastError"], "notification-url-invalid")

    def test_inline_exchange_evidence_is_not_refetched_as_an_article(self):
        inline_url = "https://openapi.twse.com.tw/v1/opendata/t187ap04_L?company=2330&date=1150918&time=153643&id=abc"
        with monitor.connect(self.db_path) as db:
            monitor.add_source(db, "TSM", inline_url)
            db.execute("UPDATE sources SET source_mode='inline' WHERE url=?", (inline_url,))
            db.commit()
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        self.assertEqual(app.interval_for("TSM"), 3)
        rows, pending = app.body_candidates()
        self.assertNotIn(inline_url, [row["url"] for row in rows])
        self.assertEqual(pending, 2)

    def test_discovery_timing_is_measured_separately_from_poll_interval(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        with patch.object(monitor, "collect_discovery", return_value=({"status": "ok"}, {})):
            result, links, elapsed = app.collect_discovery_timed("TSM")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(links, {})
        self.assertGreaterEqual(elapsed, 0)
        self.assertEqual(app.interval_for("TSM"), 3)

    def test_editorial_methods_require_current_evidence_and_do_not_deliver(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        with monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url LIKE '%new-release'").fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "a" * 64, "contentType": "text/html", "contentBytes": 80,
                "extractedText": "Capacity will increase in 2027.\nExecution remains subject to demand.", "extractedChars": 70,
            })
        payload = {
            "url": "https://nebius.com/newsroom/new-release", "sha256": "a" * 64,
            "summaryJa": "公式発表によると、AI向け容量は2027年に増加する計画です。",
            "impactLabel": "mixed", "impactJa": "供給能力の拡大余地がありますが、実行と需要の確認が引き続き必要です。",
            "confidence": "medium", "evidence": {
                "summary": ["Capacity will increase in 2027."], "impact": ["Execution remains subject to demand."],
            },
        }
        self.assertFalse(app.save_brief(payload)["published"])
        queue = app.editorial_queue(5)
        self.assertEqual(queue["items"][0]["brief_status"], "draft")
        self.assertTrue(queue["items"][0]["review_preflight"]["ready"])
        with monitor.connect(self.db_path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM brief_review_history").fetchone()[0], 0)
        with self.assertRaisesRegex(ValueError, "draft-revision-mismatch"):
            app.decide_brief({
                "url": payload["url"], "sha256": payload["sha256"],
                "decision": "approved", "reviewer": "editor",
                "reason": "下書き指紋なしでは判断できません",
            })
        decision = app.decide_brief({
            "url": payload["url"], "sha256": payload["sha256"], "decision": "approved",
            "validationSha256": self.brief_validation_sha(app, payload["url"]),
            "reviewer": "editor", "reason": "原文と数値を確認",
        })
        self.assertFalse(decision["published"])

    def test_updated_source_requires_rewrite_before_hold_and_approval(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        url = "https://nebius.com/newsroom/new-release"
        first_text = "Capacity will increase in 2027.\nExecution remains subject to demand."
        with monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "1" * 64, "contentType": "text/html", "contentBytes": 80,
                "extractedText": first_text, "extractedChars": len(first_text),
            })
        first = {
            "url": url, "sha256": "1" * 64,
            "summaryJa": "公式発表によると、AI向け容量は2027年に増加する計画です。",
            "impactLabel": "mixed",
            "impactJa": "供給能力の拡大余地がありますが、実行と需要の確認が引き続き必要です。",
            "confidence": "medium", "evidence": {
                "summary": ["Capacity will increase in 2027."],
                "impact": ["Execution remains subject to demand."],
            },
        }
        app.save_brief(first)
        app.decide_brief({
            "url": url, "sha256": first["sha256"], "decision": "approved",
            "validationSha256": self.brief_validation_sha(app, url),
            "reviewer": "first-editor", "reason": "初版の原文と根拠を確認しました",
        })
        self.assertEqual(app.public_snapshot()["briefs"][0]["source_sha256"], first["sha256"])

        second_text = "Capacity will increase in 2028.\nExecution remains subject to demand and permits."
        with monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "2" * 64, "contentType": "text/html", "contentBytes": 88,
                "extractedText": second_text, "extractedChars": len(second_text),
            })
        stale = app.editorial_queue(5)["items"][0]
        self.assertEqual(stale["brief_status"], "stale")
        self.assertFalse(stale["brief_current"])
        self.assertFalse(stale["review_preflight"]["ready"])
        self.assertEqual(stale["review_preflight"]["blockers"], ["source-revision-mismatch"])
        self.assertEqual(stale["previous_brief"]["summary_ja"], first["summaryJa"])
        self.assertEqual(app.public_snapshot()["briefs"], [])
        with self.assertRaises(ValueError):
            app.decide_brief({
                "url": url, "sha256": "2" * 64, "decision": "approved",
                "reviewer": "stale-editor", "reason": "古い下書きを承認しようとしました",
            })

        second = {
            "url": url, "sha256": "2" * 64,
            "summaryJa": "公式発表によると、AI向け容量は2028年に増加する計画へ更新されました。",
            "impactLabel": "mixed",
            "impactJa": "供給拡大の余地がありますが、需要と許認可の確認が引き続き必要です。",
            "confidence": "medium", "evidence": {
                "summary": ["Capacity will increase in 2028."],
                "impact": ["Execution remains subject to demand and permits."],
            },
        }
        app.save_brief(second)
        app.decide_brief({
            "url": url, "sha256": second["sha256"], "decision": "held",
            "validationSha256": self.brief_validation_sha(app, url),
            "reviewer": "second-editor", "reason": "許認可への影響を追加確認します",
        })
        self.assertEqual(app.public_snapshot()["briefs"], [])

        corrected = {
            **second,
            "impactJa": "供給拡大の機会はありますが、需要と許認可が未確定のため継続確認が必要です。",
        }
        app.save_brief(corrected)
        app.decide_brief({
            "url": url, "sha256": corrected["sha256"], "decision": "approved",
            "validationSha256": self.brief_validation_sha(app, url),
            "reviewer": "final-editor", "reason": "更新後の原文と修正版の根拠を確認しました",
        })
        public = app.public_snapshot()["briefs"]
        self.assertEqual(len(public), 1)
        self.assertEqual(public[0]["source_sha256"], corrected["sha256"])
        self.assertEqual(public[0]["impact_ja"], corrected["impactJa"])
        queue = app.editorial_queue(5)["items"][0]
        self.assertTrue(queue["brief_current"])
        self.assertIsNone(queue["previous_brief"])
        self.assertEqual(
            [(item["decision"], item["current_revision"]) for item in queue["review_history"]],
            [("approved", True), ("held", False), ("approved", False)],
        )

    def test_ai_generation_must_pass_existing_evidence_gate_and_stays_private(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        with monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url LIKE '%new-release'").fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "d" * 64, "contentType": "text/html", "contentBytes": 80,
                "extractedText": "Capacity will increase in 2027. Execution remains subject to demand.", "extractedChars": 69,
            })
        generated = {
            "draft": {
                "summaryJa": "公式発表によると、AI向け容量は2027年に増加する計画です。",
                "impactLabel": "mixed", "impactJa": "供給能力の拡大余地がありますが、実行と需要の確認が引き続き必要です。",
                "confidence": "medium", "evidence": {
                    "summary": ["Capacity will increase in 2027."], "impact": ["Execution remains subject to demand."],
                },
            },
            "audit": {"provider": "openai-responses", "model": "test-model", "responseId": "resp_test",
                      "sourceTruncated": False, "inputTokens": 400, "outputTokens": 120, "totalTokens": 520},
        }
        with patch.object(brief_generator, "generate_draft", return_value=generated):
            result = app.generate_brief({"url": "https://nebius.com/newsroom/new-release", "sha256": "d" * 64})
        self.assertFalse(result["published"])
        self.assertEqual(result["model"], "test-model")
        self.assertEqual(app.public_snapshot()["briefs"], [])
        item = app.editorial_queue(5)["items"][0]
        self.assertEqual(item["brief_status"], "draft")
        self.assertEqual(item["generation_response_id"], "resp_test")
        self.assertEqual(item["generation_source_truncated"], 0)
        self.assertEqual(item["generation_total_tokens"], 520)
        app.decide_brief({
            "url": "https://nebius.com/newsroom/new-release", "sha256": "d" * 64,
            "validationSha256": item["draft_validation_sha256"],
            "decision": "approved", "reviewer": "human-editor",
            "reason": "AI下書きと公式原文の根拠を人間が照合しました",
        })
        public = app.public_snapshot()["briefs"]
        self.assertEqual(public[0]["generation_method"], "ai-assisted")
        self.assertNotIn("generation_provider", public[0])
        self.assertNotIn("generation_model", public[0])
        self.assertNotIn("generation_response_id", public[0])

    def test_manual_generation_uses_the_same_rolling_budget(self):
        url = "https://nebius.com/newsroom/new-release"
        with patch.dict(os.environ, {
            "OPENAI_API_KEY": "sk-" + "x" * 40, "RESEARCH_SUMMARY_MODEL": "test-model",
            "RESEARCH_AUTO_DRAFT_DAILY_LIMIT": "1", "RESEARCH_AUTO_DRAFT_TOKEN_LIMIT": "10000",
        }, clear=False):
            app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        with monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "7" * 64, "contentType": "text/html", "contentBytes": 90,
                "extractedText": "Capacity will increase in 2027. Execution remains subject to demand.", "extractedChars": 69,
            })
        generated = {
            "draft": {
                "summaryJa": "公式発表によると、容量は2027年に増加する計画です。",
                "impactLabel": "mixed", "impactJa": "供給拡大の余地がありますが、需要条件の確認が必要です。",
                "confidence": "medium", "evidence": {
                    "summary": ["Capacity will increase in 2027."],
                    "impact": ["Execution remains subject to demand."],
                },
            },
            "audit": {"provider": "openai-responses", "model": "test-model", "responseId": "resp_manual",
                      "sourceTruncated": False, "inputTokens": 400, "outputTokens": 100, "totalTokens": 500},
        }
        with patch.dict(os.environ, {
            "OPENAI_API_KEY": "sk-" + "x" * 40, "RESEARCH_SUMMARY_MODEL": "test-model",
        }, clear=False), patch.object(brief_generator, "generate_draft", return_value=generated):
            app.generate_brief_budgeted({"url": url, "sha256": "7" * 64})
            with self.assertRaisesRegex(ValueError, "generation-daily-limit-reached"):
                app.generate_brief_budgeted({"url": url, "sha256": "7" * 64})
        state = app.public_state()["generation"]
        self.assertEqual(state["attemptsLast24Hours"], 1)
        self.assertEqual(state["measuredTokensLast24Hours"], 500)

    def test_auto_generation_is_opt_in_and_does_not_backfill_existing_events(self):
        with patch.dict(os.environ, {
            "RESEARCH_AUTO_DRAFTS": "true", "OPENAI_API_KEY": "sk-" + "x" * 40,
            "RESEARCH_SUMMARY_MODEL": "test-model",
        }, clear=False):
            app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        self.assertTrue(app.auto_drafts_enabled)
        with monitor.connect(self.db_path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM brief_generation_jobs").fetchone()[0], 0)
        state = app.public_state()["generation"]
        self.assertTrue(state["enabled"])
        self.assertEqual(state["queued"], 0)

    def test_generation_queue_waits_for_body_then_claims_once(self):
        url = "https://nebius.com/newsroom/new-release"
        with monitor.connect(self.db_path) as db:
            queued = monitor.queue_generation_job(db, url, 7_000)
            self.assertEqual(queued["status"], "waiting-body")
            self.assertIsNone(monitor.claim_generation_job(db, 20, 3, 100_000))
            row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "e" * 64, "contentType": "text/html", "contentBytes": 80,
                "extractedText": "Capacity will increase. Execution remains subject to demand.", "extractedChars": 60,
            })
            monitor.activate_generation_job(db, url, 7_000)
            claim = monitor.claim_generation_job(db, 20, 3, 100_000)
            self.assertEqual(claim["url"], url)
            self.assertEqual(claim["attempt"], 1)
            self.assertIsNone(monitor.claim_generation_job(db, 20, 3, 100_000))

    def test_generation_retry_and_rolling_call_limit_are_persistent(self):
        url = "https://nebius.com/newsroom/new-release"
        with monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "f" * 64, "contentType": "text/html", "contentBytes": 80,
                "extractedText": "Official evidence remains available for review.", "extractedChars": 47,
            })
            monitor.queue_generation_job(db, url, 7_000)
            claim = monitor.claim_generation_job(db, 1, 3, 100_000)
            result = monitor.finish_generation_job(db, claim, "generation-failed", 3)
            self.assertEqual(result["status"], "retry")
            self.assertEqual(result["retrySeconds"], 60)
            self.assertIsNone(monitor.claim_generation_job(db, 1, 3, 100_000))
            stats = monitor.generation_queue_stats(db, 1, 100_000)
            self.assertEqual(stats["attemptsLast24Hours"], 1)
            self.assertTrue(stats["limitReached"])
            self.assertEqual(stats["lastErrorCode"], "generation-failed")

    def test_token_budget_blocks_before_generation_and_uses_measured_total_after_success(self):
        url = "https://nebius.com/newsroom/new-release"
        with monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "8" * 64, "contentType": "text/html", "contentBytes": 80,
                "extractedText": "Official evidence remains available for review.", "extractedChars": 47,
            })
            monitor.queue_generation_job(db, url, 7_000)
            self.assertIsNone(monitor.claim_generation_job(db, 20, 3, 6_999))
            blocked = monitor.generation_queue_stats(db, 20, 6_999)
            self.assertEqual(blocked["tokenBudgetBlocked"], 1)
            claim = monitor.claim_generation_job(db, 20, 3, 100_000)
            monitor.finish_generation_job(db, claim, max_attempts=3, usage={
                "inputTokens": 500, "outputTokens": 100, "totalTokens": 600,
            })
            stats = monitor.generation_queue_stats(db, 20, 100_000)
            self.assertEqual(stats["budgetTokensLast24Hours"], 600)
            self.assertEqual(stats["measuredTokensLast24Hours"], 600)

    def test_auto_worker_creates_private_draft_and_never_publishes(self):
        url = "https://nebius.com/newsroom/new-release"
        with patch.dict(os.environ, {
            "RESEARCH_AUTO_DRAFTS": "true", "OPENAI_API_KEY": "sk-" + "x" * 40,
            "RESEARCH_SUMMARY_MODEL": "test-model",
        }, clear=False):
            app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        with monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "c" * 64, "contentType": "text/html", "contentBytes": 90,
                "extractedText": "Capacity will increase in 2027. Execution remains subject to demand.", "extractedChars": 69,
            })
            monitor.queue_generation_job(db, url, 7_000)
        generated = {
            "draft": {
                "summaryJa": "公式発表によると、容量は2027年に増加する計画です。",
                "impactLabel": "mixed", "impactJa": "供給能力の拡大余地がありますが、需要の確認が引き続き必要です。",
                "confidence": "medium", "evidence": {
                    "summary": ["Capacity will increase in 2027."],
                    "impact": ["Execution remains subject to demand."],
                },
            },
            "audit": {"provider": "openai-responses", "model": "test-model", "responseId": "resp_auto",
                      "sourceTruncated": False, "inputTokens": 500, "outputTokens": 100, "totalTokens": 600},
        }
        with patch.object(brief_generator, "generate_draft", return_value=generated):
            result = app.process_generation_job()
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(app.public_snapshot()["briefs"], [])
        item = app.editorial_queue(5)["items"][0]
        self.assertEqual(item["brief_status"], "draft")
        self.assertEqual(item["generation_job_status"], "succeeded")
        self.assertEqual(item["generation_response_id"], "resp_auto")
        self.assertEqual(item["generation_total_tokens"], 600)
        self.assertEqual(app.public_state()["generation"]["measuredTokensLast24Hours"], 600)

    def test_recovery_marks_saved_current_draft_complete_without_second_call(self):
        url = "https://nebius.com/newsroom/new-release"
        with monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "9" * 64, "contentType": "text/html", "contentBytes": 90,
                "extractedText": "Capacity will increase. Execution remains subject to demand.", "extractedChars": 60,
            })
            monitor.queue_generation_job(db, url, 7_000)
            claim = monitor.claim_generation_job(db, 20, 3, 100_000)
            monitor.save_brief_draft(
                db, url, "9" * 64, "公式発表によると、容量を増やす計画が示されました。", "mixed",
                "供給拡大の余地がありますが、需要条件の確認が引き続き必要です。", "medium",
                {"summary": ["Capacity will increase."], "impact": ["Execution remains subject to demand."]},
            )
            db.execute("UPDATE briefs SET generation_response_id='resp_saved' WHERE url=?", (url,))
            db.commit()
            recovered = monitor.recover_generation_jobs(db, stale_minutes=0)
            self.assertEqual(recovered["completed"], 1)
            self.assertEqual(db.execute(
                "SELECT status FROM brief_generation_jobs WHERE url=?", (url,)
            ).fetchone()[0], "succeeded")
            self.assertEqual(claim["attempt"], 1)

    def test_editorial_http_api_is_fail_closed_and_bearer_protected(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        with monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url LIKE '%new-release'").fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "b" * 64, "contentType": "text/html", "contentBytes": 20,
                "extractedText": "Official evidence body.", "extractedChars": 23,
            })
        server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
        server.app = app
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/admin/briefs"
        try:
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop("RESEARCH_EDITOR_TOKEN", None)
                with self.assertRaises(HTTPError) as missing:
                    urlopen(Request(url), timeout=2)
                self.assertEqual(missing.exception.code, 401)
            with patch.dict(os.environ, {"RESEARCH_EDITOR_TOKEN": "editor-token-at-least-24-characters"}):
                with self.assertRaises(HTTPError) as wrong:
                    urlopen(Request(url, headers={"Authorization": "Bearer wrong-token-at-least-24-chars"}), timeout=2)
                self.assertEqual(wrong.exception.code, 401)
                with urlopen(Request(url, headers={"Authorization": "Bearer editor-token-at-least-24-characters"}), timeout=2) as response:
                    payload = json.loads(response.read())
                self.assertTrue(payload["ok"])
                self.assertIn("Official evidence body.", str(payload["items"]))
                with urlopen(Request(
                    f"{url}?view=needs-draft",
                    headers={"Authorization": "Bearer editor-token-at-least-24-characters"},
                ), timeout=2) as response:
                    filtered = json.loads(response.read())
                self.assertEqual(filtered["filter"], "needs-draft")
                self.assertEqual(filtered["filteredTotal"], 1)
                with self.assertRaises(HTTPError) as invalid_filter:
                    urlopen(Request(
                        f"{url}?view=approved",
                        headers={"Authorization": "Bearer editor-token-at-least-24-characters"},
                    ), timeout=2)
                self.assertEqual(invalid_filter.exception.code, 400)
                business = "NVIDIA designs accelerated computing platforms and software for data centers and other markets."
                risk = "Demand can change rapidly, and suppliers could disrupt product delivery."
                annual = {
                    "id": "nvda-2026-annual-ja", "ticker": "NVDA",
                    "accessionNumber": "0001045810-26-000021", "sourceSha256": "a" * 64,
                    "summaryJa": "データセンターなどに向けて、計算基盤とソフトウェアを提供する企業です。",
                    "businessModelJa": "計算基盤と関連ソフトウェアをデータセンターなどの市場へ提供します。",
                    "riskPointsJa": [{"text": "需要の急変や供給企業への依存により、製品供給が滞る可能性があります。", "evidenceIds": ["risk-1"]}],
                    "summaryEvidenceIds": ["business-1"], "businessModelEvidenceIds": ["business-1"],
                    "evidence": [{"id": "business-1", "section": "business", "quote": business},
                                 {"id": "risk-1", "section": "risk", "quote": risk}],
                    "confidence": "high", "generationMethod": "human",
                    "sourceBusiness": business, "sourceRisks": risk,
                }
                annual_draft = Request(
                    f"http://127.0.0.1:{server.server_port}/admin/annual-briefs/draft",
                    data=json.dumps(annual).encode(), method="POST",
                    headers={"Authorization": "Bearer editor-token-at-least-24-characters", "Content-Type": "application/json"},
                )
                with urlopen(annual_draft, timeout=2) as response:
                    self.assertEqual(json.loads(response.read())["status"], "draft")
                annual_queue = Request(
                    f"http://127.0.0.1:{server.server_port}/admin/annual-briefs",
                    headers={"Authorization": "Bearer editor-token-at-least-24-characters"},
                )
                with urlopen(annual_queue, timeout=2) as response:
                    annual_queue_payload = json.loads(response.read())
                self.assertEqual(annual_queue_payload["counts"], {
                    "total": 1, "draft": 1, "held": 0, "approved": 0,
                    "rejected": 0, "integrity_invalid": 0, "actionable": 1,
                })
                self.assertEqual(annual_queue_payload["filteredTotal"], 1)
                self.assertTrue(annual_queue_payload["items"][0]["integrityValid"])
                annual_invalid_queue = Request(
                    f"http://127.0.0.1:{server.server_port}/admin/annual-briefs?view=invalid",
                    headers={"Authorization": "Bearer editor-token-at-least-24-characters"},
                )
                with urlopen(annual_invalid_queue, timeout=2) as response:
                    invalid_queue_payload = json.loads(response.read())
                self.assertEqual(invalid_queue_payload["filteredTotal"], 0)
                self.assertEqual(invalid_queue_payload["items"], [])
                with self.assertRaises(HTTPError) as invalid_annual_filter:
                    urlopen(Request(
                        f"http://127.0.0.1:{server.server_port}/admin/annual-briefs?view=unknown",
                        headers={"Authorization": "Bearer editor-token-at-least-24-characters"},
                    ), timeout=2)
                self.assertEqual(invalid_annual_filter.exception.code, 400)
                annual_validation_sha = annual_queue_payload["items"][0]["validationSha256"]
                annual_review = Request(
                    f"http://127.0.0.1:{server.server_port}/admin/annual-briefs/review",
                    data=json.dumps({
                        "ticker": "NVDA", "accessionNumber": annual["accessionNumber"],
                        "sourceSha256": annual["sourceSha256"],
                        "validationSha256": annual_validation_sha, "decision": "approved",
                        "reviewer": "private-editor", "reason": "SEC原文と根拠引用を照合済み",
                        "sourceBusiness": business, "sourceRisks": "別のリスク原文です。",
                    }).encode(), method="POST",
                    headers={"Authorization": "Bearer editor-token-at-least-24-characters", "Content-Type": "application/json"},
                )
                with self.assertRaises(HTTPError) as changed_evidence:
                    urlopen(annual_review, timeout=2)
                self.assertEqual(changed_evidence.exception.code, 400)
                valid_annual_review = Request(
                    f"http://127.0.0.1:{server.server_port}/admin/annual-briefs/review",
                    data=json.dumps({
                        "ticker": "NVDA", "accessionNumber": annual["accessionNumber"],
                        "sourceSha256": annual["sourceSha256"],
                        "validationSha256": annual_validation_sha, "decision": "approved",
                        "reviewer": "private-editor", "reason": "SEC原文と根拠引用を照合済み",
                        "sourceBusiness": business, "sourceRisks": risk,
                    }).encode(), method="POST",
                    headers={"Authorization": "Bearer editor-token-at-least-24-characters", "Content-Type": "application/json"},
                )
                with urlopen(valid_annual_review, timeout=2) as response:
                    self.assertEqual(json.loads(response.read())["status"], "approved")
                query = (f"http://127.0.0.1:{server.server_port}/annual-brief?ticker=NVDA"
                         f"&accession={annual['accessionNumber']}&sha256={annual['sourceSha256']}")
                with patch.dict(os.environ, {"RESEARCH_API_TOKEN": "api-token-at-least-24-characters"}):
                    with urlopen(Request(query, headers={"Authorization": "Bearer api-token-at-least-24-characters"}), timeout=2) as response:
                        public = json.loads(response.read())
                self.assertEqual(public["status"], "approved")
                self.assertNotIn("private-editor", str(public))
                generate = Request(
                    f"http://127.0.0.1:{server.server_port}/admin/briefs/generate",
                    data=json.dumps({"url": "https://nebius.com/newsroom/new-release", "sha256": "b" * 64}).encode(),
                    method="POST",
                    headers={"Authorization": "Bearer editor-token-at-least-24-characters", "Content-Type": "application/json"},
                )
                with patch.dict(os.environ, {
                    "RESEARCH_EDITOR_TOKEN": "editor-token-at-least-24-characters",
                    "OPENAI_API_KEY": "", "RESEARCH_SUMMARY_MODEL": "",
                }, clear=False):
                    with self.assertRaises(HTTPError) as unconfigured:
                        urlopen(generate, timeout=5)
                    self.assertEqual(unconfigured.exception.code, 503)
                    self.assertEqual(json.loads(unconfigured.exception.read())["error"], "generation-not-configured")
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
