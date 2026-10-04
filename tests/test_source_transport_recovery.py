"""Regressions for the two live official-source failures found October 2."""
import gzip
import io
import json
from email.message import Message
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import signals
from html_signals import collect


class Response(io.BytesIO):
    def __init__(self, body, content_type, encoding=None):
        super().__init__(body)
        self.headers = Message()
        self.headers['Content-Type'] = content_type
        if encoding:
            self.headers['Content-Encoding'] = encoding


class SourceTransportRecoveryTests(unittest.TestCase):
    def test_conditional_requests_can_be_disabled_without_changing_default(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'globenewswire-public')
        validators = {'etag': '"previous"', 'last_modified': 'Fri, 02 Oct 2026 03:31:04 GMT'}
        for conditional in (False, True):
            with self.subTest(conditional=conditional), patch.object(signals, 'build_opener') as opener:
                opener.return_value.open.return_value = Response(b'<rss/>', 'application/xml')
                signals.fetch({**source, 'conditionalRequests': conditional}, validators)
                request = opener.return_value.open.call_args.args[0]
                self.assertEqual(request.get_header('If-none-match'), '"previous"' if conditional else None)
                self.assertEqual(request.get_header('If-modified-since'), validators['last_modified'] if conditional else None)

    def test_prnewswire_uses_stable_official_html_and_json_ld_publication_time(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'prnewswire-public')
        first_url = ('https://www.prnewswire.com/news-releases/'
                     'nvidia-announces-results-302896001.html')
        second_url = ('https://www.prnewswire.com/news-releases/'
                      'amd-announces-results-302896002.html')
        urls = [first_url]

        def request(request_source, validators):
            if request_source['url'] == source['url']:
                links = ''.join(f'<a href="{url}">release</a>' for url in urls)
                return {'body': f'<html><main>{links}</main></html>'.encode()}
            publication = ('2026-10-02T03:50:00-04:00' if request_source['url'] == first_url
                           else '2026-10-02T03:51:00-04:00')
            ticker = 'NVIDIA' if request_source['url'] == first_url else 'AMD'
            return {'body': (
                '<html><script type="application/ld+json">'
                + json.dumps({'@type': 'NewsArticle', 'datePublished': publication})
                + f'</script><article><h1>{ticker} results</h1><p>'
                + f'{ticker} reported official financial results. ' * 10
                + '</p></article></html>').encode()}

        self.assertEqual(source['format'], 'html-index')
        self.assertEqual(source['url'],
                         'https://www.prnewswire.com/news-releases/news-releases-list/')
        first = collect(source, {}, ['NVDA', 'AMD'], request,
                        lambda: '2026-10-02T07:52:00+00:00')
        self.assertEqual(first['_items'][0]['publishedAt'], '2026-10-02T07:50:00+00:00')
        self.assertTrue(first['_items'][0]['baseline'])

        urls.insert(0, second_url)
        second = collect(source, {'index_state': first['index_state']}, ['NVDA', 'AMD'], request,
                         lambda: '2026-10-02T07:53:00+00:00')
        self.assertEqual([item['url'] for item in second['_items']], [second_url])
        self.assertEqual(second['_items'][0]['publishedAt'], '2026-10-02T07:51:00+00:00')
        self.assertFalse(second['_items'][0]['baseline'])

    def test_gzip_decodes_official_json_and_html_without_losing_text(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'sandisk-news')
        for fmt, mime, body in [('json', 'application/json', b'{"docs":[]}'),
                                ('document', 'text/html', '<p>Revenue -1.25%; 売上</p>'.encode())]:
            with self.subTest(fmt=fmt), patch.object(signals, 'build_opener') as opener:
                opener.return_value.open.return_value = Response(gzip.compress(body), mime, 'gzip')
                self.assertEqual(signals.fetch({**source, 'format': fmt}, {})['body'], body)

    def test_gzip_expanded_size_remains_bounded(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'sandisk-news')
        with patch.object(signals, 'MAX_BYTES', 200), patch.object(signals, 'build_opener') as opener:
            opener.return_value.open.return_value = Response(gzip.compress(b'a' * 1000), 'text/html', 'gzip')
            with self.assertRaisesRegex(ValueError, 'signal-response-limit'):
                signals.fetch({**source, 'format': 'document'}, {})

    def test_json_listing_retains_full_article_and_detects_new_release(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'sandisk-news')
        prefix = 'https://www.sandisk.com/company/newsroom/press-releases/2026/'
        urls = [prefix + 'first']
        text = 'Sandisk expects revenue of $8.97 billion, down 1.25%; acquisition is pending. ' * 40
        def request(s, validators):
            if s['format'] == 'json':
                return {'body': json.dumps({'docs': [{'url': u, 'documentTypeDate': '2026-10-02T00:00:00Z'} for u in urls]}).encode()}
            return {'body': ('<html><meta name="article:published_time" content="2026-10-02T03:00:00Z">'
                             '<h1>Sandisk outlook</h1><div class="para-text"><p>' + text +
                             '</p></div><footer>unrelated</footer></html>').encode()}
        first = collect(source, {}, ['SNDK'], request, lambda: '2026-10-02T03:01:00+00:00')
        self.assertTrue(first['_items'][0]['baseline'])
        self.assertEqual(first['_items'][0]['text'], text.strip())
        # The article's explicit publication timestamp wins over a listing date.
        self.assertEqual(first['_items'][0]['publishedAt'], '2026-10-02T03:00:00+00:00')
        urls.insert(0, prefix + 'second')
        second = collect(source, {'index_state': first['index_state']}, ['SNDK'], request,
                         lambda: '2026-10-02T03:03:00+00:00')
        self.assertEqual(len(second['_items']), 1)
        self.assertEqual(second['_items'][0]['url'], urls[0])
        self.assertFalse(second['_items'][0]['baseline'])
        self.assertEqual(second['article_errors'], 0)

    def test_json_listing_does_not_follow_unapproved_hosts_or_malformed_data(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'sandisk-news')
        for docs, error in [([{'url': 'https://example.com/news'}], 'signal-index-no-articles'),
                            ([{'url': 123}], 'signal-index-invalid-listing'),
                            ({'url': 'invalid'}, 'signal-index-invalid-listing')]:
            with self.subTest(docs=docs), self.assertRaisesRegex(ValueError, error):
                collect(source, {}, ['SNDK'], lambda *_: {'body': json.dumps({'docs': docs}).encode()})


if __name__ == '__main__':
    unittest.main()
