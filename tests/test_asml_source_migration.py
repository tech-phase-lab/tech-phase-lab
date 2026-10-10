"""ASML issuer-host migration, using synthetic markup and transport fixtures.

The source URLs were verified via ASML's own redirects on October 2, 2026.
No live network requests or persisted production records are changed by tests.
"""
import importlib.util
import io
import json
from email.message import Message
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.request import Request

spec = importlib.util.spec_from_file_location(
    'asml_monitor', Path(__file__).resolve().parents[1] / 'scripts/research/monitor.py'
)
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)

OLD_INDEX = 'https://www.asml.com/en/news/press-releases'
INDEX = 'https://investor.asml.com/news/press-releases-and-announcements'
OLD_URL = OLD_INDEX + '/2026/asml-begins-construction-of-new-eindhoven-campus'
URL = ('https://investor.asml.com/news-releases/news-release-details/'
       'asml-begins-construction-new-eindhoven-campus-strengthening-its-presence-brainport-region')


class Response(io.BytesIO):
    def __init__(self, body):
        super().__init__(body)
        self.headers = Message()
        self.headers['Content-Type'] = 'text/html; charset=utf-8'


class AsmlSourceMigrationTests(unittest.TestCase):
    def test_exact_issuer_host_retains_old_source_and_sec_routes(self):
        provider = monitor.PROVIDERS['ASML']
        self.assertEqual(provider['indexUrl'], OLD_INDEX)
        self.assertEqual(monitor.INDEXES['ASML'], INDEX)
        self.assertEqual(set(provider['allowedHosts']), {
            'data.sec.gov', 'www.sec.gov', 'www.asml.com', 'investor.asml.com',
        })
        self.assertEqual(monitor.article_url(OLD_URL, 'ASML'), OLD_URL)
        self.assertEqual(monitor.article_url(URL, 'ASML'), URL)
        self.assertEqual(len(provider['supplementalSources']), 2)

    def test_relative_listing_links_use_new_monitor_origin(self):
        path = URL.removeprefix('https://investor.asml.com')
        body = (f'<main><a href="{path}">ASML campus release</a>'
                '<a href="/quarterly-results">Quarterly results</a>'
                '<a href="/news-releases/news-release-details/">Release index</a>'
                '<a href="https://unknown.asml.com/news-releases/news-release-details/other">Other</a>'
                '</main>').encode()
        source = monitor.monitoring_sources('ASML')[0]
        self.assertEqual(source['url'], INDEX)
        self.assertEqual(monitor.discover_links(body, 'text/html', 'ASML', source),
                         {URL: 'ASML campus release'})

    def test_unrelated_paths_and_hosts_are_not_release_evidence(self):
        for url in [INDEX, 'https://investor.asml.com/quarterly-results',
                    'https://investor.asml.com/news-releases/news-release-details/',
                    URL + '/attachment', URL + '.pdf',
                    URL.replace('investor.asml.com', 'unknown.asml.com'),
                    URL.replace('investor.asml.com', 'investor.asml.com.evil.example'),
                    URL.replace('https:', 'http:')]:
            with self.subTest(url=url):
                self.assertIsNone(monitor.article_url(url, 'ASML'))
        self.assertIsNone(monitor.article_url(URL, 'TSM'))

    def test_migrated_article_original_date_uses_observed_metadata_structure(self):
        # These metadata names, date values and identity fields were present in
        # the issuer HTML. Body copy and surrounding markup are synthetic.
        graph = {'@context': 'https://schema.org', '@graph': [{
            '@type': 'NewsArticle', '@id': URL, 'mainEntityOfPage': URL,
            'datePublished': '2026-09-08T13:20:43+0200',
        }]}
        schema = '<script type="application/ld+json">' + json.dumps(graph) + '</script>'
        meta = '<meta property="sc:publication_date" content="2026-09-08T11:20:07Z">'
        body = '<main><p>ASML announced a campus investment.</p></main>'
        content = ('<html><head>' + meta + schema + '</head>' + body + '</html>').encode()
        for identity in (OLD_URL, URL):
            with self.subTest(identity=identity):
                self.assertEqual(monitor.article_publication_date(content, identity), '2026-09-08')
        # Matching canonical schema independently supports the same day even
        # when an issuer publishes the numeric offset without a colon.
        self.assertEqual(monitor.article_publication_date(schema.encode(), URL), '2026-09-08')
        # Schema for a different identity alone must not rewrite the old URL.
        self.assertIsNone(monitor.article_publication_date(schema.encode(), OLD_URL))

    def test_redirect_only_accepts_the_configured_issuer(self):
        redirect = monitor.Redirects('ASML')
        request = Request(OLD_URL)
        next_request = redirect.redirect_request(request, None, 301, 'Moved', {}, URL)
        self.assertEqual(next_request.full_url, URL)
        with self.assertRaisesRegex(ValueError, 'outside approved official hosts'):
            redirect.redirect_request(request, None, 301, 'Moved', {},
                                      URL.replace('investor.asml.com', 'unknown.asml.com'))

    def test_redirected_recheck_keeps_original_identity_and_observation_clocks(self):
        body = b'<html><main><p>ASML announced a campus investment.</p></main></html>'
        observed = '2026-09-08T12:00:00.000+00:00'
        checked = '2026-10-02T18:00:00.000+00:00'
        with tempfile.TemporaryDirectory() as tmp:
            db = monitor.connect(Path(tmp) / 'monitor.sqlite')
            self.addCleanup(db.close)
            with patch.object(monitor, 'now', return_value=observed):
                monitor.add_source(db, 'ASML', OLD_URL, '2026-09-08', 'ASML campus release')
            db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',
                       (OLD_URL, 'ASML', observed))
            db.commit()

            class Opener:
                def __init__(self, redirects):
                    self.redirects = redirects

                def open(self, request, timeout):
                    redirected = self.redirects.redirect_request(
                        request, None, 301, 'Moved', {}, URL)
                    if redirected.full_url != URL:
                        raise AssertionError('Unexpected redirect target')
                    return Response(body)

            row = db.execute('SELECT * FROM sources WHERE url=?', (OLD_URL,)).fetchone()
            with patch.object(monitor, 'build_opener', side_effect=Opener), \
                    patch.object(monitor, 'now', return_value=checked):
                result = monitor.check_source(db, row)
            self.assertEqual(result['status'], 'first-fetched')
            saved = db.execute('SELECT * FROM sources').fetchone()
            self.assertEqual(saved['url'], OLD_URL)
            self.assertEqual(saved['evidence_url'], OLD_URL)
            self.assertEqual(saved['published_on'], '2026-09-08')
            self.assertEqual(saved['discovered_at'], observed)
            self.assertEqual(saved['checked_at'], checked)
            self.assertEqual(saved['status'], 'pending')
            self.assertIsNone(saved['error'])
            self.assertEqual(db.execute('SELECT count(*) FROM sources').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT detected_at FROM release_events').fetchone()[0], observed)
            self.assertEqual(db.execute('SELECT count(*) FROM briefs').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
