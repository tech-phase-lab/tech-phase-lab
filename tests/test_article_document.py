from datetime import datetime, timezone
from email.message import Message
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import article_document
import monitor
import official_headline_corrections as source
import official_research
import signals

TITLE = source.TITLE
URL = source.URL
DATE = '2026-09-28'
NOW = datetime(2026, 10, 4, tzinfo=timezone.utc)
TEXT = ('NVIDIA announced an additional $150 billion in share repurchase authorization, '
        'increasing the remaining total to $235 billion. The company expects to execute '
        'the remaining program through fiscal year 2028.')


def html(url=URL, title=TITLE, date='September 28, 2026'):
    return (f'<html><head><link rel="canonical" href="{url}"><meta property="og:title" content="{title}"></head>'
            f'<body><nav>Not article evidence</nav><div class="article"><h1>{title}</h1>'
            f'<div class="article-date">{date}</div><div class="article-body"><p>{TEXT}</p></div></div>'
            '<div>Unrelated other release and footer</div></body></html>').encode()


class ArticleDocumentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'test.sqlite'
        self.db = official_research.connect(self.path)
        self.addCleanup(self.db.close)
        monitor.add_source(self.db, 'NVDA', URL, DATE, TITLE)
        self.db.commit()

    def row(self):
        return self.db.execute('SELECT * FROM sources WHERE url=?', (URL,)).fetchone()

    def test_xml_feed_json_and_error_are_never_article_evidence(self):
        for content, content_type in [(b'<rss><channel><title>A feed instead of the article</title></channel></rss>', 'text/xml'),
                                      (b'<Error><Code>AccessDenied</Code></Error>', 'application/xml'),
                                      (b'{"error":"No such article"}', 'application/json'),
                                      (b'{"error":"No such article"}', 'text/html'),
                                      (b'<?xml version="1.0"?><!--wrapper--><Error><Code>AccessDenied</Code></Error>', 'text/html'),
                                      (b'<html><title>503 Service Unavailable</title></html>', 'text/html'),
                                      (b'<Error><Code>AccessDenied</Code></Error>', 'text/html'),
                                      (b'<html><title>Page not found</title><p>'+b'missing '*100+b'</p></html>', 'text/html')]:
            with self.subTest(type=content_type), self.assertRaises(ValueError):
                monitor.collect_source(self.row(), lambda *_: (content, content_type))
        self.assertIsNone(self.row()['sha256'])
        self.assertEqual(self.db.execute('SELECT count(*) FROM source_revisions').fetchone()[0], 0)

    def test_wrong_canonical_or_heading_is_rejected(self):
        for body in (html(url=URL + '-other'), html(title='NVIDIA announces a different release'),
                     html().replace(('<h1>' + TITLE + '</h1>').encode(), b'<h1>Unrelated release</h1>')):
            with self.assertRaisesRegex(ValueError, 'article-response-(identity|title)-mismatch'):
                monitor.collect_source(self.row(), lambda *_: (body, 'text/html'))

    def test_div_article_scoping_and_original_visible_date(self):
        result = monitor.collect_source(self.row(), lambda *_: (html(), 'text/html'))
        self.assertEqual(result['publishedOn'], DATE)
        self.assertIn(TEXT, result['extractedText'])
        self.assertNotIn('Not article', result['extractedText'])
        self.assertNotIn('Unrelated', result['extractedText'])
        self.assertEqual(result['bodySha256'], hashlib.sha256(result['extractedText'].encode()).hexdigest())
        self.assertIsNone(article_document.explicit_body('<div class="article">one</div><div class="article">two</div>'))

    def test_retained_wrong_type_forces_unconditional_retrieval_and_cannot_reuse_304(self):
        self.db.execute("UPDATE sources SET sha256='old',content_type='text/xml',extracted_text='XML',extracted_chars=3,response_etag='old'")
        self.db.commit()
        requests = []
        def transport(*args, **kwargs):
            requests.append(kwargs)
            return {'notModified': True, 'etag': 'old', 'lastModified': None}
        transport.supports_persistent_validators = True
        with self.assertRaisesRegex(ValueError, 'article-response-not-document'):
            monitor.collect_source(self.row(), transport)
        self.assertEqual(requests[0]['validators'], {'force_unconditional': True})

    def test_article_accept_is_separate_from_feed_negotiation(self):
        seen = []
        class Response:
            headers = Message()
            headers['Content-Type'] = 'text/html'
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, size): return html()
        class Opener:
            def open(self, request, **kwargs):
                seen.append(request.get_header('Accept'))
                return Response()
        with patch.object(monitor, 'build_opener', return_value=Opener()), patch.object(monitor, 'wait_for_source_courtesy'):
            monitor.fetch(URL, 'NVDA', {'force_unconditional': True}, include_metadata=True)
            monitor.fetch(monitor.INDEXES['NVDA'], 'NVDA', {'force_unconditional': True}, include_metadata=True)
        self.assertEqual(seen[0], 'text/html,application/pdf;q=0.9')
        self.assertIn('application/rss+xml', seen[1])

    def test_body_revision_repair_preserves_history_and_publication_clock(self):
        observed = '2026-09-28T11:05:29.215000+00:00'
        with self.db:
            self.db.execute("UPDATE sources SET sha256='old',raw_sha256='old',body_sha256='oldbody',content_type='text/xml',extracted_text='XML',extracted_chars=3,fetched_at=?", (observed,))
            self.db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)', (URL, 'NVDA', observed))
        result = monitor.collect_source(self.row(), lambda *_: (html(), 'text/html'))
        with patch.object(monitor, 'now', return_value=NOW.isoformat()):
            monitor.save_source_check(self.db, self.row(), result)
        self.assertEqual(self.row()['published_on'], DATE)
        self.assertEqual(self.row()['fetched_at'], observed)
        self.assertEqual(self.db.execute('SELECT detected_at FROM release_events').fetchone()[0], observed)
        self.assertEqual(self.db.execute("SELECT extracted_text FROM source_revisions WHERE sha256='old'").fetchone()[0], 'XML')
        items = signals.public_official_updates(self.db, reference=NOW)
        self.assertEqual(items[0]['publishedOn'], DATE)
        self.assertEqual(items[0]['observedAt'], observed)
        self.assertNotIn('bodyJa', items[0])

    def test_successful_wrong_type_queues_once_and_never_clears_access_backoff(self):
        future = '2026-10-05T00:00:00+00:00'
        with self.db:
            self.db.execute("UPDATE sources SET sha256='xml-revision',content_type='text/xml',extracted_text='XML',extracted_chars=3,next_fetch_at=?", (future,))
            self.db.execute('INSERT INTO body_host_backoff VALUES(?,?,?,?,?)',
                            ('nvidianews.nvidia.com', 1, 'http-403', future, NOW.isoformat()))
        monitor.queue_invalid_article_evidence(self.db)
        self.assertIsNone(self.row()['next_fetch_at'])
        self.assertEqual(self.row()['sha256'], 'xml-revision')
        self.assertEqual(self.row()['extracted_text'], 'XML')
        self.assertEqual(self.db.execute('SELECT retry_at FROM body_host_backoff').fetchone()[0], future)
        self.db.execute('UPDATE sources SET next_fetch_at=?', (future,))
        monitor.queue_invalid_article_evidence(self.db)
        self.assertEqual(self.row()['next_fetch_at'], future)
        self.db.execute("UPDATE sources SET sha256='xml-denied',error='http-403'")
        monitor.queue_invalid_article_evidence(self.db)
        self.assertEqual(self.row()['next_fetch_at'], future)
        self.assertEqual(self.row()['error'], 'http-403')
        self.assertEqual(self.db.execute('SELECT count(*) FROM article_response_rechecks').fetchone()[0], 1)

    def test_story_fallback_accepts_unique_div_and_blocks_wrong_identity(self):
        with self.db:
            self.db.execute("UPDATE sources SET sha256='old',extracted_text='XML',extracted_chars=3")
            self.db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',
                            (URL, 'old', '2026-09-28T11:05:29+00:00', 'XML', 3))
            self.db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)', (URL, 'NVDA', '2026-09-28T11:05:29+00:00'))
        self.assertEqual(official_research.prepare_story_body(self.path, NOW, lambda *_: {'body': html(url=URL+'-other')}), 'retry')
        self.assertEqual(self.db.execute('SELECT body FROM official_story_bodies').fetchone()[0], '')
        self.db.execute('UPDATE official_story_bodies SET next_at=0'); self.db.commit()
        self.assertEqual(official_research.prepare_story_body(self.path, NOW, lambda *_: {'body': html()}), 'ready')
        self.assertIn(TEXT, self.db.execute('SELECT body FROM official_story_bodies').fetchone()[0])


if __name__ == '__main__':
    unittest.main()
