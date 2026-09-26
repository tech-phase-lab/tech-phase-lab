from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import gzip
import importlib.util
from pathlib import Path
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/research"))
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
signals_spec = importlib.util.spec_from_file_location("signals", ROOT / "scripts/research/signals.py")
signals = importlib.util.module_from_spec(signals_spec)
signals_spec.loader.exec_module(signals)
sys.modules["signals"] = signals
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

    def test_body_batch_configuration_is_bounded(self):
        with patch.dict(os.environ, {"RESEARCH_BODY_FETCH_BATCH": "999999"}, clear=False):
            app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        self.assertEqual(app.body_batch, 100)

    def test_discovery_poll_metrics_survive_restart_without_source_details(self):
        completed = datetime.now(timezone.utc)
        started = completed - timedelta(milliseconds=900)
        with monitor.connect(self.db_path) as db:
            monitor.record_discovery_poll_batch(
                db, started.isoformat(timespec="milliseconds"),
                completed.isoformat(timespec="milliseconds"),
                900, 3, 1, 2, (300, 450, 600),
            )
            summary = monitor.discovery_poll_summary(
                db, (completed + timedelta(seconds=1)).isoformat(timespec="milliseconds")
            )
        self.assertEqual(summary["runs24Hours"], 1)
        self.assertEqual(summary["checks24Hours"], 3)
        self.assertEqual(summary["degraded24Hours"], 1)
        self.assertEqual(summary["newSources24Hours"], 2)
        self.assertEqual(summary["requestDurationAverageMs24Hours"], 450)
        self.assertEqual(summary["requestDurationMaxMs24Hours"], 600)
        self.assertEqual(summary["lastCompletedAgeSeconds"], 1)
        self.assertFalse(summary["pollOverdue"])
        self.assertNotIn("https://", json.dumps(summary))

        restarted = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        persisted = restarted.public_state()["discoveryRuns"]
        self.assertEqual(persisted["lastChecks"], 3)
        self.assertEqual(persisted["lastDegraded"], 1)
        self.assertEqual(persisted["lastNewSources"], 2)

    def test_durable_worker_evidence_distinguishes_restored_and_current_activity(self):
        previous_completed = datetime.now(timezone.utc) - timedelta(seconds=2)
        previous_started = previous_completed - timedelta(milliseconds=500)
        with monitor.connect(self.db_path) as db:
            monitor.record_discovery_poll_batch(
                db, previous_started.isoformat(timespec="milliseconds"),
                previous_completed.isoformat(timespec="milliseconds"),
                500, 1, 0, 0, (250,),
            )
            monitor.record_body_fetch_poll(
                db, previous_completed.isoformat(timespec="milliseconds"), 0
            )
            monitor.record_body_fetch_batch(
                db, previous_started.isoformat(timespec="milliseconds"),
                previous_completed.isoformat(timespec="milliseconds"),
                500, 1, 0, 0,
            )

        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        restored = app.public_state()
        self.assertFalse(restored["discoveryRuns"]["completedSinceStart"])
        self.assertFalse(restored["bodyFetch"]["durable"]["polledSinceStart"])
        self.assertFalse(restored["bodyFetch"]["durable"]["completedSinceStart"])

        current_completed = datetime.now(timezone.utc)
        current_started = current_completed - timedelta(milliseconds=250)
        with monitor.connect(self.db_path) as db:
            monitor.record_discovery_poll_batch(
                db, current_started.isoformat(timespec="milliseconds"),
                current_completed.isoformat(timespec="milliseconds"),
                250, 1, 0, 0, (125,),
            )
            monitor.record_body_fetch_poll(
                db, current_completed.isoformat(timespec="milliseconds"), 0
            )
            monitor.record_body_fetch_batch(
                db, current_started.isoformat(timespec="milliseconds"),
                current_completed.isoformat(timespec="milliseconds"),
                250, 1, 0, 0,
            )
        current = app.public_state()
        self.assertTrue(current["discoveryRuns"]["completedSinceStart"])
        self.assertTrue(current["bodyFetch"]["durable"]["polledSinceStart"])
        self.assertTrue(current["bodyFetch"]["durable"]["completedSinceStart"])

    def test_priority_source_coverage_requires_current_process_evidence(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        started = datetime.now(timezone.utc) - timedelta(seconds=1)
        app.state["startedAt"] = started.isoformat(timespec="milliseconds")
        before = (started - timedelta(milliseconds=1)).isoformat(timespec="milliseconds")
        after = (started + timedelta(milliseconds=1)).isoformat(timespec="milliseconds")
        with app.state_lock:
            app.state["companies"] = {
                "TSM": {"status": "ok", "checkedAt": after},
                "MRVL": {"status": "fallback", "checkedAt": after},
                "ANET": {"status": "degraded", "checkedAt": after},
                "VRT": {"status": "ok", "checkedAt": before},
                "PLTR": {"status": "ok", "checkedAt": "not-a-time"},
            }
        coverage = app.public_state()["prioritySources"]
        self.assertEqual(coverage, {
            "targetCount": 5, "configuredCount": 5, "checkedSinceStart": 3,
            "healthy": 2, "degraded": 1, "pending": 2, "omitted": 0,
            "completionLatencyMs": None,
        })
        self.assertNotIn("checkedAt", json.dumps(coverage))

    def test_priority_source_coverage_rejects_future_evidence_and_measures_completion(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        started = datetime.now(timezone.utc) - timedelta(seconds=2)
        app.state["startedAt"] = started.isoformat(timespec="milliseconds")
        with app.state_lock:
            app.state["companies"] = {
                ticker: {
                    "status": "ok",
                    "checkedAt": (started + timedelta(milliseconds=offset)).isoformat(
                        timespec="milliseconds"
                    ),
                }
                for ticker, offset in zip(service.PRIORITY_SEC_TICKERS, (100, 200, 300, 400, 500))
            }
        complete = app.public_state()["prioritySources"]
        self.assertEqual(complete["checkedSinceStart"], 5)
        self.assertEqual(complete["completionLatencyMs"], 500)

        with app.state_lock:
            app.state["companies"]["PLTR"]["checkedAt"] = (
                datetime.now(timezone.utc) + timedelta(hours=1)
            ).isoformat(timespec="milliseconds")
        invalid = app.public_state()["prioritySources"]
        self.assertEqual(invalid["checkedSinceStart"], 4)
        self.assertEqual(invalid["pending"], 1)
        self.assertIsNone(invalid["completionLatencyMs"])

    def test_priority_source_completion_latency_stays_at_first_complete_cycle(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        started = datetime.now(timezone.utc) - timedelta(seconds=2)
        app.state["startedAt"] = started.isoformat(timespec="milliseconds")
        with app.state_lock:
            app.state["companies"] = {
                ticker: {
                    "status": "ok",
                    "checkedAt": (started + timedelta(milliseconds=offset)).isoformat(
                        timespec="milliseconds"
                    ),
                }
                for ticker, offset in zip(
                    service.PRIORITY_SEC_TICKERS, (100, 200, 300, 400, 500)
                )
            }
            first = app.current_priority_source_coverage(
                app.state, remember_completion=True
            )
            for company in app.state["companies"].values():
                company["checkedAt"] = (
                    started + timedelta(milliseconds=1500)
                ).isoformat(timespec="milliseconds")
        self.assertEqual(first["completionLatencyMs"], 500)
        self.assertEqual(app.public_state()["prioritySources"]["completionLatencyMs"], 500)

    def test_priority_source_coverage_reports_custom_roster_omissions(self):
        with patch.dict(os.environ, {"RESEARCH_TICKERS": "TSM,MRVL"}, clear=False):
            app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        coverage = app.public_state()["prioritySources"]
        self.assertEqual(coverage["configuredCount"], 2)
        self.assertEqual(coverage["pending"], 2)
        self.assertEqual(coverage["omitted"], 3)

    def test_priority_source_completion_survives_restart_without_company_details(self):
        reference = datetime.now(timezone.utc)
        started = reference - timedelta(seconds=2)
        first_observed = reference - timedelta(seconds=1)
        with monitor.connect(self.db_path) as db:
            monitor.record_priority_source_run(
                db, started.isoformat(timespec="milliseconds"),
                first_observed.isoformat(timespec="milliseconds"),
                5, 5, 4, 1, 500,
            )
            monitor.record_priority_source_run(
                db, started.isoformat(timespec="milliseconds"),
                reference.isoformat(timespec="milliseconds"),
                5, 5, 5, 0, 500,
            )
            summary = monitor.priority_source_run_summary(
                db, (reference + timedelta(seconds=1)).isoformat(timespec="milliseconds")
            )
        self.assertEqual(summary["configuredCount"], 5)
        self.assertEqual(summary["healthy"], 5)
        self.assertEqual(summary["degraded"], 0)
        self.assertEqual(summary["completionLatencyMs"], 500)
        self.assertEqual(summary["completedRuns24Hours"], 1)
        self.assertEqual(summary["lastObservedAgeSeconds"], 1)
        self.assertNotIn("ticker", json.dumps(summary).lower())
        self.assertNotIn("process", json.dumps(summary).lower())

        restarted = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        persisted = restarted.public_state()["prioritySourceRuns"]
        self.assertEqual(persisted["healthy"], 5)
        self.assertEqual(persisted["completionLatencyMs"], 500)

    def test_priority_source_run_metrics_reject_invalid_and_future_evidence(self):
        reference = datetime.now(timezone.utc)
        started = reference - timedelta(seconds=1)
        with monitor.connect(self.db_path) as db:
            for values in (
                (started, reference, 5, 5, 4, 0, 500),
                (started, reference, 5, 6, 6, 0, 500),
                (reference, started, 5, 5, 5, 0, 500),
                (started, reference, 5, 5, 5, 0, 2_000),
            ):
                with self.assertRaisesRegex(ValueError, "invalid-priority-source-run"):
                    monitor.record_priority_source_run(
                        db,
                        values[0].isoformat(timespec="milliseconds"),
                        values[1].isoformat(timespec="milliseconds"),
                        *values[2:],
                    )
            with self.assertRaisesRegex(
                ValueError, "invalid-priority-source-run-reference"
            ):
                monitor.priority_source_run_summary(db, "not-a-time")

            future_started = reference + timedelta(hours=1)
            future_observed = future_started + timedelta(seconds=1)
            monitor.record_priority_source_run(
                db, future_started.isoformat(timespec="milliseconds"),
                future_observed.isoformat(timespec="milliseconds"),
                5, 5, 5, 0, 500,
            )
            summary = monitor.priority_source_run_summary(
                db, reference.isoformat(timespec="milliseconds")
            )
        self.assertIsNone(summary["lastCompletedAt"])
        self.assertEqual(summary["completedRuns24Hours"], 0)

    def test_priority_source_run_persistence_failure_is_isolated_and_recovers(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        observed = datetime.now(timezone.utc)
        started = observed - timedelta(seconds=1)
        coverage = {
            "targetCount": 5, "configuredCount": 5, "healthy": 5,
            "degraded": 0, "completionLatencyMs": 500,
        }
        with patch.object(
            monitor, "record_priority_source_run",
            side_effect=sqlite3.OperationalError("simulated storage failure"),
        ):
            self.assertFalse(app.record_priority_source_run_safely(
                started.isoformat(timespec="milliseconds"),
                observed.isoformat(timespec="milliseconds"), coverage,
            ))
        failed = app.public_state()
        self.assertFalse(failed["priorityPersistence"]["healthy"])
        self.assertEqual(
            failed["priorityPersistence"]["lastError"],
            "priority-source-metrics-failed",
        )
        self.assertIn("priority-source-metrics-failed", failed["health"]["issues"])
        app.sync_health_incidents()
        with monitor.connect(self.db_path) as db:
            self.assertEqual(db.execute(
                "SELECT status FROM operational_incidents WHERE incident_key=?",
                ("discovery:priority-metrics",),
            ).fetchone()[0], "open")

        self.assertTrue(app.record_priority_source_run_safely(
            started.isoformat(timespec="milliseconds"),
            observed.isoformat(timespec="milliseconds"), coverage,
        ))
        app.sync_health_incidents()
        recovered = app.public_state()
        self.assertTrue(recovered["priorityPersistence"]["healthy"])
        self.assertNotIn("priority-source-metrics-failed", recovered["health"]["issues"])
        with monitor.connect(self.db_path) as db:
            self.assertEqual(db.execute(
                "SELECT status FROM operational_incidents WHERE incident_key=?",
                ("discovery:priority-metrics",),
            ).fetchone()[0], "resolved")

    def test_priority_source_run_refreshes_on_change_and_heartbeat(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.priority_metrics_interval = 300
        started = datetime.now(timezone.utc) - timedelta(seconds=2)
        coverage = {
            "targetCount": 5, "configuredCount": 5, "healthy": 5,
            "degraded": 0, "completionLatencyMs": 500,
        }
        first = (started + timedelta(seconds=1)).isoformat(timespec="milliseconds")
        unchanged = (started + timedelta(seconds=1, milliseconds=100)).isoformat(
            timespec="milliseconds"
        )
        heartbeat = (started + timedelta(seconds=1, milliseconds=400)).isoformat(
            timespec="milliseconds"
        )

        self.assertTrue(app.persist_priority_source_coverage_if_due(
            started.isoformat(timespec="milliseconds"), first, coverage, 10,
        ))
        self.assertFalse(app.persist_priority_source_coverage_if_due(
            started.isoformat(timespec="milliseconds"), unchanged, coverage, 20,
        ))
        with monitor.connect(self.db_path) as db:
            summary = monitor.priority_source_run_summary(
                db, (started + timedelta(seconds=10)).isoformat(timespec="milliseconds")
            )
        self.assertEqual(summary["lastObservedAt"], first)

        degraded = {**coverage, "healthy": 4, "degraded": 1}
        self.assertTrue(app.persist_priority_source_coverage_if_due(
            started.isoformat(timespec="milliseconds"), unchanged, degraded, 20,
        ))
        self.assertTrue(app.persist_priority_source_coverage_if_due(
            started.isoformat(timespec="milliseconds"), heartbeat, degraded, 321,
        ))
        with monitor.connect(self.db_path) as db:
            summary = monitor.priority_source_run_summary(
                db, (started + timedelta(seconds=10)).isoformat(timespec="milliseconds")
            )
            row_count = db.execute("SELECT count(*) FROM priority_source_runs").fetchone()[0]
        self.assertEqual(summary["lastObservedAt"], heartbeat)
        self.assertEqual(summary["healthy"], 4)
        self.assertEqual(summary["degraded"], 1)
        self.assertEqual(summary["completionLatencyMs"], 500)
        self.assertEqual(row_count, 1)

    def test_priority_source_run_refresh_retries_after_storage_failure(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        started = datetime.now(timezone.utc) - timedelta(seconds=1)
        observed = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
        coverage = {
            "targetCount": 5, "configuredCount": 5, "healthy": 5,
            "degraded": 0, "completionLatencyMs": 500,
        }
        with patch.object(app, "record_priority_source_run_safely", return_value=False):
            self.assertFalse(app.persist_priority_source_coverage_if_due(
                started.isoformat(timespec="milliseconds"), observed, coverage, 10,
            ))
        self.assertIsNone(app.priority_metrics_signature)
        self.assertEqual(app.next_priority_metrics_at, 0)
        self.assertTrue(app.persist_priority_source_coverage_if_due(
            started.isoformat(timespec="milliseconds"), observed, coverage, 11,
        ))

    def test_priority_source_health_records_and_resolves_degraded_coverage(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        checked_at = service.utc_now()
        with app.state_lock:
            app.state.update({
                "ready": True, "lastCycleAt": checked_at, "lastCycleCompanies": 5,
                "companies": {
                    ticker: {
                        "status": "degraded" if ticker == "VRT" else "ok",
                        "checkedAt": checked_at,
                    }
                    for ticker in service.PRIORITY_SEC_TICKERS
                },
            })
        degraded = app.public_state()
        self.assertIn("priority-source-degraded", degraded["health"]["issues"])
        self.assertEqual(degraded["prioritySources"]["degraded"], 1)
        app.sync_health_incidents()
        with monitor.connect(self.db_path) as db:
            incident = db.execute(
                "SELECT status,last_error_code AS error_code "
                "FROM operational_incidents WHERE incident_key=?",
                ("discovery:priority-sources",),
            ).fetchone()
            self.assertEqual(dict(incident), {
                "status": "open", "error_code": "priority-source-degraded",
            })

        with app.state_lock:
            app.state["companies"]["VRT"]["status"] = "fallback"
        app.sync_health_incidents()
        recovered = app.public_state()
        self.assertNotIn("priority-source-degraded", recovered["health"]["issues"])
        with monitor.connect(self.db_path) as db:
            self.assertEqual(db.execute(
                "SELECT status FROM operational_incidents WHERE incident_key=?",
                ("discovery:priority-sources",),
            ).fetchone()[0], "resolved")

    def test_priority_source_health_marks_post_cycle_missing_checks(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        checked_at = service.utc_now()
        with app.state_lock:
            app.state.update({
                "ready": True, "lastCycleAt": checked_at, "lastCycleCompanies": 4,
                "companies": {
                    ticker: {"status": "ok", "checkedAt": checked_at}
                    for ticker in service.PRIORITY_SEC_TICKERS[:-1]
                },
            })
        state = app.public_state()
        self.assertIn("priority-source-pending", state["health"]["issues"])
        self.assertEqual(state["prioritySources"]["pending"], 1)

    def test_discovery_poll_metrics_reject_invalid_or_unbounded_values(self):
        timestamp = service.utc_now()
        with monitor.connect(self.db_path) as db:
            for values in (
                (timestamp, timestamp, 0, 2, 0, 0, (100,)),
                (timestamp, timestamp, 0, 2, 3, 0, (100, 100)),
                (timestamp, timestamp, 0, 1, 0, -1, (100,)),
                ("not-a-time", timestamp, 0, 1, 0, 0, (100,)),
            ):
                with self.assertRaisesRegex(ValueError, "invalid-discovery-poll-batch"):
                    monitor.record_discovery_poll_batch(db, *values)
            with self.assertRaisesRegex(ValueError, "invalid-discovery-poll-reference"):
                monitor.discovery_poll_summary(db, "not-a-time")
            with self.assertRaisesRegex(ValueError, "invalid-discovery-poll-reference"):
                monitor.discovery_poll_summary(db, poll_overdue_after_seconds=14)

    def test_discovery_poll_metrics_mark_stale_persisted_evidence(self):
        completed = datetime.now(timezone.utc)
        with monitor.connect(self.db_path) as db:
            monitor.record_discovery_poll_batch(
                db, (completed - timedelta(seconds=1)).isoformat(timespec="milliseconds"),
                completed.isoformat(timespec="milliseconds"),
                1000, 1, 0, 0, (250,),
            )
            summary = monitor.discovery_poll_summary(
                db, (completed + timedelta(seconds=61)).isoformat(timespec="milliseconds"),
                poll_overdue_after_seconds=60,
            )
        self.assertEqual(summary["lastCompletedAgeSeconds"], 61)
        self.assertEqual(summary["pollOverdueAfterSeconds"], 60)
        self.assertTrue(summary["pollOverdue"])

    def test_durable_batch_summaries_ignore_future_rows(self):
        reference = datetime.now(timezone.utc)
        past_started = reference - timedelta(seconds=2)
        past_completed = reference - timedelta(seconds=1)
        future_started = reference + timedelta(hours=1)
        future_completed = future_started + timedelta(seconds=1)
        with monitor.connect(self.db_path) as db:
            monitor.record_discovery_poll_batch(
                db, past_started.isoformat(timespec="milliseconds"),
                past_completed.isoformat(timespec="milliseconds"),
                1000, 2, 0, 1, (200, 300),
            )
            monitor.record_discovery_poll_batch(
                db, future_started.isoformat(timespec="milliseconds"),
                future_completed.isoformat(timespec="milliseconds"),
                1000, 9, 9, 99, (100,) * 9,
            )
            monitor.record_body_fetch_batch(
                db, past_started.isoformat(timespec="milliseconds"),
                past_completed.isoformat(timespec="milliseconds"),
                1000, 2, 0, 1, (400,), {
                    "detectedNeverFetched": 1,
                    "baselineNeverFetched": 0,
                    "extractionPending": 0,
                    "recheck": 1,
                },
            )
            monitor.record_body_fetch_batch(
                db, future_started.isoformat(timespec="milliseconds"),
                future_completed.isoformat(timespec="milliseconds"),
                1000, 8, 8, 8, (500,) * 8,
            )
            discovery = monitor.discovery_poll_summary(
                db, reference.isoformat(timespec="milliseconds")
            )
            body = monitor.body_fetch_batch_summary(
                db, reference.isoformat(timespec="milliseconds")
            )
        self.assertEqual(discovery["lastChecks"], 2)
        self.assertEqual(discovery["runs24Hours"], 1)
        self.assertEqual(discovery["newSources24Hours"], 1)
        self.assertEqual(body["lastChecks"], 2)
        self.assertEqual(body["runs24Hours"], 1)
        self.assertEqual(body["errors24Hours"], 0)
        self.assertEqual(body["detectionLatencySamples24Hours"], 1)
        self.assertEqual(body["lastSelectedDetectedNeverFetched"], 1)
        self.assertEqual(body["lastSelectedRecheck"], 1)
        self.assertEqual(body["selectedDetectedNeverFetched24Hours"], 1)
        self.assertEqual(body["selectedBaselineNeverFetched24Hours"], 0)
        self.assertEqual(body["selectedExtractionPending24Hours"], 0)
        self.assertEqual(body["selectedRecheck24Hours"], 1)
        self.assertEqual(body["errorDetectedNeverFetched24Hours"], 0)
        self.assertEqual(body["errorBaselineNeverFetched24Hours"], 0)
        self.assertEqual(body["errorExtractionPending24Hours"], 0)
        self.assertEqual(body["errorRecheck24Hours"], 0)

    def test_durable_batch_summaries_ignore_corrupted_metric_rows(self):
        reference = datetime.now(timezone.utc)
        started = reference - timedelta(seconds=3)
        completed = reference - timedelta(seconds=2)
        corrupted_completed = reference - timedelta(seconds=1)
        with monitor.connect(self.db_path) as db:
            monitor.record_discovery_poll_batch(
                db, started.isoformat(timespec="milliseconds"),
                completed.isoformat(timespec="milliseconds"),
                1000, 2, 0, 1, (200, 300),
            )
            monitor.record_body_fetch_batch(
                db, started.isoformat(timespec="milliseconds"),
                completed.isoformat(timespec="milliseconds"),
                1000, 2, 0, 1, (400,),
            )
            monitor.record_body_fetch_poll(
                db, completed.isoformat(timespec="milliseconds"), 4
            )
            db.execute("PRAGMA ignore_check_constraints=ON")
            db.execute("""
              INSERT INTO discovery_poll_batches(
                started_at,completed_at,duration_ms,checks,degraded,new_sources,
                request_duration_total_ms,request_duration_max_ms
              ) VALUES(?,?,?,?,?,?,?,?)
            """, (
                started.isoformat(timespec="milliseconds"),
                corrupted_completed.isoformat(timespec="milliseconds"),
                1000, 2, 0, 99, -1, 500,
            ))
            db.execute("""
              INSERT INTO body_fetch_batches(
                polled_at,completed_at,duration_ms,checks,errors,not_modified,
                detection_latency_samples,detection_latency_total_ms,
                detection_latency_max_ms
              ) VALUES(?,?,?,?,?,?,?,?,?)
            """, (
                started.isoformat(timespec="milliseconds"),
                corrupted_completed.isoformat(timespec="milliseconds"),
                1000, 2, 0, 1, 2, -1, 500,
            ))
            db.execute("UPDATE body_fetch_worker_state SET pending_count=-1 WHERE id=1")
            db.commit()
            discovery = monitor.discovery_poll_summary(
                db, reference.isoformat(timespec="milliseconds")
            )
            body = monitor.body_fetch_batch_summary(
                db, reference.isoformat(timespec="milliseconds")
            )
        self.assertEqual(discovery["lastChecks"], 2)
        self.assertEqual(discovery["lastNewSources"], 1)
        self.assertEqual(discovery["runs24Hours"], 1)
        self.assertEqual(discovery["requestDurationAverageMs24Hours"], 250)
        self.assertEqual(body["lastChecks"], 2)
        self.assertEqual(body["runs24Hours"], 1)
        self.assertEqual(body["detectionLatencySamples24Hours"], 1)
        self.assertEqual(body["detectionLatencyAverageMs24Hours"], 400)
        self.assertIsNone(body["lastPolledAt"])
        self.assertIsNone(body["pendingAtLastPoll"])

    def test_discovery_loop_records_one_url_free_poll_batch(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.tickers = ["NBIS"]
        app.collect_discovery_timed = lambda *_: ({
            "ticker": "NBIS", "status": "degraded", "route": "none",
            "sourceUrl": monitor.INDEXES["NBIS"], "sourceFormat": "none",
            "sourcesChecked": 1, "sourcesConfigured": 1, "candidates": 0,
            "error": "timeout",
        }, {}, 123)
        app.fetch_bodies_safely = lambda _pool: True
        app.thread.start()
        try:
            for _ in range(100):
                with app.state_lock:
                    if app.state["ready"]:
                        break
                threading.Event().wait(0.01)
            else:
                self.fail("discovery loop did not complete")
        finally:
            app.stop_event.set()
            app.thread.join(timeout=2)
        durable = app.public_state()["discoveryRuns"]
        self.assertGreaterEqual(durable["runs24Hours"], 1)
        self.assertGreaterEqual(durable["checks24Hours"], 1)
        self.assertGreaterEqual(durable["degraded24Hours"], 1)
        self.assertEqual(durable["lastRequestDurationAverageMs"], 123)
        self.assertNotIn("https://", json.dumps(durable))

    def test_idle_body_poll_heartbeat_survives_restart_without_source_details(self):
        with monitor.connect(self.db_path) as db:
            db.execute("UPDATE sources SET next_fetch_at='2099-01-01T00:00:00+00:00'")
            db.commit()
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        with ThreadPoolExecutor(max_workers=1) as pool:
            app.fetch_bodies(pool)
        durable = app.public_state()["bodyFetch"]["durable"]
        self.assertIsNotNone(durable["lastPolledAt"])
        self.assertEqual(durable["pendingAtLastPoll"], 0)
        self.assertFalse(durable["pollOverdue"])
        self.assertIsNone(durable["lastCompletedAt"])
        self.assertNotIn("https://", json.dumps(durable))

        restarted = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        persisted = restarted.public_state()["bodyFetch"]["durable"]
        self.assertEqual(persisted["lastPolledAt"], durable["lastPolledAt"])
        self.assertEqual(persisted["pendingAtLastPoll"], 0)
        self.assertFalse(persisted["pollOverdue"])

    def test_stale_body_poll_degrades_health_without_repeating_monitor_stale(self):
        old_poll = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(
            timespec="milliseconds"
        )
        with monitor.connect(self.db_path) as db:
            monitor.record_body_fetch_poll(db, old_poll, 2)
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        recent = service.utc_now()
        app.state.update({"ready": True, "lastCycleAt": recent})
        app.state["backup"].update({"healthy": True, "lastSuccessAt": recent})
        app.state["incidentWatch"]["healthy"] = True
        state = app.public_state()
        self.assertEqual(state["health"]["issues"], ["body-fetch-stale"])
        self.assertTrue(state["bodyFetch"]["durable"]["pollOverdue"])
        app.sync_health_incidents()
        incident = app.public_state()["incidents"]
        self.assertEqual(incident["open"], 1)
        self.assertEqual(incident["recent"][0]["errorCode"], "body-fetch-stale")

        app.state["lastCycleAt"] = "2026-01-01T00:00:00+00:00"
        stale_monitor = app.public_state()
        self.assertIn("monitor-stale", stale_monitor["health"]["issues"])
        self.assertNotIn("body-fetch-stale", stale_monitor["health"]["issues"])

    def test_stale_discovery_poll_records_and_resolves_an_incident(self):
        completed = datetime.now(timezone.utc) - timedelta(minutes=10)
        started = completed - timedelta(seconds=1)
        with monitor.connect(self.db_path) as db:
            monitor.record_discovery_poll_batch(
                db, started.isoformat(timespec="milliseconds"),
                completed.isoformat(timespec="milliseconds"),
                1000, 1, 0, 0, (500,),
            )
            monitor.record_body_fetch_poll(db, service.utc_now(), 0)
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        recent = service.utc_now()
        app.state.update({"ready": True, "lastCycleAt": recent})
        app.state["backup"].update({"healthy": True, "lastSuccessAt": recent})
        app.state["incidentWatch"]["healthy"] = True

        stale = app.public_state()
        self.assertEqual(stale["health"]["issues"], ["discovery-poll-stale"])
        self.assertTrue(stale["discoveryRuns"]["pollOverdue"])
        app.sync_health_incidents()
        with monitor.connect(self.db_path) as db:
            incident = db.execute(
                "SELECT status,last_error_code AS error_code "
                "FROM operational_incidents WHERE incident_key=?",
                ("discovery:worker",),
            ).fetchone()
            self.assertEqual(dict(incident), {
                "status": "open", "error_code": "discovery-poll-stale",
            })

        fresh_completed = datetime.now(timezone.utc)
        fresh_started = fresh_completed - timedelta(milliseconds=500)
        with monitor.connect(self.db_path) as db:
            monitor.record_discovery_poll_batch(
                db, fresh_started.isoformat(timespec="milliseconds"),
                fresh_completed.isoformat(timespec="milliseconds"),
                500, 1, 0, 0, (250,),
            )
        recovered = app.public_state()
        self.assertNotIn("discovery-poll-stale", recovered["health"]["issues"])
        app.sync_health_incidents()
        with monitor.connect(self.db_path) as db:
            self.assertEqual(db.execute(
                "SELECT status FROM operational_incidents WHERE incident_key=?",
                ("discovery:worker",),
            ).fetchone()[0], "resolved")

    def test_body_poll_heartbeat_rejects_invalid_or_unbounded_values(self):
        with monitor.connect(self.db_path) as db:
            for timestamp, pending in (
                ("not-a-time", 0), (service.utc_now(), -1),
                (service.utc_now(), 1_000_001),
            ):
                with self.assertRaisesRegex(ValueError, "invalid-body-fetch-poll"):
                    monitor.record_body_fetch_poll(db, timestamp, pending)
            with self.assertRaisesRegex(ValueError, "invalid-body-fetch-reference"):
                monitor.body_fetch_batch_summary(db, poll_overdue_after_seconds=59)

    def test_legacy_body_batch_table_migrates_without_losing_metrics(self):
        legacy_path = Path(self.temp.name) / "legacy-batches.sqlite"
        with sqlite3.connect(legacy_path) as db:
            db.execute("""
              CREATE TABLE body_fetch_batches (
                id INTEGER PRIMARY KEY, polled_at TEXT NOT NULL,
                completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL,
                checks INTEGER NOT NULL, errors INTEGER NOT NULL,
                not_modified INTEGER NOT NULL)
            """)
            db.execute("""
              INSERT INTO body_fetch_batches(
                polled_at,completed_at,duration_ms,checks,errors,not_modified
              ) VALUES(?,?,?,?,?,?)
            """, (
                "2026-09-23T00:00:00+00:00", "2026-09-23T00:00:01+00:00",
                1000, 2, 0, 1,
            ))
        with monitor.connect(legacy_path) as db:
            columns = {row[1] for row in db.execute("PRAGMA table_info(body_fetch_batches)")}
            self.assertTrue({
                "detection_latency_samples", "detection_latency_total_ms",
                "detection_latency_max_ms", "eligibility_wait_samples",
                "eligibility_wait_total_ms", "eligibility_wait_max_ms",
                "request_duration_samples", "request_duration_total_ms",
                "request_duration_max_ms",
                "request_success_duration_samples",
                "request_success_duration_total_ms",
                "request_success_duration_max_ms",
                "request_error_duration_samples",
                "request_error_duration_total_ms",
                "request_error_duration_max_ms",
                "selected_detected_never_fetched",
                "selected_baseline_never_fetched", "selected_extraction_pending",
                "selected_recheck", "error_detected_never_fetched",
                "error_baseline_never_fetched", "error_extraction_pending",
                "error_recheck",
                "not_modified_detected_never_fetched",
                "not_modified_baseline_never_fetched",
                "not_modified_extraction_pending", "not_modified_recheck",
                "fetched_detected_never_fetched",
                "fetched_baseline_never_fetched",
                "fetched_extraction_pending", "fetched_recheck",
                "updated_detected_never_fetched",
                "updated_baseline_never_fetched",
                "updated_extraction_pending", "updated_recheck",
            }.issubset(columns))
            summary = monitor.body_fetch_batch_summary(
                db, "2026-09-23T00:01:00+00:00"
            )
        self.assertEqual(summary["checks24Hours"], 2)
        self.assertEqual(summary["detectionLatencySamples24Hours"], 0)
        self.assertIsNone(summary["detectionLatencyAverageMs24Hours"])
        self.assertEqual(summary["eligibilityWaitSamples24Hours"], 0)
        self.assertIsNone(summary["eligibilityWaitAverageMs24Hours"])
        self.assertIsNone(summary["eligibilityWaitMaxMs24Hours"])
        self.assertEqual(summary["requestDurationSamples24Hours"], 0)
        self.assertIsNone(summary["requestDurationAverageMs24Hours"])
        self.assertIsNone(summary["requestDurationMaxMs24Hours"])
        self.assertEqual(summary["requestSuccessDurationSamples24Hours"], 0)
        self.assertIsNone(summary["requestSuccessDurationAverageMs24Hours"])
        self.assertIsNone(summary["requestSuccessDurationMaxMs24Hours"])
        self.assertEqual(summary["requestErrorDurationSamples24Hours"], 0)
        self.assertIsNone(summary["requestErrorDurationAverageMs24Hours"])
        self.assertIsNone(summary["requestErrorDurationMaxMs24Hours"])
        self.assertEqual(summary["selectedDetectedNeverFetched24Hours"], 0)
        self.assertEqual(summary["selectedBaselineNeverFetched24Hours"], 0)
        self.assertEqual(summary["selectedExtractionPending24Hours"], 0)
        self.assertEqual(summary["selectedRecheck24Hours"], 0)
        self.assertEqual(summary["errorDetectedNeverFetched24Hours"], 0)
        self.assertEqual(summary["errorBaselineNeverFetched24Hours"], 0)
        self.assertEqual(summary["errorExtractionPending24Hours"], 0)
        self.assertEqual(summary["errorRecheck24Hours"], 0)
        self.assertEqual(summary["notModifiedDetectedNeverFetched24Hours"], 0)
        self.assertEqual(summary["notModifiedBaselineNeverFetched24Hours"], 0)
        self.assertEqual(summary["notModifiedExtractionPending24Hours"], 0)
        self.assertEqual(summary["notModifiedRecheck24Hours"], 0)
        self.assertEqual(summary["fetchedDetectedNeverFetched24Hours"], 0)
        self.assertEqual(summary["fetchedBaselineNeverFetched24Hours"], 0)
        self.assertEqual(summary["fetchedExtractionPending24Hours"], 0)
        self.assertEqual(summary["fetchedRecheck24Hours"], 0)
        self.assertEqual(summary["updatedDetectedNeverFetched24Hours"], 0)
        self.assertEqual(summary["updatedBaselineNeverFetched24Hours"], 0)
        self.assertEqual(summary["updatedExtractionPending24Hours"], 0)
        self.assertEqual(summary["updatedRecheck24Hours"], 0)

    def test_body_fetch_eligibility_wait_is_bounded_and_persisted(self):
        reference = datetime.now(timezone.utc)
        started = reference - timedelta(seconds=1)
        selection = {
            "detectedNeverFetched": 0,
            "baselineNeverFetched": 0,
            "extractionPending": 0,
            "recheck": 1,
        }
        with monitor.connect(self.db_path) as db:
            with self.assertRaisesRegex(ValueError, "invalid-body-fetch-batch"):
                monitor.record_body_fetch_batch(
                    db, started.isoformat(timespec="milliseconds"),
                    reference.isoformat(timespec="milliseconds"),
                    1000, 1, 0, 1, (), selection,
                    selection_not_modified={"recheck": 1},
                    eligibility_waits_ms=(-1,),
                )
            monitor.record_body_fetch_batch(
                db, started.isoformat(timespec="milliseconds"),
                reference.isoformat(timespec="milliseconds"),
                1000, 1, 0, 1, (), selection,
                selection_not_modified={"recheck": 1},
                eligibility_waits_ms=(3250,),
            )
            summary = monitor.body_fetch_batch_summary(
                db, reference.isoformat(timespec="milliseconds")
            )
        self.assertEqual(summary["lastEligibilityWaitSamples"], 1)
        self.assertEqual(summary["lastEligibilityWaitAverageMs"], 3250)
        self.assertEqual(summary["lastEligibilityWaitMaxMs"], 3250)
        self.assertEqual(summary["eligibilityWaitSamples24Hours"], 1)
        self.assertEqual(summary["eligibilityWaitAverageMs24Hours"], 3250)
        self.assertEqual(summary["eligibilityWaitMaxMs24Hours"], 3250)
        self.assertNotIn("https://", json.dumps(summary))

    def test_body_fetch_request_duration_is_bounded_and_persisted(self):
        reference = datetime.now(timezone.utc)
        started = reference - timedelta(seconds=1)
        selection = {
            "detectedNeverFetched": 0,
            "baselineNeverFetched": 0,
            "extractionPending": 0,
            "recheck": 2,
        }
        with monitor.connect(self.db_path) as db:
            with self.assertRaisesRegex(ValueError, "invalid-body-fetch-batch"):
                monitor.record_body_fetch_batch(
                    db, started.isoformat(timespec="milliseconds"),
                    reference.isoformat(timespec="milliseconds"),
                    1000, 2, 1, 1, (), selection,
                    selection_errors={"recheck": 1},
                    selection_not_modified={"recheck": 1},
                    request_durations_ms=(3_600_001,),
                )
            with self.assertRaisesRegex(ValueError, "invalid-body-fetch-batch"):
                monitor.record_body_fetch_batch(
                    db, started.isoformat(timespec="milliseconds"),
                    reference.isoformat(timespec="milliseconds"),
                    1000, 2, 1, 1, (), selection,
                    selection_errors={"recheck": 1},
                    selection_not_modified={"recheck": 1},
                    request_durations_ms=(650, 1200),
                    request_success_durations_ms=(650, 1200),
                )
            monitor.record_body_fetch_batch(
                db, started.isoformat(timespec="milliseconds"),
                reference.isoformat(timespec="milliseconds"),
                1000, 2, 1, 1, (), selection,
                selection_errors={"recheck": 1},
                selection_not_modified={"recheck": 1},
                request_durations_ms=(650, 1200),
                request_success_durations_ms=(650,),
                request_error_durations_ms=(1200,),
            )
            summary = monitor.body_fetch_batch_summary(
                db, reference.isoformat(timespec="milliseconds")
            )
        self.assertEqual(summary["lastRequestDurationSamples"], 2)
        self.assertEqual(summary["lastRequestDurationAverageMs"], 925)
        self.assertEqual(summary["lastRequestDurationMaxMs"], 1200)
        self.assertEqual(summary["requestDurationSamples24Hours"], 2)
        self.assertEqual(summary["requestDurationAverageMs24Hours"], 925)
        self.assertEqual(summary["requestDurationMaxMs24Hours"], 1200)
        self.assertEqual(summary["requestSuccessDurationSamples24Hours"], 1)
        self.assertEqual(summary["requestSuccessDurationAverageMs24Hours"], 650)
        self.assertEqual(summary["requestSuccessDurationMaxMs24Hours"], 650)
        self.assertEqual(summary["requestErrorDurationSamples24Hours"], 1)
        self.assertEqual(summary["requestErrorDurationAverageMs24Hours"], 1200)
        self.assertEqual(summary["requestErrorDurationMaxMs24Hours"], 1200)
        self.assertNotIn("https://", json.dumps(summary))

    def test_legacy_body_host_probe_table_migrates_without_guessing_due_time(self):
        legacy_path = Path(self.temp.name) / "legacy-probes.sqlite"
        with sqlite3.connect(legacy_path) as db:
            db.execute("""
              CREATE TABLE body_host_probe_events (
                id INTEGER PRIMARY KEY, attempted_at TEXT NOT NULL,
                completed_at TEXT NOT NULL, outcome TEXT NOT NULL)
            """)
            db.execute("""
              INSERT INTO body_host_probe_events(attempted_at,completed_at,outcome)
              VALUES(?,?,?)
            """, (
                "2026-09-23T00:00:00+00:00",
                "2026-09-23T00:00:01+00:00", "restricted",
            ))
        with monitor.connect(legacy_path) as db:
            columns = {
                row[1] for row in db.execute("PRAGMA table_info(body_host_probe_events)")
            }
            summary = monitor.body_host_probe_summary(
                db, "2026-09-23T00:01:00+00:00"
            )
        self.assertIn("eligible_at", columns)
        self.assertEqual(summary["probes24Hours"], 1)
        self.assertIsNone(summary["lastEligibleAt"])
        self.assertIsNone(summary["lastEligibilityWaitMs"])
        self.assertEqual(summary["eligibilityWaitSamples24Hours"], 0)

    def test_body_fetch_selection_partitions_must_cover_new_batch(self):
        reference = datetime.now(timezone.utc)
        started = reference - timedelta(seconds=1)
        with monitor.connect(self.db_path) as db:
            with self.assertRaisesRegex(ValueError, "invalid-body-fetch-batch"):
                monitor.record_body_fetch_batch(
                    db, started.isoformat(timespec="milliseconds"),
                    reference.isoformat(timespec="milliseconds"),
                    1000, 2, 0, 0, (), {
                        "detectedNeverFetched": 1,
                        "baselineNeverFetched": 0,
                        "extractionPending": 0,
                        "recheck": 0,
                    },
                )

    def test_body_fetch_selection_errors_must_match_total_and_partition(self):
        reference = datetime.now(timezone.utc)
        started = reference - timedelta(seconds=1)
        selections = {
            "detectedNeverFetched": 1,
            "baselineNeverFetched": 1,
            "extractionPending": 1,
            "recheck": 1,
        }
        with monitor.connect(self.db_path) as db:
            for selection_errors in (
                {"detectedNeverFetched": 1},
                {"detectedNeverFetched": 2, "baselineNeverFetched": 0},
            ):
                with self.assertRaisesRegex(ValueError, "invalid-body-fetch-batch"):
                    monitor.record_body_fetch_batch(
                        db, started.isoformat(timespec="milliseconds"),
                        reference.isoformat(timespec="milliseconds"),
                        1000, 4, 2, 0, (), selections, selection_errors,
                    )
            monitor.record_body_fetch_batch(
                db, started.isoformat(timespec="milliseconds"),
                reference.isoformat(timespec="milliseconds"),
                1000, 4, 2, 0, (), selections, {
                    "detectedNeverFetched": 1,
                    "baselineNeverFetched": 0,
                    "extractionPending": 0,
                    "recheck": 1,
                },
            )
            summary = monitor.body_fetch_batch_summary(
                db, reference.isoformat(timespec="milliseconds")
            )
        self.assertEqual(summary["lastErrorDetectedNeverFetched"], 1)
        self.assertEqual(summary["lastErrorBaselineNeverFetched"], 0)
        self.assertEqual(summary["lastErrorExtractionPending"], 0)
        self.assertEqual(summary["lastErrorRecheck"], 1)
        self.assertEqual(summary["errorDetectedNeverFetched24Hours"], 1)
        self.assertEqual(summary["errorBaselineNeverFetched24Hours"], 0)
        self.assertEqual(summary["errorExtractionPending24Hours"], 0)
        self.assertEqual(summary["errorRecheck24Hours"], 1)

    def test_body_fetch_not_modified_partitions_must_match_total_and_outcomes(self):
        reference = datetime.now(timezone.utc)
        started = reference - timedelta(seconds=1)
        selections = {
            "detectedNeverFetched": 1,
            "baselineNeverFetched": 1,
            "extractionPending": 1,
            "recheck": 1,
        }
        errors = {"detectedNeverFetched": 1}
        with monitor.connect(self.db_path) as db:
            for not_modified, partitions in (
                (2, {"recheck": 1}),
                (1, {"detectedNeverFetched": 1}),
            ):
                with self.assertRaisesRegex(ValueError, "invalid-body-fetch-batch"):
                    monitor.record_body_fetch_batch(
                        db, started.isoformat(timespec="milliseconds"),
                        reference.isoformat(timespec="milliseconds"),
                        1000, 4, 1, not_modified, (), selections, errors, partitions,
                    )
            monitor.record_body_fetch_batch(
                db, started.isoformat(timespec="milliseconds"),
                reference.isoformat(timespec="milliseconds"),
                1000, 4, 1, 1, (), selections, errors, {"recheck": 1},
            )
            summary = monitor.body_fetch_batch_summary(
                db, reference.isoformat(timespec="milliseconds")
            )
        self.assertEqual(summary["lastNotModifiedDetectedNeverFetched"], 0)
        self.assertEqual(summary["lastNotModifiedBaselineNeverFetched"], 0)
        self.assertEqual(summary["lastNotModifiedExtractionPending"], 0)
        self.assertEqual(summary["lastNotModifiedRecheck"], 1)
        self.assertEqual(summary["notModifiedDetectedNeverFetched24Hours"], 0)
        self.assertEqual(summary["notModifiedBaselineNeverFetched24Hours"], 0)
        self.assertEqual(summary["notModifiedExtractionPending24Hours"], 0)
        self.assertEqual(summary["notModifiedRecheck24Hours"], 1)

    def test_body_fetch_fetched_partitions_must_match_remaining_outcomes(self):
        reference = datetime.now(timezone.utc)
        started = reference - timedelta(seconds=1)
        selections = {
            "detectedNeverFetched": 1,
            "baselineNeverFetched": 1,
            "extractionPending": 1,
            "recheck": 1,
        }
        errors = {"detectedNeverFetched": 1}
        not_modified = {"recheck": 1}
        with monitor.connect(self.db_path) as db:
            for fetched in (
                {"baselineNeverFetched": 1},
                {"detectedNeverFetched": 1, "extractionPending": 1},
            ):
                with self.assertRaisesRegex(ValueError, "invalid-body-fetch-batch"):
                    monitor.record_body_fetch_batch(
                        db, started.isoformat(timespec="milliseconds"),
                        reference.isoformat(timespec="milliseconds"),
                        1000, 4, 1, 1, (), selections, errors, not_modified, fetched,
                    )
            monitor.record_body_fetch_batch(
                db, started.isoformat(timespec="milliseconds"),
                reference.isoformat(timespec="milliseconds"),
                1000, 4, 1, 1, (), selections, errors, not_modified, {
                    "baselineNeverFetched": 1,
                    "extractionPending": 1,
                },
            )
            summary = monitor.body_fetch_batch_summary(
                db, reference.isoformat(timespec="milliseconds")
            )
        self.assertEqual(summary["lastFetchedDetectedNeverFetched"], 0)
        self.assertEqual(summary["lastFetchedBaselineNeverFetched"], 1)
        self.assertEqual(summary["lastFetchedExtractionPending"], 1)
        self.assertEqual(summary["lastFetchedRecheck"], 0)
        self.assertEqual(summary["fetchedDetectedNeverFetched24Hours"], 0)
        self.assertEqual(summary["fetchedBaselineNeverFetched24Hours"], 1)
        self.assertEqual(summary["fetchedExtractionPending24Hours"], 1)
        self.assertEqual(summary["fetchedRecheck24Hours"], 0)
        self.assertEqual(
            summary["outcomeUnmeasuredDetectedNeverFetched24Hours"], 0
        )
        self.assertEqual(
            summary["outcomeUnmeasuredBaselineNeverFetched24Hours"], 0
        )
        self.assertEqual(
            summary["outcomeUnmeasuredExtractionPending24Hours"], 0
        )
        self.assertEqual(summary["outcomeUnmeasuredRecheck24Hours"], 0)

    def test_body_fetch_summary_marks_partially_migrated_outcomes_unmeasured(self):
        reference = datetime.now(timezone.utc)
        started = reference - timedelta(seconds=1)
        with monitor.connect(self.db_path) as db:
            monitor.record_body_fetch_batch(
                db, started.isoformat(timespec="milliseconds"),
                reference.isoformat(timespec="milliseconds"),
                1000, 2, 0, 1, (), {"recheck": 2}, {}, {"recheck": 1},
                {"recheck": 1},
            )
            db.execute("""
              UPDATE body_fetch_batches
              SET not_modified_recheck=0,fetched_recheck=0
              WHERE id=(SELECT max(id) FROM body_fetch_batches)
            """)
            db.commit()
            summary = monitor.body_fetch_batch_summary(
                db, reference.isoformat(timespec="milliseconds")
            )
        self.assertEqual(summary["selectedRecheck24Hours"], 2)
        self.assertEqual(summary["notModifiedRecheck24Hours"], 0)
        self.assertEqual(summary["fetchedRecheck24Hours"], 0)
        self.assertEqual(summary["outcomeUnmeasuredRecheck24Hours"], 2)

    def test_body_fetch_updated_partitions_must_be_successful_extractions(self):
        reference = datetime.now(timezone.utc)
        started = reference - timedelta(seconds=1)
        selections = {
            "detectedNeverFetched": 1,
            "baselineNeverFetched": 1,
            "extractionPending": 1,
            "recheck": 1,
        }
        errors = {"detectedNeverFetched": 1}
        not_modified = {"recheck": 1}
        fetched = {"baselineNeverFetched": 1, "extractionPending": 1}
        with monitor.connect(self.db_path) as db:
            with self.assertRaisesRegex(ValueError, "invalid-body-fetch-batch"):
                monitor.record_body_fetch_batch(
                    db, started.isoformat(timespec="milliseconds"),
                    reference.isoformat(timespec="milliseconds"),
                    1000, 4, 1, 1, (), selections, errors, not_modified, fetched,
                    {"detectedNeverFetched": 1},
                )
            monitor.record_body_fetch_batch(
                db, started.isoformat(timespec="milliseconds"),
                reference.isoformat(timespec="milliseconds"),
                1000, 4, 1, 1, (), selections, errors, not_modified, fetched,
                {"baselineNeverFetched": 1},
            )
            summary = monitor.body_fetch_batch_summary(
                db, reference.isoformat(timespec="milliseconds")
            )
        self.assertEqual(summary["lastUpdatedBaselineNeverFetched"], 1)
        self.assertEqual(summary["lastUpdatedExtractionPending"], 0)
        self.assertEqual(summary["updatedBaselineNeverFetched24Hours"], 1)
        self.assertEqual(summary["updatedExtractionPending24Hours"], 0)

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

    def test_public_snapshot_limits_history_and_live_response_is_compressed(self):
        with monitor.connect(self.db_path) as db:
            for number in range(25):
                db.execute(
                    "INSERT INTO history (url,at,kind,sha256) VALUES (?,?,?,?)",
                    ("https://nebius.com/newsroom/older", datetime.now(timezone.utc).isoformat(), "test", None),
                )
                db.execute(
                    """INSERT INTO discovery_runs
                       (ticker,at,status,candidates,index_url,source_format,sources_checked,sources_configured)
                       VALUES (?,?,?,?,?,?,?,?)""",
                    ("NBIS", datetime.now(timezone.utc).isoformat(), "ok", 1, "https://nebius.com/newsroom/", "html", 1, 1),
                )
            db.commit()
            self.assertEqual(len(monitor.snapshot(db)["discoveryRuns"]), 25)
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        limited = app.public_snapshot()
        self.assertEqual(len(limited["discoveryRuns"]), 20)
        self.assertEqual(len([row for row in limited["history"] if row["url"].endswith("older")]), 20)
        server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
        server.app = app
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            request = Request(
                f"http://127.0.0.1:{server.server_port}/live",
                headers={"Accept-Encoding": "gzip"},
            )
            with urlopen(request, timeout=2) as response:
                self.assertEqual(response.headers["Content-Encoding"], "gzip")
                wire = response.read()
                self.assertLess(len(wire), len(gzip.decompress(wire)))
                self.assertEqual(len(json.loads(gzip.decompress(wire))["snapshot"]["discoveryRuns"]), 20)
        finally:
            server.shutdown()
            server.server_close()

    def test_body_fetch_prioritizes_new_event_and_exports_only_metadata(self):
        due_at = datetime.now(timezone.utc) - timedelta(seconds=3)
        with monitor.connect(self.db_path) as db:
            db.execute(
                "UPDATE sources SET next_fetch_at=? WHERE url LIKE '%new-release'",
                (due_at.isoformat(timespec="milliseconds"),),
            )
            db.commit()
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
        body_fetch = app.public_state()["bodyFetch"]
        self.assertEqual(body_fetch["lastBatchChecks"], 1)
        self.assertEqual(body_fetch["lastBatchErrors"], 0)
        self.assertEqual(body_fetch["lastBatchNotModified"], 0)
        self.assertIsNotNone(body_fetch["lastPollAt"])
        self.assertIsNotNone(body_fetch["lastBatchAt"])
        self.assertIsInstance(body_fetch["lastBatchDurationMs"], int)
        durable = body_fetch["durable"]
        self.assertEqual(durable["runs24Hours"], 1)
        self.assertEqual(durable["checks24Hours"], 1)
        self.assertEqual(durable["errors24Hours"], 0)
        self.assertEqual(durable["notModified24Hours"], 0)
        self.assertEqual(durable["detectionLatencySamples24Hours"], 1)
        self.assertEqual(durable["eligibilityWaitSamples24Hours"], 1)
        self.assertIsInstance(durable["eligibilityWaitAverageMs24Hours"], int)
        self.assertIsInstance(durable["eligibilityWaitMaxMs24Hours"], int)
        self.assertGreaterEqual(durable["eligibilityWaitAverageMs24Hours"], 3000)
        self.assertEqual(durable["requestDurationSamples24Hours"], 1)
        self.assertIsInstance(durable["requestDurationAverageMs24Hours"], int)
        self.assertIsInstance(durable["requestDurationMaxMs24Hours"], int)
        self.assertEqual(durable["requestSuccessDurationSamples24Hours"], 1)
        self.assertEqual(durable["requestErrorDurationSamples24Hours"], 0)
        self.assertEqual(durable["selectedDetectedNeverFetched24Hours"], 1)
        self.assertEqual(durable["selectedBaselineNeverFetched24Hours"], 0)
        self.assertEqual(durable["selectedExtractionPending24Hours"], 0)
        self.assertEqual(durable["selectedRecheck24Hours"], 0)
        self.assertEqual(durable["errorDetectedNeverFetched24Hours"], 0)
        self.assertEqual(durable["errorBaselineNeverFetched24Hours"], 0)
        self.assertEqual(durable["errorExtractionPending24Hours"], 0)
        self.assertEqual(durable["errorRecheck24Hours"], 0)
        self.assertEqual(durable["notModifiedDetectedNeverFetched24Hours"], 0)
        self.assertEqual(durable["notModifiedBaselineNeverFetched24Hours"], 0)
        self.assertEqual(durable["notModifiedExtractionPending24Hours"], 0)
        self.assertEqual(durable["notModifiedRecheck24Hours"], 0)
        self.assertEqual(durable["fetchedDetectedNeverFetched24Hours"], 1)
        self.assertEqual(durable["fetchedBaselineNeverFetched24Hours"], 0)
        self.assertEqual(durable["fetchedExtractionPending24Hours"], 0)
        self.assertEqual(durable["fetchedRecheck24Hours"], 0)
        self.assertEqual(durable["updatedDetectedNeverFetched24Hours"], 1)
        self.assertEqual(durable["updatedBaselineNeverFetched24Hours"], 0)
        self.assertEqual(durable["updatedExtractionPending24Hours"], 0)
        self.assertEqual(durable["updatedRecheck24Hours"], 0)
        self.assertIsInstance(durable["detectionLatencyAverageMs24Hours"], int)
        self.assertIsInstance(durable["detectionLatencyMaxMs24Hours"], int)
        self.assertNotIn("https://", json.dumps(durable))

        restarted = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        persisted = restarted.public_state()["bodyFetch"]["durable"]
        self.assertTrue(durable.pop("polledSinceStart"))
        self.assertTrue(durable.pop("completedSinceStart"))
        self.assertFalse(persisted.pop("polledSinceStart"))
        self.assertFalse(persisted.pop("completedSinceStart"))
        self.assertEqual(persisted, durable)

    def test_body_fetch_persists_failure_for_selected_partition(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 1
        original_fetch = monitor.fetch
        monitor.fetch = lambda *_args, **_kwargs: (_ for _ in ()).throw(
            TimeoutError("private endpoint timed out")
        )
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                app.fetch_bodies(pool)
        finally:
            monitor.fetch = original_fetch
        durable = app.public_state()["bodyFetch"]["durable"]
        self.assertEqual(durable["lastErrors"], 1)
        self.assertEqual(durable["lastSelectedDetectedNeverFetched"], 1)
        self.assertEqual(durable["lastErrorDetectedNeverFetched"], 1)
        self.assertEqual(durable["errorDetectedNeverFetched24Hours"], 1)
        self.assertEqual(durable["errorBaselineNeverFetched24Hours"], 0)
        self.assertEqual(durable["errorExtractionPending24Hours"], 0)
        self.assertEqual(durable["errorRecheck24Hours"], 0)
        self.assertEqual(durable["requestSuccessDurationSamples24Hours"], 0)
        self.assertEqual(durable["requestErrorDurationSamples24Hours"], 1)
        self.assertIsInstance(durable["requestErrorDurationAverageMs24Hours"], int)
        self.assertIsInstance(durable["requestErrorDurationMaxMs24Hours"], int)
        self.assertNotIn("private endpoint", json.dumps(durable))

    def test_body_latency_ignores_routine_rechecks_and_invalid_detection_times(self):
        with monitor.connect(self.db_path) as db:
            db.execute("""
              UPDATE sources SET sha256=?,raw_sha256=?,body_sha256=?,
                extracted_text='Existing evidence.',extracted_chars=18,next_fetch_at=NULL
              WHERE url LIKE '%new-release'
            """, ("a" * 64, "a" * 64, "b" * 64))
            db.commit()
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 1
        original_fetch = monitor.fetch
        monitor.fetch = lambda *_: (b"<main>Routine evidence remains current.</main>", "text/html")
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                app.fetch_bodies(pool)
        finally:
            monitor.fetch = original_fetch
        durable = app.public_state()["bodyFetch"]["durable"]
        self.assertEqual(durable["detectionLatencySamples24Hours"], 0)
        self.assertIsNone(durable["detectionLatencyAverageMs24Hours"])
        self.assertIsNone(durable["detectionLatencyMaxMs24Hours"])
        self.assertIsNone(service.timestamp_latency_ms("not-a-timestamp", service.utc_now()))
        self.assertIsNone(service.timestamp_latency_ms(service.utc_now(), "not-a-timestamp"))

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

    def test_body_candidates_reserve_spare_slot_for_oldest_unfetched_release(self):
        oldest = "https://investor.marvell.com/news-events/press-releases/detail/999/oldest-release"
        middle = "https://www.vertiv.com/en-us/about/news-and-events/corporate-news/2026/middle-release/"
        newest = "https://www.arista.com/en/company/news/press-release/newest-release"
        with monitor.connect(self.db_path) as db:
            for ticker, url, detected_at in (
                ("MRVL", oldest, "2026-09-23T00:00:00+00:00"),
                ("VRT", middle, "2026-09-24T00:00:00+00:00"),
                ("ANET", newest, "2026-09-25T00:00:00+00:00"),
            ):
                monitor.add_source(db, ticker, url, title=ticker)
                monitor.add_release_events(db, ticker, [url])
                db.execute(
                    "UPDATE release_events SET detected_at=? WHERE url=?",
                    (detected_at, url),
                )
            db.execute(
                "UPDATE release_events SET detected_at=? WHERE url LIKE '%new-release'",
                ("2026-09-24T12:00:00+00:00",),
            )
            db.commit()

        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 2
        rows, pending = app.body_candidates("2026-09-26T00:00:00+00:00")

        self.assertEqual(pending, 5)
        self.assertEqual([row["url"] for row in rows], [newest, oldest])
        backlog = app.public_state()["bodyBacklog"]
        self.assertTrue(backlog["fairnessScheduled"])
        self.assertFalse(backlog["fairnessSharedHost"])
        self.assertEqual(backlog["scheduledDetectedNeverFetched"], 2)
        self.assertEqual(backlog["scheduledBaselineNeverFetched"], 0)
        self.assertEqual(backlog["scheduledExtractionPending"], 0)
        self.assertEqual(backlog["scheduledRecheck"], 0)
        self.assertGreater(backlog["fairnessAgeMs"], 2 * 24 * 60 * 60 * 1000)
        self.assertLess(backlog["fairnessAgeMs"], 4 * 24 * 60 * 60 * 1000)

    def test_body_candidates_oldest_release_replaces_newest_on_same_host(self):
        oldest = "https://investor.marvell.com/news/detail/998/oldest-release"
        newest = "https://investor.marvell.com/news/detail/999/newest-release"
        other_host = "https://www.vertiv.com/news/middle-release/"
        with monitor.connect(self.db_path) as db:
            db.execute("UPDATE sources SET next_fetch_at='2099-01-01T00:00:00+00:00'")
            for ticker, url, detected_at in (
                ("MRVL", oldest, "2026-09-23T00:00:00+00:00"),
                ("MRVL", newest, "2026-09-25T00:00:00+00:00"),
                ("VRT", other_host, "2026-09-24T00:00:00+00:00"),
            ):
                monitor.add_source(db, ticker, url, title=ticker)
                monitor.add_release_events(db, ticker, [url])
                db.execute(
                    "UPDATE release_events SET detected_at=? WHERE url=?",
                    (detected_at, url),
                )
            db.commit()

        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 2
        rows, _pending = app.body_candidates("2026-09-26T00:00:00+00:00")

        selected = [row["url"] for row in rows]
        self.assertEqual(selected, [oldest, other_host])
        self.assertNotIn(newest, selected)
        backlog = app.public_state()["bodyBacklog"]
        self.assertTrue(backlog["fairnessScheduled"])
        self.assertTrue(backlog["fairnessSharedHost"])
        self.assertEqual(backlog["scheduledDetectedNeverFetched"], 2)
        self.assertGreater(backlog["fairnessAgeMs"], 2 * 24 * 60 * 60 * 1000)
        self.assertLess(backlog["fairnessAgeMs"], 4 * 24 * 60 * 60 * 1000)
        self.assertNotIn("marvell.com", json.dumps(backlog))

    def test_body_backlog_distinguishes_eligible_and_access_restricted_retries(self):
        detected_at = datetime.now(timezone.utc) - timedelta(hours=1)
        detected_at_text = detected_at.isoformat(timespec="milliseconds")
        with monitor.connect(self.db_path) as db:
            db.execute("""
              UPDATE sources
              SET error='http-403',fetch_failures=1,next_fetch_at='2099-01-01T00:00:00+00:00'
              WHERE url LIKE '%older'
            """)
            db.execute(
                "UPDATE release_events SET detected_at=?", (detected_at_text,)
            )
            db.commit()

        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        _rows, pending = app.body_candidates("2026-09-24T05:00:00+00:00")
        backlog = app.public_state()["bodyBacklog"]
        detected_age_ms = backlog.pop("detectedNeverFetchedAgeMaxMs")

        self.assertEqual(pending, 1)
        self.assertEqual(backlog, {
            "eligible": 1,
            "hostDeferred": 0,
            "activeHostCircuits": 0,
            "nextHostProbeAt": None,
            "dueHostCircuits": 0,
            "scheduledHostProbes": 0,
            "retryDeferred": 1,
            "accessRestricted": 1,
            "rateLimited": 0,
            "recheckDeferred": 0,
            "neverFetched": 2,
            "detectedNeverFetched": 1,
            "baselineNeverFetched": 1,
            "detectedNeverFetchedMeasured": 1,
            "detectedNeverFetchedUnmeasured": 0,
            "oldestDetectedNeverFetchedAt": detected_at_text,
            "fairnessScheduled": False,
            "fairnessAgeMs": None,
            "fairnessSharedHost": False,
            "scheduledDetectedNeverFetched": 1,
            "scheduledBaselineNeverFetched": 0,
            "scheduledExtractionPending": 0,
            "scheduledRecheck": 0,
            "extractionPending": 0,
            "extracted": 0,
            "total": 2,
            "measuredAt": "2026-09-24T05:00:00+00:00",
        })
        self.assertGreaterEqual(detected_age_ms, 3600000)
        self.assertLess(detected_age_ms, 3610000)
        self.assertNotIn("https://", json.dumps(backlog))

    def test_body_backlog_partitions_evidence_state_without_source_details(self):
        with monitor.connect(self.db_path) as db:
            older = "https://nebius.com/newsroom/older"
            extracted = "https://nebius.com/newsroom/extracted"
            monitor.add_source(db, "NBIS", extracted, title="Extracted")
            db.execute("""
              UPDATE sources
              SET sha256=?,raw_sha256=?,body_sha256=?,extracted_text='',extracted_chars=0
              WHERE url=?
            """, ("a" * 64, "a" * 64, "b" * 64, older))
            db.execute("""
              UPDATE sources
              SET sha256=?,raw_sha256=?,body_sha256=?,extracted_text='Evidence',extracted_chars=8
              WHERE url=?
            """, ("c" * 64, "c" * 64, "d" * 64, extracted))
            db.execute("UPDATE release_events SET detected_at='2099-01-01T00:00:00+00:00'")
            db.commit()

        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_candidates("2026-09-24T05:00:00+00:00")
        backlog = app.public_state()["bodyBacklog"]

        self.assertEqual(backlog["neverFetched"], 1)
        self.assertEqual(backlog["detectedNeverFetched"], 1)
        self.assertEqual(backlog["baselineNeverFetched"], 0)
        self.assertEqual(
            backlog["detectedNeverFetched"] + backlog["baselineNeverFetched"],
            backlog["neverFetched"],
        )
        self.assertEqual(
            backlog["detectedNeverFetchedMeasured"]
            + backlog["detectedNeverFetchedUnmeasured"],
            backlog["detectedNeverFetched"],
        )
        self.assertEqual(backlog["detectedNeverFetchedMeasured"], 0)
        self.assertEqual(backlog["detectedNeverFetchedUnmeasured"], 1)
        self.assertIsNone(backlog["detectedNeverFetchedAgeMaxMs"])
        self.assertIsNone(backlog["oldestDetectedNeverFetchedAt"])
        self.assertEqual(backlog["extractionPending"], 1)
        self.assertEqual(backlog["extracted"], 1)
        self.assertEqual(
            backlog["neverFetched"] + backlog["extractionPending"] + backlog["extracted"],
            backlog["total"],
        )
        self.assertNotIn("nebius.com", json.dumps(backlog))

    def test_body_backlog_partitions_current_batch_by_evidence_state(self):
        detected = "https://www.arista.com/en/company/news/press-release/batch-detected"
        baseline = "https://investor.marvell.com/news-events/press-releases/detail/997/batch-baseline"
        incomplete = "https://www.vertiv.com/en-us/about/news-and-events/corporate-news/2026/batch-incomplete/"
        recheck = "https://investors.palantir.com/news-details/2026/batch-recheck"
        with monitor.connect(self.db_path) as db:
            db.execute("UPDATE sources SET next_fetch_at='2099-01-01T00:00:00+00:00'")
            for ticker, url in (
                ("ANET", detected), ("MRVL", baseline),
                ("VRT", incomplete), ("PLTR", recheck),
            ):
                monitor.add_source(db, ticker, url, title=ticker)
            monitor.add_release_events(db, "ANET", [detected])
            db.execute("""
              UPDATE sources
              SET sha256=?,raw_sha256=?,body_sha256=?,extracted_text='',extracted_chars=0
              WHERE url=?
            """, ("a" * 64, "a" * 64, "b" * 64, incomplete))
            db.execute("""
              UPDATE sources
              SET sha256=?,raw_sha256=?,body_sha256=?,extracted_text='Evidence',extracted_chars=8
              WHERE url=?
            """, ("c" * 64, "c" * 64, "d" * 64, recheck))
            db.commit()

        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 4
        rows, _pending = app.body_candidates("2026-09-26T00:00:00+00:00")
        backlog = app.public_state()["bodyBacklog"]

        self.assertEqual(backlog["scheduledDetectedNeverFetched"], 1)
        self.assertEqual(backlog["scheduledBaselineNeverFetched"], 1)
        self.assertEqual(backlog["scheduledExtractionPending"], 1)
        self.assertEqual(backlog["scheduledRecheck"], 1)
        self.assertEqual(sum((
            backlog["scheduledDetectedNeverFetched"],
            backlog["scheduledBaselineNeverFetched"],
            backlog["scheduledExtractionPending"],
            backlog["scheduledRecheck"],
        )), len(rows))
        self.assertNotIn("batch-", json.dumps(backlog))

    def test_body_backlog_reports_rate_limits_separately_from_access_controls(self):
        with monitor.connect(self.db_path) as db:
            db.execute("""
              UPDATE sources
              SET error='http-429',fetch_failures=1,next_fetch_at='2099-01-01T00:00:00+00:00'
              WHERE url LIKE '%older'
            """)
            db.commit()

        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_candidates("2026-09-24T05:00:00+00:00")
        backlog = app.public_state()["bodyBacklog"]

        self.assertEqual(backlog["retryDeferred"], 1)
        self.assertEqual(backlog["accessRestricted"], 0)
        self.assertEqual(backlog["rateLimited"], 1)
        self.assertNotIn("http-429", json.dumps(backlog))

    def test_body_candidates_defer_same_host_after_access_restriction(self):
        sec_url = (
            "https://www.sec.gov/Archives/edgar/data/1835632/"
            "000183563226000001/example.htm"
        )
        with monitor.connect(self.db_path) as db:
            blocked = db.execute(
                "SELECT * FROM sources WHERE url LIKE '%older'"
            ).fetchone()
            monitor.save_source_error(
                db, blocked, HTTPError(blocked["url"], 403, "Forbidden", {}, None)
            )
            monitor.add_source(db, "NBIS", sec_url, title="SEC filing")
            db.commit()

        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 5
        rows, pending = app.body_candidates("2026-09-24T05:00:00+00:00")
        backlog = app.public_state()["bodyBacklog"]

        self.assertEqual([row["url"] for row in rows], [sec_url])
        self.assertEqual(pending, 1)
        self.assertEqual(backlog["hostDeferred"], 1)
        self.assertEqual(backlog["activeHostCircuits"], 1)
        self.assertIsNotNone(backlog["nextHostProbeAt"])
        self.assertEqual(backlog["retryDeferred"], 1)
        self.assertEqual(backlog["total"], 3)
        self.assertNotIn("nebius.com", json.dumps(backlog))

    def test_body_batch_attempts_only_one_url_per_host(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 5
        rows, pending = app.body_candidates()
        self.assertEqual(pending, 2)
        self.assertEqual(len(rows), 1)

    def test_expired_host_circuit_allows_one_probe_then_reopens_on_restriction(self):
        expired = datetime.now(timezone.utc) - timedelta(minutes=1)
        updated = expired - timedelta(hours=6)
        with monitor.connect(self.db_path) as db:
            db.execute(
                "UPDATE sources SET error='http-403',fetch_failures=1,next_fetch_at=?",
                (expired.isoformat(timespec="milliseconds"),),
            )
            db.execute("""
              INSERT INTO body_host_backoff(host,failures,error,retry_at,updated_at)
              VALUES('nebius.com',1,'http-403',?,?)
            """, (
                expired.isoformat(timespec="milliseconds"),
                updated.isoformat(timespec="milliseconds"),
            ))
            db.commit()

        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 5
        rows, pending = app.body_candidates()
        self.assertEqual(pending, 2)
        self.assertEqual(len(rows), 1)
        self.assertEqual(app.public_state()["bodyBacklog"]["activeHostCircuits"], 0)
        self.assertEqual(app.public_state()["bodyBacklog"]["dueHostCircuits"], 1)
        self.assertEqual(app.public_state()["bodyBacklog"]["scheduledHostProbes"], 1)

        attempted = []

        def still_restricted(url, *_args, **_kwargs):
            attempted.append(url)
            raise HTTPError(url, 403, "Forbidden", {}, None)

        original_fetch = monitor.fetch
        monitor.fetch = still_restricted
        try:
            with ThreadPoolExecutor(max_workers=5) as pool:
                app.fetch_bodies(pool)
        finally:
            monitor.fetch = original_fetch

        self.assertEqual(len(attempted), 1)
        with monitor.connect(self.db_path) as db:
            circuit = db.execute(
                "SELECT failures,error,retry_at,updated_at FROM body_host_backoff "
                "WHERE host='nebius.com'"
            ).fetchone()
        self.assertEqual(circuit["failures"], 2)
        self.assertEqual(circuit["error"], "http-403")
        self.assertGreater(circuit["retry_at"], circuit["updated_at"])

        rows, pending = app.body_candidates()
        backlog = app.public_state()["bodyBacklog"]
        self.assertEqual(rows, [])
        self.assertEqual(pending, 0)
        self.assertEqual(backlog["activeHostCircuits"], 1)
        self.assertEqual(backlog["dueHostCircuits"], 0)
        self.assertEqual(backlog["scheduledHostProbes"], 0)
        self.assertEqual(backlog["hostDeferred"], 1)
        self.assertEqual(backlog["retryDeferred"], 1)
        self.assertIsNotNone(backlog["nextHostProbeAt"])
        probes = app.public_state()["bodyHostProbes"]
        self.assertEqual(probes["lastOutcome"], "restricted")
        self.assertGreaterEqual(probes["lastEligibilityWaitMs"], 0)
        self.assertEqual(probes["eligibilityWaitSamples24Hours"], 1)
        self.assertEqual(probes["probes24Hours"], 1)
        self.assertEqual(probes["restricted24Hours"], 1)
        self.assertNotIn("nebius.com", json.dumps(probes))
        self.assertNotIn("https://", json.dumps(probes))

        def unexpected_retry(*_args, **_kwargs):
            raise AssertionError("an active host circuit must suppress the next worker request")

        monitor.fetch = unexpected_retry
        try:
            with ThreadPoolExecutor(max_workers=5) as pool:
                app.fetch_bodies(pool)
        finally:
            monitor.fetch = original_fetch
        self.assertEqual(app.public_state()["bodyHostProbes"], probes)
        self.assertEqual(app.public_state()["bodyFetch"]["lastBatchChecks"], 1)

        restarted = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        self.assertEqual(restarted.public_state()["bodyHostProbes"], probes)

    def test_expired_host_circuit_reserves_spare_batch_capacity_for_probe(self):
        expired = datetime.now(timezone.utc) - timedelta(minutes=1)
        updated = expired - timedelta(hours=6)
        fresh_urls = (
            "https://pr.tsmc.com/english/news/official-release",
            "https://investor.sandisk.com/news-events/news-releases/official-release",
        )
        with monitor.connect(self.db_path) as db:
            db.execute("""
              UPDATE sources SET sha256=?,raw_sha256=?,body_sha256=?,
                extracted_text='Existing evidence.',extracted_chars=18,
                error=NULL,next_fetch_at=NULL
            """, ("a" * 64, "a" * 64, "b" * 64))
            for ticker, url in zip(("TSM", "SNDK"), fresh_urls):
                monitor.add_source(db, ticker, url, title="Fresh official release")
                monitor.add_release_events(db, ticker, [url])
            db.execute("""
              INSERT INTO body_host_backoff(host,failures,error,retry_at,updated_at)
              VALUES('nebius.com',1,'http-403',?,?)
            """, (
                expired.isoformat(timespec="milliseconds"),
                updated.isoformat(timespec="milliseconds"),
            ))
            db.commit()

        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 2
        rows, _pending = app.body_candidates()

        self.assertIn(rows[0]["url"], fresh_urls)
        self.assertEqual(monitor.source_hostname(rows[1]["url"]), "nebius.com")
        self.assertEqual(app.body_probe_urls, {rows[1]["url"]})
        backlog = app.public_state()["bodyBacklog"]
        self.assertEqual(backlog["dueHostCircuits"], 1)
        self.assertEqual(backlog["scheduledHostProbes"], 1)
        self.assertNotIn("nebius.com", json.dumps(backlog))

    def test_expired_host_circuit_probe_success_is_persisted_as_recovered(self):
        expired = datetime.now(timezone.utc) - timedelta(minutes=1)
        updated = expired - timedelta(hours=6)
        with monitor.connect(self.db_path) as db:
            db.execute(
                "UPDATE sources SET error='http-403',fetch_failures=1,next_fetch_at=?",
                (expired.isoformat(timespec="milliseconds"),),
            )
            db.execute("""
              INSERT INTO body_host_backoff(host,failures,error,retry_at,updated_at)
              VALUES('nebius.com',1,'http-403',?,?)
            """, (
                expired.isoformat(timespec="milliseconds"),
                updated.isoformat(timespec="milliseconds"),
            ))
            db.commit()

        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 5
        original_fetch = monitor.fetch
        monitor.fetch = lambda *_args, **_kwargs: (
            b"<main><h1>Recovered</h1><p>Direct official evidence.</p></main>",
            "text/html",
        )
        try:
            with ThreadPoolExecutor(max_workers=5) as pool:
                app.fetch_bodies(pool)
        finally:
            monitor.fetch = original_fetch

        probes = app.public_state()["bodyHostProbes"]
        self.assertEqual(probes["lastOutcome"], "recovered")
        self.assertGreaterEqual(probes["lastEligibilityWaitMs"], 0)
        self.assertEqual(probes["eligibilityWaitSamples24Hours"], 1)
        self.assertEqual(probes["probes24Hours"], 1)
        self.assertEqual(probes["recovered24Hours"], 1)
        self.assertEqual(probes["restricted24Hours"], 0)
        self.assertEqual(probes["failed24Hours"], 0)
        with monitor.connect(self.db_path) as db:
            self.assertIsNone(db.execute(
                "SELECT 1 FROM body_host_backoff WHERE host='nebius.com'"
            ).fetchone())

    def test_body_host_probe_summary_excludes_future_and_invalid_timestamps(self):
        reference = "2026-09-24T12:00:00.000+00:00"
        with monitor.connect(self.db_path) as db:
            monitor.record_body_host_probe(
                db, "2026-09-24T11:59:50.000+00:00",
                "2026-09-24T11:59:58.000+00:00",
                "2026-09-24T11:59:59.000+00:00", "failed",
            )
            db.executemany("""
              INSERT INTO body_host_probe_events(attempted_at,completed_at,outcome)
              VALUES(?,?,?)
            """, (
                ("2026-09-24T12:00:01.000+00:00", "2026-09-24T12:00:02.000+00:00", "recovered"),
                ("2026-09-24T11:00:02.000+00:00", "2026-09-24T11:00:01.000+00:00", "restricted"),
                ("2026-09-24T09:00:00.000+00:00", "2026-09-24T11:00:00.000+00:00", "restricted"),
            ))
            summary = monitor.body_host_probe_summary(db, reference)
        self.assertEqual(summary, {
            "lastEligibleAt": "2026-09-24T11:59:50.000+00:00",
            "lastAttemptedAt": "2026-09-24T11:59:58.000+00:00",
            "lastCompletedAt": "2026-09-24T11:59:59.000+00:00",
            "lastOutcome": "failed", "lastEligibilityWaitMs": 8000,
            "probes24Hours": 1,
            "recovered24Hours": 0, "restricted24Hours": 0,
            "failed24Hours": 1,
            "eligibilityWaitSamples24Hours": 1,
            "eligibilityWaitAverageMs24Hours": 8000,
            "eligibilityWaitMaxMs24Hours": 8000,
        })

    def test_body_candidates_ignore_corrupt_host_circuit(self):
        with monitor.connect(self.db_path) as db:
            db.execute("""
              INSERT INTO body_host_backoff(host,failures,error,retry_at,updated_at)
              VALUES('nebius.com',1,'http-403','2099-01-01T00:00:00+00:00',
                     '2026-09-24T05:00:00+00:00')
            """)
            db.commit()
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        rows, pending = app.body_candidates("2026-09-24T05:00:00+00:00")
        self.assertEqual(pending, 2)
        self.assertEqual(len(rows), 1)
        self.assertEqual(app.public_state()["bodyBacklog"]["hostDeferred"], 0)
        self.assertEqual(app.public_state()["bodyBacklog"]["activeHostCircuits"], 0)
        self.assertIsNone(app.public_state()["bodyBacklog"]["nextHostProbeAt"])

    def test_body_candidates_try_company_evidence_before_equivalent_sec_backlog(self):
        sec_url = (
            "https://www.sec.gov/Archives/edgar/data/1835632/"
            "000183563226000001/example.htm"
        )
        with monitor.connect(self.db_path) as db:
            monitor.add_source(db, "MRVL", sec_url, title="SEC filing")
            monitor.add_release_events(db, "MRVL", [sec_url])
            db.commit()

        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 2
        rows, _pending = app.body_candidates()
        self.assertTrue(rows[0]["url"].endswith("new-release"))
        self.assertEqual(rows[1]["url"], sec_url)

        with monitor.connect(self.db_path) as db:
            db.execute(
                "UPDATE sources SET fetch_failures=1 WHERE url LIKE '%new-release'"
            )
            db.commit()
        rows, _pending = app.body_candidates()
        self.assertEqual(rows[0]["url"], sec_url)

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
        self.assertEqual(app.public_state()["bodyFetch"]["lastBatchNotModified"], 1)
        durable = app.public_state()["bodyFetch"]["durable"]
        self.assertEqual(durable["lastNotModified"], 1)
        self.assertEqual(durable["notModified24Hours"], 1)
        self.assertEqual(durable["lastNotModifiedDetectedNeverFetched"], 0)
        self.assertEqual(durable["lastNotModifiedBaselineNeverFetched"], 0)
        self.assertEqual(durable["lastNotModifiedExtractionPending"], 0)
        self.assertEqual(durable["lastNotModifiedRecheck"], 1)
        self.assertEqual(durable["notModifiedRecheck24Hours"], 1)

    def test_empty_body_poll_records_poll_without_overwriting_batch_metrics(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.state["bodyFetch"].update({
            "lastBatchAt": "2026-09-23T00:00:00+00:00",
            "lastBatchDurationMs": 125,
            "lastBatchChecks": 2,
            "lastBatchErrors": 1,
            "lastBatchNotModified": 1,
        })
        with patch.object(app, "body_candidates", return_value=([], 0)):
            with ThreadPoolExecutor(max_workers=1) as pool:
                app.fetch_bodies(pool)
        body_fetch = app.public_state()["bodyFetch"]
        self.assertIsNotNone(body_fetch["lastPollAt"])
        self.assertEqual(body_fetch["lastBatchAt"], "2026-09-23T00:00:00+00:00")
        self.assertEqual(body_fetch["lastBatchDurationMs"], 125)
        self.assertEqual(body_fetch["lastBatchChecks"], 2)

    def test_body_worker_failure_is_isolated_redacted_and_recovers(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_interval = 10
        with patch.object(
            app, "fetch_bodies", side_effect=RuntimeError("private database path")
        ):
            with ThreadPoolExecutor(max_workers=1) as pool:
                self.assertFalse(app.fetch_bodies_safely(pool))
        failed = app.public_state()
        self.assertFalse(failed["bodyFetch"]["healthy"])
        self.assertEqual(failed["bodyFetch"]["consecutiveFailures"], 1)
        self.assertEqual(failed["bodyFetch"]["lastError"], "body-fetch-failed")
        self.assertEqual(failed["bodyFetch"]["retrySeconds"], 20)
        self.assertIsNotNone(failed["bodyFetch"]["nextRetryAt"])
        self.assertIn("body-fetch-failed", failed["health"]["issues"])
        self.assertNotIn("private database path", json.dumps(failed))

        with patch.object(app, "fetch_bodies", side_effect=RuntimeError("still private")):
            with ThreadPoolExecutor(max_workers=1) as pool:
                self.assertFalse(app.fetch_bodies_safely(pool))
        repeated = app.public_state()["bodyFetch"]
        self.assertEqual(repeated["consecutiveFailures"], 2)
        self.assertEqual(repeated["retrySeconds"], 40)
        self.assertNotIn("still private", json.dumps(repeated))

        with patch.object(app, "fetch_bodies", side_effect=RuntimeError("bounded private")):
            with ThreadPoolExecutor(max_workers=1) as pool:
                for _ in range(4):
                    self.assertFalse(app.fetch_bodies_safely(pool))
        capped = app.public_state()["bodyFetch"]
        self.assertEqual(capped["consecutiveFailures"], 6)
        self.assertEqual(capped["retrySeconds"], 300)
        self.assertNotIn("bounded private", json.dumps(capped))

        app.sync_health_incidents()
        with monitor.connect(self.db_path) as db:
            incident = db.execute(
                "SELECT status,last_error_code AS error_code FROM operational_incidents WHERE incident_key=?",
                ("body:worker",),
            ).fetchone()
            self.assertEqual(dict(incident), {
                "status": "open", "error_code": "body-fetch-failed",
            })

        with patch.object(app, "body_candidates", return_value=([], 0)):
            with ThreadPoolExecutor(max_workers=1) as pool:
                self.assertTrue(app.fetch_bodies_safely(pool))
        recovered = app.public_state()
        self.assertTrue(recovered["bodyFetch"]["healthy"])
        self.assertEqual(recovered["bodyFetch"]["consecutiveFailures"], 0)
        self.assertEqual(recovered["bodyFetch"]["retrySeconds"], 0)
        self.assertIsNone(recovered["bodyFetch"]["nextRetryAt"])
        self.assertNotIn("body-fetch-failed", recovered["health"]["issues"])
        app.sync_health_incidents()
        with monitor.connect(self.db_path) as db:
            self.assertEqual(db.execute(
                "SELECT status FROM operational_incidents WHERE incident_key=?",
                ("body:worker",),
            ).fetchone()[0], "resolved")

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

    def test_public_health_exposes_safe_discovery_cache_totals(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        cache = app.public_state()["discoveryCache"]
        self.assertEqual(set(cache), {
            "persistedSources", "invalidatedSources", "conditionalRequests",
            "notModifiedResponses", "freshResponses", "lastUpdatedAt",
        })
        self.assertEqual(cache["persistedSources"], 0)
        self.assertEqual(cache["notModifiedResponses"], 0)
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

    def test_supplemental_failure_does_not_back_off_verified_company_route(self):
        partial = {"status": "degraded", "route": "primary", "candidates": 1}
        total = {"status": "degraded", "route": "none", "candidates": 0}
        recovered = {"status": "fallback", "route": "fallback", "candidates": 1}
        legacy_ok = {"status": "ok", "candidates": 1}

        self.assertTrue(service.discovery_has_verified_route(partial))
        self.assertFalse(service.discovery_requires_backoff(partial))
        self.assertFalse(service.discovery_has_verified_route(total))
        self.assertTrue(service.discovery_requires_backoff(total))
        self.assertTrue(service.discovery_has_verified_route(recovered))
        self.assertFalse(service.discovery_requires_backoff(recovered))
        self.assertTrue(service.discovery_has_verified_route(legacy_ok))

    def test_partial_discovery_route_restores_baseline_after_restart(self):
        with monitor.connect(self.db_path) as db:
            monitor.save_discovery(db, "MRVL", {
                "status": "degraded", "route": "primary", "candidates": 0,
                "error": "timeout", "sourceUrl": monitor.INDEXES["MRVL"],
                "sourceFormat": "rss", "sourcesChecked": 3,
                "sourcesConfigured": 3,
            }, {})
            restored = db.execute("""
              SELECT 1 FROM discovery_runs
              WHERE ticker=? AND (
                status IN ('ok','fallback')
                OR (status='degraded' AND route IS NOT NULL AND route!='none')
              ) LIMIT 1
            """, ("MRVL",)).fetchone()
        self.assertIsNotNone(restored)

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

    def test_public_health_exposes_only_aggregate_official_signal_state(self):
        state = service.AutomaticMonitor(self.db_path, self.snapshot_path).public_state()
        summary = state["signalIntake"]
        self.assertEqual(summary["routes"]["configured"], 25)
        self.assertEqual(summary["routes"]["pending"], 25)
        self.assertEqual(sum(summary["routes"]["errorKinds"].values()), 0)
        retry = summary["routes"]["retry"]
        self.assertEqual(
            {key: retry[key] for key in ("due", "deferred", "unscheduled", "nextAt")},
            {"due": 0, "deferred": 0, "unscheduled": 0, "nextAt": None},
        )
        self.assertTrue(all(
            state == {"due": 0, "deferred": 0, "unscheduled": 0, "nextAt": None}
            for state in retry["byErrorKind"].values()
        ))
        self.assertEqual(summary["routes"]["activeOutages"], {
            "measured": 0, "unmeasured": 0, "ageMaxMs": None,
            "attemptsAverage": None, "attemptsMax": None,
            "oldestStartedAt": None,
            "byErrorKind": {},
        })
        articles = summary["articleRetrieval"]
        self.assertEqual(articles["error"], 0)
        self.assertEqual(sum(articles["errorKinds"].values()), 0)
        self.assertEqual(
            {key: articles["retry"][key]
             for key in ("due", "deferred", "unscheduled", "nextAt")},
            {"due": 0, "deferred": 0, "unscheduled": 0, "nextAt": None},
        )
        self.assertEqual(articles["recoveries24Hours"], {
            "count": 0, "latencyAverageMs": None, "latencyMaxMs": None,
            "attemptsAverage": None, "attemptsMax": None, "lastRecoveredAt": None,
        })
        self.assertEqual(summary["publicationEvidence"]["total"], 0)
        self.assertEqual(summary["routeTransitions24Hours"], {
            "recoveries": 0, "failures": 0, "changes": 0,
            "lastOutcome": None, "lastOccurredAt": None,
        })
        self.assertEqual(summary["routeRecoveries24Hours"], {
            "count": 0, "latencyAverageMs": None, "latencyMaxMs": None,
            "attemptsAverage": None, "attemptsMax": None, "lastRecoveredAt": None,
        })
        self.assertEqual(summary["routeRetryWait24Hours"], {
            "count": 0, "waitAverageMs": None, "waitMaxMs": None,
            "lastAttemptedAt": None,
        })
        serialized = json.dumps(summary)
        self.assertNotIn("https://", serialized)
        self.assertNotIn("source", serialized.lower())

    def test_public_health_groups_sec_errors_without_exposing_transport_details(self):
        errors = [
            ("TSM", "000119312526000011/tsm-6k.htm", "http-403", "accessRestricted"),
            ("MRVL", "000183563226000011/mrvl-8k.htm", "http-429", "rateLimited"),
            ("ANET", "000159653226000011/anet-8k.htm", "timeout", "timeout"),
            ("VRT", "000167410126000011/vrt-8k.htm", "http-503", "server"),
            ("PLTR", "000132165526000011/pltr-8k.htm", "sec-exhibit-unavailable", "missingExhibit"),
            ("PLTR", "000132165526000012/pltr-8k.htm", "fetch-failed", "other"),
        ]
        with monitor.connect(self.db_path) as db:
            for ticker, path, error, _ in errors:
                url = f"https://www.sec.gov/Archives/edgar/data/{path}"
                monitor.add_source(db, ticker, url, title=f"{ticker} filing")
                db.execute(
                    "UPDATE sources SET checked_at=?,error=? WHERE url=?",
                    ("2026-09-24T00:00:00+00:00", error, url),
                )
            db.commit()
            evidence = monitor.sec_evidence_summary(db, service.PRIORITY_SEC_TICKERS)

        self.assertEqual(evidence["error"], len(errors))
        self.assertEqual(evidence["errorKinds"], {
            "accessRestricted": 1,
            "rateLimited": 1,
            "timeout": 1,
            "server": 1,
            "missingExhibit": 1,
            "other": 1,
        })
        self.assertEqual(evidence["byTicker"]["PLTR"]["errorKinds"]["other"], 1)
        serialized = json.dumps(evidence)
        for private_value in ("http-403", "http-429", "http-503", "sec-exhibit-unavailable"):
            self.assertNotIn(private_value, serialized)

    def test_backup_becomes_degraded_when_last_success_exceeds_deadline(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        with monitor.connect(self.db_path) as db:
            monitor.record_body_fetch_poll(db, service.utc_now(), 0)
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
        app.save_brief({
            "url": "https://nebius.com/newsroom/new-release", "sha256": "d" * 64,
            **generated["draft"],
        })
        item = app.editorial_queue(5)["items"][0]
        self.assertEqual(item["generation_provider"], "openai-responses")
        self.assertEqual(item["generation_response_id"], "resp_test")
        with self.assertRaisesRegex(ValueError, "ai-draft-human-verification-required"):
            app.decide_brief({
                "url": "https://nebius.com/newsroom/new-release", "sha256": "d" * 64,
                "validationSha256": item["draft_validation_sha256"],
                "decision": "approved", "reviewer": "human-editor",
                "reason": "AI下書きと公式原文の根拠を人間が照合しました",
            })
        with monitor.connect(self.db_path) as db:
            fake_reviewed_at = "2026-09-23T12:00:00+00:00"
            db.execute(
                "UPDATE briefs SET status='approved',reviewed_at=? WHERE url=?",
                (fake_reviewed_at, "https://nebius.com/newsroom/new-release"),
            )
            db.execute("""
              INSERT INTO brief_review_history(
                url,source_sha256,draft_validation_sha256,decision,reviewed_at,
                reviewer,reason,ai_verification
              ) VALUES(?,?,?,?,?,?,?,0)
            """, (
                "https://nebius.com/newsroom/new-release", "d" * 64,
                item["draft_validation_sha256"], "approved", fake_reviewed_at,
                "tampered-editor", "AI verification was not recorded",
            ))
            db.commit()
        self.assertEqual(app.public_snapshot()["briefs"], [])
        with monitor.connect(self.db_path) as db:
            db.execute(
                "DELETE FROM brief_review_history WHERE reviewer='tampered-editor'"
            )
            db.execute(
                "UPDATE briefs SET status='draft',reviewed_at=NULL WHERE url=?",
                ("https://nebius.com/newsroom/new-release",),
            )
            db.commit()
        app.decide_brief({
            "url": "https://nebius.com/newsroom/new-release", "sha256": "d" * 64,
            "validationSha256": item["draft_validation_sha256"],
            "decision": "approved", "reviewer": "human-editor",
            "reason": "AI下書きと公式原文の根拠を人間が照合しました",
            "aiVerification": True,
        })
        public = app.public_snapshot()["briefs"]
        self.assertEqual(public[0]["generation_method"], "ai-assisted")
        self.assertNotIn("generation_provider", public[0])
        self.assertNotIn("generation_model", public[0])
        self.assertNotIn("generation_response_id", public[0])
        history = app.editorial_queue(5)["items"][0]["review_history"]
        self.assertTrue(history[0]["ai_verification"])

    def test_truncated_ai_draft_requires_full_source_verification_before_publication(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        url = "https://nebius.com/newsroom/new-release"
        with monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "8" * 64, "contentType": "text/html", "contentBytes": 80,
                "extractedText": "Capacity will increase in 2027. Execution remains subject to demand.",
                "extractedChars": 69,
            })
        generated = {
            "draft": {
                "summaryJa": "公式発表によると、AI向け容量は2027年に増加する計画です。",
                "impactLabel": "mixed",
                "impactJa": "供給能力の拡大余地がありますが、実行と需要の確認が引き続き必要です。",
                "confidence": "medium",
                "evidence": {
                    "summary": ["Capacity will increase in 2027."],
                    "impact": ["Execution remains subject to demand."],
                },
            },
            "audit": {
                "provider": "openai-responses", "model": "test-model",
                "responseId": "resp_truncated", "sourceTruncated": True,
                "inputTokens": 400, "outputTokens": 120, "totalTokens": 520,
            },
        }
        with patch.object(brief_generator, "generate_draft", return_value=generated):
            app.generate_brief({"url": url, "sha256": "8" * 64})
        item = app.editorial_queue(5)["items"][0]
        self.assertEqual(item["generation_source_truncated"], 1)
        payload = {
            "url": url, "sha256": "8" * 64,
            "validationSha256": item["draft_validation_sha256"],
            "decision": "approved", "reviewer": "human-editor",
            "reason": "短縮前を含む公式原文と根拠を確認しました",
            "aiVerification": True,
        }
        with self.assertRaisesRegex(
            ValueError, "truncated-ai-draft-full-source-verification-required"
        ):
            app.decide_brief(payload)
        self.assertEqual(app.public_snapshot()["briefs"], [])

        app.decide_brief({**payload, "fullSourceVerification": True})
        self.assertEqual(len(app.public_snapshot()["briefs"]), 1)
        history = app.editorial_queue(5)["items"][0]["review_history"]
        self.assertTrue(history[0]["ai_verification"])
        self.assertTrue(history[0]["full_source_verification"])

        with monitor.connect(self.db_path) as db:
            db.execute(
                "UPDATE brief_review_history SET full_source_verification=0 WHERE url=?",
                (url,),
            )
            db.commit()
        self.assertEqual(app.public_snapshot()["briefs"], [])

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

    def test_generation_retry_respects_bounded_provider_delay(self):
        url = "https://nebius.com/newsroom/new-release"
        with patch.dict(os.environ, {
            "RESEARCH_AUTO_DRAFTS": "true", "OPENAI_API_KEY": "sk-" + "x" * 40,
            "RESEARCH_SUMMARY_MODEL": "test-model",
        }, clear=False):
            app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        with monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url=?", (url,)).fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "7" * 64, "contentType": "text/html", "contentBytes": 80,
                "extractedText": "Official evidence remains available for review.", "extractedChars": 47,
            })
            monitor.queue_generation_job(db, url, 7_000)
        deferred = brief_generator.GenerationFailed(
            "generation-request-deferred", retry_after_seconds=7200
        )
        with patch.object(app, "generate_brief", side_effect=deferred):
            result = app.process_generation_job()
        self.assertEqual(result["status"], "retry")
        self.assertEqual(result["retrySeconds"], 7200)
        with monitor.connect(self.db_path) as db:
            stats = monitor.generation_queue_stats(db, 20, 100_000)
        self.assertIsNotNone(stats["nextRetryAt"])
        self.assertGreaterEqual(stats["nextRetryWaitSeconds"], 7195)
        self.assertLessEqual(stats["nextRetryWaitSeconds"], 7200)
        with monitor.connect(self.db_path) as db:
            too_far = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
            db.execute(
                "UPDATE brief_generation_jobs SET next_attempt_at=? WHERE url=?",
                (too_far, url),
            )
            db.commit()
            invalid = monitor.generation_queue_stats(db, 20, 100_000)
        self.assertIsNone(invalid["nextRetryAt"])
        self.assertIsNone(invalid["nextRetryWaitSeconds"])

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
