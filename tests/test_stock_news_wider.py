"""Owner, Nov 15 (注目トピックの取り込みを広げる): publisher aliases, the "tickers" stream, the monthly call plan, per-stream counts
on /health, and the translation cost staying where it was. Offline: no provider or model calls."""
import json
import os
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "research"))
import company_wire  # noqa: E402
import earnings_backtest  # noqa: E402
import monitor  # noqa: E402
import stock_news as news  # noqa: E402

INTAKE = {"STOCK_NEWS_ENABLED": "true", "STOCK_NEWS_API_KEY": "synthetic-key", "STOCK_NEWS_TO_HOME": "true",
          "STOCK_NEWS_STREAMS": "tech,tickers,market", "STOCK_NEWS_ITEMS": "50"}
MODEL = {"OFFICIAL_HEADLINE_TRANSLATION_ENABLED": "true", "OPENAI_API_KEY": "k" * 30, "OFFICIAL_HEADLINE_TRANSLATION_MODEL": "test-model"}


def words(n, count=6):
    """``count`` made-up words unique to ``n``, so no two test headlines read as the same story."""
    letters = "bcdfghjklmnpqrstvwz"
    return " ".join("".join(letters[(n * 7 + k * 3 + j * 5) % 19] + "aeiou"[(n + j) % 5] for j in range(3)) + letters[n % 19] + str(n)
                    for k in range(count))


def row(index, publisher="Reuters", tickers=("NVDA",), title="Nvidia wins a large order"):
    published = format_datetime(datetime.now(timezone.utc) - timedelta(minutes=5))
    item = {"news_url": f"https://publisher.example/w/{index}", "title": f"{title} {index}", "text": "Body.",
            "source_name": publisher, "date": published}
    if tickers is not None:
        item["tickers"] = list(tickers)
    return item


class PublisherAliasTests(unittest.TestCase):
    def test_the_provider_spellings_of_kept_outlets_are_kept(self):
        for name in ("WSJ", "wsj", "The Wall Street Journal", "Wall Street Journal", "Wall Street Journal (WSJ)",
                     "FT", "Financial Times", "The Financial Times", "AP", "Associated Press", "The Associated Press",
                     "Barron's", "Barrons", "MarketWatch", "Market Watch", "Bloomberg", "Bloomberg News", "Bloomberg Television",
                     "Bloomberg Markets and Finance (video)", "BLOOMBERG TECHNOLOGY", "The Guardian", "Guardian", "The Verge"):
            self.assertTrue(company_wire.stock_news_publisher_kept(name), name)

    def test_opinion_outlets_stay_dropped(self):
        for name in ("Bloomberg Opinion", "The Motley Fool", "Motley Fool", "Seeking Alpha", "TheStreet", "The Street",
                     "The Financial News", "24/7 Wall Street", "The Dog of Wall Street", "Schwab Network", "Finbold", "ETF Trends"):
            self.assertFalse(company_wire.stock_news_publisher_kept(name), name)
        self.assertFalse(company_wire.KEEP_KEYS & company_wire.DROP_KEYS)

    def test_the_counter_uses_the_listed_spelling(self):
        self.assertEqual(company_wire.publisher_counter("WSJ"), "Wall Street Journal")
        self.assertEqual(company_wire.publisher_counter("The Wall Street Journal"), "Wall Street Journal")
        self.assertEqual(company_wire.publisher_counter("Barron's"), "Barrons")
        self.assertEqual(company_wire.publisher_counter("Bloomberg Technology"), "Bloomberg Technology")
        self.assertEqual(company_wire.publisher_counter("Bloomberg News"), "Bloomberg")
        self.assertEqual(company_wire.publisher_counter("Unheard Of Daily"), "Unheard Of Daily")


class TickerStreamTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = news.connect(Path(self.tmp.name) / "news.sqlite")
        self.env = patch.dict(os.environ, INTAKE)
        self.env.start()

    def tearDown(self):
        self.env.stop(); self.db.close(); self.tmp.cleanup()

    def test_the_stream_names_the_watched_companies_and_big_tech(self):
        tickers = news.stream_tickers()
        for ticker in [*company_wire.roster(), *earnings_backtest.WATCH[:22], "GOOGL", "GOOG", "META", "AMZN", "NFLX", "TSLA"]:
            self.assertIn(ticker, tickers)
        self.assertEqual(len(tickers), len(set(tickers)))
        self.assertLessEqual(len(tickers), news.MAX_TICKERS)
        self.assertEqual(tickers[:len(company_wire.roster())], company_wire.roster(), "watched companies first")
        self.assertNotIn("ANT", tickers, "unverified with the provider")
        with patch.dict(os.environ, {"STOCK_NEWS_EXTRA_TICKERS": " ant, NVDA,bad ticker!"}):
            self.assertEqual(news.stream_tickers()[-1], "ANT")
            self.assertEqual(news.stream_tickers().count("NVDA"), 1)
        self.assertIn("tickers", news.stream_names())

    def test_the_request_goes_to_the_ticker_endpoint_with_the_symbols(self):
        seen = []
        def transport(request):
            seen.append(request.full_url)
            return {"data": []}
        news.probe("tickers", transport=transport)
        self.assertTrue(seen[0].startswith("https://stocknewsapi.com/api/v1?"), seen[0])
        self.assertIn("tickers=" + "%2C".join(news.stream_tickers()), seen[0])

    def test_only_the_named_symbols_are_kept_and_filed_watched_first(self):
        rows = [row(1, tickers=["TSLA", "ZZZ"]), row(2, tickers=["ZZZ"]), row(3, tickers=["NFLX", "NVDA", "MU", "AMD"])]
        result = news.poll_stream(self.db, "tickers", transport=lambda name, page, token: rows)
        self.assertEqual(result["status"], "ok", result)
        filed = sorted((r[0], r[1].rsplit(" ", 1)[1]) for r in self.db.execute("SELECT ticker, title FROM company_wire"))
        self.assertEqual(filed, [("AMD", "3"), ("MU", "3"), ("NVDA", "3"), ("TSLA", "1")])

    def test_the_monthly_plan_stays_under_44000_and_the_hard_ceiling_is_kept(self):
        month = 31 * 86400
        total = sum(month / spec["seconds"] for spec in news.STREAMS.values())
        self.assertEqual(round(total), 40920)
        self.assertLessEqual(total, 44000)
        self.assertEqual(news.MONTHLY_TARGET, 44000)
        with patch.dict(os.environ, {"STOCK_NEWS_MONTHLY_CALL_LIMIT": "50001"}):
            with self.assertRaisesRegex(ValueError, "invalid-stock-news-call-limit"):
                news.poll_stream(self.db, "tech", transport=lambda *_: self.fail("network"))

    def test_extra_pages_only_under_the_months_even_pace(self):
        now = "2026-11-16T00:00:00.000+00:00"   # half of November gone: the pace allows 22,000 calls
        self.assertTrue(news.extra_page_allowed(self.db, now))
        self.db.executemany("INSERT INTO news_api_calls VALUES(?)", [("2026-11-10T00:00:00+00:00",)] * 22000)
        self.assertFalse(news.extra_page_allowed(self.db, now))
        self.assertTrue(news.extra_page_allowed(self.db, "2026-11-20T00:00:00.000+00:00"))

    def test_a_busy_round_stops_after_one_page_when_ahead_of_pace(self):
        served = []
        def full(name, page, token):
            served.append(page)
            return [row(len(served) * 100 + i) for i in range(50)]
        with self.db:
            news.put_state(self.db, "started:tech", "1")   # not the first fetch, so a full page would be followed by another
        with patch.object(news, "MONTHLY_TARGET", 0):
            self.assertEqual(news.poll_stream(self.db, "tech", transport=full)["calls"], 1)
        with self.db:
            news.put_state(self.db, "next_poll:tech", "2000-01-01T00:00:00+00:00")
        with patch.object(news, "MONTHLY_TARGET", 10 ** 9):
            self.assertEqual(news.poll_stream(self.db, "tech", transport=full)["calls"], 3)


class StreamHealthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = news.connect(Path(self.tmp.name) / "news.sqlite")
        self.env = patch.dict(os.environ, INTAKE)
        self.env.start()

    def tearDown(self):
        self.env.stop(); self.db.close(); self.tmp.cleanup()

    def test_new_articles_are_counted_per_stream_kept_and_dropped(self):
        news.poll_stream(self.db, "tech", transport=lambda *_: [row(1), row(2, "The Motley Fool")])
        news.poll_stream(self.db, "tickers", transport=lambda *_: [row(1), row(3, "WSJ", ["AMZN"]), row(4, "Seeking Alpha", ["META"])])
        news.poll_stream(self.db, "market", transport=lambda *_: [row(5, "CNBC", None, "Oil jumps")])
        today = company_wire.daily_counts(self.db, datetime.now(timezone.utc).timestamp())["today"]
        self.assertEqual(today["stockNewsStreams"], {"market": {"kept": 1, "dropped": 0}, "tech": {"kept": 1, "dropped": 1},
                                                     "tickers": {"kept": 1, "dropped": 1}})
        self.assertEqual(today["stockNewsPublishers"]["kept"], {"Reuters": 1, "CNBC": 1, "Wall Street Journal": 1})
        self.assertIn(("AMZN",), [tuple(r) for r in self.db.execute("SELECT ticker FROM company_wire")])


class TranslationCostTests(unittest.TestCase):
    """More headlines ride in the same calls: at most 30 articles a call, each article once, the 400-a-day limit unchanged."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "db.sqlite")
        monitor.connect(self.path).close()
        self.env = patch.dict(os.environ, INTAKE)
        self.env.start()

    def tearDown(self):
        self.env.stop(); self.tmp.cleanup()

    def test_45_new_articles_under_three_tickers_and_two_streams_take_two_calls(self):
        rows = [row(n, tickers=["NVDA", "AMZN", "TSLA"], title=words(n)) for n in range(45)]
        with news.connect(self.path) as db:
            news.poll_stream(db, "tickers", transport=lambda *_: rows)
            news.poll_stream(db, "tech", transport=lambda *_: rows)   # the same articles again from the other stream
            self.assertEqual(db.execute("SELECT COUNT(*) FROM company_wire").fetchone()[0], 135)
        batches = []
        def send(payload, key):
            items = json.loads(payload["input"])
            batches.append(len(items))
            out = [{"id": i["id"], "titleJa": "日本語の見出し", "shortJa": "短い見出し", "kind": "news"} for i in items]
            return {"status": "completed", "output": [{"type": "message", "content": [
                {"type": "output_text", "text": json.dumps({"items": out}, ensure_ascii=False)}]}]}
        results = company_wire.run_round(self.path, transport=send, env=MODEL, now_ts=time.time() + 1)
        self.assertEqual(batches, [30, 15], results)
        self.assertEqual(company_wire.TRANSLATION_BATCH, 30)
        self.assertEqual(company_wire.daily_limit({}), 400)


if __name__ == "__main__":
    unittest.main()
