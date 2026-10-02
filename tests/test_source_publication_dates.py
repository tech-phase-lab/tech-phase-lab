"""Original publication evidence is distinct from feed re-listing and observation.

The regression uses the independently observed Microsoft URL/header date pair.
Markup around those facts is a synthetic standards fixture, not a captured page.
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

URL = 'https://www.microsoft.com/en-us/security/blog/2026/10/01/insights-from-the-2026-microsoft-digital-defense-report/'
TITLE = 'Insights from the 2026 Microsoft Digital Defense Report'
OBSERVED = '2026-10-02T17:45:51.992+00:00'
NOW = datetime(2026, 10, 2, 18, tzinfo=timezone.utc)
BODY = '<article><h1>' + TITLE + '</h1><time>October 1</time><p>Microsoft published its annual digital defense report.</p></article>'


def article(meta='', schema=None):
    structured = '<script type="application/ld+json">' + json.dumps(schema) + '</script>' if schema else ''
    return ('<html><head>' + meta + structured + '</head><body>' + BODY + '</body></html>').encode()


class SourcePublicationDateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = monitor.connect(Path(self.tmp.name) / 'monitor.sqlite')
        self.addCleanup(self.db.close)
        monitor.add_source(self.db, 'MSFT', URL, '2026-10-02', TITLE)
        self.db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)', (URL, 'MSFT', OBSERVED))
        self.db.commit()

    def row(self):
        return self.db.execute('SELECT * FROM sources WHERE url=?', (URL,)).fetchone()

    def check(self, content):
        with patch.object(monitor, 'now', return_value=NOW.isoformat()):
            return monitor.check_source(self.db, self.row(), lambda *_: (content, 'text/html'))

    def test_original_article_date_replaces_non_null_feed_date_through_public_bridge(self):
        self.check(article())
        before = signals.public_official_updates(self.db, reference=NOW)
        self.db.commit()
        self.assertEqual(before[0]['publishedOn'], '2026-10-02')
        result = self.check(article('<meta property="article:published_time" content="2026-10-01T09:00:00-07:00">'))
        self.assertEqual(result['status'], 'unchanged')
        self.assertEqual(self.row()['published_on'], '2026-10-01')
        after = signals.public_official_updates(self.db, reference=NOW)
        self.assertEqual(len(after), 1)
        self.assertEqual(after[0]['publishedOn'], '2026-10-01')
        self.assertEqual(datetime.fromisoformat(after[0]['observedAt']), datetime.fromisoformat(OBSERVED))
        self.assertNotIn('publishedAt', after[0])
        self.assertEqual(self.db.execute('SELECT detected_at FROM release_events WHERE url=?', (URL,)).fetchone()[0], OBSERVED)
        monitor.add_source(self.db, 'MSFT', URL, '2026-10-02', TITLE)
        self.assertEqual(self.row()['published_on'], '2026-10-01')

    def test_original_json_ld_date_matches_article_and_ignores_modified_related_dates(self):
        content = article(schema={'@graph': [
            {'@type': 'WebPage', '@id': URL, 'dateModified': '2026-10-02T17:00:00Z'},
            {'@type': 'Article', '@id': URL + '#article', 'mainEntityOfPage': {'@id': URL},
             'datePublished': '2026-10-01T23:30:00-07:00', 'dateModified': '2026-10-02T17:00:00Z'},
            {'@type': 'Article', 'url': 'https://www.microsoft.com/en-us/security/blog/2026/10/02/other/',
             'datePublished': '2026-10-02T08:00:00Z'},
        ]})
        self.check(content)
        self.assertEqual(self.row()['published_on'], '2026-10-01')

    def test_modified_or_ambiguous_metadata_never_changes_original_date(self):
        for content in [
            article('<meta property="article:modified_time" content="2026-10-01T08:00:00Z">',
                    {'@type': 'Article', 'url': URL, 'dateModified': '2026-10-01T08:00:00Z'}),
            article('<meta property="article:published_time" content="2026-10-01T08:00:00Z">',
                    {'@type': 'Article', 'url': URL, 'datePublished': '2026-09-30T08:00:00Z'}),
            article(schema={'@type': 'Article', 'url': 'https://example.com/other', 'datePublished': '2026-10-01'}),
        ]:
            with self.subTest(content=content):
                self.check(content)
                self.assertEqual(self.row()['published_on'], '2026-10-02')

    def test_related_query_port_or_conflicting_identity_cannot_supply_original_date(self):
        identities = [
            {'url': URL + '?id=other'},
            {'url': URL.replace('https://www.microsoft.com/', 'https://www.microsoft.com:8443/')},
            {'url': URL.replace('https://', 'https://other@')},
            {'url': URL + 'other/', 'mainEntityOfPage': URL},
            {'url': URL, '@id': 'https://[invalid/'},
        ]
        for identity in identities:
            with self.subTest(identity=identity):
                self.check(article(schema={'@type': 'Article', 'datePublished': '2026-10-01', **identity}))
                self.assertEqual(self.row()['published_on'], '2026-10-02')

    def test_cross_host_feed_relisting_returns_preexisting_inline_article_to_normal_fetch(self):
        self.check(article())
        self.db.execute("UPDATE sources SET source_mode='inline',next_fetch_at='2026-10-03T00:00:00+00:00' WHERE url=?", (URL,))
        self.db.commit()
        feed = f'''<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item>
          <title>{TITLE}</title><link>{URL}</link><pubDate>Fri, 02 Oct 2026 17:40:00 +0000</pubDate>
          <content:encoded><![CDATA[{BODY * 3}]]></content:encoded>
        </item></channel></rss>'''.encode()
        links = monitor.feed_links(feed, 'MSFT', source_url='https://news.microsoft.com/source/feed/')
        self.assertEqual(links[URL], TITLE)
        monitor.save_discovery(self.db, 'MSFT', {
            'status': 'ok', 'candidates': 1, 'error': None,
            'sourceUrl': 'https://news.microsoft.com/source/feed/',
        }, links)
        self.assertEqual(self.row()['source_mode'], 'remote')
        self.assertIsNone(self.row()['next_fetch_at'])
        # Reconciliation requires article evidence; neither a URL date nor the
        # feed's relisting timestamp is silently promoted to original metadata.
        self.assertEqual(self.row()['published_on'], '2026-10-02')
        self.check(article('<meta property="article:published_time" content="2026-10-01T08:00:00-07:00">'))
        self.assertEqual(self.row()['published_on'], '2026-10-01')
        monitor.save_discovery(self.db, 'MSFT', {
            'status': 'ok', 'candidates': 1, 'error': None,
            'sourceUrl': 'https://news.microsoft.com/source/feed/',
        }, links)
        self.assertEqual(self.row()['source_mode'], 'remote')
        self.assertEqual(self.row()['published_on'], '2026-10-01')

    def test_stale_extractor_rechecks_article_metadata_even_for_long_unchanged_body(self):
        self.check(article())
        self.db.execute("UPDATE sources SET extractor_version='old',extracted_chars=2000,response_etag='stored' WHERE url=?", (URL,))
        self.db.commit()
        calls = []
        def transport(_url, _ticker, **kwargs):
            calls.append(kwargs)
            return {'notModified': False, 'content': article('<meta property="article:published_time" content="2026-10-01T08:00:00Z">'),
                    'contentType': 'text/html', 'etag': 'new', 'lastModified': None}
        transport.supports_persistent_validators = True
        result = monitor.collect_source(self.row(), transport)
        self.assertEqual(calls[0]['validators'], {'force_unconditional': True})
        monitor.save_source_check(self.db, self.row(), result)
        self.assertEqual(self.row()['published_on'], '2026-10-01')


if __name__ == '__main__':
    unittest.main()
