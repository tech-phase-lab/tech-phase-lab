"""Offline audit-clock projection; no new publication or reconstructed history."""
from contextlib import ExitStack
from datetime import timedelta
from pathlib import Path
import sqlite3
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import official_research as research
import official_research_diagnostics as diagnostics
import official_research_editorial_recovery as recovery
import buyback_structured_publication as derived
import test_reviewed_retry_articles as retry_fixture
import test_reviewed_rollout_correction as article_fixture
import test_buyback_structured_publication as buyback_fixture


class AuditClockAssertions:
    def history(self, *, row=None, saved=None, valid=True, reference=None):
        with sqlite3.connect(self.path.resolve().as_uri() + '?mode=ro', uri=True) as db:
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA query_only=ON')
            self.assertEqual(db.execute('PRAGMA query_only').fetchone()[0], 1)
            return diagnostics.publication_history(db, row or self.row, saved or self.saved,
                                                   valid, reference or self.reference)

    def assert_unknown(self, result):
        self.assertEqual(result, {'earliestAuditedPublicationAt': None, 'currentPayloadAuditedAt': None,
                                 'firstValidatedAt': None, 'firstRenderedAt': None, 'historyComplete': False})

    def assert_current(self, result):
        self.assertEqual(result, {'earliestAuditedPublicationAt': self.saved['public_at'],
                                 'currentPayloadAuditedAt': self.saved['public_at'],
                                 'firstValidatedAt': None, 'firstRenderedAt': None, 'historyComplete': False})

    def mutate(self, sql, args=()):
        with sqlite3.connect(self.path) as db:
            db.execute(sql, args)

    def assert_mutations_rejected(self, cases):
        with sqlite3.connect(self.path) as db:
            baseline = '\n'.join(db.iterdump())
        for sql, args in cases:
            with self.subTest(sql=sql, args=args):
                # Each case uses a fresh synthetic DB, never an application DB.
                temp = self.path.with_name('case.sqlite')
                with sqlite3.connect(temp) as db:
                    db.executescript(baseline)
                    db.execute(sql, args)
                original, self.path = self.path, temp
                try:
                    self.assert_unknown(self.history())
                finally:
                    self.path = original
                    temp.unlink()

    def test_query_only_projection_and_owner_queue_do_not_mutate_or_call_providers(self):
        before_bytes = self.path.read_bytes()
        with sqlite3.connect(self.path) as db:
            before = list(db.iterdump())
        blocked = ((research, 'schema'), (research, 'run_once'), (research.bridge, 'sync'),
                   (research.signals, 'fetch'), (research.brief_generator, 'request_response'),
                   (recovery, 'publish_retained'), (derived, 'publish'))
        with ExitStack() as stack:
            for module, name in blocked:
                stack.enter_context(patch.object(module, name, side_effect=AssertionError('forbidden '+name)))
            self.assert_current(self.history())
            result = diagnostics.queue(self.path, view='all', reference=self.reference)
            item = next(item for item in result['items'] if item['eventId'] == self.row['id'])
            self.assertEqual(item['publication']['currentPayloadAuditedAt'], self.saved['public_at'])
            self.assertEqual(item['status'], 'validated-publication')
            self.assertFalse(item['publication']['historyComplete'])
        with sqlite3.connect(self.path) as db:
            self.assertEqual(list(db.iterdump()), before)
        self.assertEqual(self.path.read_bytes(), before_bytes)

    def test_duplicate_audit_rows_fail_closed_even_if_one_matches(self):
        table = ('reviewed_retry_article_recoveries' if isinstance(self, RetryAuditClockTests)
                 else 'source_structured_buyback_derivations')
        with sqlite3.connect(self.path) as db:
            # Real schemas have event_id primary keys. A malformed replacement
            # table must not let fetchone silently select one conflicting row.
            db.execute('CREATE TABLE duplicate_audit AS SELECT * FROM '+table)
            db.execute('INSERT INTO duplicate_audit SELECT * FROM '+table)
            db.execute('UPDATE duplicate_audit SET '+('payload_sha' if isinstance(self, RetryAuditClockTests)
                       else 'validated_payload_sha')+"='wrong' WHERE rowid=2")
            db.execute('DROP TABLE '+table)
            db.execute('ALTER TABLE duplicate_audit RENAME TO '+table)
        self.assert_unknown(self.history())

    def test_invalid_or_changed_current_identity_is_not_a_clock_proof(self):
        self.assert_unknown(self.history(valid=False))
        for key, value in (('sha', 'stale'), ('body_sha', 'stale'), ('payload', self.saved['payload']+' '),
                           ('started_at', 'invalid'), ('public_at', 'invalid')):
            with self.subTest(key=key):
                self.assert_unknown(self.history(saved={**self.saved, key: value}))
        for key, value in (('id', -1), ('source_id', 'wrong'), ('sha', 'stale'), ('body_sha', 'stale'),
                           ('body', self.row['body']+' '), ('observed_at', 'invalid'),
                           ('body_at', '2026-10-04T23:59:00+00:99')):
            with self.subTest(key=key):
                self.assert_unknown(self.history(row={**self.row, key: value}))
        self.assert_unknown(self.history(reference=self.reference-timedelta(seconds=1)))


