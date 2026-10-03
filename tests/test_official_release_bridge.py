import json
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import headline_translation as translation
import official_release_bridge as bridge
import signals
from test_headline_translation import ENV, response

NOW = datetime(2026, 10, 1, 12, 40, tzinfo=timezone.utc)
URL = 'https://nebius.com/newsroom/nebius-acquires-inferize-to-strengthen-nebius-token-factorys-production-inference-stack'
TITLE = "Nebius acquires Inferize to strengthen Nebius Token Factory’s production inference stack"
VRT_URL = ('https://investors.vertiv.com/news/news-details/2026/'
           'Vertiv-Reports-Strong-Second-Quarter-2026-with-Diluted-EPS-Growth-of-53-'
           'Adjusted-Diluted-EPS-Growth-of-60-Raises-Full-Year-2026-Guidance-Across-All-Key-Metrics/default.aspx')
VRT_TITLE = 'Vertiv second-quarter results'
# Observed issuer dateline with synthetic surrounding prose. This retained-text
# fixture does not reproduce the article or presume an unverified DOM selector.
VRT_BODY = ('Synthetic quarterly-results fixture\n'
            'COLUMBUS, Ohio, July 29, 2026 /PRNewswire/ -- Vertiv Holdings Co (NYSE: VRT) '
            'announced quarterly financial results in this synthetic test paragraph.\n'
            'The synthetic fixture contains no additional publication date.')


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

    def test_new_release_with_unknown_publication_date_keeps_detection_time(self):
        with translation.connect(self.path) as db:
            db.execute('UPDATE sources SET published_on=NULL')
        items = self.feed()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['observedAt'], '2026-10-01T11:00:29+00:00')
        self.assertNotIn('publishedOn', items[0])
        self.assertNotIn('publishedAt', items[0])
        self.assertEqual(translation.run_once(self.path, response, ENV, now=NOW.timestamp()), 'done')
        self.assertIn('translationJa', self.feed()[0])

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
                             ('title', 'Register today for our free course'), ('title', 'Read story'), ('status', 'rejected'), ('status', 'held')]:
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


class VertivRetainedPublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'monitor.sqlite'
        self.reference = datetime(2026, 10, 3, tzinfo=timezone.utc)
        with translation.connect(self.path) as db:
            db.execute('''INSERT INTO sources(url,ticker,title,published_on,discovered_at,
              checked_at,fetched_at,sha256,body_sha256,extracted_text)
              VALUES(?,?,?,NULL,?,?,?,?,?,?)''',
                       (VRT_URL, 'VRT', VRT_TITLE, '2026-09-29T09:00:00+00:00',
                        '2026-10-02T12:00:00+00:00', '2026-09-29T09:00:41+00:00',
                        'vrt-body-v1', 'vrt-text-v1', VRT_BODY))
            db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',
                       (VRT_URL, 'VRT', '2026-09-29T09:00:29+00:00'))
            db.execute('''INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars)
              VALUES(?,?,?,?,?)''',
                       (VRT_URL, 'vrt-body-v1', '2026-09-29T09:00:41+00:00', VRT_BODY, len(VRT_BODY)))

    def feed(self, *, read_only=False):
        with translation.connect(self.path) as db:
            return signals.public_official_updates(db, reference=self.reference, read_only=read_only)

    def source(self):
        with translation.connect(self.path) as db:
            return dict(db.execute('SELECT * FROM sources WHERE url=?', (VRT_URL,)).fetchone())

    def test_july_dateline_repairs_missing_date_and_invalidates_existing_new_projection(self):
        with patch.object(bridge, 'vertiv_retained_publication_date', return_value=None):
            before = self.feed()
        self.assertEqual(len(before), 1)
        self.assertNotIn('publishedOn', before[0])
        source_before = self.source()
        with translation.connect(self.path) as db:
            revision_before = tuple(db.execute('SELECT * FROM source_revisions').fetchone())
            detection_before = tuple(db.execute('SELECT * FROM release_events').fetchone())
        self.assertEqual(self.feed(), [])
        self.assertEqual(self.source(), {**source_before, 'published_on': '2026-07-29'})
        with translation.connect(self.path) as db:
            old_event = db.execute('SELECT * FROM signal_events').fetchone()
            self.assertFalse(bridge.is_current(db, old_event))
            self.assertEqual(tuple(db.execute('SELECT * FROM source_revisions').fetchone()), revision_before)
            self.assertEqual(tuple(db.execute('SELECT * FROM release_events').fetchone()), detection_before)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_events').fetchone()[0], 1)
        self.assertEqual(self.feed(), [])

    def test_current_issuer_dateline_still_publishes_with_original_day(self):
        body = VRT_BODY.replace('July 29, 2026', 'October 2, 2026')
        with translation.connect(self.path) as db:
            db.execute('UPDATE source_revisions SET extracted_text=?,extracted_chars=?', (body, len(body)))
        items = self.feed()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['publishedOn'], '2026-10-02')
        self.assertEqual(items[0]['observedAt'], '2026-09-29T09:00:29+00:00')
        self.assertNotIn('publishedAt', items[0])
        self.assertEqual(self.source()['published_on'], '2026-10-02')

    def test_read_only_projection_does_not_recover_or_write_date(self):
        with patch.object(bridge, 'vertiv_retained_publication_date', return_value=None):
            before = self.feed()
        self.assertEqual(self.feed(read_only=True), before)
        self.assertIsNone(self.source()['published_on'])

    def test_existing_date_is_never_replaced_by_retained_dateline(self):
        with translation.connect(self.path) as db:
            db.execute("UPDATE sources SET published_on='2026-10-01'")
        with patch.object(bridge, 'vertiv_retained_publication_date', side_effect=AssertionError('unneeded recovery')):
            self.assertEqual(self.feed()[0]['publishedOn'], '2026-10-01')
        self.assertEqual(self.source()['published_on'], '2026-10-01')

    def test_missing_current_revision_cannot_recover_from_an_old_body(self):
        with translation.connect(self.path) as db:
            db.execute("UPDATE sources SET sha256='vrt-body-v2'")
        self.assertEqual(self.feed(), [])
        self.assertIsNone(self.source()['published_on'])

    def test_exact_issuer_dateline_accepts_only_factual_spacing_and_punctuation(self):
        bodies = [VRT_BODY,
                  VRT_BODY.replace('July 29, 2026', 'July\n29,\n2026')
                          .replace('-- Vertiv Holdings Co', '—\nVertiv Holdings Co.'),
                  VRT_BODY + '\n' + VRT_BODY]
        for body in bodies:
            with self.subTest(body=body):
                self.assertEqual(bridge.vertiv_retained_publication_date('VRT', VRT_URL, body), '2026-07-29')

    def test_general_dates_malformed_conflicting_and_foreign_issuer_fail_closed(self):
        bodies = [
            'Jul 29, 2026\nVertiv Holdings Co (NYSE: VRT) reported second quarter results.',
            VRT_BODY.replace('July 29, 2026', 'July 32, 2026'),
            VRT_BODY.replace('July 29, 2026', 'February 29, 2026'),
            VRT_BODY.replace('July 29, 2026', 'Smarch 29, 2026'),
            VRT_BODY.replace('July 29, 2026', 'July 29, 2025'),
            VRT_BODY.replace('Vertiv Holdings Co', 'Other Holdings Co'),
            VRT_BODY.replace('(NYSE: VRT)', '(NYSE: XYZ)'),
            VRT_BODY.replace('-- Vertiv Holdings Co', '-- A report mentioned Vertiv Holdings Co'),
            VRT_BODY + '\n' + VRT_BODY.replace('July 29, 2026', 'September 29, 2026'),
            VRT_BODY + '\n' + VRT_BODY.replace('July 29, 2026', 'July 32, 2026'),
            VRT_BODY + '\n' + VRT_BODY.replace('Vertiv Holdings Co', 'Other Holdings Co'),
            'x' * bridge.VERTIV_DATELINE_LIMIT + '\n' + VRT_BODY,
            VRT_BODY[:VRT_BODY.index('announced quarterly')].rstrip(),
        ]
        for body in bodies:
            with self.subTest(body=body[-350:]):
                self.assertIsNone(bridge.vertiv_retained_publication_date('VRT', VRT_URL, body))

    def test_canonical_issuer_host_release_path_year_and_ticker_are_required(self):
        urls = [VRT_URL.replace('https:', 'http:'),
                VRT_URL.replace('investors.vertiv.com', 'www.vertiv.com'),
                VRT_URL.replace('investors.vertiv.com', 'investors.vertiv.com.evil.test'),
                VRT_URL.replace('investors.vertiv.com', 'investors.vertiv.com:443'),
                VRT_URL.replace('investors.vertiv.com', 'user@investors.vertiv.com'),
                VRT_URL.replace('/news-details/', '/news/'),
                VRT_URL.replace('/2026/', '/2025/'),
                VRT_URL.replace('/Vertiv-', '/Other-'),
                VRT_URL + '?related=1', VRT_URL + '#related',
                'https://[invalid/', None]
        for url in urls:
            with self.subTest(url=url):
                self.assertIsNone(bridge.vertiv_retained_publication_date('VRT', url, VRT_BODY))
        self.assertIsNone(bridge.vertiv_retained_publication_date('NBIS', VRT_URL, VRT_BODY))


if __name__ == '__main__':
    unittest.main()
