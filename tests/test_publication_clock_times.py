"""Issuer releases keep the publisher's stated clock time beside its date (owner, Nov 26).

Rows of the 速報 page from date-only sources showed no time at all. The monitor
now keeps a feed's or article's stated instant; placeholders (local midnight, a
time with no zone) are never promoted to a publication time.
"""
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor
import signals

URL = 'https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/'
TITLE = 'Gemini 4 Argon: our next era of frontier intelligence'
NOW = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
OBSERVED = '2026-09-30T20:04:00.000+00:00'
BODY = ('<html><head>{meta}</head><body><main><p>Google announced a synthetic model update. '
        'This is test evidence for the existing publication checks.</p></main></body></html>')


def rss(date):
    return (f'<rss><channel><item><title>{TITLE}</title><link>{URL}</link>'
            f'<pubDate>{date}</pubDate></item></channel></rss>').encode()


class FeedClockTimeTests(unittest.TestCase):
    def test_zoned_feed_time_is_kept_in_utc(self):
        self.assertEqual(monitor.feed_links(rss('Tue, 24 Nov 2026 19:30:00 +0000'), 'GOOGL')[URL],
                         {'title': TITLE, 'publishedOn': '2026-11-24', 'publishedAt': '2026-11-24T19:30:00+00:00'})
        self.assertEqual(monitor.feed_links(rss('Tue, 24 Nov 26 16:05:00 -0500'), 'GOOGL')[URL]['publishedAt'],
                         '2026-11-24T21:05:00+00:00')

    def test_midnight_placeholder_and_zoneless_times_stay_date_only(self):
        for stamp in ('Mon, 23 Nov 2026 00:00:00 -0500', 'Tue, 17 Nov 2026 13:15:00', 'Tue, 24 Nov 2026'):
            with self.subTest(stamp=stamp):
                detail = monitor.feed_links(rss(stamp), 'GOOGL')[URL]
                self.assertNotIn('publishedAt', detail)

    def test_iso_time_helpers(self):
        self.assertEqual(monitor.original_publication_time('2026-10-01T09:00:00-07:00'), '2026-10-01T16:00:00+00:00')
        self.assertEqual(monitor.original_publication_time('2026-09-08T13:20:43+0200'), '2026-09-08T11:20:43+00:00')
        for value in ('2026-10-01', '2026-10-01T09:00:00', '2026-10-01T00:00:00Z', '2026-10-01T09:00:00+24:00', None, 7):
            with self.subTest(value=value):
                self.assertIsNone(monitor.original_publication_time(value))
        self.assertEqual(monitor.consistent_publication_time('2026-10-02T03:00:00+00:00', '2026-10-01'),
                         '2026-10-02T03:00:00+00:00')
        self.assertIsNone(monitor.consistent_publication_time('2026-10-05T03:00:00+00:00', '2026-10-01'))

    def test_taiwan_announcement_time(self):
        self.assertEqual(monitor.taiwan_publication_time('2026-10-15', '152138'), '2026-10-15T07:21:38+00:00')
        self.assertEqual(monitor.taiwan_publication_time('2026-10-15', '93005'), '2026-10-15T01:30:05+00:00')
        self.assertIsNone(monitor.taiwan_publication_time('2026-10-15', '256000'))
        self.assertIsNone(monitor.taiwan_publication_time('2026-10-15', ''))

    def test_cached_candidates_accept_only_a_normalized_time(self):
        good = {URL: {'title': TITLE, 'publishedOn': '2026-09-30', 'publishedAt': '2026-09-30T20:00:00+00:00'}}
        self.assertEqual(monitor.normalized_discovery_candidates('GOOGL', good), good)
        for bad in ('2026-09-30T13:00:00-07:00', '2026-09-30', 'yesterday'):
            with self.subTest(bad=bad):
                self.assertIsNone(monitor.normalized_discovery_candidates(
                    'GOOGL', {URL: {'title': TITLE, 'publishedOn': '2026-09-30', 'publishedAt': bad}}))


class StoredClockTimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = monitor.connect(Path(self.tmp.name) / 'monitor.sqlite')
        self.addCleanup(self.db.close)

    def row(self):
        return self.db.execute('SELECT * FROM sources WHERE url=?', (URL,)).fetchone()

    def discover(self, stamp):
        result, links = monitor.collect_discovery('GOOGL', lambda *_: (rss(stamp), 'text/xml'))
        with patch.object(monitor, 'now', return_value=OBSERVED):
            new = monitor.save_discovery(self.db, 'GOOGL', result, links)
            monitor.add_release_events(self.db, 'GOOGL', new)

    def fetch(self, meta=''):
        with patch.object(monitor, 'now', return_value=OBSERVED):
            monitor.check_source(self.db, self.row(), lambda *_: (BODY.format(meta=meta).encode(), 'text/html'))

    def test_already_listed_release_gets_its_feed_time_on_the_next_poll(self):
        # Stored before this change: date only, already projected to the public list.
        monitor.add_source(self.db, 'GOOGL', URL, '2026-09-30', TITLE)
        with patch.object(monitor, 'now', return_value=OBSERVED):
            monitor.add_release_events(self.db, 'GOOGL', [URL])
        self.fetch()
        before = signals.public_official_updates(self.db, reference=NOW)
        self.db.commit()
        self.assertEqual(before[0]['publishedOn'], '2026-09-30')
        self.assertNotIn('publishedAt', before[0])
        # The feed still lists it, now read with its clock time.
        monitor.add_source(self.db, 'GOOGL', URL, '2026-09-30', TITLE, published_at='2026-09-30T20:00:00+00:00')
        after = signals.public_official_updates(self.db, reference=NOW)
        self.assertEqual(len(after), 1)
        self.assertEqual(after[0]['id'], before[0]['id'], 'the same row gains a time; no duplicate is listed')
        self.assertEqual(after[0]['publishedAt'], '2026-09-30T20:00:00+00:00')
        self.assertEqual(after[0]['publishedOn'], '2026-09-30')
        # A later listing never moves a stored time.
        monitor.add_source(self.db, 'GOOGL', URL, '2026-09-30', TITLE, published_at='2026-09-30T23:00:00+00:00')
        self.assertEqual(self.row()['published_at'], '2026-09-30T20:00:00+00:00')

    def test_feed_time_flows_from_discovery_to_the_public_list(self):
        self.discover('Wed, 30 Sep 2026 20:00:00 GMT')
        self.assertEqual(self.row()['published_at'], '2026-09-30T20:00:00+00:00')
        self.fetch()
        feed = signals.public_official_updates(self.db, reference=NOW)
        self.assertEqual(feed[0]['publishedAt'], '2026-09-30T20:00:00+00:00')

    def test_article_metadata_supplies_a_missing_time(self):
        self.discover('Wed, 30 Sep 2026 00:00:00 -0700')
        self.assertIsNone(self.row()['published_at'])
        self.fetch('<meta property="article:published_time" content="2026-09-30T13:00:00-07:00">')
        self.assertEqual(self.row()['published_at'], '2026-09-30T20:00:00+00:00')
        self.assertEqual(signals.public_official_updates(self.db, reference=NOW)[0]['publishedAt'],
                         '2026-09-30T20:00:00+00:00')

    def test_article_time_on_another_day_or_in_the_future_is_ignored(self):
        self.discover('Wed, 30 Sep 2026 00:00:00 -0700')
        for meta in ('<meta property="article:published_time" content="2026-10-03T13:00:00-07:00">',
                     '<meta property="article:published_time" content="2026-09-30">'):
            with self.subTest(meta=meta):
                self.fetch(meta)
                self.assertIsNone(self.row()['published_at'])
        feed = signals.public_official_updates(self.db, reference=NOW)
        self.assertNotIn('publishedAt', feed[0])
        self.assertEqual(feed[0]['publishedOn'], '2026-09-30')
        self.assertNotIn('test evidence', json.dumps(feed))


if __name__ == '__main__':
    unittest.main()
