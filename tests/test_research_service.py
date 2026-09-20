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
        decision = app.decide_brief({
            "url": payload["url"], "sha256": payload["sha256"], "decision": "approved",
            "reviewer": "editor", "reason": "原文と数値を確認",
        })
        self.assertFalse(decision["published"])

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
