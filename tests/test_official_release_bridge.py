import json
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import headline_translation as translation
import signals
from test_headline_translation import ENV, response

NOW = datetime(2026, 10, 1, 12, 40, tzinfo=timezone.utc)
URL = 'https://nebius.com/newsroom/nebius-acquires-inferize-to-strengthen-nebius-token-factorys-production-inference-stack'
TITLE = "Nebius acquires Inferize to strengthen Nebius Token Factory’s production inference stack"


class PrimaryReleasePublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'monitor.sqlite'
        with translation.connect(self.path) as db:
            db.execute('''INSERT INTO sources(url,ticker,title,published_on,discovered_at,sha256)
              VALUES(?,?,?,?,?,?)''', (URL, 'NBIS', TITLE, '2026-10-01', '2026-10-01T11:00:29+00:00', 'body-v1'))
            db.execute('''INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)''',
                       (URL, 'NBIS', '2026-10-01T11:00:29+00:00'))
            db.execute('''INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars)
              VALUES(?,?,?,?,?)''', (URL, 'body-v1', '2026-10-01T11:00:41+00:00', 'PRIVATE BODY', 12))

    def feed(self):
        with translation.connect(self.path) as db:
            return signals.public_official_updates(db, reference=NOW)

    def test_detected_fetched_release_reaches_translation_and_public_feed(self):
        before = self.feed()
        self.assertEqual(len(before), 1)
        self.assertEqual(before[0]['url'], URL)
        self.assertEqual(before[0]['publishedOn'], '2026-10-01')
        self.assertNotIn('publishedAt', before[0])
        with translation.connect(self.path) as db:
            diagnosis = translation.diagnostics(db, env=ENV, now=NOW.timestamp())
            self.assertEqual(diagnosis['pending'], 1)
        self.assertEqual(translation.run_once(self.path, response, ENV, now=NOW.timestamp()), 'done')
        after = self.feed()
        self.assertIn('translationJa', after[0])
        self.assertNotIn('PRIVATE', json.dumps(after))
        self.assertEqual(after[0]['id'], before[0]['id'])
        self.assertEqual(translation.run_once(self.path, lambda *_: self.fail('duplicate translation'),
                                             ENV, now=NOW.timestamp()+1), 'idle')

    def test_stalled_queue_records_incident_and_translation_resolves_it(self):
        with translation.connect(self.path) as db:
            self.assertEqual(translation.sync_incident(db, ENV, NOW.timestamp()),
                             'headline-translation-overdue')
            self.assertEqual(db.execute("SELECT status FROM operational_incidents WHERE incident_key='publication:headlines'").fetchone()[0], 'open')
        self.assertEqual(translation.run_once(self.path, response, ENV, now=NOW.timestamp()), 'done')
        with translation.connect(self.path) as db:
            self.assertIsNone(translation.sync_incident(db, ENV, NOW.timestamp()+1))
            self.assertEqual(db.execute("SELECT status FROM operational_incidents WHERE incident_key='publication:headlines'").fetchone()[0], 'resolved')

    def test_body_revision_change_during_translation_cannot_publish_old_translation(self):
        def revise(payload, key):
            with translation.connect(self.path) as db:
                db.execute("UPDATE sources SET sha256='body-v2' WHERE url=?", (URL,))
            return response(payload, key)
        self.assertEqual(translation.run_once(self.path, revise, ENV, now=NOW.timestamp()), 'stale')
        self.assertEqual(self.feed(), [])

    def test_unfetched_old_and_promotion_never_publish(self):
        self.assertEqual(len(self.feed()), 1)
        for field, value in [('sha256', 'unfetched'), ('published_on', '2026-09-01'),
                             ('title', 'Register today for our free course'), ('status', 'rejected'), ('status', 'held')]:
            with self.subTest(field=field):
                with translation.connect(self.path) as db:
                    original = db.execute(f'SELECT {field} FROM sources').fetchone()[0]
                    db.execute(f'UPDATE sources SET {field}=?', (value,))
                self.assertEqual(self.feed(), [])
                with translation.connect(self.path) as db:
                    db.execute(f'UPDATE sources SET {field}=?', (original,))

    def test_translation_covers_more_than_homepage_twenty_items(self):
        with translation.connect(self.path) as db:
            for i in range(25):
                db.execute('''INSERT INTO signal_events(source_id,url,sha,previous_sha,title,
                  tickers_json,matches_json,event_kind,published_on,observed_at,excerpt,diff,truncated)
                  VALUES('nebius-blog',?,?,'',?,'["NBIS"]','{}','new','2026-10-01',?,'','',0)''',
                           (f'https://nebius.com/blog/release-{i}', str(i), f'New cloud platform {i}', NOW.isoformat()))
            diagnosis = translation.diagnostics(db, env=ENV, now=NOW.timestamp())
            self.assertEqual(diagnosis['eligible'], 26)
        self.assertEqual(len(self.feed()), 20)


if __name__ == '__main__':
    unittest.main()
