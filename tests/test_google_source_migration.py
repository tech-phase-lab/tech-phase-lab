"""Bounded Google official RSS migration-path discovery fixtures.

Paths and Google publication dates were observed in the official RSS feed on
October 3, 2026. Surrounding feed/body content is synthetic.
These tests make no network requests and do not invoke a generation provider.
"""
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from xml.sax.saxutils import escape

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor
import signals

OLD_GOOGLE_RULE = r'^/(?:technology|products|company-news|inside-google|outreach-initiatives|around-the-globe|feed)/.+'
GOOGLE_ITEMS = [
    ('https://blog.google/innovation-and-ai/technology/ai/google-ai-updates-september-2026/',
     'The latest AI news we announced in September 2026', 'Fri, 02 Oct 2026 15:00:00 GMT', '2026-10-02'),
    ('https://blog.google/innovation-and-ai/models-and-research/google-research/project-suncatcher-prototype/',
     'Our Project Suncatcher prototype satellite is in orbit.', 'Thu, 01 Oct 2026 23:30:00 GMT', '2026-10-01'),
    ('https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/',
     'Gemini 4 Argon: our next era of frontier intelligence', 'Wed, 30 Sep 2026 20:00:00 GMT', '2026-09-30'),
    ('https://blog.google/products-and-platforms/products/education/ai-educator-series-badge-a-thon/',
     'Synthetic Google product update', 'Thu, 01 Oct 2026 16:00:00 GMT', '2026-10-01'),
]
NOW = datetime(2026, 10, 3, 13, 36, tzinfo=timezone.utc)
OBSERVED = NOW.isoformat(timespec='milliseconds')


def rss(items):
    return ('<rss><channel>' + ''.join(
        f'<item><title>{escape(title)}</title><link>{escape(url)}</link>'
        f'<pubDate>{escape(date)}</pubDate></item>'
        for url, title, date, _ in items
    ) + '</channel></rss>').encode()


