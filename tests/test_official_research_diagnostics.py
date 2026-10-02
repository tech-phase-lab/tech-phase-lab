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
import official_research as research
import official_research_diagnostics as diagnostics
from test_official_research import NOW, URL, TITLE, BODY, NOTE, copy


class OfficialResearchDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'db.sqlite'
        with research.connect(self.path) as db:
            db.execute('INSERT INTO sources(url,ticker,title,published_on,discovered_at,sha256) VALUES(?,?,?,?,?,?)', (URL, 'NBIS', TITLE, '2026-10-01', NOW.isoformat(), 'body-v1'))
            db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)', (URL, 'NBIS', NOW.isoformat()))
            db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)', (URL, 'body-v1', NOW.isoformat(), BODY, len(BODY)))
            self.row = research.candidates(db, NOW)[0]

    def queue(self, **kwargs):
        return diagnostics.queue(self.path, reference=NOW, **kwargs)

    def reject(self, note, sha=None, reason='unsupported-number'):
        sha = sha or self.row['sha']
        with research.connect(self.path) as db:
            db.execute("INSERT INTO official_research_jobs VALUES(?,?,4,?,'synthetic-lease','retry',?)", (self.row['id'], sha, NOW.timestamp() + 120, reason))
            db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)', ('synthetic-lease', self.row['id'], sha, NOW.isoformat(), reason, 'fact', json.dumps(note)))

    def test_current_pending_item_has_revision_retry_and_indexed_numeric_diagnostics_only(self):
        note = json.loads(json.dumps(NOTE))
        note['facts'][1]['ja'] = '非公開の数値99%を含む文章。'
        self.reject(note)
        result = self.queue()
        self.assertEqual(result['counts'], {'candidates': 1, 'validatedPublications': 0, 'pending': 1})
        item = result['items'][0]
        self.assertEqual(item['eventId'], self.row['id'])
        self.assertEqual(item['sourceId'], 'primary-ir-NBIS')
        self.assertEqual(item['url'], URL)
        self.assertEqual(item['currentSha'], self.row['sha'])
        self.assertTrue(item['job']['currentRevision'])
        self.assertEqual(item['job']['attempts'], 4)
        self.assertEqual(item['job']['nextRetryAt'], '2026-10-01T14:02:00+00:00')
        failure = item['latestFailure']
        self.assertFalse(failure['bodyRevisionRecorded'])
        self.assertEqual(failure['validation']['issues'][0]['field'], 'facts[1]')
        self.assertEqual(failure['validation']['issues'][0]['checks'][0]['unsupported'], [{'value': '99', 'dimension': 'percent', 'count': 1}])
        encoded = json.dumps(result, ensure_ascii=False)
        for private in [note['facts'][1]['ja'], NOTE['summary']['ja'], 'evidenceQuote', 'Company announcement background.', 'synthetic-lease']:
            self.assertNotIn(private, encoded)
        self.assertFalse(result['rawCopyIncluded'])

    def test_existing_normal_facts_false_positive_is_explained_without_changing_gate(self):
        quote = 'Connect two DGX Spark systems to run the supported model.'
        row = {**self.row, 'body': BODY + ' ' + quote}
        note = json.loads(json.dumps(NOTE))
        note['facts'][0] = copy('DGX Sparkを2台接続する。', 'Connect two DGX Spark systems.', quote)
        report = diagnostics.validation_report(json.dumps(note), row)
        self.assertEqual(report['status'], 'invalid')
        checks = report['issues'][0]['checks']
        self.assertIn('ja-evidence-quantity', [item['check'] for item in checks])
        self.assertIn('bilingual-quantity-count', [item['check'] for item in checks])
        with self.assertRaisesRegex(ValueError, 'unsupported-number'):
            research.validate(note, row['body'], row['title'])

    def test_stale_job_and_failure_are_not_misrepresented_as_current_rejection(self):
        self.reject(NOTE, sha='old-revision')
        item = self.queue()['items'][0]
        self.assertFalse(item['job']['currentRevision'])
        self.assertIsNone(item['latestFailure'])

    def test_historical_failure_can_now_pass_without_publishing_or_retrying(self):
        self.reject(NOTE)
        item = self.queue()['items'][0]
        self.assertEqual(item['status'], 'pending')
        self.assertEqual(item['latestFailure']['reason'], 'unsupported-number')
        self.assertEqual(item['latestFailure']['validation']['status'], 'valid')

    def test_true_read_only_does_not_sync_schema_publish_or_mutate_any_rows(self):
        self.reject(NOTE)
        with sqlite3.connect(self.path) as db:
            before = list(db.iterdump())
        with patch.object(research.signals, 'schema', side_effect=AssertionError('schema write')), \
             patch.object(research.bridge, 'sync', side_effect=AssertionError('metadata sync')), \
             patch.object(research, 'run_once', side_effect=AssertionError('generation')):
            self.assertEqual(self.queue()['counts']['pending'], 1)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(list(db.iterdump()), before)
        def attempted_write(db, *args, **kwargs):
            db.execute('DELETE FROM official_research_jobs')
        with patch.object(research, 'candidates', side_effect=attempted_write):
            with self.assertRaises(sqlite3.OperationalError):
                self.queue()

    def test_missing_database_is_not_created(self):
        path = Path(self.tmp.name) / 'missing.sqlite'
        with self.assertRaises(sqlite3.OperationalError):
            diagnostics.queue(path)
        self.assertFalse(path.exists())

    def test_pending_classification_is_independent_of_feed_limit_and_newest_five_jobs(self):
        rows = [{**self.row, 'id': index} for index in range(1, 28)]
        with research.connect(self.path) as db:
            for row in rows[1:]:
                db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)', (row['id'], row['sha'], row['body_sha'], json.dumps(NOTE), 'PRIVATE-EVIDENCE', NOW.isoformat(), NOW.isoformat(), 1))
                db.execute("INSERT INTO official_research_jobs VALUES(?,?,1,0,?,'done',NULL)", (row['id'], row['sha'], str(row['id'])))
        with patch.object(research, 'candidates', return_value=rows):
            result = self.queue(limit=1)
            self.assertEqual(result['counts'], {'candidates': 27, 'validatedPublications': 26, 'pending': 1})
            self.assertEqual([item['eventId'] for item in result['items']], [1])
            self.assertEqual(self.queue(view='all', limit=3)['filteredTotal'], 27)

    def test_invalid_saved_publication_is_pending(self):
        note = json.loads(json.dumps(NOTE))
        note['title']['en'] = 'Revenue was $999 billion.'
        with research.connect(self.path) as db:
            db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)', (self.row['id'], self.row['sha'], self.row['body_sha'], json.dumps(note), 'PRIVATE-EVIDENCE', NOW.isoformat(), NOW.isoformat(), 1))
        item = self.queue()['items'][0]
        self.assertTrue(item['publication']['currentRevision'])
        self.assertEqual(item['publication']['validation']['status'], 'invalid')
        self.assertIsNone(item['publication']['publicAt'])

    def test_malformed_payloads_return_bounded_safe_diagnostics(self):
        for value in ['{bad', '[]', json.dumps({'facts': []}), 'x' * 131073, None]:
            result = diagnostics.validation_report(value, self.row)
            self.assertIn(result['status'], {'invalid', 'unavailable'})
            self.assertLess(len(json.dumps(result)), 300)
        note = json.loads(json.dumps(NOTE))
        note['facts'][0]['ja'] = '値は99。'
        note['facts'][0]['en'] = 123
        self.assertEqual(diagnostics.validation_report(json.dumps(note), self.row)['status'], 'invalid')

    def test_query_bounds_and_views_fail_closed(self):
        for kwargs in [{'limit': 0}, {'limit': 51}, {'limit': True}, {'limit': 1.5}, {'view': 'raw'}, {'view': 'retry'}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.queue(**kwargs)

    def test_admin_http_get_requires_existing_editor_token_and_has_no_post_action(self):
        # The legacy service suite reloads monitor/signals during discovery.
        # Resolve the service after discovery so its dependency instances match
        # the modules patched by the other transport tests.
        import service
        queue = Mock(return_value={'items': [], 'readOnly': True})
        server = service.ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        server.app = SimpleNamespace(official_research_queue=queue)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}/admin/official-research'
        try:
            with patch.dict(os.environ, {'RESEARCH_EDITOR_TOKEN': 'synthetic-editor-token', 'RESEARCH_API_TOKEN': 'synthetic-api-token'}):
                for auth in [None, 'Bearer wrong-token', 'Bearer synthetic-api-token']:
                    with self.assertRaises(HTTPError) as error:
                        urlopen(Request(url, headers={'Authorization': auth} if auth else {}), timeout=2)
                    self.assertEqual(error.exception.code, 401)
                queue.assert_not_called()
                with urlopen(Request(url, headers={'Authorization': 'Bearer synthetic-editor-token'}), timeout=2) as response:
                    self.assertTrue(json.loads(response.read())['readOnly'])
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                queue.assert_called_once_with(20, 'pending')
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(url, method='POST', data=b'{}', headers={'Authorization': 'Bearer synthetic-editor-token'}), timeout=2)
                self.assertEqual(error.exception.code, 404)
                del os.environ['RESEARCH_EDITOR_TOKEN']
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(url, headers={'Authorization': 'Bearer synthetic-editor-token'}), timeout=2)
                self.assertEqual(error.exception.code, 401)
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
