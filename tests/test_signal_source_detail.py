"""Read-only retained-source inspection; no fetches or publication side effects."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor
import official_release_bridge as bridge
import service
import signal_source_detail as details
import signals

SOURCE = next(s for s in signals.SOURCES if s['id'] == 'prnewswire-public')
URL = 'https://www.prnewswire.com/news-releases/synthetic-oracle-update.html'
TITLE = 'Oracle announces a planned energy commitment'
BODY = 'Oracle retained introduction.\n' + 'Substantive retained paragraph.\n' * 100 + 'The planned subscription remains subject to commission approval.'
PUBLISHED = '2026-10-02T13:00:00+00:00'
OBSERVED = '2026-10-02T13:02:02.125+00:00'
LATER = '2026-10-03T06:20:00.000+00:00'


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


class SignalSourceDetailTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'source.sqlite'
        with monitor.connect(self.path) as db:
            signals.schema(db)
            signals.save(db, SOURCE, [{'title': TITLE, 'url': URL, 'text': BODY,
                'matches': {'ORCL': ['Oracle']}, 'publishedAt': PUBLISHED, 'truncated': False}], {}, OBSERVED, 'synthetic', 1)
            self.id = db.execute('SELECT id FROM signal_events').fetchone()[0]
            self.sha = digest(TITLE + '\n' + BODY)

    def read(self, event_id=None):
        return details.detail(self.path, self.id if event_id is None else event_id)

    def test_exact_current_revision_returns_retained_tail_hashes_and_original_clocks(self):
        result = self.read()
        self.assertEqual(result['status'], 'current')
        self.assertTrue(result['currentRevision'])
        self.assertEqual(result['sourceId'], SOURCE['id'])
        self.assertEqual(result['sourceKind'], 'publisher-discovery')
        self.assertEqual(result['url'], URL)
        self.assertEqual(result['text'], BODY)
        self.assertTrue(result['text'].endswith('subject to commission approval.'))
        self.assertEqual(result['bodyChars'], len(BODY))
        self.assertEqual(result['eventSha256'], self.sha)
        self.assertEqual(result['documentSha256'], self.sha)
        self.assertEqual(result['bodySha256'], digest(BODY))
        self.assertEqual(result['publishedAt'], PUBLISHED)
        self.assertEqual(result['observedAt'], OBSERVED)
        self.assertEqual(result['bodyAt'], OBSERVED)
        self.assertIsNone(result['publishedOn'])
        self.assertFalse(result['sourceTruncated'])

    def test_true_read_only_leaves_schema_rows_jobs_and_budget_unchanged(self):
        with sqlite3.connect(self.path) as db:
            before = list(db.iterdump())
        with patch.object(monitor, 'connect', side_effect=AssertionError('schema write')), \
             patch.object(signals, 'schema', side_effect=AssertionError('schema write')), \
             patch.object(signals, 'fetch', side_effect=AssertionError('network')), \
             patch.object(bridge, 'sync', side_effect=AssertionError('metadata write')):
            self.assertEqual(self.read()['text'], BODY)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(list(db.iterdump()), before)

    def test_normal_queue_and_public_projection_still_omit_full_source(self):
        with monitor.connect(self.path) as db:
            normal = signals.queue(db, sources=[SOURCE])
            self.assertNotIn('subject to commission approval.', json.dumps(normal))
            self.assertNotIn('text', normal['items'][0])
            self.assertEqual(signals.public_official_updates(db, sources=[SOURCE]), [])
        result = service.AutomaticMonitor.signal_source_detail(SimpleNamespace(db_path=self.path), self.id)
        self.assertEqual(result['text'], BODY)

    def test_missing_database_is_not_created(self):
        path = Path(self.tmp.name) / 'missing.sqlite'
        with self.assertRaises(sqlite3.OperationalError):
            details.detail(path, self.id)
        self.assertFalse(path.exists())

    def test_stale_event_never_receives_new_revision_body(self):
        with sqlite3.connect(self.path) as db:
            db.execute('UPDATE signal_documents SET sha=?,text=?,last_seen_at=?',
                       (digest(TITLE+'\nNew revision'), 'New revision', LATER))
        result = self.read()
        self.assertEqual(result['status'], 'stale')
        self.assertFalse(result['currentRevision'])
        self.assertIsNone(result['text'])
        self.assertIsNone(result['bodySha256'])
        self.assertEqual(result['eventSha256'], self.sha)
        self.assertEqual(result['observedAt'], OBSERVED)

    def test_retained_body_mutation_without_hash_change_is_not_certified(self):
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE signal_documents SET text='Corrupt changed evidence'")
        result = self.read()
        self.assertEqual(result['status'], 'integrity-mismatch')
        self.assertIsNone(result['text'])

    def test_missing_and_oversized_documents_are_explicit_and_bounded(self):
        with sqlite3.connect(self.path) as db:
            db.execute('UPDATE signal_documents SET text=?', ('x' * (details.MAX_BODY_CHARS + 1),))
        result = self.read()
        self.assertEqual(result['status'], 'body-limit')
        self.assertIsNone(result['text'])
        with sqlite3.connect(self.path) as db:
            db.execute('DELETE FROM signal_documents')
        result = self.read()
        self.assertEqual(result['status'], 'missing-document')
        self.assertIsNone(result['text'])

    def test_source_processing_truncation_is_not_hidden(self):
        with sqlite3.connect(self.path) as db:
            db.execute('UPDATE signal_events SET truncated=1')
        result = self.read()
        self.assertEqual(result['text'], BODY)
        self.assertTrue(result['sourceTruncated'])

    def test_unknown_source_unapproved_url_and_unknown_id_do_not_expose_text(self):
        self.assertIsNone(self.read(999999))
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE signal_events SET source_id='unknown-source'")
        self.assertIsNone(self.read())
        with sqlite3.connect(self.path) as db:
            db.execute('UPDATE signal_events SET source_id=?,url=?', (SOURCE['id'], 'https://evil.example/private'))
        self.assertIsNone(self.read())

    def test_event_id_is_single_bounded_decimal(self):
        for invalid in (0, -1, True, None, '', '01', '1.0', '+1', '1 OR 1=1', '1000000000000'):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                details.detail(self.path, invalid)
        self.assertEqual(self.read(str(self.id))['eventId'], self.id)

    def test_primary_issuer_revision_uses_bridge_and_preserves_date_only(self):
        url = 'https://blogs.nvidia.com/blog/synthetic-source-detail/'
        raw_sha = 'a' * 64
        title = 'NVIDIA retained issuer announcement'
        event_sha = bridge.revision(title, raw_sha, '2026-10-01')
        with monitor.connect(self.path) as db:
            db.execute('INSERT INTO sources(url,ticker,title,published_on,discovered_at,checked_at,sha256,body_sha256) VALUES(?,?,?,?,?,?,?,?)',
                       (url, 'NVDA', title, '2026-10-01', OBSERVED, LATER, raw_sha, digest(BODY)))
            db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',
                       (url, raw_sha, OBSERVED, BODY, len(BODY)))
            db.execute('''INSERT INTO signal_events(source_id,url,sha,title,tickers_json,matches_json,event_kind,
              published_on,observed_at,excerpt,diff,truncated) VALUES(?,?,?,?,?,?,'new',?,?,?,'',0)''',
                       ('primary-ir-NVDA', url, event_sha, title, '["NVDA"]', '{}', '2026-10-01', OBSERVED, 'Clipped excerpt'))
            primary_id = db.execute('SELECT max(id) FROM signal_events').fetchone()[0]
        result = self.read(primary_id)
        self.assertEqual(result['sourceKind'], 'issuer-primary')
        self.assertEqual(result['text'], BODY)
        self.assertEqual(result['documentSha256'], raw_sha)
        self.assertEqual(result['eventSha256'], event_sha)
        self.assertEqual(result['bodySha256'], digest(BODY))
        self.assertEqual(result['publishedOn'], '2026-10-01')
        self.assertIsNone(result['publishedAt'])
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE source_revisions SET extracted_text='Corrupt primary evidence'")
        self.assertEqual(self.read(primary_id)['status'], 'integrity-mismatch')
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE sources SET title='Updated title' WHERE ticker='NVDA'")
        self.assertEqual(self.read(primary_id)['status'], 'stale')

    def test_http_source_detail_stays_editor_authenticated_get_only(self):
        callback = Mock(side_effect=lambda value: details.detail(self.path, value))
        server = service.ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        server.app = SimpleNamespace(signal_source_detail=callback)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = f'http://127.0.0.1:{server.server_port}'
        token = 'synthetic-editor-token-at-least-24-characters'
        def read(path, auth=None):
            try:
                response = urlopen(Request(base+path, headers={'Authorization': auth} if auth else {}))
            except HTTPError as error:
                response = error
            return response.code, json.loads(response.read()), response.headers
        with patch.dict(os.environ, {'RESEARCH_EDITOR_TOKEN': token, 'RESEARCH_API_TOKEN': 'public-token'}):
            for auth in (None, 'Bearer public-token'):
                self.assertEqual(read(f'/admin/signals?eventId={self.id}', auth)[0], 401)
            callback.assert_not_called()
            code, payload, headers = read(f'/admin/signals?eventId={self.id}', 'Bearer '+token)
            self.assertEqual(code, 200)
            self.assertEqual(payload['detail']['text'], BODY)
            self.assertEqual(headers['Cache-Control'], 'no-store')
            self.assertEqual(read('/admin/signals?eventId=999999', 'Bearer '+token)[0], 404)
            for query in ('eventId=', 'eventId=0', 'eventId=1&eventId=2', 'eventId=1.2'):
                self.assertEqual(read('/admin/signals?'+query, 'Bearer '+token)[0], 400)
            self.assertEqual(read(f'/admin/official-research?eventId={self.id}', 'Bearer '+token)[0], 400)
