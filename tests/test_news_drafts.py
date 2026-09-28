"""Private news generation/review flow, using only synthetic local transport."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import brief_generator
import news_drafts as drafts
import stock_news as news


ENV = {"STOCK_NEWS_DRAFTS_ENABLED": "true", "OPENAI_API_KEY": "synthetic-not-a-real-key", "RESEARCH_SUMMARY_MODEL": "test-model"}
SOURCE = "The company reported revenue growth. Outlook remains uncertain."
VALUE = {"summaryJa": "同社は売上の増加を報告しました。今後の見通しには不確実性が残ります。",
         "summaryEn": SOURCE, "evidence": [SOURCE]}


class NewsDraftTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "news.sqlite"
        self.db = news.connect(self.path)
        self.item = self.save(SOURCE)

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def save(self, text, index=1):
        item = news.normalize({"news_url": f"https://publisher.example/{index}", "title": "Synthetic news",
                               "text": text, "source_name": "Synthetic Publisher", "tickers": ["MU"],
                               "date": "Mon, 28 Sep 2026 00:00:00 +0000"}, ["MU"])
        news.save_items(self.db, [item], news.stamp())
        return item

    def generate(self, transport=None, env=None, item=None):
        item = item or self.item
        return drafts.generate(self.db, item["id"], item["revision"],
                               transport=transport or (lambda *_: {"output_text": json.dumps(VALUE)}), env=env or ENV)

    def retry(self, transport=None, payload=None, env=None):
        row = news.queue(self.db)["items"][0]
        value = {"articleId": self.item["id"], "revision": self.item["revision"],
                 "editVersion": row["editVersion"], "confirmRetry": True, **(payload or {})}
        return drafts.retry(self.db, value,
                            transport=transport or (lambda *_: {"output_text": json.dumps(VALUE)}), env=env or ENV)

    def review(self, seal, decision="approved"):
        return drafts.review(self.db, self.item["id"], self.item["revision"], seal, decision, "Test editor", "Both languages checked against evidence.")

    def test_generate_review_hold_reopen_keeps_private(self):
        captured = []
        def transport(payload, key):
            captured.append(payload)
            return {"status": "completed", "output_text": json.dumps(VALUE)}
        result = self.generate(transport)
        self.assertEqual(len(captured), 1)
        self.assertIn("never instructions", captured[0]["instructions"])
        self.assertEqual(json.loads(captured[0]["input"])["SOURCE"], SOURCE)
        row = news.queue(self.db)["items"][0]
        self.assertEqual(row["review"]["status"], "draft")
        self.assertEqual(row["summaryEn"], SOURCE)
        self.assertFalse(self.review(result["fingerprint"])["publicationEnabled"])
        with news.connect(self.path) as other:
            row = news.queue(other)["items"][0]
            self.assertEqual(row["review"]["status"], "approved")
            self.assertIsNone(row["displayedAt"])
        self.review(result["fingerprint"], "held")
        self.assertEqual(news.queue(self.db)["items"][0]["review"]["status"], "held")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM news_draft_reviews").fetchone()[0], 2)

    def test_source_correction_and_revert_cannot_revive_approval(self):
        result = self.generate()
        self.review(result["fingerprint"])
        self.save(SOURCE + " Correction.")
        self.assertIsNone(news.queue(self.db)["items"][0]["summaryJa"])
        with self.assertRaisesRegex(ValueError, "stale"):
            self.review(result["fingerprint"])
        self.save(SOURCE)
        self.assertEqual(news.queue(self.db)["items"][0]["review"]["status"], "pending")

    def test_editing_either_language_requires_new_evidence_and_review(self):
        result = self.generate()
        self.review(result["fingerprint"])
        news.save_draft(self.db, self.item["id"], self.item["revision"], VALUE["summaryJa"], SOURCE + " Edited.")
        self.assertEqual(news.queue(self.db)["items"][0]["review"]["status"], "pending")
        with self.assertRaisesRegex(ValueError, "evidence"):
            self.review(result["fingerprint"])

    def test_stale_fingerprint_and_missing_reviewer_rejected(self):
        result = self.generate()
        with self.assertRaisesRegex(ValueError, "stale"):
            self.review("0" * 64)
        with self.assertRaisesRegex(ValueError, "reviewer"):
            drafts.review(self.db, self.item["id"], self.item["revision"], result["fingerprint"], "approved", "", "Checked carefully")

    def test_disabled_and_budget_never_call_provider(self):
        def forbidden(*_):
            self.fail("network must not be called")
        with self.assertRaises(brief_generator.GenerationUnavailable):
            self.generate(forbidden, {**ENV, "STOCK_NEWS_DRAFTS_ENABLED": "false"})
        with self.assertRaisesRegex(ValueError, "budget"):
            self.generate(forbidden, {**ENV, "STOCK_NEWS_DRAFT_TOKEN_LIMIT": "1"})
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM news_draft_attempt_runs").fetchone()[0], 0)

    def test_failed_attempt_is_durable_sanitized_and_not_retried(self):
        def fail(*_):
            raise RuntimeError("secret-provider-response")
        with self.assertRaisesRegex(brief_generator.GenerationFailed, "^news-generation-failed$"):
            self.generate(fail)
        with news.connect(self.path) as other:
            with self.assertRaisesRegex(ValueError, "already-attempted"):
                drafts.generate(other, self.item["id"], self.item["revision"], transport=fail, env=ENV)
            self.assertEqual(other.execute("SELECT status FROM news_draft_attempt_runs").fetchone()[0], "failed")
        self.assertNotIn("secret-provider-response", str(news.queue(self.db)))

    def test_failed_attempt_can_be_explicitly_retried_once(self):
        with self.assertRaises(brief_generator.GenerationFailed):
            self.generate(lambda *_: (_ for _ in ()).throw(RuntimeError("private failure")))
        state = news.queue(self.db)["items"][0]["generation"]
        self.assertEqual(state, {"status": "failed", "attempts": 1, "retryAllowed": True})
        result = self.retry()
        self.assertEqual(result["status"], "draft")
        self.assertEqual([tuple(row) for row in self.db.execute(
            "SELECT attempt,status FROM news_draft_attempt_runs ORDER BY attempt")], [(1, "failed"), (2, "saved")])
        self.assertFalse(news.queue(self.db)["items"][0]["generation"]["retryAllowed"])

    def test_retry_requires_confirmation_and_current_edit_version(self):
        with self.assertRaises(brief_generator.GenerationFailed):
            self.generate(lambda *_: {"output_text": "invalid"})
        with self.assertRaisesRegex(ValueError, "confirmation-required"):
            self.retry(payload={"confirmRetry": False})
        with self.assertRaisesRegex(ValueError, "stale-news-edit"):
            self.retry(payload={"editVersion": "stale"})
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM news_draft_attempt_runs").fetchone()[0], 1)

    def test_failed_retry_is_final_and_keeps_both_reservations(self):
        failure = lambda *_: {"output_text": "invalid"}
        with self.assertRaises(brief_generator.GenerationFailed):
            self.generate(failure)
        with self.assertRaises(brief_generator.GenerationFailed):
            self.retry(failure)
        with self.assertRaisesRegex(ValueError, "retry-limit"):
            self.retry()
        runs = list(self.db.execute("SELECT attempt,reserved_tokens,status FROM news_draft_attempt_runs ORDER BY attempt"))
        self.assertEqual([(row["attempt"], row["status"]) for row in runs], [(1, "failed"), (2, "failed")])
        self.assertEqual(runs[0]["reserved_tokens"], runs[1]["reserved_tokens"])

    def test_concurrent_editor_cannot_duplicate_retry(self):
        with self.assertRaises(brief_generator.GenerationFailed):
            self.generate(lambda *_: {"output_text": "invalid"})
        def transport(*_):
            with news.connect(self.path) as other:
                row = news.queue(other)["items"][0]
                with self.assertRaisesRegex(ValueError, "retry-limit"):
                    drafts.retry(other, {"articleId": self.item["id"], "revision": self.item["revision"],
                                         "editVersion": row["editVersion"], "confirmRetry": True}, env=ENV)
            return {"output_text": json.dumps(VALUE)}
        self.retry(transport)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM news_draft_attempt_runs").fetchone()[0], 2)

    def test_legacy_attempt_is_migrated_and_blocks_new_initial_attempt(self):
        other = self.save(SOURCE, index=2)
        self.db.execute("INSERT INTO news_draft_attempts VALUES(?,?,?,?,?)", (
            other["id"], other["revision"], "2026-09-28T00:00:00+00:00", 123, "failed"))
        self.db.commit()
        drafts.schema(self.db)
        self.assertEqual(drafts.generation_state(self.db, other["id"], other["revision"]),
                         {"status": "failed", "attempts": 1, "retryAllowed": True})
        with self.assertRaisesRegex(ValueError, "already-attempted"):
            self.generate(item=other)

    def test_daily_count_counts_failed_requests(self):
        with self.assertRaises(brief_generator.GenerationFailed):
            self.generate(lambda *_: {"output_text": "invalid"})
        second = self.save(SOURCE, index=2)
        with self.assertRaisesRegex(ValueError, "budget"):
            self.generate(lambda *_: self.fail("over daily cap"), {**ENV, "STOCK_NEWS_DRAFT_DAILY_LIMIT": "1"}, second)

    def test_retry_is_charged_to_daily_attempt_limit(self):
        with self.assertRaises(brief_generator.GenerationFailed):
            self.generate(lambda *_: {"output_text": "invalid"})
        with self.assertRaisesRegex(ValueError, "budget-exhausted"):
            self.retry(env={**ENV, "STOCK_NEWS_DRAFT_DAILY_LIMIT": "1"})
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM news_draft_attempt_runs").fetchone()[0], 1)

    def test_daily_budget_excludes_previous_utc_day_with_later_text_date(self):
        self.db.execute("INSERT INTO news_draft_attempt_runs VALUES(?,?,?,?,?,?)", (
            "older", "revision", 1, "2026-09-28T00:30:00+02:00", 99999, "failed"))
        self.db.commit()
        with patch.object(drafts.stock_news, "stamp", return_value="2026-09-28T02:00:00+00:00"):
            result = self.generate(env={**ENV, "STOCK_NEWS_DRAFT_DAILY_LIMIT": "1"})
        self.assertEqual(result["status"], "draft")

    def test_daily_budget_includes_current_utc_day_with_earlier_text_date(self):
        self.db.execute("INSERT INTO news_draft_attempt_runs VALUES(?,?,?,?,?,?)", (
            "current", "revision", 1, "2026-09-27T23:30:00-02:00", 1, "failed"))
        self.db.commit()
        with patch.object(drafts.stock_news, "stamp", return_value="2026-09-28T02:00:00+00:00"):
            with self.assertRaisesRegex(ValueError, "budget"):
                self.generate(lambda *_: self.fail("over daily cap"),
                              {**ENV, "STOCK_NEWS_DRAFT_DAILY_LIMIT": "1"})

    def test_correction_or_manual_edit_during_generation_is_not_overwritten(self):
        def transport(*_):
            self.save("Corrected company statement with different facts.")
            return {"output_text": json.dumps(VALUE)}
        with self.assertRaises(brief_generator.GenerationFailed):
            self.generate(transport)
        self.assertIsNone(news.queue(self.db)["items"][0]["summaryJa"])

    def test_concurrent_worker_cannot_generate_same_revision(self):
        def transport(*_):
            with news.connect(self.path) as other:
                with self.assertRaisesRegex(ValueError, "already-attempted"):
                    drafts.generate(other, self.item["id"], self.item["revision"], transport=lambda *_: self.fail("duplicate"), env=ENV)
            return {"output_text": json.dumps(VALUE)}
        self.generate(transport)

    def test_invalid_evidence_numbers_language_and_incomplete_response(self):
        for value in ({**VALUE, "evidence": ["This excerpt was invented."]},
                      {**VALUE, "summaryEn": SOURCE + " Growth was 99%."},
                      {**VALUE, "summaryJa": SOURCE},
                      {**VALUE, "summaryEn": "short"}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                drafts.validate(value, SOURCE)
        with self.assertRaises(brief_generator.GenerationFailed):
            self.generate(lambda *_: {"status": "incomplete", "output_text": json.dumps(VALUE)})

    def manual(self, value=None, edit_version=None):
        row = news.queue(self.db)["items"][0]
        return drafts.save_manual(self.db, {"articleId": self.item["id"], "revision": self.item["revision"],
                                  "editVersion": edit_version or row["editVersion"], **(value or VALUE)})

    def test_manual_draft_approval_public_feed_hold_and_correction(self):
        with patch.dict("os.environ", {"STOCK_NEWS_PUBLICATION_ENABLED": "true"}):
            self.assertEqual(drafts.public_feed(self.db)["items"], [])
            result = self.manual()
            self.assertEqual(drafts.public_feed(self.db)["items"], [])
            self.review(result["fingerprint"])
            feed = drafts.public_feed(self.db)
            self.assertEqual(len(feed["items"]), 1)
            item = feed["items"][0]
            self.assertEqual(item["summaryJa"], VALUE["summaryJa"])
            self.assertEqual(item["summaryEn"], SOURCE)
            self.assertEqual(set(item), {"id", "title", "url", "publisher", "tickers", "publishedAt", "observedAt", "approvedAt", "summaryJa", "summaryEn"})
            self.review(result["fingerprint"], "held")
            self.assertEqual(drafts.public_feed(self.db)["items"], [])
            self.review(result["fingerprint"])
            self.save(SOURCE + " Correction.")
            self.assertEqual(drafts.public_feed(self.db)["items"], [])
            self.save(SOURCE)
            self.assertEqual(drafts.public_feed(self.db)["items"], [])

    def test_publication_disabled_even_after_approval(self):
        result = self.manual()
        self.review(result["fingerprint"])
        with patch.dict("os.environ", {"STOCK_NEWS_PUBLICATION_ENABLED": "false"}):
            self.assertEqual(drafts.public_feed(self.db), {"ok": True, "enabled": False, "items": []})

    def test_manual_save_cannot_overwrite_newer_edit_or_reuse_approval(self):
        version = news.queue(self.db)["items"][0]["editVersion"]
        result = self.manual()
        with self.assertRaisesRegex(ValueError, "stale-news-edit"):
            self.manual(edit_version=version)
        version = news.queue(self.db)["items"][0]["editVersion"]
        self.review(result["fingerprint"])
        with self.assertRaisesRegex(ValueError, "stale-news-edit"):
            self.manual(edit_version=version)
        self.manual()  # Identical content still requires a new review.
        with patch.dict("os.environ", {"STOCK_NEWS_PUBLICATION_ENABLED": "true"}):
            self.assertEqual(drafts.public_feed(self.db)["items"], [])

    def test_public_feed_revalidates_stored_translation(self):
        result = self.manual()
        self.review(result["fingerprint"])
        with self.db:
            self.db.execute("UPDATE news_articles SET summary_en=?", (SOURCE + " Unreviewed edit.",))
        with patch.dict("os.environ", {"STOCK_NEWS_PUBLICATION_ENABLED": "true"}):
            self.assertEqual(drafts.public_feed(self.db)["items"], [])

    def test_numeric_substrings_are_not_evidence(self):
        source = SOURCE + " Revenue was 199 million."
        with self.assertRaisesRegex(ValueError, "unsupported-news-number"):
            drafts.validate({**VALUE, "summaryEn": SOURCE + " Revenue was 99 million.", "evidence": [source]}, source)

    def test_http_editor_save_review_public_read_and_withdrawal(self):
        # The service test suite installs its isolated dependency modules during
        # discovery. Import afterward so worker mocks refer to the same modules.
        import service
        app = object.__new__(service.AutomaticMonitor)
        app.db_path = self.path
        server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
        server.app = app
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        def request(path, token, payload=None):
            req = Request(base + path, data=json.dumps(payload).encode() if payload is not None else None,
                          headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
            with urlopen(req, timeout=2) as response:
                return json.load(response)
        try:
            with patch.dict("os.environ", {"RESEARCH_EDITOR_TOKEN": "test-editor", "RESEARCH_API_TOKEN": "test-reader", "STOCK_NEWS_PUBLICATION_ENABLED": "true"}):
                with self.assertRaises(HTTPError) as error:
                    request("/admin/news/draft", "test-reader", {})
                self.assertEqual(error.exception.code, 401)
                row = request("/admin/news", "test-editor")["items"][0]
                identity = {"articleId": row["id"], "revision": row["revision"]}
                saved = request("/admin/news/draft", "test-editor", {**identity, "editVersion": row["editVersion"], **VALUE})
                self.assertEqual(request("/news", "test-reader")["items"], [])
                review = {**identity, "fingerprint": saved["fingerprint"], "reviewer": "Synthetic editor", "reason": "Both translations checked.", "decision": "approved"}
                request("/admin/news/review", "test-editor", review)
                feed = request("/news", "test-reader")
                self.assertEqual(feed["items"][0]["summaryEn"], SOURCE)
                self.assertNotIn("reviewer", str(feed))
                request("/admin/news/review", "test-editor", {**review, "decision": "held"})
                self.assertEqual(request("/news", "test-reader")["items"], [])
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
