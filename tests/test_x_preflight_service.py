"""Private metadata bridge; no live tokens, files, providers or network."""
import json
import os
import tempfile
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor
import x_preflight
import x_preflight_service as bridge


class Guard(dict):
    def get(self, key, default=None):
        if key == 'X_BEARER_TOKEN':
            raise AssertionError('secret access forbidden')
        return super().get(key, default)


class ServicePreflightTests(unittest.TestCase):
    def test_default_off_has_zero_database_token_or_checker_activity(self):
        with patch.object(monitor, 'connect', side_effect=AssertionError('database access')), \
             patch.object(x_preflight, 'Checker', side_effect=AssertionError('checker construction')):
            bridge.run_once('/not-used', threading.Event(), env=Guard())

    def test_local_diagnostic_is_no_network_and_contains_only_safe_bytes(self):
        emit = Mock()
        with patch.object(x_preflight, 'local_free_space', return_value={'available_bytes': 90000000}), \
             patch.object(bridge, 'local_file_sizes', return_value={'inventory_complete': True}), \
             patch.object(x_preflight, 'Checker', side_effect=AssertionError('provider checker')):
            bridge.run_once('/not-used', threading.Event(), env=Guard({bridge.LOCAL: 'true'}), emit=emit)
        self.assertEqual(emit.call_count, 1)
        self.assertEqual(json.loads(emit.call_args[0][0].split(' ', 1)[1])['capacity']['available_bytes'], 90000000)

    def test_file_size_inventory_reads_metadata_only_and_skips_links(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            (root / 'automatic.sqlite').write_bytes(b'123')
            (root / 'automatic.sqlite-wal').write_bytes(b'12345')
            (root / 'backups').mkdir()
            (root / 'backups' / 'private-backup-name.sqlite').write_bytes(b'12')
            (root / 'outside-link').symlink_to('/etc/passwd')
            with patch('builtins.open', side_effect=AssertionError('contents read')):
                result = bridge.local_file_sizes(scandir=lambda path: os.scandir(root / path.removeprefix('/data/')) if path != '/data' else os.scandir(root))
            self.assertEqual(result['categories']['database']['bytes'], 3)
            self.assertEqual(result['categories']['wal']['bytes'], 5)
            self.assertEqual(result['categories']['backups']['bytes'], 2)
            self.assertEqual(result['skipped_links'], 1)
            self.assertNotIn('private-backup-name', json.dumps(result))

    def test_invalid_config_has_fixed_error_without_token_or_database(self):
        emit = Mock()
        with patch.object(monitor, 'connect', side_effect=AssertionError('database access')):
            bridge.run_once('/not-used', threading.Event(), env=Guard({bridge.ENABLED: 'true', bridge.APPROVAL: 'secret-invalid-json'}), emit=emit)
        self.assertIn('invalid-service-approval', emit.call_args[0][0])
        self.assertNotIn('secret-invalid', emit.call_args[0][0])

    def test_existing_stop_blocks_everything(self):
        stop = threading.Event(); stop.set()
        with patch.object(monitor, 'connect', side_effect=AssertionError('database access')):
            bridge.run_once('/not-used', stop, env=Guard({bridge.ENABLED: 'true', bridge.LOCAL: 'true'}))

    def test_reports_only_checker_output_and_closes_db(self):
        fake_db, emit, stop = Mock(), Mock(), threading.Event()
        checker = Mock(); checker.run = AsyncMock(return_value={'status': 'observed', 'stream_activation_authorized': False})
        with patch.object(monitor, 'connect', return_value=fake_db), patch.object(x_preflight, 'Checker', return_value=checker) as ctor:
            bridge.run_once('/not-used', stop, env=Guard({bridge.ENABLED: 'true', bridge.APPROVAL: json.dumps({'fixture': True})}), emit=emit)
        options = ctor.call_args.kwargs
        self.assertTrue(options['reserve_request']())
        stop.set()
        self.assertFalse(options['reserve_request']())
        self.assertEqual(emit.call_count, 1)
        self.assertIn('"status":"observed"', emit.call_args[0][0])
        fake_db.close.assert_called_once()


if __name__ == '__main__': unittest.main()
