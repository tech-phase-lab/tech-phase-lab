"""Per-company delivery measurement: counts, times and short codes only."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor
import pipeline_status

NOW = datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc)


class CompanyDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'monitor.sqlite'

    def add(self, db, url, ticker, days_ago, chars=0, error=None, fetched=None):
        detected = (NOW - timedelta(days=days_ago)).isoformat()
        db.execute("INSERT INTO sources(url,ticker,discovered_at,extracted_chars,error,fetched_at) VALUES(?,?,?,?,?,?)",
                   (url, ticker, detected, chars, error, fetched))
        db.execute("INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)", (url, ticker, detected))

    def test_counts_reads_failures_and_publications_per_company(self):
        with monitor.connect(self.path) as db, db:
            self.add(db, 'https://www.sec.gov/Archives/edgar/data/1/a.htm', 'CRDO', 1, chars=500, fetched='2026-10-11T00:00:00+00:00')
            self.add(db, 'https://investors.credosemi.com/news-events/news/news-details/2026/A/default.aspx', 'CRDO', 2, error='verification-page')
            self.add(db, 'https://investors.credosemi.com/news-events/news/news-details/2026/B/default.aspx', 'CRDO', 3, error='verification-page')
            self.add(db, 'https://www.broadcom.com/company/news/releases/x', 'AVGO', 20, chars=900, fetched='2026-09-22T00:00:00+00:00')
        payload = {'officialUpdates': [
            {'tickers': ['NVDA'], 'publishedAt': '2026-10-08T10:00:00+00:00', 'title': 'must not appear'},
            {'tickers': ['NVDA'], 'publishedOn': '2026-10-10'},
            {'tickers': ['NOPE'], 'publishedAt': '2026-10-09T00:00:00+00:00'}]}
        value = pipeline_status.company_delivery(self.path, payload, now=NOW.timestamp())
        crdo = value['companies']['CRDO']
        self.assertEqual((crdo['found'], crdo['bodyRead'], crdo['viaSec']), (3, 1, 1))
        self.assertEqual(crdo['unreadReasons'], {'verification-page': 2})
        self.assertEqual(value['companies']['AVGO']['found'], 0)  # older than the window
        nvda = value['companies']['NVDA']
        self.assertEqual((nvda['published'], nvda['newestPublishedAt']), (2, '2026-10-10'))
        self.assertEqual(value['companies']['DELL']['scope'], 'earnings')
        self.assertNotIn('must not appear', json.dumps(value))
        self.assertNotIn('credosemi.com', json.dumps(value))


if __name__ == '__main__':
    unittest.main()
