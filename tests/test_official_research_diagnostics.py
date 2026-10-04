import json
import os
from datetime import timedelta
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
import official_research_content_repair as repair
import test_official_research_content_repair as repair_tests
from test_official_research import NOW, URL, TITLE, BODY, NOTE, copy
from test_official_research_content_repair import NOW as REPAIR_NOW, NOTE as REPAIR_NOTE, BODY as REPAIR_BODY, QUOTE as REPAIR_QUOTE


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
                headers={'Authorization': 'Bearer synthetic-editor-token'}
                with urlopen(Request(url+'?view=all&limit=50&beforeEventId=1246&terminalBeforeEventId=1240',headers=headers),timeout=2) as response:
                    self.assertEqual(response.status,200)
                queue.assert_called_with(50,'all',before_event_id=1246,terminal_before_event_id=1240)
                for query in ('beforeEventId=', 'beforeEventId=0', 'beforeEventId=-1',
                              'beforeEventId=1.5', 'beforeEventId=9007199254740992',
                              'beforeEventId=2&beforeEventId=3', 'terminalBeforeEventId=abc'):
                    with self.subTest(query=query), self.assertRaises(HTTPError) as error:
                        urlopen(Request(url+'?'+query,headers=headers),timeout=2)
                    self.assertEqual(error.exception.code,400)
                self.assertEqual(queue.call_count,2)
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(url, method='POST', data=b'{}', headers={'Authorization': 'Bearer synthetic-editor-token'}), timeout=2)
                self.assertEqual(error.exception.code, 404)
                del os.environ['RESEARCH_EDITOR_TOKEN']
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(url, headers={'Authorization': 'Bearer synthetic-editor-token'}), timeout=2)
                self.assertEqual(error.exception.code, 401)
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)


