"""A missing production ledger must not be reported as a successful live restore."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('resolute_backup', Path(__file__).resolve().parents[1] / 'scripts/resolute/backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

class LiveRestoreTests(unittest.TestCase):
    def test_missing_schema_is_explicit_and_required_schema_fails(self):
        with patch.object(backup, 'run', return_value=b'f\n'):
            self.assertEqual(backup.verify_restored_live_payments({}), {'state': 'not_installed'})
            with self.assertRaisesRegex(RuntimeError, 'required live ledger missing'):
                backup.verify_restored_live_payments({}, required=True)

    def test_live_failure_cannot_pass_as_sandbox_success(self):
        with patch.object(backup, 'run', side_effect=[b't\n', b'{"invalid_grants":1,"missing_grants":0}']):
            with self.assertRaisesRegex(RuntimeError, 'inconsistent'):
                backup.verify_restored_live_payments({})

    def test_empty_live_ledger_and_view_are_checked(self):
        counts = b'{"orders":0,"grants":0,"events":0,"audit":0,"alert_outbox":0,"invalid_grants":0,"missing_grants":0}'
        with patch.object(backup, 'run', side_effect=[b't\n', counts, b'0\n']) as run:
            result = backup.verify_restored_live_payments({}, required=True)
            self.assertEqual(result['state'], 'verified')
            self.assertIn('resolute_payments_live.orders', run.call_args_list[1].args[0][-1])
            self.assertIn('entitlement_periods', run.call_args_list[2].args[0][-1])

    def test_missing_restored_view_is_failure(self):
        with patch.object(backup, 'run', side_effect=[b't\n', RuntimeError('view missing')]), patch.object(backup, 'verify_restored_payments', return_value={}):
            with self.assertRaisesRegex(RuntimeError, 'view missing'):
                backup.verify_restored_live_payments({})
