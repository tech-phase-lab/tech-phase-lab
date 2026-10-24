"""Backup retention must survive repeated same-day runs and ISO year boundaries."""
import importlib.util
from datetime import date, timedelta
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('resolute_backup',
    Path(__file__).resolve().parents[1] / 'scripts/resolute/backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

class ResoluteRetentionTests(unittest.TestCase):
    def test_repeated_runs_do_not_displace_days(self):
        objects = []
        for i in range(40):
            day = (date(2027, 1, 5) - timedelta(days=i)).strftime('%Y%m%d')
            for hour in ('T000000Z', 'T010000Z'):
                objects.append({'Key': backup.PREFIX+'dumps/'+day+hour+'.dump.age'})
        keep = backup.retained_keys(objects)
        self.assertLessEqual(len(keep), 11)
        self.assertTrue(all('T010000Z' in key for key in keep))
        for i in range(7):
            day = (date(2027, 1, 5) - timedelta(days=i)).strftime('%Y%m%d')
            self.assertIn(backup.PREFIX+'dumps/'+day+'T010000Z.dump.age', keep)
        weeks = {date(int(Path(key).name[:4]), int(Path(key).name[4:6]),
                      int(Path(key).name[6:8])).isocalendar()[:2] for key in keep}
        self.assertEqual(len(weeks), 4)

    def test_empty_store_and_single_dump(self):
        self.assertEqual(backup.retained_keys([]), set())
        key = backup.PREFIX+'dumps/20270105T000000Z.dump.age'
        self.assertEqual(backup.retained_keys([{'Key': key}]), {key})

class ResolutePaymentRestoreTests(unittest.TestCase):
    def test_inconsistent_payment_backup_cannot_report_success(self):
        from unittest.mock import patch
        import json
        for field in ('invalid_grants', 'missing_grants'):
            report = dict(orders=1, grants=1, events=2, audit=3, alert_outbox=1,
                          invalid_grants=0, missing_grants=0)
            report[field] = 1
            with patch.object(backup, 'run', return_value=json.dumps(report).encode()):
                with self.assertRaises(RuntimeError):
                    backup.verify_restored_payments({})

    def test_success_reports_counts_only(self):
        from unittest.mock import patch
        import json
        counts = dict(orders=2, grants=1, events=3, audit=4, alert_outbox=1)
        report = dict(counts, invalid_grants=0, missing_grants=0)
        with patch.object(backup, 'run', return_value=json.dumps(report).encode()):
            self.assertEqual(backup.verify_restored_payments({}), counts)
