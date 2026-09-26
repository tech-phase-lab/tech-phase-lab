"""Verify the two distinct delays without inventing an official release time."""
import sqlite3
import sys
from pathlib import Path
from datetime import datetime, timezone
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
from x_earnings_comparison import report


class EarningsComparisonTests(unittest.TestCase):
    def test_measure_release_and_detection_separately_only_with_verification(self):
        with sqlite3.connect(":memory:") as db:
            db.row_factory = sqlite3.Row
            db.execute("CREATE TABLE signal_events (source_id TEXT,url TEXT,title TEXT,tickers_json TEXT,event_kind TEXT,published_at TEXT,observed_at TEXT)")
            db.executemany("INSERT INTO signal_events VALUES (?,?,?,?,?,?,?)", [
                ("x-tipranks", "https://x.com/TipRanks/status/1", "MU earnings", '["MU"]', "new", "2026-09-25T01:01:00Z", "2026-09-25T01:01:20Z"),
                ("x-thefly", "https://x.com/theflynews/status/2", "NBIS earnings", '["NBIS"]', "new", "2026-09-25T01:02:00Z", "2026-09-25T01:03:00Z"),
                ("x-wallstengine", "https://x.com/wallstengine/status/3", "MU earnings", '["MU"]', "baseline", "2026-09-25T01:00:00Z", "2026-09-25T01:02:00Z"),
            ])
            result = report(db, [{"ticker": "MU", "officialUrl": "https://example.com/official",
                                  "releaseAt": "2026-09-25T01:00:00Z"}],
                            now=datetime(2026, 9, 25, 2, tzinfo=timezone.utc))
            tip = result["sources"]["x-tipranks"]
            self.assertEqual((tip["newPosts"], tip["verifiedReleaseMatches"]), (1, 1))
            self.assertEqual(tip["samples"][0]["releaseToPostSeconds"], 60)
            self.assertEqual(tip["samples"][0]["postToFirstSeenSeconds"], 20)
            self.assertIsNone(result["sources"]["x-thefly"]["samples"][0]["releaseToPostSeconds"])
            self.assertEqual(result["sources"]["x-wallstengine"]["baselinePosts"], 1)


if __name__ == "__main__":
    unittest.main()
