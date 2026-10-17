"""Oct 11: a detected earnings release starts the X burst for its company."""
import sqlite3
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import release_watch

NOW = datetime(2026, 10, 15, 6, 0, tzinfo=timezone.utc)


class DetectionBurstTests(unittest.TestCase):
    def setUp(self):
        release_watch.DETECTED.clear()
        self.addCleanup(release_watch.DETECTED.clear)

    def test_an_earnings_release_bursts_earnings_routes_for_fifteen_minutes(self):
        self.assertTrue(release_watch.note_detection('TSM', 'TSMC Reports Third Quarter EPS of NT$17.40', NOW.isoformat()))
        routes = set(release_watch.BURST_ROUTES['earnings'])
        self.assertEqual(release_watch.burst_routes(NOW + timedelta(minutes=5), events=[]), routes)
        self.assertEqual(release_watch.burst_routes(NOW + timedelta(minutes=16), events=[]), set())
        self.assertEqual(release_watch.burst_routes(NOW - timedelta(minutes=1), events=[]), set())

    def test_announcements_and_other_news_do_not_burst(self):
        for title in ('NVIDIA to Report Third Quarter Fiscal 2027 Financial Results on Nov 19',
                      'Oracle Announces Date for Q2 Earnings Conference Call',
                      'Google Cloud introduces the Gemini agent', None):
            with self.subTest(title=title):
                self.assertFalse(release_watch.note_detection('NVDA', title, NOW.isoformat()))
        self.assertEqual(release_watch.burst_routes(NOW, events=[]), set())

    def test_refresh_reads_recent_detections_only(self):
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE sources(url TEXT PRIMARY KEY, ticker TEXT, title TEXT)')
        db.execute('CREATE TABLE release_events(id INTEGER PRIMARY KEY, url TEXT, ticker TEXT, detected_at TEXT)')
        for url, ticker, title, at in (('https://a', 'NVDA', 'NVIDIA Announces Financial Results for Second Quarter Fiscal 2027', NOW),
                                       ('https://b', 'MU', 'Micron Reports Results for the Fourth Quarter', NOW - timedelta(hours=2))):
            db.execute('INSERT INTO sources VALUES(?,?,?)', (url, ticker, title))
            db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)', (url, ticker, at.isoformat()))
        self.assertEqual(release_watch.refresh_detections(db, NOW + timedelta(minutes=1)), 1)
        self.assertEqual(set(release_watch.DETECTED), {'NVDA'})
        self.assertEqual(release_watch.refresh_detections(sqlite3.connect(':memory:'), NOW), 0)


if __name__ == '__main__':
    unittest.main()
