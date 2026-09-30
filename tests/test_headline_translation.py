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
    "OFFICIAL_HEADLINE_TRANSLATION_APPROVED_ON": "2026-12-01",
    "OPENAI_API_KEY": "synthetic-test-key-only-1234",
    "OFFICIAL_HEADLINE_TRANSLATION_MODEL": "synthetic-model",
    "OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT": "3",
}
SOURCE = next(source for source in signals.SOURCES if source["id"] == "nebius-blog")
NOW = 1798762600  # 2027-01-01T00:16:40Z, after the earliest allowed approval date.


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
                "2027-01-01T00:15:00+00:00", "2027-01-01T00:15:10+00:00",
                "PRIVATE SOURCE BODY", "PRIVATE DIFF",
            ))
            self.event_id = cursor.lastrowid

    def test_disabled_never_calls_provider(self):
        self.assertEqual(
            translation.run_once(self.path, lambda *_: self.fail("provider called"),
                                 env={}, now=NOW, sources=[SOURCE]),
            "disabled",
        )

    def test_invalid_or_future_approval_never_calls_provider(self):
        unapproved = {**ENV, "OFFICIAL_HEADLINE_TRANSLATION_APPROVED_ON": ""}
        self.assertEqual(
            translation.run_once(self.path, lambda *_: self.fail("provider called"),
                                 env=unapproved, now=NOW, sources=[SOURCE]),
            "disabled",
        )
        early = {**ENV, "OFFICIAL_HEADLINE_TRANSLATION_APPROVED_ON": "2026-09-28"}
        self.assertEqual(
            translation.run_once(self.path, lambda *_: self.fail("provider called"),
                                 env=early, now=NOW, sources=[SOURCE]),
            "disabled",
        )

    def test_owner_october_activation_is_recorded_without_environment_edit(self):
        approved = {key: value for key, value in ENV.items()
                    if key != "OFFICIAL_HEADLINE_TRANSLATION_APPROVED_ON"}
        self.assertEqual(translation.approval_status(approved, now=NOW), "approved")
        future = {**ENV, "OFFICIAL_HEADLINE_TRANSLATION_APPROVED_ON": "2027-01-02"}
        self.assertEqual(
            translation.run_once(self.path, lambda *_: self.fail("provider called"),
                                 env=future, now=NOW, sources=[SOURCE]),
            "disabled",
        )

    def test_translation_is_bound_to_exact_source_revision_and_public_projection(self):
        self.assertEqual(
            translation.run_once(self.path, response, ENV, now=NOW, sources=[SOURCE]),
            "done",
        )
        with translation.connect(self.path) as db:
            items = signals.public_official_updates(
                db, sources=[SOURCE],
                reference=translation.datetime.fromtimestamp(NOW, tz=translation.timezone.utc),
            )
            self.assertEqual(items[0]["translationJa"], "ネビウスが新しいAI基盤を発表")
            self.assertNotIn("PRIVATE", json.dumps(items, ensure_ascii=False))
        self.assertEqual(
            translation.run_once(self.path, lambda *_: self.fail("duplicate call"),
                                 ENV, now=NOW + 1, sources=[SOURCE]),
            "idle",
        )

    def test_new_revision_never_inherits_old_translation(self):
        self.assertEqual(translation.run_once(self.path, response, ENV, now=NOW, sources=[SOURCE]), "done")
        with translation.connect(self.path) as db:
            cursor = db.execute('''INSERT INTO signal_events(
              source_id,url,sha,previous_sha,title,tickers_json,matches_json,event_kind,
              published_at,observed_at,excerpt,diff,truncated)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0)''', (
                SOURCE["id"], "https://nebius.com/blog/example", "sha-2", "sha-1",
                "Nebius updates its AI platform", '["NBIS"]', "{}", "changed",
                "2027-01-01T00:15:00+00:00", "2027-01-01T00:16:00+00:00", "", "",))
            latest_id = cursor.lastrowid
            items = signals.public_official_updates(
                db, sources=[SOURCE],
                reference=translation.datetime.fromtimestamp(NOW + 10, tz=translation.timezone.utc),
            )
            self.assertEqual(items[0]["id"], str(latest_id))
            self.assertNotIn("translationJa", items[0])

    def test_failures_retry_three_times_without_persisting_provider_error(self):
        def failed(*_):
            raise RuntimeError("sensitive provider response")
        for now in (NOW, NOW + 300, NOW + 600):
            self.assertEqual(translation.run_once(self.path, failed, ENV, now=now, sources=[SOURCE]), "retry")
        self.assertEqual(translation.run_once(self.path, response, ENV, now=NOW + 900, sources=[SOURCE]), "idle")
        self.assertNotIn(b"sensitive provider response", self.path.read_bytes())

    def test_live_lease_and_daily_limit_prevent_duplicate_calls(self):
        with translation.connect(self.path) as db:
            self.assertIsNotNone(translation.claim(db, [SOURCE], 3, "synthetic-model", NOW))
        self.assertEqual(
            translation.run_once(self.path, lambda *_: self.fail("concurrent call"),
                                 ENV, now=NOW + 1, sources=[SOURCE]),
            "idle",
        )
        limited = {**ENV, "OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT": "1"}
        self.assertEqual(translation.run_once(self.path, response, limited, now=NOW + 300, sources=[SOURCE]), "idle")

    def test_diagnostics_are_aggregate_bounded_and_show_retry_recovery_state(self):
        def failed(*_):
            raise RuntimeError("private provider response")

        self.assertEqual(
            translation.run_once(self.path, failed, ENV, now=NOW, sources=[SOURCE]),
            "retry",
        )
        with translation.connect(self.path) as db:
            summary = translation.diagnostics(db, env=ENV, now=NOW + 1, sources=[SOURCE])
        self.assertEqual(summary, {
            "status": "enabled", "dailyLimit": 3,
            "eligible": 1, "translated": 0, "pending": 1,
            "running": 0, "retrying": 1, "exhausted": 0,
            "oldestPendingAt": "2027-01-01T00:15:10+00:00",
            "nextRetryAt": "2027-01-01T00:21:40+00:00",
            "calls24Hours": {"total": 1, "failed": 1, "completed": 0, "stale": 0},
        })
        serialized = json.dumps(summary)
        self.assertNotIn("http", serialized.lower())
        self.assertNotIn("private", serialized.lower())
        self.assertNotIn("synthetic-model", serialized)

    def test_diagnostics_distinguish_disabled_and_misconfigured_without_calling_provider(self):
        with translation.connect(self.path) as db:
            disabled = translation.diagnostics(db, env={}, now=NOW, sources=[SOURCE])
            unapproved = translation.diagnostics(
                db, env={"OFFICIAL_HEADLINE_TRANSLATION_ENABLED": "true", "OFFICIAL_HEADLINE_TRANSLATION_APPROVED_ON": ""},
                now=NOW, sources=[SOURCE],
            )
            misconfigured = translation.diagnostics(
                db, env={
                    "OFFICIAL_HEADLINE_TRANSLATION_ENABLED": "true",
                    "OFFICIAL_HEADLINE_TRANSLATION_APPROVED_ON": "2026-12-01",
                },
                now=NOW, sources=[SOURCE],
            )
        self.assertEqual(disabled["status"], "disabled")
        self.assertEqual(unapproved["status"], "approval-required")
        self.assertIsNone(disabled["dailyLimit"])
        self.assertEqual(misconfigured["status"], "misconfigured")
        self.assertEqual(disabled["eligible"], 1)
        self.assertEqual(misconfigured["pending"], 1)


if __name__ == "__main__":
    unittest.main()
