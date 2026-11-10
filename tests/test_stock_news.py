"""Offline intake tests. No provider calls or API credentials."""
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import stock_news as news
import service


def article(index=1, text="Revenue increased."):
    return {"news_url": f"https://publisher.example/news/{index}", "title": f"Company report {index}",
            "text": text, "source_name": "Synthetic Publisher", "date": "Fri, 25 Sep 2026 16:00:00 -0400",
            "tickers": ["MU", "NBIS"]}


class StockNewsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = news.connect(Path(self.tmp.name) / "news.sqlite")
        self.env = patch.dict(os.environ, {"STOCK_NEWS_ENABLED": "true", "STOCK_NEWS_API_KEY": "synthetic-key",
                                         "STOCK_NEWS_MONTHLY_CALL_LIMIT": "48000"})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.db.close()
        self.tmp.cleanup()

    def next_poll(self):
        with self.db:
            news.put_state(self.db, "next_poll", "2000-01-01T00:00:00+00:00")

    def test_disabled_never_calls_even_with_key(self):
        with patch.dict(os.environ, {"STOCK_NEWS_ENABLED": "false"}):
            self.assertEqual(news.poll(self.db, ["MU"], transport=lambda *_: self.fail("network"))["status"], "disabled")

    def test_shared_call_saves_once_then_correction_invalidates_draft(self):
        row = article()
        result = news.poll(self.db, ["MU", "NBIS"], transport=lambda *_: [row])
        self.assertEqual((result["calls"], result["added"]), (1, 1))
        item = news.normalize(row, ["MU", "NBIS"])
        news.save_draft(self.db, item["id"], item["revision"], "売上増加", "Revenue increased.")
        self.assertEqual(news.poll(self.db, ["MU"], transport=lambda *_: self.fail("paced"))["status"], "waiting")
        self.next_poll()
        row["news_url"] += "?utm_source=test#section"
        result = news.poll(self.db, ["MU", "NBIS"], transport=lambda *_: [row, row])
        self.assertEqual((result["added"], result["changed"]), (0, 0))
        self.next_poll()
        row["text"] = "Revenue decreased: correction."
        result = news.poll(self.db, ["MU", "NBIS"], transport=lambda *_: [row])
        self.assertEqual((result["added"], result["changed"]), (0, 1))
        stored = self.db.execute("SELECT * FROM news_articles").fetchone()
        self.assertNotEqual(stored["revision"], stored["draft_revision"])
        self.assertIsNone(stored["displayed_at"])
        with self.assertRaisesRegex(ValueError, "stale"):
            news.save_draft(self.db, item["id"], item["revision"], "旧内容", "Old")

    def test_monthly_budget_persists_across_connections(self):
        with patch.dict(os.environ, {"STOCK_NEWS_MONTHLY_CALL_LIMIT": "1"}):
            news.poll(self.db, ["MU"], transport=lambda *_: [])
            self.next_poll()
            with news.connect(Path(self.tmp.name) / "news.sqlite") as other:
                result = news.poll(other, ["MU"], transport=lambda *_: self.fail("budget exceeded"))
            self.assertEqual((result["status"], result["calls"]), ("error", 0))

    def test_failed_call_counts_and_secrets_are_not_persisted(self):
        def fail(*_):
            raise RuntimeError("https://stocknewsapi.com/api/v1?token=synthetic-key")
        result = news.poll(self.db, ["MU"], transport=fail)
        self.assertEqual(result["calls"], 1)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM news_api_calls").fetchone()[0], 1)
        serialized = json.dumps(result) + str(list(self.db.execute("SELECT * FROM news_intake_state")))
        self.assertNotIn("synthetic-key", serialized)

    def test_queue_reduces_legacy_error_detail_to_fixed_code(self):
        with self.db:
            news.put_state(
                self.db, "last_error",
                "Timeout for https://stocknewsapi.com/api/v1?token=legacy-secret",
            )
        result = news.queue(self.db)
        self.assertEqual(result["lastError"], "stock-news-intake-failed")
        self.assertNotIn("stocknewsapi.com", str(result))
        self.assertNotIn("legacy-secret", str(result))

    def test_pagination_catches_more_than_100_new_items(self):
        news.poll(self.db, ["MU"], transport=lambda *_: [article(1)])
        self.next_poll()
        pages = []
        def transport(tickers, page, token):
            pages.append(page)
            return [article(i) for i in range(200, 300)] if page == 1 else [article(100), article(1)]
        result = news.poll(self.db, ["MU"], transport=transport)
        self.assertEqual(pages, [1, 2])
        self.assertEqual(result["added"], 101)
        self.assertFalse(result["historyIncomplete"])

    def test_page_cap_flags_incomplete_history(self):
        news.poll(self.db, ["MU"], transport=lambda *_: [])
        self.next_poll()
        result = news.poll(self.db, ["MU"], transport=lambda _, page, __: [article(page*100+i) for i in range(100)])
        self.assertEqual(result["calls"], 5)
        self.assertTrue(result["historyIncomplete"])

    def test_dates_filters_and_unsafe_links(self):
        self.assertEqual(news.normalize(article(), ["MU"])["publishedAt"], "2026-09-25T20:00:00+00:00")
        self.assertIsNone(news.normalize(article(), ["AMD"]))
        for url in ("javascript:alert(1)", "http://127.0.0.1/a", "https://x:y@publisher.example/a"):
            with self.assertRaises(ValueError):
                news.normalize({**article(), "news_url": url}, ["MU"])
        with self.assertRaises(ValueError):
            news.normalize({**article(), "date": "Fri, 25 Sep 2026 16:00:00"}, ["MU"])
        result = news.poll(self.db, ["MU"], transport=lambda *_: [{}, article()])
        self.assertEqual((result["rejected"], result["added"]), (1, 1))

    def test_queue_hides_old_language_drafts_and_preserves_first_detection(self):
        item = news.normalize(article(), ["MU"])
        news.save_items(self.db, [item], "2026-09-25T20:01:00+00:00")
        news.save_draft(self.db, item["id"], item["revision"], "売上増加", "Revenue increased")
        self.assertEqual(news.queue(self.db)["items"][0]["publicationToIntakeMs"], 60000)
        changed = news.normalize(article(text="Correction"), ["MU"])
        news.save_items(self.db, [changed], "2026-09-25T20:02:00+00:00")
        row = news.queue(self.db)["items"][0]
        self.assertEqual(row["observedAt"], "2026-09-25T20:01:00+00:00")
        self.assertIsNone(row["summaryJa"])
        self.assertIsNone(row["summaryEn"])

    def test_queue_orders_mixed_detection_offsets_by_absolute_time(self):
        older = news.normalize(article(1), ["MU"])
        newer = news.normalize(article(2), ["MU"])
        news.save_items(self.db, [older], "2026-09-28T10:00:00+09:00")
        news.save_items(self.db, [newer], "2026-09-28T02:00:00+00:00")
        items = news.queue(self.db)["items"]
        self.assertEqual([row["id"] for row in items], [newer["id"], older["id"]])

    def test_service_worker_is_inert_without_explicit_enable(self):
        with patch.dict(os.environ, {"STOCK_NEWS_ENABLED": "false"}):
            # Early exit must not need a database, monitor state or network.
            service.AutomaticMonitor.run_stock_news(object())

    def test_private_news_endpoint_requires_editor_token(self):
        class App:
            def stock_news_queue(self, limit):
                return {"items": [], "publicationEnabled": False}
            def generate_news_draft(self, payload):
                return {"status": "draft", "publicationEnabled": False}
            def retry_news_draft(self, payload):
                return {"status": "draft", "publicationEnabled": False}
            def review_news_draft(self, payload):
                return {"status": "held", "publicationEnabled": False}
            def save_news_draft(self, payload):
                return {"status": "draft", "publicationEnabled": False}
        server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
        server.app = App()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/admin/news"
        try:
            with patch.dict(os.environ, {"RESEARCH_EDITOR_TOKEN": "synthetic-editor-token-more-than-24"}):
                with self.assertRaises(HTTPError) as error:
                    urlopen(url, timeout=2)
                self.assertEqual(error.exception.code, 401)
                with urlopen(Request(url, headers={"Authorization": "Bearer synthetic-editor-token-more-than-24"}), timeout=2) as response:
                    self.assertFalse(json.load(response)["publicationEnabled"])
                for action, expected in (("generate", "draft"), ("retry", "draft"), ("review", "held"), ("draft", "draft")):
                    request = Request(url + "/" + action, data=b"{}", headers={"Content-Type": "application/json"})
                    with self.assertRaises(HTTPError) as error:
                        urlopen(request, timeout=2)
                    self.assertEqual(error.exception.code, 401)
                    request.add_header("Authorization", "Bearer synthetic-editor-token-more-than-24")
                    with urlopen(request, timeout=2) as response:
                        result = json.load(response)
                        self.assertEqual(result["status"], expected)
                        self.assertFalse(result["publicationEnabled"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)



class ProbeTests(unittest.TestCase):
    """The owner's one-time connection check: one request, nothing saved, the key never returned."""
    def run_probe(self, transport, key="secret-key-value"):
        with patch.dict(os.environ, {"STOCK_NEWS_API_KEY": key}, clear=False):
            return news.probe(transport=transport, clock=iter([100.0, 100.8]).__next__,
                              now=news.datetime(2026, 11, 9, 12, 10, tzinfo=news.timezone.utc))

    def test_reports_latency_count_headlines_and_age_without_the_key(self):
        seen = []
        def transport(request):
            seen.append(request.full_url)
            return {"data": [{"title": "Nvidia wins order", "source_name": "Reuters", "tickers": ["NVDA"], "date": "Mon, 09 Nov 2026 07:00:00 -0500"},
                             {"title": "Micron ships HBM4", "source_name": "CNBC", "tickers": ["MU"], "date": "Mon, 09 Nov 2026 06:50:00 -0500"}], "total_pages": 4}
        result = self.run_probe(transport)
        self.assertEqual((result["articles"], result["totalPages"], result["responseSeconds"], result["newestAgeMinutes"]), (2, 4, 0.8, 10))
        self.assertEqual(result["samples"][0], {"title": "Nvidia wins order", "publisher": "Reuters", "tickers": ["NVDA"], "ageMinutes": 10})
        self.assertEqual(len(seen), 1)
        self.assertNotIn("secret-key-value", json.dumps(result))

    def test_missing_key_and_provider_errors_give_fixed_codes_only(self):
        with patch.dict(os.environ, {"STOCK_NEWS_API_KEY": ""}):
            with self.assertRaisesRegex(ValueError, "^stock-news-key-not-set$"):
                news.probe(transport=lambda request: self.fail("no request without a key"))
        def forbidden(request):
            raise HTTPError(request.full_url, 403, "secret-key-value in text", {}, None)
        with self.assertRaisesRegex(ValueError, "^stock-news-http-403$") as caught:
            self.run_probe(forbidden)
        self.assertNotIn("secret-key-value", str(caught.exception))
        import io
        def reason(body):
            def transport(request):
                raise HTTPError(request.full_url, 403, "x", {}, io.BytesIO(body.encode()))
            return transport
        for body, code in (("`secret-key-value` is not a valid API token.", "stock-news-http-403-invalid-key"),
                           ('The "items" parameter is outside the allowed range.', "stock-news-http-403-items-range"),
                           ("Your plan does not include this", "stock-news-http-403-plan"),
                           ("Request limit exceeded", "stock-news-http-403-limit"), ("Forbidden", "stock-news-http-403")):
            with self.assertRaisesRegex(ValueError, "^" + code + "$") as caught:
                self.run_probe(reason(body))
            self.assertNotIn("secret-key-value", str(caught.exception))
        with self.assertRaisesRegex(ValueError, "^stock-news-invalid-response$"):
            self.run_probe(lambda request: {"nope": 1})

    def test_probe_is_limited_to_one_request_a_minute_and_ignores_the_enable_flag(self):
        app = service.AutomaticMonitor.__new__(service.AutomaticMonitor)
        app.state_lock = threading.Lock(); app.state = {}
        with patch.dict(os.environ, {"STOCK_NEWS_ENABLED": "false"}), patch.object(news, "probe", return_value={"status": "ok"}) as probe:
            self.assertEqual(app.stock_news_probe(), {"status": "ok"})
            with self.assertRaisesRegex(ValueError, "^stock-news-probe-wait$"):
                app.stock_news_probe()
        self.assertEqual(probe.call_count, 1)


if __name__ == "__main__":
    unittest.main()


class HomeBridgeTests(unittest.TestCase):
    """Owner, Nov 10: the home news can run on the Stock News API through the existing company headline table."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = news.connect(Path(self.tmp.name) / "news.sqlite")
        self.env = patch.dict(os.environ, {"STOCK_NEWS_ENABLED": "true", "STOCK_NEWS_API_KEY": "synthetic-key"})
        self.env.start()

    def tearDown(self):
        self.env.stop(); self.db.close(); self.tmp.cleanup()

    def row(self, index, tickers, date="Fri, 25 Sep 2026 16:00:00 -0400"):
        return {"news_url": f"https://publisher.example/n/{index}", "title": f"Nvidia wins order {index}", "text": "Body.",
                "source_name": "Reuters", "date": date, "tickers": tickers}

    def next_poll(self):
        with self.db:
            news.put_state(self.db, "next_poll", "2000-01-01T00:00:00+00:00")

    def wire_rows(self):
        import company_wire
        company_wire.schema(self.db)
        return [dict(r) for r in self.db.execute("SELECT ticker, source, title, publisher, origin FROM company_wire ORDER BY ticker, title")]

    def test_nothing_reaches_the_home_table_unless_switched_on(self):
        news.poll(self.db, ["NVDA", "MU"], transport=lambda *_: [self.row(1, ["NVDA"])])
        self.assertEqual(self.wire_rows(), [])

    def test_switched_on_copies_watched_companies_only_and_once(self):
        with patch.dict(os.environ, {"STOCK_NEWS_TO_HOME": "true"}):
            rows = [self.row(1, ["NVDA", "MU"]), self.row(2, ["ZZZZ"])]
            news.poll(self.db, ["NVDA", "MU", "ZZZZ"], transport=lambda *_: rows)
            self.next_poll()
            news.poll(self.db, ["NVDA", "MU", "ZZZZ"], transport=lambda *_: rows)
        copied = self.wire_rows()
        self.assertEqual([(r["ticker"], r["title"], r["source"], r["publisher"], r["origin"]) for r in copied],
                         [("MU", "Nvidia wins order 1", "stocknews", "Reuters", "third-party"),
                          ("NVDA", "Nvidia wins order 1", "stocknews", "Reuters", "third-party")])

    def test_page_size_is_a_setting_and_paging_follows_it(self):
        for value, expected in (("3", 3), ("0", 1), ("500", 100), ("x", 100)):
            with patch.dict(os.environ, {"STOCK_NEWS_ITEMS": value}):
                self.assertEqual(news.page_size(), expected)
        pages, round_no = [], [0]
        def transport(tickers, page, token):
            pages.append(page)
            # Every round brings new articles, so a full page (3) sends the reader on to the next page; a short page ends it.
            return [self.row(round_no[0] * 100 + page * 10 + i, ["NVDA"]) for i in range(3 if page < 3 else 1)]
        with patch.dict(os.environ, {"STOCK_NEWS_ITEMS": "3"}):
            news.poll(self.db, ["NVDA"], transport=transport)          # the first fetch is a baseline: one page
            round_no[0] = 1
            self.next_poll()
            result = news.poll(self.db, ["NVDA"], transport=transport)
        self.assertEqual(pages, [1, 1, 2, 3])
        self.assertEqual(result["calls"], 3)

    def test_a_page_larger_than_the_setting_is_refused(self):
        with patch.dict(os.environ, {"STOCK_NEWS_ITEMS": "2"}):
            result = news.poll(self.db, ["NVDA"], transport=lambda *_: [self.row(i, ["NVDA"]) for i in range(3)])
        self.assertEqual(result["status"], "error")

    def test_delay_of_new_articles_is_summarised(self):
        now = news.datetime(2026, 9, 25, 20, 10, tzinfo=news.timezone.utc)
        items = [{"publishedAt": "2026-09-25T20:09:00+00:00"}, {"publishedAt": "2026-09-25T20:05:00+00:00"}, {"publishedAt": "2026-09-25T19:50:00+00:00"}]
        self.assertEqual(news.delay_summary(items, now), {"count": 3, "minSeconds": 60, "medianSeconds": 300, "maxSeconds": 1200})
        self.assertIsNone(news.delay_summary([], now))

    def test_company_feeds_can_be_limited_to_stop_the_old_sources(self):
        import company_wire
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("COMPANY_WIRE_FEEDS", None)
            self.assertEqual([name for name, _ in company_wire.feeds()], ["yahoo", "gnews"])
        for value, expected in (("none", []), ("", []), ("gnews", ["gnews"]), ("yahoo, gnews", ["yahoo", "gnews"])):
            with patch.dict(os.environ, {"COMPANY_WIRE_FEEDS": value}):
                self.assertEqual([name for name, _ in company_wire.feeds()], expected)