class RetryAuditClockTests(AuditClockAssertions, unittest.TestCase):
    def setUp(self):
        self.fixture = retry_fixture.ReviewedRetryArticlesTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.path = self.fixture.path
        self.reference = article_fixture.NOW
        with patch.object(recovery, 'datetime') as clock:
            clock.now.return_value = self.reference
            self.assertTrue(self.fixture.publish())
        with research.connect(self.path) as db:
            self.row = research.candidates(db, self.reference, read_only=True)[0]
            self.saved = dict(db.execute('SELECT * FROM official_research_publications').fetchone())

    def test_primary_article_audit_exposes_only_current_proven_clocks(self):
        self.assert_current(self.history())

    def test_source_revision_payload_manifest_and_clock_tampering_is_rejected(self):
        cases = [(f'UPDATE reviewed_retry_article_recoveries SET {column}=?', (value,)) for column, value in (
            ('source_id', 'wrong'), ('event_sha', 'stale'), ('body_sha', 'stale'),
            ('source_revision', 'stale'), ('manifest_sha', '0'*64), ('payload_sha', '0'*64),
            ('source_observed_at', 'invalid'), ('source_observed_at', '2026-10-01T23:59:00+00:00'),
            ('source_body_at', '20261004T090000Z'), ('source_body_at', '2026-10-04T23:00:00+00:00'),
            ('source_body_at', '2020-01-01T00:00:00+00:00'),
            ('started_at', '2026-10-04T10:00:00+00:99'), ('started_at', '2026-10-04T11:00:00+00:00'),
            ('public_at', 'invalid'), ('public_at', '2026-10-04T11:00:00+00:00'))]
        cases += [('UPDATE signal_events SET '+column+'=?', (value,)) for column, value in
                  (('source_id', 'wrong'), ('url', 'https://example.invalid'), ('title', 'Changed'),
                   ('sha', 'stale'), ('observed_at', 'invalid'))]
        cases += [('UPDATE official_story_bodies SET '+column+'=?', (value,)) for column, value in
                  (('sha', 'stale'), ('body_sha', 'stale'), ('body', 'different body'), ('error', 'failed'))]
        cases += [("UPDATE sources SET status='held'", ()), ("UPDATE sources SET sha256='stale'", ())]
        cases += [('UPDATE official_research_publications SET '+column+'=?', (value,)) for column, value in
                  (('sha', 'stale'), ('body_sha', 'stale'), ('payload', self.saved['payload']+' '),
                   ('started_at', 'invalid'), ('public_at', '2026-10-04T11:00:00+00:00'))]
        self.assert_mutations_rejected(cases)

    def test_older_clock_parity_with_new_current_audit(self):
        earlier = (self.reference-timedelta(minutes=2)).isoformat()
        with sqlite3.connect(self.path) as db:
            db.execute('INSERT INTO business_news_revalidations VALUES(?,?,?,?,?,?,?,?)',
                       (self.row['id'],self.row['sha'],self.row['body_sha'],'older-audit',
                        'original-payload','older-validated-payload','[]',earlier))
        result = self.history()
        self.assertEqual(result['earliestAuditedPublicationAt'], earlier)
        self.assertEqual(result['currentPayloadAuditedAt'], self.saved['public_at'])
        self.mutate("UPDATE reviewed_retry_article_recoveries SET payload_sha='wrong'")
        result = self.history()
        self.assertEqual(result['earliestAuditedPublicationAt'], earlier)
        self.assertIsNone(result['currentPayloadAuditedAt'])
        self.assertIsNone(result['firstValidatedAt'])
        self.assertIsNone(result['firstRenderedAt'])
        self.assertFalse(result['historyComplete'])

    def test_same_body_later_fetch_preserves_audited_clock_without_using_new_body_clock(self):
        later = self.reference + timedelta(minutes=5)
        self.assert_current(self.history(row={**self.row, 'body_at': later.isoformat()}, reference=later))
        self.assert_unknown(self.history(row={**self.row, 'body_at': '2020-01-01T00:00:00+00:00'}))

    def test_oversize_or_optional_malformed_audit_fails_closed(self):
        self.assert_unknown(self.history(saved={**self.saved, 'payload': 'x'*131073}))
        self.assert_unknown(self.history(row={**self.row, 'body': 'x'*160001}))
        self.mutate('DROP TABLE reviewed_retry_article_recoveries')
        self.assert_unknown(self.history())
        self.mutate('CREATE TABLE reviewed_retry_article_recoveries(event_id INTEGER)')
        self.assert_unknown(self.history())

    def test_signal_document_revision_has_its_own_exact_source_proof(self):
        title = 'Nebius announces a service update'
        sha = recovery.digest(title+'\n'+self.row['body'])
        source_id, url = 'nebius-blog', 'https://nebius.com/blog/posts/synthetic-audit-clock'
        with sqlite3.connect(self.path) as db:
            db.execute('UPDATE signal_events SET source_id=?,url=?,title=?,sha=?', (source_id,url,title,sha))
            db.execute('INSERT INTO signal_documents VALUES(?,?,?,?,?,?,?)',
                       (source_id,url,sha,title,self.row['body'],self.row['observed_at'],self.row['observed_at']))
            db.execute('UPDATE official_story_bodies SET sha=?', (sha,))
            db.execute('UPDATE official_research_publications SET sha=?', (sha,))
            db.execute('UPDATE reviewed_retry_article_recoveries SET source_id=?,event_sha=?,source_revision=?',
                       (source_id,sha,sha))
        self.row.update(source_id=source_id,url=url,title=title,sha=sha)
        self.saved['sha'] = sha
        self.assert_current(self.history())
        self.assert_mutations_rejected([
            ('UPDATE signal_documents SET '+column+'=?', (value,)) for column, value in
            (('sha', 'stale'), ('title', 'different'), ('text', 'different'), ('source_id', 'wrong'))])


