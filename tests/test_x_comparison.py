"""Check that baseline history never skews new-post arrival measurements."""
from datetime import datetime, timezone
import sqlite3
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
from x_comparison import report
import signals


class ComparisonTests(unittest.TestCase):
    def test_baseline_is_separate_and_only_new_posts_have_arrival_lag(self):
        now = datetime(2026, 9, 25, 3, 0, tzinfo=timezone.utc)
        with sqlite3.connect(":memory:") as db:
            db.row_factory = sqlite3.Row
            signals.schema(db)
            db.executemany("""INSERT INTO signal_events
                (source_id,title,tickers_json,event_kind,published_at,observed_at,url,sha,matches_json,excerpt,diff,truncated)
                VALUES (?,?,?,?,?,?,?,'revision','{}','','',0)""", [
                ("x-tipranks", "Micron price target raised", '["MU"]', "baseline", "2026-09-21T00:00:00Z", "2026-09-25T02:00:00+00:00", "https://x.com/TipRanks/status/1000"),
                ("x-tipranks", "Nebius price target raised", '["NBIS"]', "new", "2026-09-25T02:49:30Z", "2026-09-25T02:50:00+00:00", "https://x.com/TipRanks/status/1001"),
                ("x-thefly", "MU product", '["MU"]', "new", "2026-09-25T02:59:00Z", "2026-09-25T03:00:00+00:00", "https://x.com/theflynews/status/1002"),
                ("x-wallstengine", "NBIS price target raised", '["NBIS"]', "new", "2026-09-25T02:59:10Z", "2026-09-25T03:00:00+00:00", "https://x.com/wallstengine/status/1003"),
            ])
            db.execute("INSERT INTO signal_routes (id,checked_at,error,matched_items) VALUES (?,?,?,?)", (
                "x-tipranks", "2026-09-25T03:00:00+00:00",
                "Timeout for https://secret.example/?token=hidden", 10,
            ))
            result = report(db, now=now)
            tip = result["sources"]["x-tipranks"]
            self.assertEqual((tip["baselinePosts"], tip["newPosts"], tip["targetMentions"]), (1, 1, 1))
            self.assertEqual(tip["medianArrivalSeconds"], 30)
            self.assertEqual(tip["samples"], [{
                "url": "https://x.com/TipRanks/status/1001", "tickers": ["NBIS"],
                "postedAt": "2026-09-25T02:49:30+00:00",
                "firstSeenAt": "2026-09-25T02:50:00+00:00",
                "postToFirstSeenSeconds": 30,
                "publicationStatus": "unsupported-target-syntax",
            }])
            self.assertEqual(tip["tickerCounts"], {"NBIS": 1})
            self.assertFalse(tip["lastSearchHitLimit"])
            self.assertEqual(tip["lastError"], "fetch-failed")
            self.assertNotIn("secret.example", str(result))
            self.assertNotIn("hidden", str(result))
            self.assertEqual(result["sources"]["x-thefly"]["newPosts"], 0)
            self.assertIsNone(result["sources"]["x-thefly"]["medianArrivalSeconds"])
            self.assertEqual(result["sources"]["x-wallstengine"]["targetMentions"], 1)
            filtered = report(db, now=now, ticker="MU")
            self.assertEqual(filtered["sources"]["x-tipranks"]["baselinePosts"], 1)
            self.assertEqual(filtered["sources"]["x-tipranks"]["newPosts"], 0)


if __name__ == "__main__":
    unittest.main()
