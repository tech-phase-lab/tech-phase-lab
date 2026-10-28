"""Offline editorial recovery regressions using synthetic paraphrased evidence."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import official_research as research
import official_research_content_repair as repair
import official_research_editorial_recovery as recovery
from test_headline_translation import ENV


NOW = datetime(2026, 10, 3, 2, 0, tzinfo=timezone.utc)
OBSERVED = '2026-10-02T23:00:00+00:00'
BODY_AT = '2026-10-02T23:01:00+00:00'
CLAIMED = '2026-10-03T01:18:00+00:00'
FAILED = '2026-10-03T01:19:00+00:00'
RETRY_AT = NOW.timestamp() + 20000

# Deliberately synthetic. Only short selectors match source phrases; no full
# NVIDIA article is bundled. The signed-off paraphrases are validated in full.
PARAGRAPHS = {
    1214: [
        'AI factories are built by the megawatt in this synthetic source. NVIDIA explains costs, GPU use and developer tools.',
        'Productivity, durability and versatility affect AI-factory returns through throughput, continued hardware use and broader workloads.',
        'A versatile developer ecosystem deepens and broadens the demand they can serve.',
        'Each megawatt is estimated to cost about $60 million for an AI factory.',
        'The NVIDIA A100 GPU shipped in 2020 and remains in commercial service six years later.',
        'Barkr estimates useful life based on resale values at five to six years for H100 and nine to 10 years for GB300 NVL72.',
        'The ecosystem has more than 1,000 ready-made CUDA-X libraries, with more than 10 million developers building on them.',
    ],
    1213: [
        'NVIDIA outlines 25 new games arriving in October on GeForce NOW, along with games already streaming.',
        'The Witcher 3: Wild Hunt – Remastered launched Tuesday, Sept. 29 and is already streaming to Performance and Ultimate members.',
        'Ultimate members receive RTX 5080-class cloud performance from GeForce NOW.',
        'Dates listed above are the store release dates; GeForce NOW availability can differ as games are added.',
        'The service handles the rendering, downloads and storage in the cloud, avoiding costly local hardware upgrades and lengthy installations.',
    ],
}
BODIES = {event_id: '\n\n'.join(paragraphs + ['Synthetic background unrelated to the reviewed claims. ' * 28])
          for event_id, paragraphs in PARAGRAPHS.items()}


class EditorialRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.number = 0
        # Any unexpected source access or provider use fails the test immediately.
        for obj, name in [(research.signals, 'fetch'), (research.brief_generator, 'request_response'),
                          (research, 'prepare_story_body')]:
            mocked = patch.object(obj, name, side_effect=AssertionError('external call'))
            mocked.start()
            self.addCleanup(mocked.stop)

    def fixture(self, ids=(1214,)):
        self.number += 1
        path = Path(self.tmp.name) / f'editorial-{self.number}.sqlite'
        with research.connect(path) as db:
            for event_id in ids:
                pin = repair.PINS[event_id]
                sha = research.bridge.revision(pin['title'], pin['body_sha'], pin['published_on'])
                body = BODIES[event_id]
                lease = f'consumed-{event_id}'
                rejected = json.dumps({'title': {'ja': '却下された数値', 'en': 'Rejected numeric copy'},
                                       'rejectedFact': 'Wrong retained number 99999'})
                db.execute('''INSERT INTO sources(url,ticker,title,published_on,discovered_at,checked_at,sha256)
                  VALUES(?,'NVDA',?,?,?,?,?)''',
                           (pin['url'], pin['title'], pin['published_on'], OBSERVED, BODY_AT, pin['body_sha']))
                db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',
                           (pin['url'], 'NVDA', OBSERVED))
                db.execute('''INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars)
                  VALUES(?,?,?,?,?)''', (pin['url'], pin['body_sha'], BODY_AT, body, len(body)))
                db.execute('''INSERT INTO signal_events(id,source_id,url,sha,previous_sha,title,tickers_json,
                  matches_json,event_kind,published_on,observed_at,excerpt,diff,truncated)
                  VALUES(?,?,?,?,?,?,?,'{}','new',?,?,'','',0)''',
                           (event_id, pin['source_id'], pin['url'], sha, '', pin['title'],
                            '["NVDA"]', pin['published_on'], OBSERVED))
                db.execute('''INSERT INTO official_research_jobs
                  VALUES(?,?,7,?,?,'retry','unsupported-number')''', (event_id, sha, RETRY_AT, lease))
                db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                           ('previous-' + lease, event_id, sha, '2026-10-03T01:09:00+00:00',
                            'unsupported-number', 'fact', 'previous rejected payload'))
                db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                           (lease, event_id, sha, FAILED, 'unsupported-number', 'fact', rejected))
                db.execute('''INSERT INTO official_research_content_repairs
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                           (event_id, pin['source_id'], sha, pin['body_sha'], repair.POLICY_ID, lease,
                            CLAIMED, 'expedited', 6, RETRY_AT - 1000, 'previous-' + lease,
                            '2026-10-03T01:09:00+00:00', 'unsupported-number'))
                db.execute('''INSERT INTO signal_headline_translation_calls
                  (at,source_id,sha,model,state,usage,lease) VALUES(?,?,?,?,'failed',?,?)''',
                           (datetime.fromisoformat(CLAIMED).timestamp(), 'research:' + pin['source_id'],
                            sha, 'failed-real-model', '{"total_tokens":123}', lease))
        return path

    def rows(self, path, table):
        with sqlite3.connect(path) as db:
            return db.execute(f'SELECT * FROM {table} ORDER BY rowid').fetchall()

    def publish(self, path, reference=NOW, validator=None):
        with research.connect(path) as db:
            rows = research.candidates(db, reference, read_only=True)
            return recovery.publish(db, rows, reference, validator or research.validate, research.current_revision)

    def test_two_exact_reviewed_notes_publish_once_without_provider_or_budget(self):
        path = self.fixture((1213, 1214))
        unchanged = {table: self.rows(path, table) for table in
                     ('sources', 'source_revisions', 'signal_events', 'release_events',
                      'official_research_attempt_failures', 'official_research_content_repairs',
                      'signal_headline_translation_calls')}
        old_jobs = self.rows(path, 'official_research_jobs')
        approved = {note['eventId']: note for note in json.loads(recovery.REVIEWED_COPY_PATH.read_text())['notes']}
        before = datetime.now(timezone.utc)
        for expected in (1, 2):
            self.assertEqual(research.run_once(path, lambda *_: self.fail('paid retry'), {}, NOW.timestamp()), 'done')
            self.assertEqual(len(self.rows(path, 'official_research_publications')), expected)
        self.assertIsNone(self.publish(path))
        with research.connect(path) as db:
            for saved in db.execute('SELECT * FROM official_research_publications'):
                event_id = saved['event_id']
                note = json.loads(saved['payload'])
                self.assertEqual(note['generationMethod'], recovery.GENERATION_METHOD)
                core = {key: note[key] for key in ('title', 'summary', 'facts', 'purpose')}
                research.validate(core, BODIES[event_id], repair.PINS[event_id]['title'])
                for key in ('title', 'summary', 'purpose'):
                    self.assertEqual({lang: core[key][lang] for lang in ('ja', 'en')}, approved[event_id][key])
                self.assertEqual([{lang: fact[lang] for lang in ('ja', 'en')} for fact in core['facts']],
                                 approved[event_id]['facts'])
                for item in [core['title'], core['summary'], *core['facts'], core['purpose']]:
                    self.assertIn(item['evidenceQuote'], BODIES[event_id])
                    self.assertLessEqual(len(item['evidenceQuote']), 1800)
                self.assertGreaterEqual(datetime.fromisoformat(saved['started_at']), before - timedelta(milliseconds=1))
                self.assertGreaterEqual(datetime.fromisoformat(saved['public_at']), datetime.fromisoformat(saved['started_at']))
                audit = db.execute('SELECT * FROM official_research_editorial_recoveries WHERE event_id=?', (event_id,)).fetchone()
                failure = db.execute('SELECT * FROM official_research_attempt_failures WHERE lease=?',
                                     (audit['source_failure_lease'],)).fetchone()
                self.assertEqual(audit['reviewed_payload_sha'], recovery.digest(saved['payload']))
                self.assertEqual(audit['reviewed_copy_sha'], recovery.REVIEWED_COPY_SHA)
                self.assertEqual(audit['source_failure_payload_sha'], recovery.digest(failure['payload']))
                self.assertEqual(audit['source_text_sha'], recovery.digest(BODIES[event_id]))
                self.assertEqual(audit['public_at'], saved['public_at'])
                self.assertEqual(audit['recovery_started_at'], saved['started_at'])
                self.assertEqual(audit['processing_ms'], saved['generation_ms'])
                self.assertEqual(audit['source_observed_at'], OBSERVED)
                self.assertEqual(audit['source_body_at'], BODY_AT)
            public = research.feed(db, NOW)
            self.assertEqual({item['publishedOn'] for item in public}, {'2026-10-01'})
            self.assertNotIn('evidenceQuote', json.dumps(public))
            self.assertNotIn('Rejected numeric copy', json.dumps(public))
        for table, original in unchanged.items():
            self.assertEqual(self.rows(path, table), original, table)
        for old, new in zip(old_jobs, self.rows(path, 'official_research_jobs')):
            self.assertEqual(new, (*old[:5], 'done', *old[6:]))

    def test_validation_failure_is_atomic_and_never_falls_through_to_provider(self):
        path = self.fixture()
        before = {table: self.rows(path, table) for table in ('official_research_jobs',
                  'official_research_attempt_failures', 'official_research_content_repairs', 'signal_headline_translation_calls')}
        with patch.object(research, 'validate', side_effect=ValueError('unsupported-number')):
            self.assertEqual(research.run_once(path, lambda *_: self.fail('paid fallback'), ENV, NOW.timestamp()), 'idle')
        self.assertEqual(self.rows(path, 'official_research_publications'), [])
        self.assertEqual(self.rows(path, 'official_research_editorial_recoveries'), [])
        for table, original in before.items():
            self.assertEqual(self.rows(path, table), original)

    def test_validator_cannot_change_signed_off_copy(self):
        path = self.fixture()
        def mutate(note, *_):
            note['title']['ja'] += '変更'
        self.assertEqual(self.publish(path, validator=mutate), 'blocked')
        self.assertEqual(self.rows(path, 'official_research_publications'), [])

    def test_audit_insert_failure_rolls_back_publication_and_job_completion(self):
        path = self.fixture()
        old_jobs = self.rows(path, 'official_research_jobs')
        with research.connect(path) as db:
            db.execute("""CREATE TRIGGER reject_editorial_audit BEFORE INSERT ON official_research_editorial_recoveries
              BEGIN SELECT RAISE(ABORT,'audit unavailable'); END""")
        with self.assertRaisesRegex(sqlite3.IntegrityError, 'audit unavailable'):
            self.publish(path)
        self.assertEqual(self.rows(path, 'official_research_publications'), [])
        self.assertEqual(self.rows(path, 'official_research_jobs'), old_jobs)

    def test_job_failure_and_consumed_audit_must_still_identify_attempt_seven(self):
        changes = [
            ("UPDATE official_research_jobs SET state=?", value) for value in ('running', 'done', 'stale', 'failed')
        ] + [
            ("UPDATE official_research_jobs SET failure_kind=?", value)
            for value in ('provider-auth', 'provider-http-401', 'provider-http-429', 'provider-unavailable', 'invalid-copy', None)
        ] + [
            ("UPDATE official_research_jobs SET attempts=?", 6),
            ("UPDATE official_research_jobs SET attempts=?", 8),
            ("UPDATE official_research_jobs SET lease=?", 'new-lease'),
            ("UPDATE official_research_jobs SET sha=?", 'new-revision'),
            ("UPDATE official_research_attempt_failures SET reason=? WHERE lease LIKE 'consumed-%'", 'provider-http-429'),
            ("UPDATE official_research_attempt_failures SET sha=? WHERE lease LIKE 'consumed-%'", 'other-revision'),
            ("UPDATE official_research_attempt_failures SET payload=? WHERE lease LIKE 'consumed-%'", None),
            ("UPDATE official_research_content_repairs SET lease=?", 'other-lease'),
            ("UPDATE official_research_content_repairs SET policy_id=?", 'other-policy'),
            ("UPDATE official_research_content_repairs SET source_id=?", 'primary-ir-VRT'),
            ("UPDATE official_research_content_repairs SET body_sha=?", 'different-body'),
            ("UPDATE official_research_content_repairs SET sha=?", 'different-sha'),
            ("UPDATE official_research_content_repairs SET previous_attempts=?", 5),
            ("UPDATE official_research_content_repairs SET mode=?", 'unapproved'),
            ("UPDATE official_research_content_repairs SET claimed_at=?", '2026-10-03T00:00:00Z'),
            ("UPDATE official_research_content_repairs SET claimed_at=?", '2026-10-03T01:20:00Z'),
            ("UPDATE official_research_attempt_failures SET failed_at=? WHERE lease LIKE 'consumed-%'", 'invalid'),
            ("UPDATE official_research_attempt_failures SET failed_at=? WHERE lease LIKE 'consumed-%'", '2026-10-04T00:00:00Z'),
            ("UPDATE signal_headline_translation_calls SET state=?", 'running'),
            ("UPDATE signal_headline_translation_calls SET sha=?", 'other-sha'),
            ("UPDATE signal_headline_translation_calls SET source_id=?", 'other-source'),
        ]
        for sql, value in changes:
            with self.subTest(sql=sql, value=value):
                path = self.fixture()
                with research.connect(path) as db:
                    db.execute(sql, (value,))
                self.assertIsNone(self.publish(path))
                self.assertEqual(self.rows(path, 'official_research_publications'), [])
                self.assertEqual(self.rows(path, 'official_research_editorial_recoveries'), [])

    def test_missing_audit_failure_or_paid_call_and_newer_failure_fail_closed(self):
        changes = [
            'DELETE FROM official_research_content_repairs',
            'DELETE FROM official_research_attempt_failures',
            'DELETE FROM signal_headline_translation_calls',
            """INSERT INTO official_research_attempt_failures
              SELECT 'later-lease',event_id,sha,'2026-10-03T01:59:00Z','unsupported-number','fact','{}'
              FROM official_research_jobs""",
        ]
        for sql in changes:
            with self.subTest(sql=sql):
                path = self.fixture()
                with research.connect(path) as db:
                    db.execute(sql)
                self.assertIsNone(self.publish(path))

    def test_stale_source_event_body_and_historical_ids_are_rechecked_under_lock(self):
        changes = [
            "UPDATE sources SET status='held'", "UPDATE sources SET status='rejected'",
            "UPDATE sources SET error='source-http-429'", "UPDATE sources SET ticker='VRT'",
            "UPDATE sources SET sha256='new-body'", "UPDATE sources SET title=title || 'changed'",
            "UPDATE sources SET published_on='2026-10-02'", "UPDATE signal_events SET sha='new-event'",
            "UPDATE signal_events SET id=444", "UPDATE signal_events SET source_id='primary-ir-VRT'",
            "UPDATE signal_events SET title=title || ' changed'",
            "UPDATE signal_events SET observed_at='2026-07-01T00:00:00Z'",
            "UPDATE source_revisions SET extracted_text=extracted_text || ' changed'",
            "UPDATE source_revisions SET observed_at='2026-10-03T01:00:00Z'", 'DELETE FROM source_revisions',
        ]
        for sql in changes:
            with self.subTest(sql=sql):
                path = self.fixture()
                with research.connect(path) as db:
                    rows = research.candidates(db, NOW, read_only=True)
                    db.execute(sql)
                with research.connect(path) as db:
                    self.assertIsNone(recovery.publish(db, rows, NOW, research.validate, research.current_revision))
                self.assertEqual(self.rows(path, 'official_research_publications'), [])

    def test_any_existing_publication_is_never_overwritten(self):
        for sha in ('current', 'historical'):
            with self.subTest(sha=sha):
                path = self.fixture()
                with research.connect(path) as db:
                    row = research.candidates(db, NOW, read_only=True)[0]
                    db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                               (row['id'], row['sha'] if sha == 'current' else 'historical',
                                row['body_sha'], '{}', '[]', OBSERVED, BODY_AT, 7))
                saved = self.rows(path, 'official_research_publications')
                self.assertIsNone(self.publish(path))
                self.assertEqual(self.rows(path, 'official_research_publications'), saved)

    def test_expiry_and_pre_rollout_do_not_grant_recovery(self):
        for now in (repair.DEPLOYED_AT - timedelta(microseconds=1), repair.EXPIRES_AT):
            self.assertIsNone(self.publish(self.fixture(), reference=now))

    def test_concurrency_and_restart_are_insert_only_and_idempotent(self):
        path = self.fixture()
        barrier = threading.Barrier(2)
        def publish():
            with research.connect(path) as db:
                rows = research.candidates(db, NOW, read_only=True)
                db.commit()
                barrier.wait(timeout=5)
                return recovery.publish(db, rows, NOW, research.validate, research.current_revision)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [future.result(timeout=15) for future in [pool.submit(publish), pool.submit(publish)]]
        self.assertCountEqual(results, ['done', None])
        self.assertIsNone(self.publish(path))
        self.assertEqual(len(self.rows(path, 'official_research_publications')), 1)
        self.assertEqual(len(self.rows(path, 'official_research_editorial_recoveries')), 1)
        self.assertEqual(len(self.rows(path, 'signal_headline_translation_calls')), 1)

    def test_missing_ambiguous_unsafe_or_unbounded_anchor_is_rejected(self):
        body = 'First unique paragraph supplies the literal evidence.\n\nLast unique paragraph supplies its context.'
        self.assertEqual(recovery.selected_paragraphs(body, ('First unique', 'Last unique')), body)
        for anchors in ((), ('',), ('no such anchor',), ('unique',), ('First\nunique',),
                        ('First unique', 'Last unique', 'extra'), ('Last unique', 'First unique'),
                        ('First unique ',), ('A' * 81,)):
            with self.subTest(anchors=anchors), self.assertRaises(ValueError):
                recovery.selected_paragraphs(body, anchors)
        for invalid in ('tiny', 'First unique ' + 'x' * 1800, body + '\x00'):
            with self.assertRaises(ValueError):
                recovery.selected_paragraphs(invalid, ('First unique',))

    def test_changed_reviewed_file_or_missing_source_anchor_cannot_publish(self):
        path = self.fixture()
        altered = Path(self.tmp.name) / 'altered-copy.json'
        altered.write_text(recovery.REVIEWED_COPY_PATH.read_text() + '\n')
        with patch.object(recovery, 'REVIEWED_COPY_PATH', altered):
            self.assertEqual(self.publish(path), 'blocked')
        with research.connect(path) as db:
            db.execute("UPDATE source_revisions SET extracted_text=replace(extracted_text,'Barkr','Another firm')")
        self.assertEqual(self.publish(path), 'blocked')
        self.assertEqual(self.rows(path, 'official_research_publications'), [])


if __name__ == '__main__':
    unittest.main()
