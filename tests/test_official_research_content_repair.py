"""Offline regressions for the expiring, two-note policy repair."""
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
from test_headline_translation import ENV


NOW = datetime(2026, 10, 3, 1, 30, tzinfo=timezone.utc)
OBSERVED = '2026-10-02T23:00:00+00:00'
BODY_AT = '2026-10-02T23:01:00+00:00'
FAILED_AT = '2026-10-03T01:09:08+00:00'
RETRY_AT = datetime(2026, 10, 3, 7, 9, 1, tzinfo=timezone.utc).timestamp()
QUOTE = 'NVIDIA announced software for its customers and described the available features.'
BODY = QUOTE + '\n' + 'Retained official announcement background. ' * 40
ITEM = {'ja': 'NVIDIAがソフトウェアを発表した。',
        'en': 'NVIDIA announced software.', 'evidenceQuote': QUOTE}
NOTE = {'title': ITEM, 'summary': ITEM, 'facts': [ITEM] * 3, 'purpose': ITEM}


def response(*_):
    return {'status': 'completed', 'output': [{'type': 'message', 'content': [
        {'type': 'output_text', 'text': json.dumps(NOTE)}]}]}


class ContentRepairTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.number = 0
        # Fail loudly if any test path tries a source or a real provider.
        for obj, attr in [(research.signals, 'fetch'), (research.brief_generator, 'request_response')]:
            mocked = patch.object(obj, attr, side_effect=AssertionError('external call'))
            mocked.start()
            self.addCleanup(mocked.stop)

    def fixture(self, ids=(1213,)):
        self.number += 1
        path = Path(self.tmp.name) / f'repair-{self.number}.sqlite'
        with research.connect(path) as db:
            for event_id in ids:
                pin = repair.PINS[event_id]
                sha = research.bridge.revision(pin['title'], pin['body_sha'], pin['published_on'])
                db.execute('''INSERT INTO sources(url,ticker,title,published_on,discovered_at,checked_at,sha256)
                  VALUES(?, 'NVDA', ?, ?, ?, ?, ?)''',
                           (pin['url'], pin['title'], pin['published_on'], OBSERVED, BODY_AT, pin['body_sha']))
                db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',
                           (pin['url'], 'NVDA', OBSERVED))
                db.execute('''INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars)
                  VALUES(?,?,?,?,?)''', (pin['url'], pin['body_sha'], BODY_AT, BODY, len(BODY)))
                db.execute('''INSERT INTO signal_events(id,source_id,url,sha,previous_sha,title,tickers_json,
                  matches_json,event_kind,published_on,observed_at,excerpt,diff,truncated)
                  VALUES(?,?,?,?,?,?,?, '{}','new',?,?,'','',0)''',
                           (event_id, pin['source_id'], pin['url'], sha, '', pin['title'],
                            '["NVDA"]', pin['published_on'], OBSERVED))
                db.execute('''INSERT INTO official_research_jobs
                  VALUES(?,?,6,?,?,'retry','unsupported-number')''',
                           (event_id, sha, RETRY_AT, f'previous-{event_id}'))
                db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                           (f'previous-{event_id}', event_id, sha, FAILED_AT,
                            'unsupported-number', 'fact', json.dumps(NOTE)))
        return path

    def claim(self, path, reference=NOW, limit=200, pending=0):
        with research.connect(path) as db, patch.object(
                research.headline_translation, 'diagnostics', return_value={'pending': pending}):
            return research.claim(db, reference, 'synthetic-model', limit)

    def rows(self, path, table):
        with sqlite3.connect(path) as db:
            return db.execute(f'SELECT * FROM {table} ORDER BY rowid').fetchall()

    def run_note(self, path, transport=response, now=NOW):
        return research.run_once(path, transport, {**ENV, 'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT': '200'}, now.timestamp())

    def test_exact_two_events_get_one_budgeted_attempt_each_and_publish(self):
        path = self.fixture((1213, 1214))
        for _ in range(2):
            self.assertEqual(self.run_note(path), 'done')
        self.assertEqual(self.run_note(path, lambda *_: self.fail('duplicate provider attempt')), 'idle')
        with research.connect(path) as db:
            self.assertEqual({r[0] for r in db.execute('SELECT event_id FROM official_research_publications')}, {1213, 1214})
            audits = db.execute('SELECT * FROM official_research_content_repairs').fetchall()
            self.assertEqual(len(audits), 2)
            for audit in audits:
                self.assertEqual(audit['mode'], 'expedited')
                self.assertEqual(audit['policy_id'], repair.POLICY_ID)
                self.assertEqual(audit['previous_attempts'], 6)
                self.assertEqual(audit['previous_next_at'], RETRY_AT)
                self.assertEqual(audit['previous_failure_at'], FAILED_AT)
            self.assertEqual([r[0] for r in db.execute('SELECT attempts FROM official_research_jobs')], [7, 7])
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 2)

    def test_all_identity_pins_fail_closed(self):
        changes = [
            ("UPDATE signal_events SET id=9999", ()),
            ("UPDATE signal_events SET source_id='primary-ir-AMD'", ()),
            ("UPDATE signal_events SET url='https://blogs.nvidia.com/blog/another/'", ()),
            ("UPDATE signal_events SET title=title || ' revised'", ()),
            ("UPDATE signal_events SET published_on='2026-10-02'", ()),
            ("UPDATE signal_events SET sha='changed-event-sha'", ()),
            ("UPDATE sources SET sha256='changed-body-sha'", ()),
            ("UPDATE sources SET title=title || ' revised'", ()),
            ("UPDATE sources SET published_on='2026-07-01'", ()),
            ("UPDATE sources SET ticker='VRT'", ()),
            ("UPDATE sources SET status='held'", ()),
            ("UPDATE sources SET status='rejected'", ()),
            ("UPDATE sources SET error='source-http-429'", ()),
            ("UPDATE signal_events SET observed_at='2026-07-01T00:00:00+00:00'", ()),
            ("UPDATE signal_events SET observed_at='2026-10-04T00:00:00+00:00'", ()),
        ]
        for sql, params in changes:
            with self.subTest(sql=sql):
                path = self.fixture()
                # Avoid projection inventing a replacement candidate after an
                # intentionally inconsistent synthetic identity change.
                with research.connect(path) as db:
                    row = research.candidates(db, NOW)[0]
                    db.execute(sql, params)
                with patch.object(research, 'candidates', return_value=[row]):
                    self.assertIsNone(self.claim(path))
                self.assertEqual(self.rows(path, 'official_research_content_repairs'), [])

    def test_retained_body_changed_or_missing_after_candidate_read_is_blocked(self):
        for sql in ["UPDATE source_revisions SET extracted_text=extracted_text || ' changed'",
                    'DELETE FROM source_revisions']:
            with self.subTest(sql=sql):
                path = self.fixture()
                with research.connect(path) as db:
                    row = research.candidates(db, NOW)[0]
                    db.execute(sql)
                with patch.object(research, 'candidates', return_value=[row]):
                    self.assertIsNone(self.claim(path))

    def test_changed_candidate_body_and_each_supplied_pin_are_blocked(self):
        for key in ('id', 'source_id', 'url', 'title', 'published_on', 'sha', 'body_sha', 'body', 'body_at'):
            path = self.fixture()
            with research.connect(path) as db:
                row = research.candidates(db, NOW)[0]
                if key == 'id':
                    db.execute('UPDATE official_research_jobs SET event_id=9999')
            with self.subTest(key=key), patch.object(research, 'candidates', return_value=[
                    {**row, key: 9999 if key == 'id' else str(row[key]) + '-changed'}]):
                self.assertIsNone(self.claim(path))

    def test_only_matching_latest_pre_policy_numeric_failure_is_eligible(self):
        changes = [
            ("UPDATE official_research_jobs SET state=?", value)
            for value in ('running', 'stale', 'failed')
        ] + [
            ("UPDATE official_research_jobs SET failure_kind=?", value)
            for value in ('provider-http-429', 'provider-auth', 'provider-http-401',
                          'provider-unavailable', 'provider-timeout', 'invalid-copy', None)
        ] + [
            ("UPDATE official_research_jobs SET sha=?", 'old-revision'),
            ("UPDATE official_research_attempt_failures SET reason=?", 'provider-http-429'),
            ("UPDATE official_research_attempt_failures SET lease=?", 'other-lease'),
            ("UPDATE official_research_attempt_failures SET sha=?", 'old-revision'),
            ("UPDATE official_research_attempt_failures SET failed_at=?", repair.DEPLOYED_AT.isoformat()),
            ("UPDATE official_research_attempt_failures SET failed_at=?", NOW.isoformat()),
            ("UPDATE official_research_attempt_failures SET failed_at=?", 'invalid-date'),
            ("UPDATE official_research_attempt_failures SET failed_at=?", '2026-10-03T01:00:00'),
            ("UPDATE official_research_attempt_failures SET failed_at=?", '2026-10-02T22:59:59+00:00'),
        ]
        for sql, value in changes:
            with self.subTest(sql=sql, value=value):
                path = self.fixture()
                with research.connect(path) as db:
                    db.execute(sql, (value,))
                # A stale revision follows the normal new-revision claim path,
                # so inspect the bounded override independently in that case.
                if sql == 'UPDATE official_research_jobs SET sha=?':
                    with research.connect(path) as db:
                        row = research.candidates(db, NOW)[0]
                        job = db.execute('SELECT * FROM official_research_jobs').fetchone()
                        self.assertFalse(repair.can_expedite(db, row, job))
                else:
                    self.assertIsNone(self.claim(path))
                self.assertEqual(self.rows(path, 'official_research_content_repairs'), [])

    def test_missing_or_newer_different_failure_blocks_the_override(self):
        for missing in (True, False):
            with self.subTest(missing=missing):
                path = self.fixture()
                with research.connect(path) as db:
                    if missing:
                        db.execute('DELETE FROM official_research_attempt_failures')
                    else:
                        row = research.candidates(db, NOW)[0]
                        db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                                   ('newer-failure', row['id'], row['sha'], '2026-10-03T01:10:00+00:00',
                                    'provider-unavailable', '', None))
                self.assertIsNone(self.claim(path))

    def test_current_publication_blocks_expedite_even_when_invalid(self):
        path = self.fixture()
        with research.connect(path) as db:
            row = research.candidates(db, NOW)[0]
            db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                       (row['id'], row['sha'], row['body_sha'], '{}', '[]', OBSERVED, BODY_AT, 1))
        before = self.rows(path, 'official_research_publications')
        self.assertIsNone(self.claim(path))
        self.assertEqual(self.rows(path, 'official_research_publications'), before)

    def test_before_rollout_and_at_expiry_cannot_expedite(self):
        for reference in (repair.DEPLOYED_AT - timedelta(microseconds=1), repair.EXPIRES_AT):
            with self.subTest(reference=reference):
                path = self.fixture()
                with research.connect(path) as db:
                    db.execute('UPDATE official_research_jobs SET next_at=?',
                               ((repair.EXPIRES_AT + timedelta(hours=1)).timestamp(),))
                self.assertIsNone(self.claim(path, reference))

    def test_full_budget_or_reserved_headline_slot_does_not_consume_repair(self):
        for pending in (0, 1):
            with self.subTest(pending=pending):
                path = self.fixture()
                with research.connect(path) as db:
                    for number in range(2 - pending):
                        db.execute('''INSERT INTO signal_headline_translation_calls
                          (at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)''',
                                   (NOW.timestamp(), 'existing', 'sha', 'model', 'failed', str(number)))
                before = self.rows(path, 'official_research_jobs')
                self.assertIsNone(self.claim(path, limit=2, pending=pending))
                self.assertEqual(self.rows(path, 'official_research_content_repairs'), [])
                self.assertEqual(self.rows(path, 'official_research_jobs'), before)
                self.assertIsNotNone(self.claim(path, limit=3, pending=pending))

    def test_concurrent_workers_and_restart_only_claim_once(self):
        path = self.fixture()
        barrier = threading.Barrier(2)
        def claim():
            # Prepare schemas before contending on the same normal worker claim.
            with research.connect(path) as db:
                db.commit()
                barrier.wait(timeout=5)
                return research.claim(db, NOW, 'synthetic-model', 200)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(claim) for _ in range(2)]
            claimed = [future.result(timeout=15) for future in futures]
        self.assertEqual(sum(value is not None for value in claimed), 1)
        self.assertIsNone(self.claim(path))
        self.assertEqual(len(self.rows(path, 'official_research_content_repairs')), 1)
        self.assertEqual(len(self.rows(path, 'signal_headline_translation_calls')), 1)

    def test_failed_repair_preserves_history_clocks_and_normal_backoff(self):
        path = self.fixture()
        unchanged = {name: self.rows(path, name) for name in
                     ('sources', 'source_revisions', 'release_events', 'signal_events')}
        failures = self.rows(path, 'official_research_attempt_failures')
        def fail(*_):
            raise ValueError('unsupported-number')
        self.assertEqual(self.run_note(path, fail), 'retry')
        with research.connect(path) as db:
            job = db.execute('SELECT * FROM official_research_jobs').fetchone()
            self.assertEqual(job['attempts'], 7)
            self.assertEqual(job['next_at'], NOW.timestamp() + research.headline_translation.retry_delay(7, 'unsupported-number'))
            self.assertEqual(job['failure_kind'], 'unsupported-number')
            self.assertEqual(job['state'], 'retry')
            self.assertEqual(db.execute('SELECT previous_next_at FROM official_research_content_repairs').fetchone()[0], RETRY_AT)
        self.assertEqual(self.rows(path, 'official_research_attempt_failures')[:1], failures)
        self.assertEqual(len(self.rows(path, 'official_research_attempt_failures')), 2)
        for name, rows in unchanged.items():
            self.assertEqual(self.rows(path, name), rows, name)
        self.assertIsNone(self.claim(path))
        ordinary = NOW + timedelta(seconds=research.headline_translation.retry_delay(7, 'unsupported-number'))
        self.assertIsNotNone(self.claim(path, reference=ordinary))
        self.assertEqual(len(self.rows(path, 'official_research_content_repairs')), 1)

    def test_scheduled_attempt_consumes_marker_without_overriding_deadline(self):
        path = self.fixture()
        scheduled = datetime.fromtimestamp(RETRY_AT, timezone.utc)
        claimed = self.claim(path, reference=scheduled)
        self.assertIsNotNone(claimed)
        row, lease = claimed
        with research.connect(path) as db:
            audit = db.execute('SELECT * FROM official_research_content_repairs').fetchone()
            self.assertEqual(audit['mode'], 'scheduled')
            self.assertEqual(audit['previous_next_at'], RETRY_AT)
            # Even an anomalous pre-rollout failure clock cannot grant another
            # attempt after the normal attempt consumed this policy marker.
            db.execute("UPDATE official_research_jobs SET state='retry',next_at=?,failure_kind='unsupported-number'",
                       (scheduled.timestamp() + 21600,))
            db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                       (lease, row['id'], row['sha'], '2026-10-03T01:10:00+00:00',
                        'unsupported-number', '', None))
        self.assertIsNone(self.claim(path, reference=scheduled + timedelta(seconds=1)))


if __name__ == '__main__':
    unittest.main()