class GoogleDiscoveryMigrationTests(unittest.TestCase):
    def test_migrated_paths_and_legacy_paths_are_accepted(self):
        for url, *_ in GOOGLE_ITEMS:
            with self.subTest(url=url):
                self.assertEqual(monitor.article_url(url, 'GOOGL'), url)
        for root in ('technology', 'products', 'company-news', 'inside-google',
                     'outreach-initiatives', 'around-the-globe', 'feed'):
            url = f'https://blog.google/{root}/synthetic-legacy-release/'
            with self.subTest(root=root):
                self.assertEqual(monitor.article_url(url, 'GOOGL'), url)

    def test_migrated_paths_keep_exact_https_authority_and_path_boundaries(self):
        url = GOOGLE_ITEMS[0][0]
        invalid = [
            url.replace('https:', 'http:'),
            url.replace('blog.google', 'other.google'),
            url.replace('blog.google', 'sub.blog.google'),
            url.replace('blog.google', 'blog.google.evil.example'),
            url.replace('blog.google', 'blog.google@evil.example'),
            url.replace('blog.google', 'evil.example@blog.google'),
            url.replace('blog.google', 'blog.google:444'),
            url.replace('/innovation-and-ai/', '/innovation-and-ai-unapproved/'),
            'https://blog.google/unapproved/synthetic-release/',
            'https://blog.google/innovation-and-ai/',
            'https://blog.google/products-and-platforms/',
            'https://blog.google/innovation-and-ai',
        ]
        for candidate in invalid:
            with self.subTest(url=candidate):
                self.assertIsNone(monitor.article_url(candidate, 'GOOGL'))
        self.assertIsNone(monitor.article_url(url, 'BE'))
        self.assertEqual(monitor.article_url(url + '?utm_source=test#section', 'GOOGL'), url)
        self.assertEqual(monitor.article_url(url.replace('blog.google', 'BLOG.GOOGLE:443'), 'GOOGL'), url)

    def test_feed_parses_observed_migration_paths_and_original_dates(self):
        malicious = ('https://blog.google.evil.example/innovation-and-ai/other/',
                     'Unapproved host', 'Fri, 02 Oct 2026 15:00:00 GMT', '2026-10-02')
        links = monitor.feed_links(rss([*GOOGLE_ITEMS, malicious]), 'GOOGL')
        self.assertEqual(set(links), {item[0] for item in GOOGLE_ITEMS})
        for url, title, _, date in GOOGLE_ITEMS:
            self.assertEqual(links[url], {'title': title, 'publishedOn': date})

    def test_rule_change_invalidates_pre_migration_cache(self):
        old_provider = deepcopy(monitor.PROVIDERS['GOOGL'])
        old_provider['articleRules'][0]['pattern'] = OLD_GOOGLE_RULE
        index = old_provider['indexUrl']
        legacy_url = 'https://blog.google/technology/synthetic-legacy-release/'
        with tempfile.TemporaryDirectory() as tmp:
            with monitor.connect(Path(tmp) / 'monitor.sqlite') as db:
                with patch.dict(monitor.PROVIDERS, {'GOOGL': old_provider}):
                    old_fingerprint = monitor.discovery_cache_parser_version('GOOGL', index)
                    self.assertEqual(monitor.feed_links(rss(GOOGLE_ITEMS), 'GOOGL'), {})
                    monitor.save_discovery_source_cache(db, 'GOOGL', {
                        index: {'etag': '"old-feed"', 'lastModified': None,
                                'candidates': {legacy_url: 'Synthetic legacy release'}},
                    })
                    self.assertIn(index, monitor.load_discovery_source_cache(db, 'GOOGL'))
                self.assertNotEqual(old_fingerprint, monitor.discovery_cache_parser_version('GOOGL', index))
                cache, stats = monitor.load_discovery_source_cache(db, 'GOOGL', include_stats=True)
                self.assertEqual(cache, {})
                self.assertEqual(stats['invalidatedSources'], 1)

    def test_new_paths_still_require_body_current_revision_and_original_date(self):
        url, title, _, published_on = GOOGLE_ITEMS[2]
        with tempfile.TemporaryDirectory() as tmp:
            with monitor.connect(Path(tmp) / 'monitor.sqlite') as db:
                result, links = monitor.collect_discovery('GOOGL', lambda *_: (rss([GOOGLE_ITEMS[2]]), 'text/xml'))
                with patch.object(monitor, 'now', return_value=OBSERVED):
                    new = monitor.save_discovery(db, 'GOOGL', result, links)
                    monitor.add_release_events(db, 'GOOGL', new)
                self.assertEqual(signals.public_official_updates(db, reference=NOW), [])
                row = db.execute('SELECT * FROM sources WHERE url=?', (url,)).fetchone()
                self.assertEqual(row['published_on'], published_on)
                self.assertEqual(row['discovered_at'], OBSERVED)
                self.assertIsNone(row['sha256'])
                body = ('<html><main><p>Google announced a synthetic model update. '
                        'This is test evidence for the existing publication checks.</p></main></html>').encode()
                with patch.object(monitor, 'now', return_value=OBSERVED):
                    monitor.check_source(db, row, lambda *_: (body, 'text/html'))
                feed = signals.public_official_updates(db, reference=NOW)
                self.assertEqual([item['url'] for item in feed], [url])
                self.assertEqual(feed[0]['publishedOn'], published_on)
                self.assertEqual(datetime.fromisoformat(feed[0]['observedAt']), NOW)
                self.assertNotIn('publishedAt', feed[0])
                self.assertNotIn('test evidence', json.dumps(feed))
                saved = db.execute('SELECT * FROM sources WHERE url=?', (url,)).fetchone()
                for field, value in (('status', 'held'), ('sha256', 'unfetched-revision'),
                                     ('published_on', '2026-09-01')):
                    with self.subTest(field=field):
                        db.execute(f'UPDATE sources SET {field}=? WHERE url=?', (value, url))
                        self.assertEqual(signals.public_official_updates(db, reference=NOW), [])
                        db.execute(f'UPDATE sources SET {field}=? WHERE url=?', (saved[field], url))


if __name__ == '__main__':
    unittest.main()
