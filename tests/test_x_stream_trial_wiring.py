"""Default-off trial thread and backup window, without any provider activity."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))


class TrialWiringTests(unittest.TestCase):
    def setUp(self):
        import service
        self.service = service
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        with patch.dict('os.environ', {'X_STREAM_TRIAL_ENABLED': 'false', 'X_FILTERED_STREAM_ENABLED': 'false'}):
            self.app = service.AutomaticMonitor(Path(self.temp.name)/'monitor.sqlite', Path(self.temp.name)/'snapshot.json')
        self.now = datetime.now(timezone.utc)
        self.app.backup_initial_complete.set()
        self.app.state['backup'].update(healthy=True, lastSuccessAt=(self.now-timedelta(minutes=5)).isoformat(), lastAttemptAt=None)

    def test_default_off_does_not_start_a_trial_or_migrate_polling(self):
        self.assertIsNone(self.app.x_stream_trial_thread)
        self.assertFalse(self.app.x_stream_requested)
        self.assertFalse(self.app.db_path.exists())

    def test_trial_flag_does_not_enable_active_migration(self):
        with patch.dict('os.environ', {'X_STREAM_TRIAL_ENABLED': 'true', 'X_FILTERED_STREAM_ENABLED': 'false'}):
            app = self.service.AutomaticMonitor(Path(self.temp.name)/'other.sqlite', Path(self.temp.name)/'snapshot.json')
        self.assertIsNotNone(app.x_stream_trial_thread)
        self.assertFalse(app.x_stream_requested)
        self.assertIsNone(app.x_stream_thread)

    def test_recent_backup_window_is_verified_from_actual_state(self):
        result = self.app.trial_backup_readiness(self.now+timedelta(minutes=2), 30)
        self.assertTrue(result['healthy'])
        self.assertGreater(datetime.fromisoformat(result['next_backup_at']), self.now+timedelta(minutes=2, seconds=30))
        self.app.state['backup']['lastAttemptAt'] = self.now.isoformat()
        self.assertFalse(self.app.trial_backup_readiness(self.now+timedelta(minutes=2), 30)['healthy'])

    def test_due_backup_missing_success_or_service_stop_blocks_trial(self):
        self.app.state['backup']['lastSuccessAt'] = (self.now-timedelta(minutes=59)).isoformat()
        self.assertFalse(self.app.trial_backup_readiness(self.now+timedelta(minutes=2), 30)['healthy'])
        self.app.state['backup']['lastSuccessAt'] = None
        self.assertFalse(self.app.trial_backup_readiness(self.now+timedelta(minutes=2), 30)['healthy'])
        self.app.stop_event.set()
        self.assertFalse(self.app.trial_backup_readiness(self.now+timedelta(minutes=2), 30)['healthy'])

    def test_thread_passes_owned_stop_and_readiness_without_credentials(self):
        with patch.object(self.service.x_stream_trial_service, 'run_once') as run:
            self.app.run_x_stream_trial()
        self.assertEqual(run.call_args.args, (self.app.db_path, self.app.stop_event))
        self.assertEqual(run.call_args.kwargs['backup_readiness'], self.app.trial_backup_readiness)


if __name__ == '__main__': unittest.main()