class BoundedRepairContextTests(unittest.TestCase):
    # Share the exact pinned identity fixture without inheriting worker tests.
    fixture = repair_tests.ContentRepairTests.fixture

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.number = 0
        self.reference = REPAIR_NOW + timedelta(minutes=15)
        self.note = json.loads(json.dumps(REPAIR_NOTE))
        self.note['facts'][0]['ja'] = 'NVIDIAが1MWあたりのソフトウェアを発表した。'
        for obj, attr in [(research.signals, 'fetch'), (research.brief_generator, 'request_response')]:
            mocked = patch.object(obj, attr, side_effect=AssertionError('external call'))
            mocked.start()
            self.addCleanup(mocked.stop)

    def consumed(self, ids=(1213,), note=None):
        path = self.fixture(ids)
        note = self.note if note is None else note
        with research.connect(path) as db:
            for row in research.candidates(db, REPAIR_NOW):
                job = db.execute('SELECT * FROM official_research_jobs WHERE event_id=?', (row['id'],)).fetchone()
                lease = f'consumed-repair-{row["id"]}'
                repair.record_claim(db, row, job, lease, REPAIR_NOW, True)
                db.execute("UPDATE official_research_jobs SET attempts=7,lease=? WHERE event_id=?", (lease, row['id']))
                db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                           (lease, row['id'], row['sha'], (REPAIR_NOW + timedelta(minutes=10)).isoformat(),
                            'unsupported-number', 'PRIVATE-PROVIDER-DETAIL', json.dumps(note)))
        return path

    def queue(self, path, **kwargs):
        return diagnostics.queue(path, reference=kwargs.pop('reference', self.reference), **kwargs)

    def context(self, item):
        return [check for issue in item['latestFailure']['validation']['issues'] for check in issue['checks']
                if check.get('check') == 'editor-only-authorized-bounded-context']

    def assert_no_context(self, result):
        self.assertFalse(result['rawCopyIncluded'])
        encoded = json.dumps(result, ensure_ascii=False)
        for private in [self.note['facts'][0]['ja'], REPAIR_QUOTE, 'rejectedFields', 'validatedFields', 'consumed-repair-', 'PRIVATE-PROVIDER-DETAIL']:
            self.assertNotIn(private, encoded)

    def test_exact_both_repair_failures_include_original_pairs_and_literal_evidence(self):
        path = self.consumed((1213, 1214))
        result = self.queue(path)
        self.assertTrue(result['rawCopyIncluded'])
        self.assertEqual({item['eventId'] for item in result['items']}, {1213, 1214})
        for item in result['items']:
            self.assertTrue(item['latestFailure']['bodyRevisionRecorded'])
            contexts = self.context(item)
            self.assertEqual(len(contexts), 1)
            context = contexts[0]
            self.assertIn('editor-only authorized bounded context', context['notice'])
            rejected = context['rejectedFields']
            self.assertEqual(len(rejected), 1)
            self.assertEqual(rejected[0]['field'], 'facts[0]')
            self.assertEqual(rejected[0]['ja'], self.note['facts'][0]['ja'])
            self.assertEqual(rejected[0]['en'], self.note['facts'][0]['en'])
            self.assertEqual(rejected[0]['selectedEvidence'], REPAIR_QUOTE)
            self.assertTrue(rejected[0]['selectedEvidenceIsLiteralCurrentBody'])
            self.assertEqual([pair['field'] for pair in context['validatedFields']],
                             ['title', 'summary', 'facts[1]', 'facts[2]', 'purpose'])
        encoded = json.dumps(result, ensure_ascii=False)
        for private in [REPAIR_BODY, 'PRIVATE-PROVIDER-DETAIL', 'consumed-repair-', 'previous-']:
            self.assertNotIn(private, encoded)

    def test_missing_audit_failure_job_or_wrong_proof_never_includes_prose(self):
        changes = [
            'DROP TABLE official_research_content_repairs',
            'DELETE FROM official_research_content_repairs',
            'DELETE FROM official_research_attempt_failures',
            'DELETE FROM official_research_jobs',
            "UPDATE official_research_content_repairs SET event_id=9999",
            "UPDATE official_research_content_repairs SET source_id='primary-ir-AMD'",
            "UPDATE official_research_content_repairs SET sha='old-source'",
            "UPDATE official_research_content_repairs SET body_sha='old-body'",
            "UPDATE official_research_content_repairs SET policy_id='another-policy'",
            "UPDATE official_research_content_repairs SET lease='another-lease'",
            "UPDATE official_research_content_repairs SET mode='unapproved'",
            "UPDATE official_research_content_repairs SET claimed_at='invalid'",
            "UPDATE official_research_content_repairs SET claimed_at='2026-10-03T01:41:00+00:00'",
            "UPDATE official_research_content_repairs SET claimed_at='2026-10-03T01:00:00+00:00'",
            "UPDATE official_research_content_repairs SET previous_attempts=5",
            "UPDATE official_research_jobs SET lease='later-job'",
            "UPDATE official_research_jobs SET sha='old-source'",
            "UPDATE official_research_jobs SET state='running'",
            "UPDATE official_research_jobs SET failure_kind='provider-unavailable'",
            "UPDATE official_research_attempt_failures SET sha='old-source'",
            "UPDATE official_research_attempt_failures SET reason='invalid-copy'",
            "UPDATE official_research_attempt_failures SET failed_at='2026-10-03T01:50:00+00:00'",
        ]
        for sql in changes:
            with self.subTest(sql=sql):
                path = self.consumed()
                with sqlite3.connect(path) as db:
                    db.execute(sql)
                self.assert_no_context(self.queue(path))

    def test_exact_cohort_and_retained_row_are_rechecked_even_for_a_stale_candidate(self):
        changes = [
            "UPDATE signal_events SET id=9999",
            "UPDATE signal_events SET source_id='primary-ir-AMD'",
            "UPDATE signal_events SET title=title || ' changed'",
            "UPDATE sources SET sha256='old-body'",
            "UPDATE sources SET status='held'",
            "UPDATE sources SET error='source-http-429'",
            "UPDATE source_revisions SET extracted_text=extracted_text || ' changed'",
            'DELETE FROM source_revisions',
        ]
        for sql in changes:
            with self.subTest(sql=sql):
                path = self.consumed()
                with research.connect(path) as db:
                    rows = research.candidates(db, self.reference)
                    db.execute(sql)
                with patch.object(research, 'candidates', return_value=rows):
                    self.assert_no_context(self.queue(path))
        path = self.consumed()
        with research.connect(path) as db:
            row = research.candidates(db, self.reference)[0]
        for modified in ({**row, 'id': 9999}, {**row, 'source_id': 'primary-ir-AMD'}, {**row, 'body_cached': True}):
            with self.subTest(modified=modified['id']), patch.object(research, 'candidates', return_value=[modified]):
                self.assert_no_context(self.queue(path))

    def test_expiry_and_newer_failure_of_any_revision_close_context(self):
        path = self.consumed()
        for reference in (repair.DEPLOYED_AT - timedelta(microseconds=1), repair.EXPIRES_AT):
            self.assert_no_context(self.queue(path, reference=reference))
        with research.connect(path) as db:
            row = research.candidates(db, self.reference)[0]
            db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                       ('newer-unrelated', row['id'], 'another-source-sha', self.reference.isoformat(),
                        'provider-unavailable', '', None))
        self.assert_no_context(self.queue(path))

    def test_snippets_are_bounded_and_unknown_payload_fields_never_escape(self):
        note = json.loads(json.dumps(self.note))
        note['facts'][0] = {'ja': '長' * 500, 'en': 'E' * 500, 'evidenceQuote': REPAIR_BODY + ' appended literal text' * 30}
        note['request'] = {'headers': 'SECRET-PROVIDER-HEADERS'}
        note['facts'][1]['request'] = 'SECRET-ITEM-REQUEST'
        path = self.consumed(note=note)
        with sqlite3.connect(path) as db:
            db.execute('UPDATE source_revisions SET extracted_text=?', (note['facts'][0]['evidenceQuote'],))
        context = self.context(self.queue(path)['items'][0])[0]
        rejected = context['rejectedFields'][0]
        self.assertEqual((len(rejected['ja']), len(rejected['en']), len(rejected['selectedEvidence'])), (400, 400, 1800))
        self.assertTrue(rejected['jaTruncated'] and rejected['enTruncated'] and rejected['evidenceTruncated'])
        self.assertNotIn('SECRET-', json.dumps(context))
        self.assertNotIn('facts[1]', [pair['field'] for pair in context['validatedFields']])

    def test_normalized_or_invented_quote_is_never_returned_as_literal_evidence(self):
        for quote in [REPAIR_QUOTE.replace(' ', '  '), 'An invented evidence quote that is absent from the retained body.']:
            with self.subTest(quote=quote):
                note = json.loads(json.dumps(self.note))
                note['facts'][0]['evidenceQuote'] = quote
                context = self.context(self.queue(self.consumed(note=note))['items'][0])[0]
                rejected = context['rejectedFields'][0]
                self.assertFalse(rejected['selectedEvidenceIsLiteralCurrentBody'])
                self.assertNotIn('selectedEvidence', rejected)
                self.assertNotIn(quote, json.dumps(context))

    def test_invalid_payload_or_valid_note_does_not_mark_raw_copy_included(self):
        for payload in ('{bad', '[]', json.dumps({'facts': []}), 'x' * 131073, json.dumps(REPAIR_NOTE)):
            with self.subTest(payload=payload[:30]):
                path = self.consumed()
                with sqlite3.connect(path) as db:
                    db.execute('UPDATE official_research_attempt_failures SET payload=?', (payload,))
                self.assert_no_context(self.queue(path))

    def test_validated_pairs_preserve_original_copy_before_brand_case_normalization(self):
        note = json.loads(json.dumps(self.note))
        note['facts'][1]['en'] = 'GEForce software is available.'
        result = self.queue(self.consumed(note=note))
        pairs = self.context(result['items'][0])[0]['validatedFields']
        self.assertEqual(next(pair for pair in pairs if pair['field'] == 'facts[1]')['en'], note['facts'][1]['en'])

    def test_scoped_prose_is_only_accessible_with_existing_editor_token(self):
        import service
        path = self.consumed()
        queue = Mock(side_effect=lambda limit, view: self.queue(path, limit=limit, view=view))
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
                    result = json.loads(response.read())
                    self.assertTrue(result['rawCopyIncluded'])
                    self.assertEqual(len(self.context(result['items'][0])), 1)
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                queue.assert_called_once_with(20, 'pending')
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)

    def test_scope_read_does_not_write_generate_or_change_public_feeds(self):
        path = self.consumed()
        with research.connect(path) as db:
            public_before = research.feed(db, self.reference)
            public_updates = research.signals.public_official_updates(db, reference=self.reference, read_only=True)
            before = list(db.iterdump())
        with patch.object(research, 'run_once', side_effect=AssertionError('generation')), \
             patch.object(research.signals, 'schema', side_effect=AssertionError('schema write')), \
             patch.object(research.bridge, 'sync', side_effect=AssertionError('metadata sync')):
            self.assertTrue(self.queue(path)['rawCopyIncluded'])
        with sqlite3.connect(path) as db:
            self.assertEqual(list(db.iterdump()), before)
        with research.connect(path) as db:
            self.assertEqual(research.feed(db, self.reference), public_before)
            self.assertEqual(research.signals.public_official_updates(db, reference=self.reference, read_only=True), public_updates)
        def attempted_write(db, *args):
            db.execute('DELETE FROM official_research_content_repairs')
        with patch.object(diagnostics, 'context_authorized', side_effect=attempted_write), self.assertRaises(sqlite3.OperationalError):
            self.queue(path)


if __name__ == '__main__':
    unittest.main()
