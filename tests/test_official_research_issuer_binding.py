"""Publisher ownership comes from configured source metadata, not mentions."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import official_research as research
import signals

NOW = datetime(2026, 10, 4, 8, 30, tzinfo=timezone.utc)
STAMP = '2026-10-02T10:00:00+00:00'
sha = lambda value: hashlib.sha256(value.encode('utf-8')).hexdigest()


class OfficialResearchIssuerBindingTests(unittest.TestCase):
    def setUp(self):
        # Service discovery replaces this module; lazy bridge imports must see
        # the same source configuration that this fixture temporarily patches.
        self.enterContext(patch.dict(sys.modules, {'signals': signals}))
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'issuer.sqlite'
        with research.connect(self.path):
            pass
        for owner, method in ((signals, 'fetch'), (research.brief_generator, 'request_response'),
                              (research, 'public_story_body')):
            mocked = patch.object(owner, method, side_effect=AssertionError('network/provider/body projection'))
            mocked.start()
            self.addCleanup(mocked.stop)

    def add(self, source_id='nebius-blog', *, title='Issuer announces a new training system',
            text='Nebius describes its training system. Related stories mention Google and NVIDIA.',
            url='https://nebius.com/blog/posts/synthetic-issuer-binding', event_id=84):
        source = next(source for source in signals.SOURCES if source['id'] == source_id)
        matches = signals.match_companies(title + '\n' + text, list(signals.ALIASES))
        for ticker in source.get('tickers', []):
            matches.setdefault(ticker, ['publisher-company'])
        digest = sha(title + '\n' + text)
        with research.connect(self.path) as db:
            db.execute('''INSERT INTO signal_documents VALUES(?,?,?,?,?,?,?)''',
                       (source_id, url, digest, title, text, STAMP, STAMP))
            db.execute('''INSERT INTO signal_events
              (id,source_id,url,sha,previous_sha,title,tickers_json,matches_json,event_kind,
               published_at,observed_at,excerpt,diff,truncated)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                       (event_id, source_id, url, digest, '', title, json.dumps(sorted(matches)),
                        json.dumps(matches), 'new', STAMP, STAMP, '', '', 0))
            db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,?)',
                       (event_id, digest, sha(text), text, STAMP, 0, None))
        return event_id

    def read_only(self, **kwargs):
        db = sqlite3.connect(self.path.resolve().as_uri() + '?mode=ro', uri=True)
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA query_only=ON')
            db.execute('BEGIN')
            before = db.total_changes
            result = research.candidates(db, NOW, read_only=True, **kwargs)
            self.assertEqual(db.total_changes, before)
            return result
        finally:
            db.close()

    def test_nebius_related_story_mentions_do_not_become_issuer(self):
        event_id = self.add()
        with sqlite3.connect(self.path) as db:
            original = db.execute('SELECT tickers_json,matches_json FROM signal_events').fetchone()
        self.assertEqual(json.loads(original[0]), ['GOOGL', 'NBIS', 'NVDA'])
        with patch.object(signals, 'public_official_updates', wraps=signals.public_official_updates) as projected:
            result = self.read_only()
            self.assertEqual(projected.call_count, 1)
            self.assertFalse(projected.call_args.kwargs['include_bodies'])
        self.assertEqual([(r['id'], r['ticker']) for r in result], [(event_id, 'NBIS')])
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT tickers_json,matches_json FROM signal_events').fetchone(), original)

    def test_other_configured_publisher_and_reused_projection(self):
        event_id = self.add('nvidia-developer', text='NVIDIA describes its system; related coverage mentions Google.',
                            url='https://developer.nvidia.com/blog/synthetic-binding')
        with research.connect(self.path) as db:
            published = signals.public_official_updates(db, reference=NOW, read_only=True, include_bodies=False)
        with patch.object(signals, 'public_official_updates', side_effect=AssertionError('duplicate scan')):
            result = self.read_only(published_updates=published)
        self.assertEqual([(r['id'], r['ticker']) for r in result], [(event_id, 'NVDA')])
        with research.connect(self.path) as db:
            db.execute("UPDATE signal_documents SET sha='withdrawn'")
        self.assertEqual(self.read_only(published_updates=published), [])

    def test_projection_reuse_cannot_restore_removed_issuer_match(self):
        self.add()
        with research.connect(self.path) as db:
            published = signals.public_official_updates(db, reference=NOW, read_only=True, include_bodies=False)
            db.execute('UPDATE signal_events SET tickers_json=?', ('["GOOGL"]',))
        self.assertEqual(self.read_only(published_updates=published), [])

    def test_source_without_valid_projected_owner_is_not_a_company_candidate(self):
        event_id = self.add()
        self.assertEqual(self.read_only(published_updates=[{'id': str(event_id), 'tickers': []}]), [])
        self.assertEqual(self.read_only(published_updates=[]), [])

    def test_multi_issuer_projection_keeps_its_order_and_all_source_matches(self):
        # Reuse a complete, source-authorized projection. A partial hand-built
        # ticker override for a single-issuer source is not publication proof.
        sources = [{**source, 'tickers': ['NVDA', 'NBIS']}
                   if source['id'] == 'nebius-blog' else source
                   for source in signals.SOURCES]
        with patch.object(signals, 'SOURCES', sources):
            event_id = self.add()
            with research.connect(self.path) as db:
                db.execute('UPDATE signal_events SET tickers_json=? WHERE id=?',
                           (json.dumps(['NVDA', 'GOOGL', 'NBIS']), event_id))
                projected = signals.public_official_updates(
                    db, sources=sources, reference=NOW, read_only=True,
                    include_bodies=False)
            result = self.read_only(published_updates=projected)
        self.assertEqual(result[0]['ticker'], 'NVDA')
        self.assertEqual(json.loads(result[0]['tickers_json']), ['NVDA', 'GOOGL', 'NBIS'])
        self.assertEqual(projected[0]['tickers'], ['NVDA', 'NBIS'])

    def test_expired_publication_does_not_regain_a_candidate(self):
        self.add()
        with research.connect(self.path) as db:
            db.execute("UPDATE signal_events SET published_at='2026-09-01T00:00:00+00:00'")
        self.assertEqual(self.read_only(), [])


if __name__ == '__main__':
    unittest.main()
