"""Bounded lifecycle tests. All files, credentials and transports are synthetic."""
import asyncio
from datetime import timedelta
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor
import x_stream
import x_budget
import x_stream_pilot as pilot
import x_stream_runtime as runtime
from test_x_stream_runtime import bundle, SecretGuard
from test_x_stream import NOW


class PilotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.path = self.root / 'test.sqlite'
        self.bundle_path = self.root / 'bundle.json'
        self.pilot_path = self.root / 'pilot.json'
        self.bundle = bundle()
        self.bundle_path.write_text(json.dumps(self.bundle))
        self.config = {'version': 1, 'pilot_id': 'fixture-pilot', 'approval_id': self.bundle['approval_id'],
                       'end_at': (NOW + timedelta(minutes=10)).isoformat()}
        self.pilot_path.write_text(json.dumps(self.config))
        self.now, self.mono = NOW, 10
        self.env = SecretGuard({runtime.FLAG: 'true', runtime.BUNDLE_ENV: str(self.bundle_path),
                               pilot.PILOT_ENV: str(self.pilot_path), 'X_API_ENABLED': 'true',
                               'RESEARCH_SIGNALS_ENABLED': 'true'})
        self.outer = threading.Event()
        self.factory = Mock(side_effect=AssertionError('network forbidden'))
        self.report = Mock()
        self.worker = self.make_worker()

    def make_worker(self):
        return pilot.PilotSupervisor(self.path, list(monitor.PROVIDERS), self.outer, Mock(),
                                     env=self.env, clock=lambda: self.now, monotonic=lambda: self.mono,
                                     transport_factory=self.factory, report=self.report)

    def tearDown(self):
        if self.worker.db:
            self.worker.db.close()
        self.temp.cleanup()

    def test_off_never_loads_bundle_creates_database_or_client(self):
        self.env[runtime.FLAG] = 'false'
        with patch.object(runtime, 'load_bundle', side_effect=AssertionError('off read')):
            self.worker.run()
        self.assertFalse(self.path.exists())
        self.assertEqual(self.env.reads, 0)

    def test_missing_pilot_blocks_before_database_token_and_client(self):
        del self.env[pilot.PILOT_ENV]
        self.worker.run()
        self.assertFalse(self.path.exists())
        self.assertEqual(self.env.reads, 0)
        self.factory.assert_not_called()

    def test_deadline_and_approval_and_cap_are_mandatory(self):
        variants = [{'end_at': NOW.isoformat()}, {'end_at': (NOW+timedelta(seconds=901)).isoformat()},
                    {'approval_id': 'wrong'}, {'version': True}, {'pilot_id': ''}]
        for change in variants:
            with self.subTest(change=change):
                self.pilot_path.write_text(json.dumps(self.config | change))
                with self.assertRaises(x_stream.StreamBlocked):
                    self.worker.initialize()
                self.assertFalse(self.path.exists())
        self.pilot_path.write_text(json.dumps(self.config))
        self.bundle['budget']['daily_limit_micros'] = 1_000_001
        self.bundle_path.write_text(json.dumps(self.bundle))
        with self.assertRaises(x_stream.StreamBlocked):
            self.worker.initialize()
        self.assertEqual(self.env.reads, 0)

    def test_midnight_crossing_cannot_reset_the_one_dollar_budget(self):
        self.now = NOW.replace(hour=23, minute=55)
        self.bundle = bundle(self.now)
        self.bundle_path.write_text(json.dumps(self.bundle))
        self.config['end_at'] = (self.now+timedelta(minutes=10)).isoformat()
        self.pilot_path.write_text(json.dumps(self.config))
        with self.assertRaises(x_stream.StreamBlocked):
            self.worker.initialize()
        self.factory.assert_not_called()
        self.assertFalse(self.path.exists())

    def test_unknown_metadata_cost_blocks_before_stream_marker_or_token(self):
        with monitor.connect(self.path) as db:
            db.execute('CREATE TABLE x_metadata_preflight_runs(reserved_micros INTEGER, cost_status TEXT, status TEXT)')
            db.execute("INSERT INTO x_metadata_preflight_runs VALUES(NULL,'unknown','observed')")
        with self.assertRaisesRegex(x_stream.StreamBlocked, 'metadata-exposure-unreconciled'):
            self.worker.initialize()
        with monitor.connect(self.path) as db:
            self.assertFalse(db.execute("SELECT 1 FROM sqlite_master WHERE name='x_stream_runtime'").fetchone())
        self.assertEqual(self.env.reads, 0)
        self.factory.assert_not_called()

    def test_known_metadata_exposure_is_reserved_in_same_trial_budget(self):
        with monitor.connect(self.path) as db:
            db.execute('CREATE TABLE x_metadata_preflight_runs(reserved_micros INTEGER, cost_status TEXT, status TEXT)')
            db.execute("INSERT INTO x_metadata_preflight_runs VALUES(200000,'bounded','verified')")
        self.worker.initialize()
        row = self.worker.db.execute('SELECT purpose,reserved FROM x_budget_reservations').fetchone()
        self.assertEqual(tuple(row), ('control', 200000))
        with self.assertRaises(x_budget.BudgetBlocked):
            x_budget.reserve(self.worker.db, 'stream', 800001, self.now)
        self.factory.assert_not_called()

    def test_metadata_admitted_between_initial_check_and_owner_claim_blocks(self):
        original = runtime.Supervisor.initialize
        def interleaved(worker):
            with monitor.connect(self.path) as db:
                db.execute('CREATE TABLE x_metadata_preflight_runs(reserved_micros INTEGER, cost_status TEXT, status TEXT)')
                db.execute("INSERT INTO x_metadata_preflight_runs VALUES(NULL,'unknown','reserved')")
            return original(worker)
        with patch.object(runtime.Supervisor, 'initialize', interleaved):
            with self.assertRaisesRegex(x_stream.StreamBlocked, 'metadata-exposure-unreconciled'):
                self.worker.initialize()
        self.factory.assert_not_called()
        self.assertEqual(self.env.reads, 0)

    def test_new_metadata_exposure_is_rechecked_before_paid_admission(self):
        self.worker.initialize()
        self.worker.db.execute('CREATE TABLE x_metadata_preflight_runs(reserved_micros INTEGER, cost_status TEXT, status TEXT)')
        with self.worker.db:
            self.worker.db.execute("INSERT INTO x_metadata_preflight_runs VALUES(1,'bounded','verified')")
        with self.assertRaisesRegex(x_stream.StreamBlocked, 'metadata-changed'):
            self.worker.refresh()
        self.factory.assert_not_called()

    def test_deadline_cannot_outlive_earliest_account_evidence(self):
        self.bundle['budget']['verified_at'] = (NOW-timedelta(minutes=6)).isoformat()
        self.bundle_path.write_text(json.dumps(self.bundle))
        with self.assertRaises(x_stream.StreamBlocked):
            self.worker.initialize()
        self.factory.assert_not_called()

    def test_initialize_claims_once_and_parent_event_stays_unset(self):
        self.assertTrue(self.worker.initialize())
        row = self.worker.db.execute('SELECT * FROM x_stream_pilot').fetchone()
        self.assertEqual(row['state'], 'running')
        self.assertEqual(row['approved_end_at'], self.config['end_at'])
        other = self.make_worker()
        with self.assertRaisesRegex(x_stream.StreamBlocked, 'already-used'):
            other.initialize()
        self.assertFalse(self.outer.is_set())
        self.assertEqual(self.env.reads, 0)

    def test_wall_deadline_blocks_admission_without_stopping_other_workers(self):
        self.worker.initialize()
        self.now += timedelta(minutes=10)
        self.assertTrue(self.worker.stop_event.is_set())
        self.assertFalse(self.outer.is_set())
        self.assertEqual(self.worker.pilot_stop.reason, 'deadline-reached')
        with self.assertRaises(x_stream.StreamBlocked):
            self.worker.refresh()
        self.factory.assert_not_called()

    def test_monotonic_deadline_survives_wall_clock_regression(self):
        self.worker.initialize()
        self.now -= timedelta(minutes=5)
        self.mono += 600
        self.assertTrue(self.worker.stop_event.is_set())
        self.assertFalse(self.outer.is_set())
        self.factory.assert_not_called()

    def test_configuration_change_cannot_extend_deadline(self):
        self.worker.initialize()
        self.config['end_at'] = (NOW+timedelta(minutes=14)).isoformat()
        self.pilot_path.write_text(json.dumps(self.config))
        with self.assertRaisesRegex(x_stream.StreamBlocked, 'config-changed'):
            self.worker.refresh()
        self.assertTrue(self.worker.stop_event.is_set())
        self.factory.assert_not_called()

    def test_ended_record_blocks_restart_and_retains_migration_marker(self):
        original = self.worker.initialize
        def initialize_and_expire():
            result = original()
            self.mono += 601
            return result
        self.worker.initialize = initialize_and_expire
        asyncio.run(self.worker.run_async())
        self.assertIsNone(self.worker.db)
        with monitor.connect(self.path) as db:
            row = db.execute('SELECT * FROM x_stream_pilot').fetchone()
            self.assertEqual(row['state'], 'ended')
            self.assertEqual(row['reason'], 'deadline-reached')
            self.assertTrue(db.execute('SELECT 1 FROM x_stream_runtime').fetchone())
            self.assertFalse(db.execute('SELECT 1 FROM x_stream_supervisor_owner').fetchone())
        self.now = NOW
        self.mono = 10
        with self.assertRaisesRegex(x_stream.StreamBlocked, 'already-used'):
            self.make_worker().initialize()
        self.assertFalse(self.outer.is_set())
        self.factory.assert_not_called()

    def test_service_uses_mandatory_pilot_wrapper(self):
        import service
        source = Path(service.__file__).read_text()
        self.assertIn('x_stream_pilot.PilotSupervisor(self.db_path', source)
        self.assertNotIn('x_stream_runtime.Supervisor(self.db_path', source)


if __name__ == '__main__':
    unittest.main()