class StructuredAuditClockTests(AuditClockAssertions, unittest.TestCase):
    def setUp(self):
        self.fixture = buyback_fixture.StructuredBuybackPublicationTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.path = self.fixture.path
        self.reference = buyback_fixture.NOW
        self.fixture.seed()
        self.row = self.fixture.rows()[0]
        self.assertEqual(self.fixture.publish(), 'done')
        with sqlite3.connect(self.path) as db:
            db.row_factory = sqlite3.Row
            self.saved = dict(db.execute('SELECT * FROM official_research_publications').fetchone())

    def test_exact_snapshots_prove_current_clock_without_replaying_derivation(self):
        with patch.object(derived, 'publication_valid', side_effect=AssertionError('not a public approval')), \
             patch.object(research.buyback_structured, 'validated_note', side_effect=AssertionError('no re-derivation')):
            self.assert_current(self.history())

    def test_structured_snapshot_hash_revision_and_clock_tampering_is_rejected(self):
        cases = [('UPDATE source_structured_buyback_derivations SET '+column+'=?', (value,)) for column, value in
                 (('sha', 'stale'), ('body_sha', 'stale'), ('policy_version', 999),
                  ('source_snapshot', '{}'), ('publication_snapshot', '{}'),
                  ('source_snapshot', '{"body":"invented"}'), ('validated_payload_sha', '0'*64),
                  ('derived_at', 'invalid'), ('derived_at', '2026-10-04T07:00:00+00:00'))]
        cases += [('UPDATE signal_documents SET '+column+'=?', (value,)) for column, value in
                  (('sha', 'stale'), ('title', 'different'), ('text', 'different'))]
        cases += [('UPDATE signal_x_acquisition SET '+column+'=?', (value,)) for column, value in
                  (('sha', 'stale'), ('last_seen_at', '2026-10-04T07:00:00+00:00'))]
        cases += [('UPDATE official_research_publications SET '+column+'=?', (value,)) for column, value in
                  (('evidence', '[]'), ('generation_ms', -1), ('payload', self.saved['payload']+' '),
                   ('public_at', '2026-10-04T07:00:00+00:00'))]
        self.assert_mutations_rejected(cases)

    def test_malformed_and_oversize_snapshot_json_is_never_parsed(self):
        self.assert_mutations_rejected([
            ('UPDATE source_structured_buyback_derivations SET '+column+'=?', (value,))
            for column in ('source_snapshot', 'publication_snapshot')
            for value in ('{', 'null', '[NaN]', '['*2000, '\x00', 'x'*1_000_001)
        ])

    def test_snapshot_comparison_is_exact_including_source_id_and_full_publication(self):
        source = derived.source_snapshot(self.row)
        saved = dict(self.saved)
        cases = []
        for key, value in (('source_id', 'wrong'), ('url', 'https://example.invalid'),
                           ('body', source['body']+' '), ('body_at', 'invalid'), ('observed_at', 'invalid')):
            cases.append(('UPDATE source_structured_buyback_derivations SET source_snapshot=?',
                          (derived.encoded({**source, key: value}),)))
        for key, value in (('event_id', -1), ('evidence', '[]'), ('generation_ms', -1),
                           ('started_at', 'invalid'), ('public_at', '2026-10-04T07:00:00+00:00')):
            cases.append(('UPDATE source_structured_buyback_derivations SET publication_snapshot=?',
                          (derived.encoded({**saved, key: value}),)))
        self.assert_mutations_rejected(cases)


if __name__ == '__main__':
    unittest.main()
