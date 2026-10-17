from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor
import official_headline_corrections as source
import official_research as research
import official_research_editorial_recovery as recovery
import signals

NOW = datetime(2026, 10, 4, 0, 42, tzinfo=timezone.utc)
BODY = (Path(__file__).parent / 'fixtures/nvidia-buyback-scoped-20260928.txt').read_text()
BODY_AT = '2026-10-04T00:30:00.000+00:00'
OBSERVED = '2026-09-28T11:05:29.215+00:00'


class ReviewedRetainedAnnouncementTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'test.sqlite'
        with research.connect(self.path) as db:
            monitor.add_source(db, 'NVDA', source.URL, '2026-09-28', source.TITLE)
            db.execute('''UPDATE sources SET sha256='validated-raw-source',content_type='text/html',
              extractor_version=?,extracted_text=?,extracted_chars=?,checked_at=?,fetched_at=?''',
                       (monitor.HTML_EXTRACTOR_VERSION, BODY, len(BODY), BODY_AT, OBSERVED))
            db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)', (source.URL, 'NVDA', OBSERVED))
            db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',
                       (source.URL, 'validated-raw-source', BODY_AT, BODY, len(BODY)))
            signals.public_official_updates(db, reference=NOW)

    def publish(self):
        with research.connect(self.path) as db:
            return recovery.publish_retained(db, NOW, research.validate)

    def test_reviewed_copy_is_current_body_bound_and_no_model_is_called(self):
        with research.connect(self.path) as db:
            before = {t: [tuple(r) for r in db.execute('SELECT * FROM ' + t)]
                      for t in ('sources','source_revisions','signal_events','release_events',
                                'official_research_jobs','signal_headline_translation_calls')}
        self.assertEqual(research.run_once(self.path, lambda *_: self.fail('paid model call'), {}, NOW.timestamp()), 'done')
        self.assertFalse(self.publish())
        with research.connect(self.path) as db:
            self.assertEqual(before, {t: [tuple(r) for r in db.execute('SELECT * FROM ' + t)] for t in before})
            saved = db.execute('SELECT * FROM official_research_publications').fetchone()
            audit = db.execute('SELECT * FROM reviewed_retained_announcement_recoveries').fetchone()
            self.assertEqual(audit['source_observed_at'], OBSERVED)
            self.assertEqual(audit['source_body_at'], BODY_AT)
            self.assertEqual(saved['started_at'], audit['started_at'])
            self.assertEqual(saved['public_at'], audit['public_at'])
            self.assertGreater(saved['public_at'], BODY_AT)
            self.assertEqual(audit['body_text_sha'], hashlib.sha256(BODY.encode()).hexdigest())
            item = signals.public_official_updates(db, reference=NOW)[0]
            self.assertEqual(item['publishedOn'], '2026-09-28')
            self.assertEqual(item['observedAt'], datetime.fromisoformat(OBSERVED).isoformat())
            self.assertIn('1500億ドル', item['bodyJa'])
            self.assertIn('2350億ドル', item['bodyJa'])
            self.assertIn('2028会計年度', item['bodyJa'])
            self.assertIn('expects', item['bodyEn'])
            self.assertNotIn('evidenceQuote', json.dumps(item))
            self.assertNotIn('新たに10月3日', item['bodyJa'])
            self.assertNotIn('“NVIDIA’s growth', json.dumps(item))
        self.assertEqual(research.run_once(self.path, lambda *_: self.fail('paid model call'), {}, NOW.timestamp()), 'disabled')

    def test_legacy_xml_wrong_identity_date_history_or_changed_body_never_publishes(self):
        changes = [
            ("UPDATE sources SET content_type='text/xml'", ()),
            ("UPDATE sources SET extractor_version='old'", ()),
            ("UPDATE sources SET error='http-403'", ()),
            ("UPDATE sources SET status='held'", ()),
            ("UPDATE sources SET title='Unrelated title'", ()),
            ("UPDATE sources SET published_on='2026-10-03'", ()),
            ("UPDATE signal_events SET observed_at='2026-10-03T12:00:00+00:00'", ()),
            ("UPDATE source_revisions SET extracted_text=?", (BODY.replace('$150', '$151'),)),
            ("UPDATE source_revisions SET observed_at='2026-10-05T00:00:00+00:00'", ()),
        ]
        for sql, params in changes:
            with self.subTest(sql=sql), research.connect(self.path) as db:
                db.execute('SAVEPOINT change')
                db.execute(sql, params)
                manifest = json.loads(recovery.RETAINED_COPY_PATH.read_text())
                self.assertIsNone(recovery.retained_candidate(db, manifest['announcements'][0], NOW))
                db.execute('ROLLBACK TO change')
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 0)

    def test_expired_changed_copy_conflicting_cache_or_publication_stays_untouched(self):
        with research.connect(self.path) as db:
            self.assertFalse(recovery.publish_retained(db, datetime(2026, 10, 5, tzinfo=timezone.utc), research.validate))
            with patch.object(recovery, 'RETAINED_COPY_SHA', 'different'):
                self.assertFalse(recovery.publish_retained(db, NOW, research.validate))
            row = db.execute('SELECT * FROM signal_events').fetchone()
            db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,?)',
                       (row['id'], row['sha'], 'otherbody', 'different evidence', BODY_AT, 0, None))
            db.commit()
            self.assertFalse(recovery.publish_retained(db, NOW, research.validate))
            self.assertEqual(db.execute('SELECT body FROM official_story_bodies').fetchone()[0], 'different evidence')

    def test_current_revision_change_hides_recovered_copy(self):
        self.assertTrue(self.publish())
        with research.connect(self.path) as db:
            row = research.candidates(db, NOW)[0]
            self.assertIn('bodyJa', research.public_story_body(db, row))
            db.execute("UPDATE sources SET sha256='different-current-source'")
            self.assertFalse(research.current_revision(db, row))
            self.assertEqual(research.public_story_body(db, row), {})


if __name__ == '__main__':
    unittest.main()
