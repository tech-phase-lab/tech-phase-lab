"""Synthetic-only coverage for request-local saved primary copy projection."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import official_research as research
from test_official_research import BODY, NOTE, TITLE

NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)


class OfficialNewsProjectionTests(unittest.TestCase):
    def setUp(self):
        import service  # Discovery replaces signals; resolve service at execution.
        self.service = service
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'projection.sqlite'
        self.app = object.__new__(service.AutomaticMonitor)
        self.app.db_path = self.path
        with research.connect(self.path) as db:
            for index in range(25):
                url = f'https://nebius.com/newsroom/synthetic-acquisition-{index}'
                stamp = (NOW - timedelta(minutes=30)).isoformat()
                digest = f'synthetic-body-{index}'
                db.execute('''INSERT INTO sources(url,ticker,title,published_on,discovered_at,sha256,source_mode)
                    VALUES(?,?,?,?,?,?,?)''', (url, 'NBIS', TITLE, '2026-10-04', stamp, digest, 'inline'))
                db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)', (url, 'NBIS', stamp))
                db.execute('''INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars)
                    VALUES(?,?,?,?,?)''', (url, digest, stamp, BODY, len(BODY)))
            self.rows = research.candidates(db, NOW, primary_only=True)
            for row in self.rows:
                stamp = (NOW - timedelta(seconds=30 - row['id'])).isoformat()
                db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                           (row['id'], row['sha'], row['body_sha'], json.dumps(NOTE), '[]', stamp, stamp, 1))
        self.older = min(self.rows, key=lambda row: row['id'])

    def public(self):
        with patch.object(self.service, 'datetime', wraps=datetime) as clock:
            clock.now.return_value = NOW
            return self.app.public_news()

    def test_inline_bodies_beyond_research_cap_are_projected_exactly(self):
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM official_story_bodies').fetchone()[0], 0)
            self.assertEqual(len(research.validated_publications(db, self.rows)), 25)
            self.assertEqual(research.public_story_body(db, self.older), {})
        result = self.public()
        self.assertEqual(len(result['officialResearch']), 20)
        self.assertNotIn('ir-result-' + str(self.older['id']), {item['id'] for item in result['officialResearch']})
        self.assertEqual(len(result['officialUpdates']), 25)
        for item in result['officialUpdates']:
            for key, language in [('bodyJa', 'ja'), ('bodyEn', 'en')]:
                expected = '\n\n'.join(dict.fromkeys([NOTE['summary'][language], *[fact[language] for fact in NOTE['facts']]]))
                self.assertEqual(item.get(key), expected)
                self.assertNotIn(NOTE['purpose'][language], item[key])
        self.assertNotIn('evidenceQuote', json.dumps(result['officialUpdates']))
        self.assertNotIn('Company announcement background', json.dumps(result))

    def test_changed_or_removed_saved_copy_is_not_reused_on_later_reads(self):
        self.assertTrue(next(item for item in self.public()['officialUpdates'] if item['id'] == str(self.older['id'])).get('bodyJa'))
        cases = [
            ("UPDATE official_research_publications SET body_sha='wrong-body' WHERE event_id=?", False),
            ("UPDATE official_research_publications SET sha='wrong-source' WHERE event_id=?", False),
            ('DELETE FROM official_research_publications WHERE event_id=?', False),
            ("UPDATE sources SET status='held' WHERE url=?", True),
            ("UPDATE sources SET status='rejected' WHERE url=?", True),
            ("UPDATE sources SET sha256='withdrawn' WHERE url=?", True),
            ("UPDATE sources SET title='Nebius announces a new platform' WHERE url=?", True),
            ("UPDATE sources SET published_on='2026-10-03' WHERE url=?", True),
        ]
        snapshot = sqlite3.connect(':memory:')
        self.addCleanup(snapshot.close)
        with research.connect(self.path) as db:
            db.backup(snapshot)
        for sql, source_change in cases:
            with self.subTest(sql=sql):
                # Each case gets the same fully initialized synthetic database.
                with research.connect(self.path) as db:
                    db.execute(sql, (self.older['url'] if source_change else self.older['id'],))
                result = self.public()
                matching = [item for item in result['officialUpdates'] if item['url'] == self.older['url']]
                self.assertTrue(all('bodyJa' not in item and 'bodyEn' not in item for item in matching))
                with research.connect(self.path) as db:
                    snapshot.backup(db)

    def test_invalid_current_payload_and_body_stay_headline_only(self):
        for change in ['payload', 'body']:
            with self.subTest(change=change), research.connect(self.path) as db:
                if change == 'payload':
                    bad = deepcopy(NOTE)
                    bad['facts'][0]['en'] += ' Revenue was $999 billion.'
                    db.execute('UPDATE official_research_publications SET payload=? WHERE event_id=?',
                               (json.dumps(bad), self.older['id']))
                else:
                    db.execute('UPDATE official_research_publications SET payload=? WHERE event_id=?',
                               (json.dumps(NOTE), self.older['id']))
                    db.execute('UPDATE source_revisions SET extracted_text=? WHERE url=?',
                               ('Different synthetic content with no saved evidence. ' * 50, self.older['url']))
            matching = next(item for item in self.public()['officialUpdates'] if item['id'] == str(self.older['id']))
            self.assertNotIn('bodyJa', matching)
            self.assertNotIn('bodyEn', matching)

    def test_only_approved_bodies_change_full_public_payload(self):
        def previous_projection(db, reference, published):
            return {'officialUpdates': published,
                    'officialResearch': self.service.official_research.feed(db, reference, published_updates=published)}
        with patch.object(self.service.official_research, 'news_projection', side_effect=previous_projection):
            before = self.public()
        after = self.public()
        stripped = deepcopy(after)
        for item in stripped['officialUpdates']:
            item.pop('bodyJa', None)
            item.pop('bodyEn', None)
        self.assertEqual(stripped, before)
        self.assertEqual(after['officialHistory'], before['officialHistory'])
        self.assertEqual(after['officialResearch'], before['officialResearch'])

    def test_cached_body_other_lanes_unknown_body_and_identity_mismatch_are_unchanged(self):
        with research.connect(self.path) as db:
            row = self.rows[0]
            db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,?)',
                       (row['id'], row['sha'], row['body_sha'], row['body'], row['body_at'], 0, None))
            published = research.signals.public_official_updates(db, reference=NOW, limit=500)
            cached = next(item for item in published if item['id'] == str(row['id']))
            self.assertIn('bodyJa', cached)
            sentinels = [
                {'id': '9001', 'tickers': ['NBIS'], 'url': 'https://x.com/wallstengine/status/1',
                 'generalSource': 1, 'bodyJa': '一般の検証済み本文', 'bodyEn': 'Approved general copy'},
                {'id': '9002', 'tickers': ['NBIS'], 'url': 'https://example.com/issuer',
                 'syndication': {'policy': 'issuer-business-news-v1'}, 'bodyJa': '発表本文', 'bodyEn': 'Issuer copy'},
                {'id': '9003', 'tickers': ['NBIS'], 'url': 'https://x.com/tipranks/status/1',
                 'bodyJa': '自社株買いの本文', 'bodyEn': 'Buyback copy'},
                {'id': '9004', 'tickers': ['NBIS'], 'url': 'https://nebius.com/newsroom/unknown-body', 'title': 'Unknown body'},
                {**published[-1], 'id': '9005'},
                {**published[-1], 'url': 'https://nebius.com/newsroom/mismatched-url'},
            ]
            result = research.news_projection(db, NOW, published + sentinels)
            self.assertEqual(result['officialUpdates'][-len(sentinels):], sentinels)
            self.assertEqual(next(item for item in result['officialUpdates'] if item['id'] == str(row['id'])), cached)
            self.assertNotIn('bodyJa', published[-1])

    def test_single_validation_pass_and_identical_query_work(self):
        with research.connect(self.path) as db:
            published = research.signals.public_official_updates(db, reference=NOW, limit=500)
            before, after = [], []
            db.set_trace_callback(before.append)
            expected = research.feed(db, NOW, published_updates=published)
            db.set_trace_callback(after.append)
            with patch.object(research, 'validate_row', wraps=research.validate_row) as validate, \
                 patch.object(research, 'candidates', wraps=research.candidates) as candidates, \
                 patch.object(research, 'validated_publications', wraps=research.validated_publications) as publications, \
                 patch.object(research.signals, 'public_official_updates', side_effect=AssertionError('duplicate headline scan')):
                result = research.news_projection(db, NOW, published)
            db.set_trace_callback(None)
            self.assertEqual(result['officialResearch'], expected)
            self.assertEqual(validate.call_count, 25)
            self.assertEqual(candidates.call_count, 1)
            self.assertEqual(publications.call_count, 1)
            self.assertEqual(after, before)

    def test_existing_publication_clock_gate_applies_before_body_projection(self):
        current_clock = self.service.official_research.publication_clock_valid
        def clock_gate(saved, row, reference):
            return row['id'] != self.older['id'] and current_clock(saved, row, reference)
        with patch.object(self.service.official_research, 'publication_clock_valid', side_effect=clock_gate) as clocks:
            result = self.public()
        self.assertEqual(clocks.call_count, 25)
        older = next(item for item in result['officialUpdates'] if item['id'] == str(self.older['id']))
        self.assertNotIn('bodyJa', older)
        self.assertNotIn('bodyEn', older)


if __name__ == '__main__':
    unittest.main()
