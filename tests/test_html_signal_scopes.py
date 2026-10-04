"""Synthetic regressions for malformed public-news HTML scope boundaries."""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor
import signals
from html_signals import NewsHTML, collect


class HtmlSignalScopeTests(unittest.TestCase):
    def setUp(self):
        self.source = next(s for s in signals.SOURCES if s['id'] == 'prnewswire-public')
        self.url = 'https://www.prnewswire.com/news-releases/test-release-302897221.html'
        self.text = 'NVIDIA announced a new infrastructure partnership with regional suppliers. ' * 8

    def gallery_document(self, text):
        # PR Newswire's live gallery uses non-void <div/> tile starts, with
        # ordinary </div> endings. This fixture reproduces structure, not copy.
        tiles = '<div class="tile"/><figure><figcaption>Logo</figcaption></figure></div>' * 3
        return ('<html><script type="application/ld+json">'
                '{"@type":"NewsArticle","datePublished":"2026-10-02T10:00:00-04:00"}'
                '</script><main><article><h1>Infrastructure partnership</h1>'
                '<section><div class="gallery">' + tiles + '</div>'
                '<div class="row"><p>' + text + '</p></div></section></article></main>'
                '<div>AMD unrelated page promotion</div></html>').encode()

    def request(self, body):
        def fetch(source, _validators):
            return {'body': (f'<a href="{self.url}">release</a>'.encode()
                             if source['url'] == self.source['url'] else body)}
        return fetch

    def test_non_void_slashes_do_not_discard_release_after_gallery(self):
        result = collect(self.source, {}, ['NVDA', 'AMD'],
                         self.request(self.gallery_document(self.text)),
                         lambda: '2026-10-02T14:01:00+00:00')
        self.assertEqual(result['article_errors'], 0)
        self.assertEqual(result['article_pending'], 0)
        item, = result['_items']
        self.assertIn(self.text.strip(), item['text'])
        self.assertEqual(set(item['matches']), {'NVDA'})
        self.assertNotIn('unrelated page promotion', item['text'])
        self.assertEqual(item['publishedAt'], '2026-10-02T14:00:00+00:00')
        self.assertTrue(item['baseline'])

    def test_previous_body_failure_recovers_only_after_valid_extraction(self):
        previous = {'index_state': json.dumps({'initialized': True, 'children': {
            self.url: {'baseline': False, 'checked': '2026-10-02T14:01:00+00:00',
                       'next_check': '2026-10-02T14:05:00+00:00', 'failures': 1,
                       'error': 'signal-article-body-invalid',
                       'first_failed_at': '2026-10-02T14:01:00+00:00', 'failure_attempts': 1},
        }})}
        result = collect(self.source, previous, ['NVDA'],
                         self.request(self.gallery_document(self.text)),
                         lambda: '2026-10-02T14:06:00+00:00')
        self.assertEqual(result['article_errors'], 0)
        self.assertFalse(result['_items'][0]['baseline'])
        state = json.loads(result['index_state'])
        self.assertIsNone(state['children'][self.url]['error'])
        self.assertEqual(state['recoveries'][0]['attempts'], 2)

    def test_thin_gallery_is_still_an_article_error(self):
        result = collect(self.source, {}, ['NVDA'],
                         self.request(self.gallery_document('Short body.')),
                         lambda: '2026-10-02T14:01:00+00:00')
        self.assertEqual(result['_items'], [])
        self.assertEqual(result['article_errors'], 1)
        self.assertEqual(json.loads(result['index_state'])['children'][self.url]['error'],
                         'signal-article-body-invalid')

    def test_unrelated_valid_release_does_not_create_company_event_or_body(self):
        text = 'A local nonprofit announced a new electrical trades training partnership. ' * 8
        db = monitor.connect(':memory:')
        try:
            result = signals.check(db, self.source, list(monitor.PROVIDERS),
                                   lambda source, previous: collect(
                                       source, previous, list(monitor.PROVIDERS),
                                       self.request(self.gallery_document(text))))
            self.assertEqual(result['status'], 'ok')
            self.assertEqual(result['events'], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_events').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_documents').fetchone()[0], 0)
            self.assertIsNone(db.execute('SELECT error FROM signal_routes').fetchone()[0])
        finally:
            db.close()

    def test_configured_body_class_preserves_gallery_and_closes_at_ancestor(self):
        parser = NewsHTML('release-body')
        parser.feed('<section class="release-body"><div class="tile"/>'
                    '<figure>Logo</figure></div><p>Full release body</section>'
                    '<p>Outside release</p>')
        text = monitor.extract_html_text(''.join(parser.selected).encode())
        self.assertIn('Full release body', text)
        self.assertNotIn('Outside release', text)
        self.assertEqual(parser.selected_stack, [])

    def test_unmatched_closing_tags_cannot_end_article_scope(self):
        for tag in ('main', 'article'):
            with self.subTest(tag=tag):
                parser = NewsHTML()
                parser.feed(f'<{tag}></br></img></section><p>Release body</p></{tag}>'
                            '<p>Outside release</p>')
                text = monitor.extract_html_text(''.join(getattr(parser, tag)).encode())
                self.assertEqual(text, 'Release body')
                self.assertIsNone(parser.capture)

    def test_closing_scope_with_unclosed_descendants_excludes_outside_text(self):
        for tag in ('main', 'article'):
            with self.subTest(tag=tag):
                parser = NewsHTML()
                parser.feed(f'<{tag}><div><p>Release body</{tag}><p>Outside release</p>')
                text = monitor.extract_html_text(''.join(getattr(parser, tag)).encode())
                self.assertEqual(text, 'Release body')
                self.assertIsNone(parser.capture)


if __name__ == '__main__':
    unittest.main()
