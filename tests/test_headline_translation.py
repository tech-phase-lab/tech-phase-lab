import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

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

    def test_legacy_job_schema_adds_source_title_marker(self):
        legacy_path = Path(self.tmp.name) / "legacy.sqlite"
        with sqlite3.connect(legacy_path) as db:
            db.execute('''CREATE TABLE signal_headline_translation_jobs(
              source_id TEXT NOT NULL, url TEXT NOT NULL, sha TEXT NOT NULL,
              attempts INTEGER NOT NULL, next_at REAL NOT NULL,
              lease TEXT NOT NULL, state TEXT NOT NULL,
              PRIMARY KEY(source_id,url,sha))''')
        with translation.connect(legacy_path) as db:
            columns = {row[1] for row in db.execute(
                "PRAGMA table_info(signal_headline_translation_jobs)"
            )}
        self.assertIn("source_title", columns)

    def test_wrong_headline_number_and_completed_acquisition_stay_private(self):
        for source, translated in (
            ('Nebius announces $15 billion investment', 'ネビウスが$5 billion投資を発表'),
            ('Nebius to acquire Example', 'ネビウスがExampleを買収した'),
        ):
            with self.subTest(source=source):
                with translation.connect(self.path) as db:
                    db.execute('DELETE FROM signal_headline_translation_jobs')
                    db.execute('DELETE FROM signal_headline_translation_calls')
                    db.execute('UPDATE signal_events SET title=?', (source,))
                def bad(*args):
                    return {'status':'completed','output_text':json.dumps({'titleJa':translated})}
                self.assertEqual(translation.run_once(self.path,bad,ENV,now=NOW,sources=[SOURCE]),'retry')
                with translation.connect(self.path) as db:
                    self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translations').fetchone()[0],0)

    def test_stored_wrong_translation_is_hidden_and_regenerated(self):
        self.assertEqual(translation.run_once(self.path,response,ENV,now=NOW,sources=[SOURCE]),'done')
        with translation.connect(self.path) as db:
            db.execute("UPDATE signal_headline_translations SET headline_ja='ネビウスが9999台を導入'")
            items=signals.public_official_updates(db,sources=[SOURCE],reference=translation.datetime.fromtimestamp(NOW,tz=translation.timezone.utc))
            self.assertNotIn('translationJa',items[0])
            state=translation.diagnostics(db,env=ENV,now=NOW,sources=[SOURCE])
            self.assertEqual(state['pending'],1)
        self.assertEqual(translation.run_once(self.path,response,ENV,now=NOW+1,sources=[SOURCE]),'done')

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

    def test_owner_activation_uses_utc_date_and_overrides_legacy_december_hold(self):
        from datetime import datetime, timezone
        now = datetime(2026, 9, 30, 21, 30, tzinfo=timezone.utc).timestamp()
        self.assertEqual(translation.approval_status(ENV, now=now), 'approved')
        self.assertIsNotNone(translation.configuration(ENV, now=now))

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

    def test_projected_headline_can_differ_from_raw_source_title(self):
        original = signals.public_official_updates

        def projected(*args, **kwargs):
            items = original(*args, **kwargs)
            return [{**item, "title": "Nebius announces a new AI platform — projected"}
                    for item in items]

        def translated(payload, key):
            self.assertEqual(
                json.loads(payload["input"])["title"],
                "Nebius announces a new AI platform — projected",
            )
            return response(payload, key)

        with patch.object(signals, "public_official_updates", projected):
            self.assertEqual(
                translation.run_once(self.path, translated, ENV, now=NOW, sources=[SOURCE]),
                "done",
            )

    def test_legacy_stale_exhaustion_gets_one_revision_bound_recovery(self):
        with translation.connect(self.path) as db, db:
            db.execute('''INSERT INTO signal_headline_translation_jobs(
              source_id,url,sha,attempts,next_at,lease,state,source_title)
              VALUES(?,?,?,?,?,?,?,NULL)''', (
                SOURCE["id"], "https://nebius.com/blog/example", "sha-1", 3,
                NOW - 1, "legacy-stale-lease", "stale",
            ))
        self.assertEqual(
            translation.run_once(self.path, response, ENV, now=NOW, sources=[SOURCE]),
            "done",
        )
        with translation.connect(self.path) as db:
            job = db.execute('''SELECT attempts,state,source_title
              FROM signal_headline_translation_jobs''').fetchone()
        self.assertEqual(job["attempts"], 1)
        self.assertEqual(job["state"], "done")
        self.assertEqual(job["source_title"], "Nebius announces a new AI platform")

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

    def test_failures_slow_down_then_recover_without_persisting_provider_error(self):
        def failed(*_):
            raise RuntimeError("sensitive provider response")
        retry_env = {**ENV, "OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT": "10"}
        for now in (NOW, NOW + 60, NOW + 180):
            self.assertEqual(translation.run_once(self.path, failed, retry_env, now=now, sources=[SOURCE]), "retry")
        self.assertEqual(translation.run_once(self.path, response, retry_env, now=NOW + 900, sources=[SOURCE]), "idle")
        with translation.connect(self.path) as db:
            state = translation.diagnostics(db, env=retry_env, now=NOW+900, sources=[SOURCE])
            self.assertEqual(state["retrying"], 1)
            self.assertEqual(state["exhausted"], 0)
        self.assertEqual(translation.run_once(self.path, response, retry_env, now=NOW + 3780, sources=[SOURCE]), "done")
        self.assertNotIn(b"sensitive provider response", self.path.read_bytes())

    def test_token_exhaustion_retries_with_more_output_room_and_no_looser_validation(self):
        budgets=[]
        def truncated(payload, key):
            budgets.append(payload['max_output_tokens'])
            return {'status': 'incomplete', 'incomplete_details': {'reason': 'max_output_tokens'}} if len(budgets)==1 else response(payload,key)
        self.assertEqual(translation.run_once(self.path, truncated, ENV, now=NOW, sources=[SOURCE]), 'retry')
        with translation.connect(self.path) as db:
            state=translation.diagnostics(db, env=ENV, now=NOW+1, sources=[SOURCE])
            self.assertEqual(state['failureKinds'], {'output-token-limit': 1})
        self.assertEqual(translation.run_once(self.path, truncated, ENV, now=NOW+5, sources=[SOURCE]), 'done')
        self.assertEqual(budgets, [300,1200])

    def test_existing_three_attempt_job_recovers_without_manual_reset(self):
        with translation.connect(self.path) as db:
            db.execute("INSERT INTO signal_headline_translation_jobs(source_id,url,sha,attempts,next_at,lease,state,source_title) VALUES(?,?,?,3,0,'old','retry',?)", (SOURCE['id'], 'https://nebius.com/blog/example', 'sha-1', 'Nebius announces a new AI platform'))
        self.assertEqual(translation.run_once(self.path, response, ENV, now=NOW, sources=[SOURCE]), 'done')

    def test_retry_after_is_respected_and_new_headline_precedes_failed_old_one(self):
        def limited(*args):
            error = RuntimeError('private')
            error.retry_after_seconds = 900
            raise error
        self.assertEqual(translation.run_once(self.path, limited, ENV, now=NOW, sources=[SOURCE]), 'retry')
        self.assertEqual(translation.run_once(self.path, response, ENV, now=NOW+899, sources=[SOURCE]), 'idle')
        with translation.connect(self.path) as db:
            db.execute("INSERT INTO signal_events(source_id,url,sha,previous_sha,title,tickers_json,matches_json,event_kind,published_at,observed_at,excerpt,diff,truncated) SELECT source_id,url||'-new','new-sha',previous_sha,title,tickers_json,matches_json,event_kind,'2027-01-01T00:17:00+00:00','2027-01-01T00:17:10+00:00',excerpt,diff,truncated FROM signal_events")
        self.assertEqual(translation.run_once(self.path, response, ENV, now=NOW+901, sources=[SOURCE]), 'done')
        with translation.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT sha FROM signal_headline_translations").fetchone()[0], 'new-sha')

    def test_unchanged_headline_reuses_translation_even_at_budget_limit(self):
        self.assertEqual(translation.run_once(self.path,response,ENV,now=NOW,sources=[SOURCE]),'done')
        with translation.connect(self.path) as db:
            db.execute("UPDATE signal_events SET sha='body-only-change'")
        limited={**ENV,'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT':'1'}
        self.assertEqual(translation.run_once(self.path,lambda *_:self.fail('duplicate spend'),limited,now=NOW+1,sources=[SOURCE]),'idle')
        with translation.connect(self.path) as db:
            self.assertIsNotNone(db.execute("SELECT 1 FROM signal_headline_translations WHERE sha='body-only-change'").fetchone())
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)

    def test_changed_translation_input_never_reuses_old_copy(self):
        self.assertEqual(translation.run_once(self.path,response,ENV,now=NOW,sources=[SOURCE]),'done')
        with translation.connect(self.path) as db:
            db.execute("UPDATE signal_events SET sha='new-headline',title='Nebius launches a different service'")
        limited={**ENV,'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT':'1'}
        translation.run_once(self.path,lambda *_:self.fail('over budget'),limited,now=NOW+1,sources=[SOURCE])
        with translation.connect(self.path) as db:
            self.assertIsNone(db.execute("SELECT 1 FROM signal_headline_translations WHERE sha='new-headline'").fetchone())

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
            "nextRetryAt": "2027-01-01T00:17:40+00:00",
            "calls24Hours": {"total": 1, "failed": 1, "completed": 0, "stale": 0},
            "failureKinds": {"provider-unavailable": 1},
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
