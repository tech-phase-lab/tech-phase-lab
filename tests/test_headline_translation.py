import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import headline_translation as translation
import signals

ENV = {
    "OFFICIAL_HEADLINE_TRANSLATION_ENABLED": "true",
    "OPENAI_API_KEY": "synthetic-test-key-only-1234",
    "OFFICIAL_HEADLINE_TRANSLATION_MODEL": "synthetic-model",
    "OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT": "3",
}
SOURCE = next(source for source in signals.SOURCES if source["id"] == "nebius-blog")


def response(payload, key):
    assert payload["store"] is False
    assert "Do not add analysis" in payload["instructions"]
    assert set(json.loads(payload["input"])) == {"title"}
    return {
        "status": "completed",
        "output_text": json.dumps({"titleJa": "ネビウスが新しいAI基盤を発表"}, ensure_ascii=False),
        "usage": {"input_tokens": 20, "output_tokens": 12, "ignored": "private"},
    }


class HeadlineTranslationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "signals.sqlite"
        with translation.connect(self.path) as db:
            cursor = db.execute('''INSERT INTO signal_events(
              source_id,url,sha,previous_sha,title,tickers_json,matches_json,event_kind,
              published_at,observed_at,excerpt,diff,truncated)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0)''', (
                SOURCE["id"], "https://nebius.com/blog/example", "sha-1", "",
                "Nebius announces a new AI platform", '["NBIS"]', "{}", "new",
                "1970-01-01T00:15:00+00:00", "1970-01-01T00:15:10+00:00",
                "PRIVATE SOURCE BODY", "PRIVATE DIFF",
            ))
            self.event_id = cursor.lastrowid

    def test_disabled_never_calls_provider(self):
        self.assertEqual(
            translation.run_once(self.path, lambda *_: self.fail("provider called"),
                                 env={}, now=1000, sources=[SOURCE]),
            "disabled",
        )

    def test_translation_is_bound_to_exact_source_revision_and_public_projection(self):
        self.assertEqual(
            translation.run_once(self.path, response, ENV, now=1000, sources=[SOURCE]),
            "done",
        )
        with translation.connect(self.path) as db:
            items = signals.public_official_updates(
                db, sources=[SOURCE],
                reference=translation.datetime.fromtimestamp(1000, tz=translation.timezone.utc),
            )
            self.assertEqual(items[0]["translationJa"], "ネビウスが新しいAI基盤を発表")
            self.assertNotIn("PRIVATE", json.dumps(items, ensure_ascii=False))
        self.assertEqual(
            translation.run_once(self.path, lambda *_: self.fail("duplicate call"),
                                 ENV, now=1001, sources=[SOURCE]),
            "idle",
        )

    def test_new_revision_never_inherits_old_translation(self):
        self.assertEqual(translation.run_once(self.path, response, ENV, now=1000, sources=[SOURCE]), "done")
        with translation.connect(self.path) as db:
            cursor = db.execute('''INSERT INTO signal_events(
              source_id,url,sha,previous_sha,title,tickers_json,matches_json,event_kind,
              published_at,observed_at,excerpt,diff,truncated)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0)''', (
                SOURCE["id"], "https://nebius.com/blog/example", "sha-2", "sha-1",
                "Nebius updates its AI platform", '["NBIS"]', "{}", "changed",
                "1970-01-01T00:15:00+00:00", "1970-01-01T00:16:00+00:00", "", "",))
            latest_id = cursor.lastrowid
            items = signals.public_official_updates(
                db, sources=[SOURCE],
                reference=translation.datetime.fromtimestamp(1010, tz=translation.timezone.utc),
            )
            self.assertEqual(items[0]["id"], str(latest_id))
            self.assertNotIn("translationJa", items[0])

    def test_failures_retry_three_times_without_persisting_provider_error(self):
        def failed(*_):
            raise RuntimeError("sensitive provider response")
        for now in (1000, 1300, 1600):
            self.assertEqual(translation.run_once(self.path, failed, ENV, now=now, sources=[SOURCE]), "retry")
        self.assertEqual(translation.run_once(self.path, response, ENV, now=1900, sources=[SOURCE]), "idle")
        self.assertNotIn(b"sensitive provider response", self.path.read_bytes())

    def test_live_lease_and_daily_limit_prevent_duplicate_calls(self):
        with translation.connect(self.path) as db:
            self.assertIsNotNone(translation.claim(db, [SOURCE], 3, "synthetic-model", 1000))
        self.assertEqual(
            translation.run_once(self.path, lambda *_: self.fail("concurrent call"),
                                 ENV, now=1001, sources=[SOURCE]),
            "idle",
        )
        limited = {**ENV, "OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT": "1"}
        self.assertEqual(translation.run_once(self.path, response, limited, now=1300, sources=[SOURCE]), "idle")


if __name__ == "__main__":
    unittest.main()
