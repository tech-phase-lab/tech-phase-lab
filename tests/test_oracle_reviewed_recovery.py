"""Synthetic retained evidence exercises the exact reviewed Oracle recovery."""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import headline_translation
import official_research as research
import oracle_reviewed_recovery as recovery
import signals

NOW = datetime(2026, 10, 3, 7, 20, tzinfo=timezone.utc)
PUBLISHED = '2026-10-02T13:00:00.000+00:00'
OBSERVED = '2026-10-02T13:02:02.527+00:00'
SOURCE = next(s for s in signals.SOURCES if s['id'] == recovery.SOURCE_ID)
# Deliberately synthetic prose, not a copied production body/response.
BODY = '\n'.join([
    'AUSTIN, Texas, Oct. 2, 2026: Oracle committed to buying part of existing Point Beach nuclear electricity generation. The commitment is expected to save Wisconsin utility customers approximately $300 million in fuel costs. The plant has supplied dependable carbon-free power for more than 50 years. The stated purpose is to protect customers from rising costs, ease household electricity bills and support reliable Wisconsin power.',
    'Oracle is stepping up with a commitment to absorb approximately $300 million in rising energy costs for more than 1 million Wisconsin utility customers.',
    'The planned commitment builds on Project Lighthouse, a Port Washington data center development. Expected local economic benefits exceed $11 billion, with more than 4,000 skilled construction jobs over three years and 1,000 ongoing operations positions. Oracle will fully fund Project Lighthouse energy costs to protect customer electricity bills and support grid reliability.',
    "Oracle's planned subscription to the Point Beach power purchase arrangement remains subject to approval by the Public Service Commission of Wisconsin.",
    'UNRELATED FOOTER PROMOTION 21%',
])

def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


class OracleReviewedRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'oracle.sqlite'
        self.sha = digest(recovery.TITLE + '\n' + BODY)
        self.body_sha = digest(BODY)
        for key, value in [('EVENT_SHA', self.sha), ('BODY_SHA', self.body_sha), ('BODY_CHARS', len(BODY))]:
            patcher = patch.object(recovery, key, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        with research.connect(self.path) as db:
            signals.save(db, SOURCE, [{'url': recovery.URL, 'title': recovery.TITLE,
                'text': BODY, 'matches': {'ORCL': ['Oracle']}, 'publishedAt': PUBLISHED,
                'truncated': False}], {}, OBSERVED, 'synthetic', 1)
            db.execute("UPDATE signal_events SET id=?,event_kind='new'", (recovery.EVENT_ID,))

    def run_recovery(self, when=NOW):
        with patch.object(signals, 'fetch', side_effect=AssertionError('network fetch')):
            return research.run_once(self.path, lambda *_: self.fail('paid provider'), env={}, now=when.timestamp())

    def public(self, when=NOW):
        with research.connect(self.path) as db:
            return signals.public_official_updates(db, reference=when)

    def test_publishes_only_reviewed_bilingual_copy_without_new_network_or_paid_calls(self):
        self.assertEqual(self.public(), [])
        self.assertEqual(self.run_recovery(), 'done')
        result = self.public()[0]
        self.assertEqual(result['id'], '1179')
        self.assertEqual(result['publisher'], 'Oracle / PR Newswire')
        self.assertEqual(result['url'], recovery.URL)
        self.assertEqual(result['tickers'], ['ORCL'])
        self.assertIn('約$300 million', result['translationJa'])
        self.assertIn('承認が必要', result['bodyJa'])
        self.assertIn('subject to approval', result['bodyEn'])
        self.assertIn('approximately $300 million', result['bodyEn'])
        self.assertIn('more than $11 billion', result['bodyEn'])
        for private in ('evidenceQuote', 'UNRELATED FOOTER', '21%', self.sha, self.body_sha, 'reviewedRecoveryId'):
            self.assertNotIn(private, json.dumps(result))
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_jobs').fetchone()[0], 0)
            self.assertEqual(research.diagnostics(db)['published'], 1)
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 1)

    def test_original_fractional_clocks_and_retained_evidence_are_unchanged(self):
        with sqlite3.connect(self.path) as db:
            before_events = db.execute('SELECT * FROM signal_events').fetchall()
            before_docs = db.execute('SELECT * FROM signal_documents').fetchall()
        self.run_recovery()
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT * FROM signal_events').fetchall(), before_events)
            self.assertEqual(db.execute('SELECT * FROM signal_documents').fetchall(), before_docs)
            self.assertEqual(db.execute('SELECT fetched_at FROM official_story_bodies').fetchone()[0], OBSERVED)
            publication = db.execute('SELECT started_at,public_at FROM official_research_publications').fetchone()
            self.assertEqual(publication[0], NOW.isoformat())
            self.assertNotEqual(publication[1], OBSERVED)
        result = self.public()[0]
        self.assertEqual(result['publishedAt'], '2026-10-02T13:00:00+00:00')
        self.assertEqual(datetime.fromisoformat(result['observedAt']), datetime.fromisoformat(OBSERVED))

    def test_restart_is_idempotent_and_does_not_overwrite_publication(self):
        self.run_recovery()
        with sqlite3.connect(self.path) as db:
            before = list(db.iterdump())
        self.assertEqual(self.run_recovery(), 'disabled')
        with sqlite3.connect(self.path) as db:
            self.assertEqual(list(db.iterdump()), before)
        self.assertEqual(len(self.public(NOW+timedelta(days=2))), 1)
        self.assertEqual(self.public(NOW+timedelta(days=8)), [])

    def test_missing_or_changed_source_revision_never_becomes_an_automatic_candidate(self):
        for sql, params in [
            ('UPDATE signal_events SET id=9999', ()),
            ('UPDATE signal_events SET sha=?', ('wrong',)),
            ('UPDATE signal_documents SET text=?', (BODY+'corruption',)),
            ('UPDATE signal_events SET truncated=1', ()),
            ('UPDATE signal_events SET published_at=?', ('2026-10-02T12:00:00Z',)),
            ('UPDATE signal_events SET observed_at=?', ('2026-10-03T07:00:00Z',)),
        ]:
            with self.subTest(sql=sql):
                with research.connect(self.path) as db:
                    db.execute('SAVEPOINT invalid_source')
                    db.execute(sql, params)
                    self.assertIsNone(recovery.candidate(db, NOW))
                    db.execute('ROLLBACK TO invalid_source')
                    db.execute('RELEASE invalid_source')
        with patch.object(recovery, 'EXPIRES_AT', NOW):
            self.assertEqual(self.run_recovery(), 'disabled')
        self.assertEqual(self.public(), [])

    def test_other_prnewswire_events_and_titles_never_pass_the_exact_allowlist(self):
        with research.connect(self.path) as db:
            signals.save(db, SOURCE, [{'url': 'https://www.prnewswire.com/news-releases/another-release-123.html',
                'title': recovery.TITLE, 'text': BODY, 'matches': {'ORCL': ['Oracle']},
                'publishedAt': PUBLISHED, 'truncated': False}], {}, OBSERVED, 'synthetic', 1)
        self.run_recovery()
        self.assertEqual([x['id'] for x in self.public()], ['1179'])
        self.assertIsNot(SOURCE.get('officialUpdates'), True)

    def test_corrupted_reviewed_copy_or_saved_copy_fails_closed(self):
        with patch.object(recovery, 'COPY_SHA', 'changed'):
            self.assertEqual(self.run_recovery(), 'disabled')
        self.assertEqual(self.public(), [])
        self.run_recovery()
        with research.connect(self.path) as db:
            note = json.loads(db.execute('SELECT payload FROM official_research_publications').fetchone()[0])
            note['facts'][0]['en'] = 'Oracle already paid $300 billion.'
            db.execute('UPDATE official_research_publications SET payload=?', (json.dumps(note),))
        self.assertEqual(self.public(), [])
        self.assertEqual(self.run_recovery(), 'disabled')

    def test_current_document_change_removes_reviewed_publication(self):
        self.run_recovery()
        with research.connect(self.path) as db:
            db.execute("UPDATE signal_documents SET sha='replacement',text='New article'")
        self.assertEqual(self.public(), [])

    def test_conflicting_headline_rolls_back_all_publication_writes(self):
        with research.connect(self.path) as db:
            db.execute('INSERT INTO signal_headline_translations VALUES(?,?,?,?,?,?)',
                       (SOURCE['id'], recovery.URL, self.sha, 'Conflicting reviewed copy', 'test', OBSERVED))
        with self.assertRaisesRegex(ValueError, 'conflicting-reviewed-headline'):
            self.run_recovery()
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM official_story_bodies').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 0)
        self.assertEqual(self.public(), [])
