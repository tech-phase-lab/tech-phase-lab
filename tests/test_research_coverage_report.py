"""Coverage audit must not confuse registration, stale data and healthy intake."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import coverage_report
import monitor
import signals


class CoverageReportTests(unittest.TestCase):
    def test_configuration_only_does_not_claim_live_coverage(self):
        result = coverage_report.report()
        self.assertEqual(len(result['companies']), 22)
        self.assertTrue(all(r['status'] == 'untested' for r in result['routes']))
        mu = next(c for c in result['companies'] if c['ticker'] == 'MU')
        self.assertIn('micron-blog', mu['dedicatedSupplementalSources'])
        self.assertFalse(mu['needsDedicatedSupplementalSource'])
        sndk = next(c for c in result['companies'] if c['ticker'] == 'SNDK')
        self.assertIn('sandisk-news', sndk['dedicatedSupplementalSources'])
        self.assertFalse(sndk['needsDedicatedSupplementalSource'])
        self.assertFalse(sndk['hasFreshDedicatedSupplementalSource'])
        self.assertEqual(sndk['dedicatedSupplementalStatuses']['sandisk-news'], 'untested')
        avgo = next(c for c in result['companies'] if c['ticker'] == 'AVGO')
        self.assertIn('broadcom-news', avgo['dedicatedSupplementalSources'])
        arm = next(c for c in result['companies'] if c['ticker'] == 'ARM')
        self.assertIn('arm-blog', arm['dedicatedSupplementalSources'])
        arm_source = next(s for s in signals.SOURCES if s['id'] == 'arm-blog')
        self.assertEqual(arm_source['format'], 'feed')
        self.assertEqual(arm_source['url'], 'https://newsroom.arm.com/topics/company/feed')
        tsm = next(c for c in result['companies'] if c['ticker'] == 'TSM')
        self.assertIn('tsmc-press-center', tsm['dedicatedSupplementalSources'])
        orcl = next(c for c in result['companies'] if c['ticker'] == 'ORCL')
        self.assertIn('oracle-investor-news', orcl['dedicatedSupplementalSources'])
        oracle_source = next(s for s in signals.SOURCES if s['id'] == 'oracle-investor-news')
        self.assertEqual(oracle_source['format'], 'feed')
        self.assertEqual(oracle_source['url'], 'https://investor.oracle.com/rss/pressrelease.aspx')
        self.assertIn('anthropic-news', result['sharedSources'])

    def test_missing_database_is_not_created(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'missing.sqlite'
            with self.assertRaises(sqlite3.OperationalError):
                coverage_report.report(path)
            self.assertFalse(path.exists())

    def test_read_only_report_distinguishes_failure_and_staleness(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'monitor.sqlite'
            db = monitor.connect(path)
            signals.schema(db)
            now = datetime.now(timezone.utc)
            # Use the real intake path to create a valid record without networking.
            source = next(s for s in signals.SOURCES if s['format'] == 'document')
            signals.check(db, source, list(signals.ALIASES), lambda *_: {
                'body': ('<main>' + 'A source document about infrastructure. ' * 10 + '</main>').encode()})
            self.assertEqual(next(r for r in coverage_report.report(path)['routes'] if r['id'] == source['id'])['status'], 'fresh')
            db.execute('UPDATE signal_routes SET succeeded_at=?', ((now - timedelta(hours=2)).isoformat(),))
            db.commit()
            self.assertEqual(next(r for r in coverage_report.report(path)['routes'] if r['id'] == source['id'])['status'], 'stale')
            db.execute("UPDATE signal_routes SET error='http-503'")
            db.commit()
            before = path.read_bytes()
            result = coverage_report.report(path)
            self.assertEqual(next(r for r in result['routes'] if r['id'] == source['id'])['status'], 'error')
            self.assertEqual(path.read_bytes(), before)
            db.close()
