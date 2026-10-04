"""Restart-safe backup scheduling and metadata observation ordering."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))


class BackupStartupTests(unittest.TestCase):
    def setUp(self):
        # Legacy suites install monitor/signals test modules during discovery.
        # Import afterward so service uses the same modules.
        global service
        import service
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.app = service.AutomaticMonitor(root/'db.sqlite', root/'snapshot.json')
        self.app.db_path.touch()

    def test_recent_verified_backup_waits_remaining_interval_without_new_copy(self):
        recent = {'createdAt': (datetime.now(timezone.utc)-timedelta(seconds=600)).isoformat(), 'backupCount': 8}
        waits = []
        def wait(seconds):
            waits.append(seconds); self.app.stop_event.set(); return True
        with patch.object(service.persistence, 'recover_latest_backup', return_value=recent), \
             patch.object(self.app, 'perform_backup') as backup, \
             patch.object(self.app.stop_event, 'wait', side_effect=wait):
            self.app.run_backup()
        backup.assert_not_called()
        self.assertTrue(2998 <= waits[0] <= 3000)
        self.assertTrue(self.app.backup_initial_complete.is_set())
        self.assertEqual(self.app.state['backup']['lastSuccessAt'], recent['createdAt'])
        self.assertIsNone(self.app.state['backup']['lastAttemptAt'])

    def test_missing_or_invalid_backup_requires_immediate_copy(self):
        def backup():
            self.app.stop_event.set(); return True
        with patch.object(service.persistence, 'recover_latest_backup', return_value=None), \
             patch.object(self.app, 'perform_backup', side_effect=backup) as called:
            self.app.run_backup()
        called.assert_called_once()
        self.assertTrue(self.app.backup_initial_complete.is_set())

    def test_recovered_wait_is_stop_interruptible(self):
        recent = {'createdAt': datetime.now(timezone.utc).isoformat(), 'backupCount': 8}
        with patch.object(service.persistence, 'recover_latest_backup', return_value=recent), \
             patch.object(self.app, 'perform_backup') as backup:
            thread = threading.Thread(target=self.app.run_backup)
            thread.start()
            self.assertTrue(self.app.backup_initial_complete.wait(1))
            self.app.stop_event.set(); thread.join(1)
        self.assertFalse(thread.is_alive()); backup.assert_not_called()

    def test_metadata_is_ordered_after_backup_and_failure_blocks_provider_checks(self):
        with patch.object(self.app.backup_initial_complete, 'wait', return_value=False), \
             patch.object(service.x_preflight_service, 'run_once') as called:
            self.app.run_x_preflight()
        self.assertFalse(called.call_args.kwargs['allow_metadata'])
        self.app.state['backup']['healthy'] = True
        self.app.backup_initial_complete.set()
        with patch.object(service.x_preflight_service, 'run_once') as called:
            self.app.run_x_preflight()
        self.assertTrue(called.call_args.kwargs['allow_metadata'])


if __name__ == '__main__': unittest.main()
