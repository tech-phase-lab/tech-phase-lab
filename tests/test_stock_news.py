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

    def test_service_worker_is_inert_without_explicit_enable(self):
        with patch.dict(os.environ, {"STOCK_NEWS_ENABLED": "false"}):
            # Early exit must not need a database, monitor state or network.
            service.AutomaticMonitor.run_stock_news(object())

    def test_private_news_endpoint_requires_editor_token(self):
        class App:
            def stock_news_queue(self, limit):
                return {"items": [], "publicationEnabled": False}
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
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
