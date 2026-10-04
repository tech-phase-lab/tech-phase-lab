"""Offline boundaries for editor-only, current business-generation failure copy."""
from contextlib import ExitStack
from datetime import datetime, timedelta
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
import general_source_news as news
import issuer_business_news as issuer_news
import issuer_syndication as syndication
import official_research as research
import official_research_diagnostics as diagnostics
import signals
import test_general_source_news as general_fixture
import test_issuer_business_news as issuer_fixture
import test_official_research as primary_fixture

NOW = general_fixture.NOW
CHECK = 'editor-only-current-failed-output'
PRIVATE = 'PRIVATE-REJECTED-BUSINESS-COPY'
SECRET = 'SYNTHETIC-UNKNOWN-SECRET-DO-NOT-EXPOSE'


def clone(value):
    return json.loads(json.dumps(value))


def encoded_size(value):
    return len(json.dumps(value, ensure_ascii=False).encode('utf-8'))


class BusinessFailedDiagnosticsTests(unittest.TestCase):
    # Reuse only the fixture helper, without inheriting its unrelated tests.
    seed = general_fixture.GeneralSourceNewsTests.seed

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'business.sqlite'
        with research.connect(self.path):
            pass
        # All diagnostic assertions are offline, including indirect helpers.
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for module in (news, issuer_news):
            clock = self.stack.enter_context(patch.object(module, 'datetime', wraps=datetime))
            clock.now.return_value = NOW
        for obj, attr in ((signals, 'fetch'), (research.brief_generator, 'request_response')):
            self.stack.enter_context(patch.object(obj, attr, side_effect=AssertionError('external call')))

    def general_row(self, text=general_fixture.CEO, number=91444, account='wallstengine'):
        self.seed(text=text, number=number, account=account)
        with research.connect(self.path) as db:
            return next(row for row in research.candidates(db, NOW) if row['url'].endswith('/' + str(number)))

    def issuer_row(self):
        with research.connect(self.path) as db:
            syndication.schema(db)
            signals.save(db, issuer_fixture.SOURCE, [{
                'url': issuer_fixture.URL, 'title': issuer_fixture.TITLE,
                'text': issuer_fixture.TITLE, 'matches': {'NBIS': ['Nebius']},
                'publishedAt': issuer_fixture.PUBLISHED, 'truncated': False,
            }], {}, issuer_fixture.OBSERVED, 'synthetic', 1)
        result = syndication.run_once(self.path, NOW, request=lambda *_: {
            'body': issuer_fixture.markup(issuer_fixture.BODY, issuer_fixture.TITLE,
                                          issuer_fixture.URL, 'Nebius'),
        })
        self.assertEqual(result, 'unsupported-facts')
        with research.connect(self.path) as db:
            return next(row for row in research.candidates(db, NOW) if row.get('issuer_business'))

    def primary_row(self):
        with research.connect(self.path) as db:
            db.execute('INSERT INTO sources(url,ticker,title,published_on,discovered_at,sha256) VALUES(?,?,?,?,?,?)',
                       (primary_fixture.URL, 'NBIS', primary_fixture.TITLE, NOW.date().isoformat(), NOW.isoformat(), 'synthetic-primary-sha'))
            db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',
                       (primary_fixture.URL, 'NBIS', NOW.isoformat()))
            db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',
                       (primary_fixture.URL, 'synthetic-primary-sha', NOW.isoformat(), primary_fixture.BODY, len(primary_fixture.BODY)))
            return next(row for row in research.candidates(db, NOW) if row['url'] == primary_fixture.URL)

    def reject(self, row, note=None, *, payload=None, reason='unsupported-number', failed_at=None):
        if payload is None:
            note = clone(note if note is not None else {'facts': general_fixture.CEO_COPY})
            note['facts'][0]['ja'] = PRIVATE + ' 2030。'
            payload = json.dumps(note, ensure_ascii=False)
        lease = 'synthetic-current-lease-' + str(row['id'])
        with research.connect(self.path) as db:
            db.execute('INSERT OR REPLACE INTO official_research_jobs(event_id,sha,attempts,next_at,lease,state,failure_kind) VALUES(?,?,?,?,?,?,?)',
                       (row['id'], row['sha'], 2, NOW.timestamp() + 60, lease, 'retry', reason))
            db.execute('INSERT OR REPLACE INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                       (lease, row['id'], row['sha'], failed_at or NOW.isoformat(), reason, SECRET, payload))
        return lease

    def update_failure(self, row, payload):
        with sqlite3.connect(self.path) as db:
            db.execute('UPDATE official_research_attempt_failures SET payload=? WHERE event_id=?', (payload, row['id']))

    def queue(self, **kwargs):
        return diagnostics.queue(self.path, reference=kwargs.pop('reference', NOW), **kwargs)

    def contexts(self, result):
        return [check for item in result['items'] if item['latestFailure']
                for issue in item['latestFailure']['validation']['issues']
                for check in issue['checks'] if check.get('check') == CHECK]

    def context(self, result):
        contexts = self.contexts(result)
        self.assertEqual(len(contexts), 1)
        return contexts[0]

    def assert_no_context(self, result):
        self.assertFalse(result['rawCopyIncluded'])
        self.assertEqual(self.contexts(result), [])
        self.assertNotIn(PRIVATE, json.dumps(result))

    def direct_context(self, row):
        with sqlite3.connect(self.path) as db:
            db.row_factory = sqlite3.Row
            job = db.execute('SELECT * FROM official_research_jobs WHERE event_id=?', (row['id'],)).fetchone()
            failure = db.execute('SELECT * FROM official_research_attempt_failures WHERE event_id=? ORDER BY rowid LIMIT 1', (row['id'],)).fetchone()
            return diagnostics.current_failed_context(db, row, job, failure, NOW)

    def test_current_general_failure_exposes_only_bounded_context_inside_checks(self):
        row = self.general_row()
        self.reject(row)
        result = self.queue()
        self.assertTrue(result['readOnly'] and result['rawCopyIncluded'])
        context = self.context(result)
        self.assertEqual(context['eventId'], row['id'])
        self.assertEqual(context['sourceSha'], row['sha'])
        self.assertEqual(context['currentBodySha'], row['body_sha'])
        self.assertEqual(context['failedAt'], NOW.isoformat())
        self.assertIn(PRIVATE, context['fields'][0]['ja'])
        self.assertLessEqual(encoded_size(context), 48000)
        item = clone(result['items'][0])
        item['latestFailure']['validation']['issues'][0]['checks'] = []
        self.assertNotIn(PRIVATE, json.dumps(item))
        self.assertEqual(result['items'][0]['latestFailure']['failedCopyContext'], 'included')
        self.assertNotIn(SECRET, json.dumps(result))

    def test_broker_evidence_ids_select_the_exact_current_unit_without_index_guessing(self):
        row = self.general_row(general_fixture.ROUNDUP, 91885, 'TipRanks')
        note = {'facts': clone(general_fixture.BROKER_COPY)}
        note['facts'][1]['evidenceId'] = '3'
        self.reject(row, note)
        fields = self.context(self.queue())['fields']
        pair = next(item for item in fields if item['field'] == 'facts[1]')
        self.assertEqual(pair['evidenceId'], '3')
        self.assertEqual(pair['selectedEvidence'], row['units'][3]['quote'])
        self.assertNotEqual(pair['selectedEvidence'], row['units'][1]['quote'])
        self.assertIn(pair['selectedEvidence'], row['body'])

    def test_issuer_business_failure_is_supported_without_any_pinned_event_id(self):
        row = self.issuer_row()
        self.reject(row, primary_fixture.NOTE)
        context = self.context(self.queue())
        names = {item['field'] for item in context['fields']}
        self.assertEqual(names, {'title', 'summary', 'facts[0]', 'facts[1]', 'facts[2]', 'purpose'})
        for item in context['fields']:
            self.assertTrue(item['selectedEvidenceIsLiteralCurrentBody'])
            self.assertIn(item['selectedEvidence'], row['body'])

    def test_stale_sha_wrong_lease_and_nonretry_jobs_do_not_expose_copy(self):
        row = self.general_row()
        for column, value in [('sha', 'old-sha'), ('lease', 'newer-lease'),
                              ('state', 'running'), ('state', 'done'), ('state', 'stale')]:
            with self.subTest(column=column, value=value):
                self.reject(row)
                with sqlite3.connect(self.path) as db:
                    db.execute('UPDATE official_research_jobs SET ' + column + '=?', (value,))
                self.assert_no_context(self.queue())
        self.reject(row)
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE official_research_attempt_failures SET sha='old-sha'")
        self.assert_no_context(self.queue())

    def test_missing_job_or_failure_do_not_expose_copy(self):
        row = self.general_row()
        for table in ('official_research_jobs', 'official_research_attempt_failures'):
            with self.subTest(table=table):
                self.reject(row)
                with sqlite3.connect(self.path) as db:
                    db.execute('DELETE FROM ' + table)
                self.assert_no_context(self.queue())

    def test_newer_failure_any_sha_or_same_time_later_row_closes_old_context(self):
        row = self.general_row()
        for sha, when in [(row['sha'], NOW + timedelta(seconds=1)),
                          ('another-revision', NOW + timedelta(seconds=1)),
                          ('another-revision', NOW)]:
            with self.subTest(sha=sha, when=when):
                self.reject(row)
                with sqlite3.connect(self.path) as db:
                    db.execute('DELETE FROM official_research_attempt_failures WHERE lease=?', ('newer-failure',))
                    db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                               ('newer-failure', row['id'], sha, when.isoformat(), 'provider-unavailable', SECRET, None))
                self.assert_no_context(self.queue(reference=NOW + timedelta(seconds=2)))

    def test_failed_clock_must_be_aware_valid_after_body_and_not_in_future(self):
        row = self.general_row()
        for when in ['not-a-time', '2026-10-03T08:00:00',
                     (NOW + timedelta(seconds=1)).isoformat(),
                     (NOW - timedelta(days=3)).isoformat()]:
            with self.subTest(when=when):
                self.reject(row, failed_at=when)
                self.assert_no_context(self.queue())

    def test_current_body_proof_is_rechecked_even_when_sha_and_lease_match(self):
        row = self.general_row()
        self.reject(row)
        with patch.object(research, 'current_revision', return_value=False) as current:
            self.assert_no_context(self.queue())
        current.assert_called()
        self.assertEqual(current.call_args.args[1]['id'], row['id'])

    def test_real_source_revision_change_revokes_the_old_copy(self):
        row = self.general_row()
        self.reject(row)
        self.seed(text=general_fixture.CEO.replace('2028', '2029'), number=91444,
                  observed=(NOW - timedelta(seconds=5)).isoformat())
        self.assert_no_context(self.queue())
        self.assertIsNone(self.direct_context(row))

    def test_malformed_missing_and_oversized_payloads_fail_closed(self):
        row = self.general_row()
        self.reject(row)
        payloads = [None, '', '{bad', '[]', 'null', '42', '{"facts":null}',
                    '{"facts":[]}', '{"facts":[{"ja":{},"en":[]}]}', 'x' * 131073,
                    json.dumps({'facts': [{'ja': PRIVATE, 'en': 'E' * 131072}]}),
                    json.dumps({'facts': [{'ja': PRIVATE + '長' * 50000, 'en': 'short'}]}, ensure_ascii=False)]
        for payload in payloads:
            with self.subTest(payload_type=type(payload).__name__, length=len(payload or '')):
                self.update_failure(row, payload)
                self.assert_no_context(self.queue())

    def test_copy_fields_are_truncated_and_unrecognized_secret_fields_are_stripped(self):
        row = self.general_row()
        item = {'ja': '長' * 900, 'en': 'E' * 900, 'evidenceId': '0',
                'headers': SECRET, 'prompt': SECRET, 'api_key': SECRET,
                'request': {'authorization': SECRET}}
        note = {'facts': [clone(item) for _ in range(20)], 'headers': SECRET,
                'instructions': SECRET, 'prompt': SECRET, 'usage': {'secret': SECRET}}
        self.reject(row, payload=json.dumps(note, ensure_ascii=False))
        context = self.context(self.queue())
        self.assertTrue(context['fieldsTruncated'])
        self.assertLessEqual(len(context['fields']), 10)
        for pair in context['fields']:
            self.assertEqual((len(pair['ja']), len(pair['en'])), (600, 600))
            self.assertTrue(pair['jaTruncated'] and pair['enTruncated'])
        self.assertLessEqual(encoded_size(context), 48000)
        serialized = json.dumps(context)
        for unknown in [SECRET, 'api_key', 'authorization', 'headers', 'prompt', 'instructions', 'request']:
            self.assertNotIn(unknown, serialized)

    def test_evidence_ids_never_select_unrelated_unknown_or_nonliteral_text(self):
        row = self.general_row()
        for evidence_id in ('missing', 0, None, {'secret': SECRET}):
            with self.subTest(evidence_id=evidence_id):
                note = {'facts': [{'ja': PRIVATE, 'en': 'Private rejected output.',
                                  'evidenceId': evidence_id, 'evidenceQuote': 'UNRETAINED-PRIVATE-EVIDENCE'}]}
                self.reject(row, payload=json.dumps(note))
                pair = self.context(self.queue())['fields'][0]
                self.assertFalse(pair['selectedEvidenceIsLiteralCurrentBody'])
                self.assertNotIn('selectedEvidence', pair)
                self.assertNotIn('UNRETAINED-PRIVATE-EVIDENCE', json.dumps(pair))
                self.assertNotIn(SECRET, json.dumps(pair))

    def test_quote_only_evidence_requires_a_literal_current_body_and_1800_bound(self):
        row = self.issuer_row()
        self.reject(row, primary_fixture.NOTE)
        for quote in [primary_fixture.QUOTES[0].replace(' ', '  '),
                      'An invented source quote with no relation to retained body.',
                      row['body'] + row['body']]:
            with self.subTest(length=len(quote)):
                note = clone(primary_fixture.NOTE)
                note['facts'][0] = {'ja': PRIVATE, 'en': 'Private rejected output.', 'evidenceQuote': quote}
                self.update_failure(row, json.dumps(note))
                pair = next(item for item in self.context(self.queue())['fields'] if item['field'] == 'facts[0]')
                self.assertFalse(pair['selectedEvidenceIsLiteralCurrentBody'])
                self.assertNotIn('selectedEvidence', pair)

    def test_aggregate_context_budget_is_200k_and_omissions_are_explicit(self):
        row = self.general_row()
        rows = [{**row, 'id': index} for index in range(1, 11)]
        for candidate in rows:
            self.reject(candidate)
        context = self.direct_context(row)
        context['fields'] = [{'field': 'facts[0]', 'ja': '長' * 600, 'en': 'E' * 600,
                              'selectedEvidence': '証' * 1800} for _ in range(6)]
        self.assertLessEqual(encoded_size(context), 48000)
        with patch.object(research, 'candidates', return_value=rows), \
             patch.object(diagnostics, 'current_failed_context', side_effect=lambda db, candidate, *args: {**context, 'eventId': candidate['id']}):
            result = self.queue(limit=20)
        contexts = self.contexts(result)
        self.assertGreater(len(contexts), 0)
        self.assertLess(len(contexts), len(rows))
        self.assertLessEqual(sum(encoded_size(item) for item in contexts), 200000)
        omitted = [item for item in result['items'] if item['latestFailure']['failedCopyContext'] == 'response-budget']
        self.assertEqual(len(contexts) + len(omitted), len(rows))

    def test_existing_primary_route_keeps_old_context_authorization_behavior(self):
        row = self.primary_row()
        self.reject(row, primary_fixture.NOTE)
        self.assertIsNone(self.direct_context(row))
        result = self.queue()
        self.assert_no_context(result)
        self.assertFalse(result['items'][0]['latestFailure']['bodyRevisionRecorded'])

    def test_no_schema_writes_provider_calls_or_public_feed_changes(self):
        row = self.general_row()
        self.reject(row)
        with research.connect(self.path) as db:
            before_feed = research.feed(db, NOW)
            before_updates = signals.public_official_updates(db, reference=NOW, read_only=True)
            before = list(db.iterdump())
        with patch.object(research, 'run_once', side_effect=AssertionError('generation')), \
             patch.object(signals, 'schema', side_effect=AssertionError('schema write')), \
             patch.object(research.bridge, 'sync', side_effect=AssertionError('metadata sync')):
            self.assertTrue(self.queue()['rawCopyIncluded'])
        with sqlite3.connect(self.path) as db:
            self.assertEqual(list(db.iterdump()), before)
        with research.connect(self.path) as db:
            after_feed = research.feed(db, NOW)
            after_updates = signals.public_official_updates(db, reference=NOW, read_only=True)
        self.assertEqual(before_feed, after_feed)
        self.assertEqual(before_updates, after_updates)
        for private in (PRIVATE, SECRET, 'selectedEvidence', 'evidenceQuote', CHECK):
            self.assertNotIn(private, json.dumps([after_feed, after_updates]))
        def attempted_write(db, *args):
            db.execute('DELETE FROM official_research_jobs')
        with patch.object(diagnostics, 'current_failed_context', side_effect=attempted_write), \
             self.assertRaises(sqlite3.OperationalError):
            self.queue()

    def test_public_api_token_stays_401_and_only_editor_get_can_read_failed_copy(self):
        import service
        row = self.general_row()
        self.reject(row)
        queue = Mock(side_effect=lambda limit, view: self.queue(limit=limit, view=view))
        server = service.ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        server.app = SimpleNamespace(official_research_queue=queue)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}/admin/official-research'
        try:
            with patch.dict(os.environ, {'RESEARCH_EDITOR_TOKEN': 'synthetic-editor-token',
                                         'RESEARCH_API_TOKEN': 'synthetic-public-token'}):
                for auth in (None, 'Bearer wrong-token', 'Bearer synthetic-public-token'):
                    with self.subTest(auth=auth), self.assertRaises(HTTPError) as error:
                        urlopen(Request(url, headers={'Authorization': auth} if auth else {}), timeout=2)
                    self.assertEqual(error.exception.code, 401)
                    self.assertNotIn(PRIVATE, error.exception.read().decode())
                queue.assert_not_called()
                with urlopen(Request(url, headers={'Authorization': 'Bearer synthetic-editor-token'}), timeout=2) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                    result = json.loads(response.read())
                    self.assertIn(PRIVATE, json.dumps(self.context(result)))
                queue.assert_called_once_with(20, 'pending')
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(url, method='POST', data=b'{}', headers={'Authorization': 'Bearer synthetic-editor-token'}), timeout=2)
                self.assertEqual(error.exception.code, 404)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
