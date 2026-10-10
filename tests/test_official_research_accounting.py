"""Publication accounting must not inherit the public feed's display limits."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import official_research as research
from test_headline_translation import ENV
from test_official_research import BODY, NOTE, TITLE
from test_news_story_bodies import BODY as STORY_BODY, NOTE as STORY_NOTE, SOURCE as STORY_SOURCE


NOW = datetime(2026, 10, 3, 2, 0, tzinfo=timezone.utc)
OBSERVED = (NOW - timedelta(minutes=10)).isoformat()


class FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)


class PublicationAccountingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'accounting.sqlite'
        for obj, name in ((research.signals, 'fetch'),
                          (research.brief_generator, 'request_response'),
                          (research, 'prepare_story_body')):
            mocked = patch.object(obj, name, side_effect=AssertionError('unexpected external call'))
            mocked.start()
            self.addCleanup(mocked.stop)
        clock = patch.object(research, 'datetime', FixedDatetime)
        clock.start()
        self.addCleanup(clock.stop)

    def add_primary(self, db, event_id, publication='valid'):
        url = f'https://nebius.com/newsroom/offline-accounting-{event_id}'
        body_sha = f'offline-body-{event_id}'
        sha = research.bridge.revision(TITLE, body_sha, '2026-10-01')
        db.execute('''INSERT INTO sources(url,ticker,title,published_on,discovered_at,checked_at,sha256)
          VALUES(?,'NBIS',?,'2026-10-01',?,?,?)''', (url, TITLE, OBSERVED, OBSERVED, body_sha))
        db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',
                   (url, 'NBIS', OBSERVED))
        db.execute('''INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars)
          VALUES(?,?,?,?,?)''', (url, body_sha, OBSERVED, BODY, len(BODY)))
        db.execute('''INSERT INTO signal_events(id,source_id,url,sha,previous_sha,title,tickers_json,
          matches_json,event_kind,published_on,observed_at,excerpt,diff,truncated)
          VALUES(?,'primary-ir-NBIS',?,?,'',?,'["NBIS"]','{}','new','2026-10-01',?,'','',0)''',
                   (event_id, url, sha, TITLE, OBSERVED))
        db.execute('''INSERT INTO official_research_jobs
          VALUES(?,?,1,0,?,'done',NULL)''', (event_id, sha, f'offline-{event_id}'))
        if publication == 'missing':
            return
        note = json.loads(json.dumps(NOTE))
        if publication == 'invalid':
            note['facts'][0]['en'] = 'Revenue was 99999 billion.'
        payload = {'malformed': '{', 'non-object': '[]'}.get(publication, json.dumps(note))
        public_at = (NOW - timedelta(minutes=1) + timedelta(milliseconds=event_id)).isoformat()
        db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                   (event_id, 'old-revision' if publication == 'stale' else sha, body_sha,
                    payload, '[]', OBSERVED, public_at, 10))

    def add_story(self, db):
        url = 'https://developer.nvidia.com/blog/announcing-a-new-platform/'
        item = {'url': url, 'title': 'NVIDIA announces a new developer platform',
                'text': 'Short feed introduction only.', 'matches': {'NVDA': ['publisher-company']},
                'publishedAt': OBSERVED, 'truncated': False}
        research.signals.save(db, STORY_SOURCE, [item], {}, OBSERVED, 'synthetic', 1)
        event = db.execute('SELECT * FROM signal_events WHERE url=?', (url,)).fetchone()
        body_sha = hashlib.sha256(STORY_BODY.encode()).hexdigest()
        db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,NULL)',
                   (event['id'], event['sha'], body_sha, STORY_BODY, OBSERVED, NOW.timestamp() + 900))
        db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                   (event['id'], event['sha'], body_sha, json.dumps(STORY_NOTE), '[]',
                    OBSERVED, NOW.isoformat(), 10))
        return event['id']

    def assert_accounting(self, db, published, pending, public_count):
        diagnostics = research.diagnostics(db)
        self.assertEqual((diagnostics['published'], diagnostics['pending']), (published, pending))
        feed = research.feed(db, NOW)
        self.assertEqual(len(feed), public_count)
        self.assertLessEqual(len(diagnostics['latest']), 5)
        self.assertNotIn('evidenceQuote', json.dumps(feed))
        self.assertNotIn('Company announcement background', json.dumps(feed))
        self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)
        return feed

    def test_complete_publications_resolve_overdue_with_public_twenty_cap(self):
        for count in (22, 35):
            with self.subTest(count=count):
                path = Path(self.tmp.name) / f'all-{count}.sqlite'
                with research.connect(path) as db:
                    for event_id in range(1, count + 1):
                        self.add_primary(db, event_id)
                    research.monitor.record_operational_incident(
                        db, 'publication:official-research', 'publication', 'official-research',
                        'critical', 'official-research-overdue', seen_at=OBSERVED)
                    feed = self.assert_accounting(db, count, 0, 20)
                    self.assertEqual([item['id'] for item in feed],
                                     [f'ir-result-{event_id}' for event_id in range(count, count - 20, -1)])
                    self.assertIsNone(research.sync_incident(db, ENV, NOW))
                    incident = db.execute("SELECT status FROM operational_incidents WHERE incident_key='publication:official-research'").fetchone()
                    self.assertEqual(incident['status'], 'resolved')

    def test_invalid_recent_rows_do_not_hide_older_valid_publications(self):
        with research.connect(self.path) as db:
            for event_id in range(1, 23):
                self.add_primary(db, event_id)
            invalid_types = ('invalid', 'stale', 'malformed', 'non-object')
            for event_id in range(23, 54):
                self.add_primary(db, event_id, invalid_types[event_id % len(invalid_types)])
            feed = self.assert_accounting(db, 22, 31, 20)
            self.assertEqual(feed[0]['id'], 'ir-result-22')
            self.assertEqual(feed[-1]['id'], 'ir-result-3')
            self.assertEqual(research.sync_incident(db, ENV, NOW), 'official-research-overdue')

    def test_genuinely_missing_publication_remains_pending(self):
        with research.connect(self.path) as db:
            for event_id in range(1, 23):
                self.add_primary(db, event_id)
            self.add_primary(db, 23, 'missing')
            self.assert_accounting(db, 22, 1, 20)
            self.assertEqual(research.sync_incident(db, ENV, NOW), 'official-research-overdue')

    def test_current_non_primary_story_counts_without_expanding_primary_feed(self):
        with research.connect(self.path) as db:
            for event_id in range(1, 23):
                self.add_primary(db, event_id)
            story_id = self.add_story(db)
            self.assert_accounting(db, 23, 0, 20)
            story = next(row for row in research.candidates(db, NOW) if row['id'] == story_id)
            self.assertTrue(research.public_story_body(db, story))
            self.assertIsNone(research.sync_incident(db, ENV, NOW))
            db.execute("UPDATE official_research_publications SET body_sha='stale-body' WHERE event_id=?", (story_id,))
            self.assert_accounting(db, 22, 1, 20)
            self.assertFalse(research.public_story_body(db, story))
            self.assertEqual(research.sync_incident(db, ENV, NOW), 'official-research-overdue')


if __name__ == '__main__':
    unittest.main()
