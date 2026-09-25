"""Check that baseline history never skews new-post arrival measurements."""
from datetime import datetime, timezone
import sqlite3
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
from x_comparison import report


class ComparisonTests(unittest.TestCase):
    def test_baseline_is_separate_and_only_new_posts_have_arrival_lag(self):
        now = datetime(2026, 9, 25, 3, 0, tzinfo=timezone.utc)
        with sqlite3.connect(":memory:") as db:
            db.row_factory = sqlite3.Row
            db.execute("CREATE TABLE signal_events (source_id TEXT,title TEXT,tickers_json TEXT,event_kind TEXT,published_at TEXT,observed_at TEXT,url TEXT)")
            db.execute("CREATE TABLE signal_routes (id TEXT,checked_at TEXT,error TEXT,matched_items INTEGER)")
            db.executemany("INSERT INTO signal_events VALUES (?,?,?,?,?,?,?)", [
                ("x-tipranks", "Micron price target raised", '["MU"]', "baseline", "2026-09-21T00:00:00Z", "2026-09-25T02:00:00+00:00", "https://x.com/TipRanks/status/1000"),
                ("x-tipranks", "Nebius price target raised", '["NBIS"]', "new", "2026-09-25T02:49:30Z", "2026-09-25T02:50:00+00:00", "https://x.com/TipRanks/status/1001"),
                ("x-thefly", "MU product", '["MU"]', "new", "2026-09-25T02:59:00Z", "2026-09-25T03:00:00+00:00", "https://x.com/theflynews/status/1002"),
                ("x-wallstengine", "NBIS price target raised", '["NBIS"]', "new", "2026-09-25T02:59:10Z", "2026-09-25T03:00:00+00:00", "https://x.com/wallstengine/status/1003"),
            ])
            db.execute("INSERT INTO signal_routes VALUES (?,?,?,?)", ("x-tipranks", "2026-09-25T03:00:00+00:00", None, 10))
            result = report(db, now=now)
            tip = result["sources"]["x-tipranks"]
            self.assertEqual((tip["baselinePosts"], tip["newPosts"], tip["targetMentions"]), (1, 1, 1))
            self.assertEqual(tip["medianArrivalSeconds"], 30)
            self.assertEqual(tip["samples"], [{
                "url": "https://x.com/TipRanks/status/1001", "tickers": ["NBIS"],
                "postedAt": "2026-09-25T02:49:30+00:00",
                "firstSeenAt": "2026-09-25T02:50:00+00:00",
                "postToFirstSeenSeconds": 30,
            }])
            self.assertEqual(tip["tickerCounts"], {"NBIS": 1})
            self.assertFalse(tip["lastSearchHitLimit"])
            self.assertEqual(result["sources"]["x-thefly"]["newPosts"], 0)
            self.assertIsNone(result["sources"]["x-thefly"]["medianArrivalSeconds"])
            self.assertEqual(result["sources"]["x-wallstengine"]["targetMentions"], 1)
            filtered = report(db, now=now, ticker="MU")
            self.assertEqual(filtered["sources"]["x-tipranks"]["baselinePosts"], 1)
            self.assertEqual(filtered["sources"]["x-tipranks"]["newPosts"], 0)


if __name__ == "__main__":
    unittest.main()
