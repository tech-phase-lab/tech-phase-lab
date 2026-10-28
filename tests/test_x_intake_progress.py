"""Offline pagination/retention invariants; all responses and budgets are synthetic."""
import io
import json
import os
import sqlite3
import sys
import tempfile
from types import SimpleNamespace
import unittest
from datetime import datetime, timedelta, timezone
from email.message import Message
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import signals
import x_api

NOW = datetime(2026, 10, 3, 10, tzinfo=timezone.utc)
CHECKED = NOW.isoformat()


def post(number, text=None, published=CHECKED):
    text = text or 'Micron $MU announces increased memory production capacity.'
    return {'url': f'https://x.com/TipRanks/status/{number}', 'title': text,
            'text': text, 'publishedAt': published, 'truncated': False}


def payload(number, token=None):
    return {'data': [{'id': str(number), 'author_id': '1', 'text': post(number)['text'],
                      'created_at': CHECKED}],
            'includes': {'users': [{'id': '1', 'username': 'TipRanks'}]},
            'meta': {'newest_id': str(number), **({'next_token': token} if token else {})}}


class XIntakeProgressTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        signals.schema(self.db)
        self.source = dict(next(s for s in signals.SOURCES if s['id'] == 'x-tipranks'),
                           query='from:TipRanks -is:retweet -is:reply', enabled=True)
        self.requests = []
        self.pages = []
        self.env = patch.dict(os.environ, {'X_API_ENABLED': 'true', 'X_BEARER_TOKEN': 'synthetic',
                                          'X_FILTERED_STREAM_ENABLED': 'false'})
        self.env.start()
        self.clock = patch.object(signals, 'stamp', return_value=CHECKED)
        self.clock.start()
        self.addCleanup(self.db.close)
        self.addCleanup(self.env.stop)
        self.addCleanup(self.clock.stop)

    def fetch(self, source, validators):
        outer = self
        class Response(io.BytesIO):
            headers = Message()
        Response.headers['Content-Type'] = 'application/json'
        class Opener:
            def open(self, request, timeout):
                outer.requests.append(parse_qs(urlsplit(request.full_url).query))
                return Response(json.dumps(outer.pages.pop(0)).encode())
        return x_api.fetch_posts(source, list(signals.ALIASES), lambda: Opener(), validators)

    def check(self, transport=None, source=None):
        return signals.check(self.db, source or self.source, list(signals.ALIASES), transport or self.fetch)

    def cursor(self):
        return json.loads(self.db.execute('SELECT body FROM signal_index_state WHERE source_id=?',
                                         (self.source['id'],)).fetchone()[0])

    def seed_cursor(self, **cursor):
        cursor.setdefault('queryGeneration', x_api.query_generation(self.source))
        self.db.execute('INSERT OR REPLACE INTO signal_index_state VALUES(?,?)',
                        (self.source['id'], json.dumps(cursor)))
        self.db.commit()

    def test_disk_backpressure_preserves_evidence_cursor_and_budget(self):
        from x_preflight import MIN_FREE_BYTES
        with tempfile.TemporaryDirectory() as folder, sqlite3.connect(Path(folder)/'test.sqlite') as db:
            db.row_factory = sqlite3.Row
            signals.schema(db)
            signals.prepare_x_query_window(db, self.source)
            with db:
                signals.save_evidence(db, self.source, [], {'_acquired_posts': [post(7000)]}, CHECKED)
            cursor = db.execute('SELECT body FROM signal_index_state').fetchone()[0]
            evidence = tuple(db.execute('SELECT * FROM signal_x_acquisition').fetchone())
            for disk in (SimpleNamespace(f_frsize=1, f_bavail=MIN_FREE_BYTES-1), OSError('private path unavailable')):
                transport = Mock(side_effect=AssertionError('low disk must not dispatch'))
                mock = patch.object(signals.os, 'statvfs', side_effect=disk) if isinstance(disk, Exception) else patch.object(signals.os, 'statvfs', return_value=disk)
                with mock:
                    result = signals.check(db, self.source, list(signals.ALIASES), transport)
                self.assertEqual(result['error'], 'x-api-storage-low-or-unavailable')
                transport.assert_not_called()
                self.assertEqual(db.execute('SELECT body FROM signal_index_state').fetchone()[0], cursor)
                self.assertEqual(tuple(db.execute('SELECT * FROM signal_x_acquisition').fetchone()), evidence)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM signal_x_request_attempts').fetchone()[0], 0)
            with patch.object(signals.os, 'statvfs', return_value=SimpleNamespace(f_frsize=1, f_bavail=MIN_FREE_BYTES)):
                signals.require_x_polling_storage(db, self.source)
            with patch.object(signals.os, 'statvfs', side_effect=AssertionError('unscoped route')):
                signals.require_x_polling_storage(db, dict(self.source, id='x-unaffected'))

    def test_service_disk_backpressure_precedes_budget_and_network(self):
        import service
        from x_preflight import MIN_FREE_BYTES
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'service.sqlite'
            app = service.AutomaticMonitor(path, Path(folder)/'snapshot.json')
            with patch.object(signals.os, 'statvfs', return_value=SimpleNamespace(f_frsize=1, f_bavail=MIN_FREE_BYTES-1)), \
                 patch.object(service.signals, 'reserve_x_api_request') as reserve, \
                 patch.object(service.signals, 'acquire') as acquire:
                app.check_signal_source(self.source)
            reserve.assert_not_called()
            acquire.assert_not_called()
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('SELECT error FROM signal_routes WHERE id=?', (self.source['id'],)).fetchone()[0],
                                 'x-api-storage-low-or-unavailable')
                cursor = json.loads(db.execute('SELECT body FROM signal_index_state WHERE source_id=?', (self.source['id'],)).fetchone()[0])
                self.assertEqual(cursor['pagesSaved'], 0)
                self.assertIsNone(cursor['sinceId'])
                self.assertIn('startTime', cursor)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM signal_x_request_attempts').fetchone()[0], 0)

    def test_initial_failures_pin_window_before_transport_and_expiry_never_shifts_it(self):
        class Clock(datetime):
            current = NOW
            @classmethod
            def now(cls, tz=None):
                return cls.current
        def budget_failure(source, validators):
            # This runs where request reservation/provider dispatch normally
            # begins: acquisition intent must already be durable and visible.
            self.assertEqual(json.loads(validators['index_state']), self.cursor())
            self.assertEqual(self.cursor()['pagesSaved'], 0)
            raise signals.XApiDailyLimit((NOW+timedelta(days=1)).isoformat())
        with patch.object(signals, 'datetime', Clock):
            self.assertEqual(self.check(budget_failure)['error'], 'x-api-daily-limit')
            original = self.cursor()
            self.assertEqual(original['startTime'], '2026-10-02T22:00:00Z')
            self.assertIsNone(original['sinceId'])
            coverage = signals.x_intake_coverage(self.db, self.source, NOW)
            self.assertEqual(coverage['acquisitionState'], 'awaiting-first-page')
            self.assertFalse(coverage['completeUpstreamCoverage'])
            self.assertEqual(coverage['pagesSaved'], 0)
            self.assertIsNone(self.db.execute('SELECT succeeded_at FROM signal_routes').fetchone()[0])
            Clock.current += timedelta(days=2)
            def provider_failure(source, validators):
                self.assertEqual(json.loads(validators['index_state'])['startTime'], original['startTime'])
                raise TimeoutError('synthetic provider timeout')
            self.assertEqual(self.check(provider_failure)['status'], 'error')
            self.assertEqual(self.cursor(), original)
            Clock.current += timedelta(days=6)
            transport = Mock(side_effect=AssertionError('expired window must not dispatch'))
            self.assertEqual(self.check(transport)['error'], 'x-api-window-expired')
            transport.assert_not_called()
            self.assertEqual(self.cursor(), original)
            coverage = signals.x_intake_coverage(self.db, self.source, Clock.current)
            self.assertEqual(coverage['acquisitionState'], 'initial-window-expired')
            self.assertEqual(coverage['pagesSaved'], 0)
            self.assertFalse(coverage['completeUpstreamCoverage'])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM signal_x_request_attempts').fetchone()[0], 0)

    def test_budget_pause_restart_preserves_partial_page_and_completed_watermark(self):
        self.seed_cursor(sinceId='7000')
        self.pages = [payload(9000, 'page-two'), payload(8000)]
        now = [NOW]
        def metered(source, validators):
            signals.reserve_x_api_request(self.db, source, now=now[0])
            return self.fetch(source, validators)
        with patch.dict(os.environ, {'X_API_DAILY_REQUEST_LIMIT': '1'}):
            self.assertEqual(self.check(metered)['status'], 'ok')
            partial = self.cursor()
            self.assertEqual(partial['sinceId'], '7000')
            self.assertEqual(partial['nextToken'], 'page-two')
            self.assertEqual(partial['newestId'], '9000')
            self.assertEqual(partial['postsSaved'], 1)
            self.assertEqual(self.check(metered)['error'], 'x-api-daily-limit')
            self.assertEqual(self.cursor(), partial)
            self.assertEqual(len(self.requests), 1)
            coverage = signals.x_intake_coverage(self.db, self.source)
            self.assertEqual(coverage['acquisitionState'], 'pagination-pending')
            self.assertFalse(coverage['completeUpstreamCoverage'])
            # A restarted caller reads only durable state after the budget resets.
            now[0] += timedelta(hours=25)
            self.assertEqual(self.check(metered)['status'], 'ok')
        self.assertEqual(self.requests[1]['next_token'], ['page-two'])
        self.assertEqual(self.requests[1]['since_id'], ['7000'])
        self.assertEqual(self.cursor()['sinceId'], '9000')
        self.assertNotIn('nextToken', self.cursor())
        self.assertEqual(self.cursor()['postsSaved'], 2)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM signal_x_acquisition').fetchone()[0], 2)
        coverage = signals.x_intake_coverage(self.db, self.source)
        self.assertEqual(coverage['assessmentCoverage'], 'not-measured-by-acquisition')
        public = signals.x_operational_summary(self.db, sources=[self.source], reference=NOW)
        self.assertEqual(public['acquisitionCoverage']['trackedQueryRoutes'], 1)
        self.assertEqual(public['acquisitionCoverage']['postObservationsSaved'], 2)
        for private in ('page-two', 'from:TipRanks', x_api.query_generation(self.source)):
            self.assertNotIn(private, json.dumps(public))
        queue = signals.queue(self.db, sources=[self.source])
        self.assertEqual(queue['routes'][0]['acquisitionCoverage']['pagesSaved'], 2)

    def test_query_change_and_unbound_legacy_state_cannot_claim_new_query_coverage(self):
        for generation in ('old-query', None):
            self.seed_cursor(sinceId='99999', newestId='999999', nextToken='old-page',
                             pagesSaved=100, postsSaved=3000, queryGeneration=generation)
            coverage = signals.x_intake_coverage(self.db, self.source)
            self.assertFalse(coverage['currentQueryTracked'])
            self.assertFalse(coverage['paginationPending'])
            self.assertEqual(coverage['pagesSaved'], 0)
            self.pages = [payload(9000)]
            self.assertEqual(self.check()['status'], 'ok')
            self.assertNotIn('since_id', self.requests[-1])
            self.assertNotIn('next_token', self.requests[-1])
            self.assertIn('start_time', self.requests[-1])
            self.assertEqual(self.cursor()['pagesSaved'], 1)
            self.assertEqual(self.cursor()['sinceId'], '9000')

    def test_parser_configuration_change_does_not_discard_same_query_continuation(self):
        self.seed_cursor(sinceId='7000', newestId='9000', nextToken='page-two')
        self.db.execute('INSERT INTO signal_routes(id,config_sha,initialized) VALUES(?,?,1)',
                        (self.source['id'], 'old-parser-fingerprint'))
        self.db.commit()
        self.pages = [payload(8000)]
        self.assertEqual(self.check(source=dict(self.source, financingUpdates=False))['status'], 'ok')
        self.assertEqual(self.requests[-1]['next_token'], ['page-two'])
        self.assertEqual(self.cursor()['sinceId'], '9000')

    def test_unsaved_or_unassessable_page_never_advances_cursor(self):
        self.seed_cursor(sinceId='7000', newestId='9000', nextToken='page-two')
        original = self.cursor()
        incomplete = payload(8000)
        del incomplete['includes']
        self.pages = [incomplete]
        self.assertEqual(self.check()['status'], 'error')
        self.assertEqual(self.cursor(), original)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM signal_x_acquisition').fetchone()[0], 0)
        self.db.execute("CREATE TRIGGER reject_save BEFORE INSERT ON signal_x_acquisition BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END")
        self.db.commit()
        self.pages = [payload(8000)]
        self.assertEqual(self.check()['status'], 'error')
        self.assertEqual(self.cursor(), original)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM signal_x_retention').fetchone()[0], 0)

    def test_silently_ignored_storage_and_missing_response_rows_do_not_advance(self):
        self.seed_cursor(sinceId='7000')
        original = self.cursor()
        self.pages = [{'meta': {'newest_id': '9000', 'result_count': 1}}]
        self.assertEqual(self.check()['error'], 'x-api-incomplete-evidence')
        self.assertEqual(self.cursor(), original)
        self.db.execute("CREATE TRIGGER ignore_save BEFORE INSERT ON signal_x_acquisition BEGIN SELECT RAISE(IGNORE); END")
        self.db.commit()
        self.pages = [payload(9000)]
        self.assertEqual(self.check()['error'], 'x-api-incomplete-evidence')
        self.assertEqual(self.cursor(), original)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM signal_x_retention').fetchone()[0], 0)

    def test_pacing_deferral_keeps_continuation_without_freshness_claim(self):
        self.seed_cursor(sinceId='7000', newestId='9000', nextToken='page-two')
        original = self.cursor()
        def paced(source, validators):
            raise signals.XApiPacing((NOW+timedelta(minutes=10)).isoformat())
        result = self.check(paced)
        self.assertEqual(result['status'], 'deferred')
        self.assertEqual(self.cursor(), original)
        self.assertIsNone(self.db.execute('SELECT succeeded_at FROM signal_routes').fetchone()[0])

    def save_batch(self, posts, selected=False, checked=CHECKED):
        items = [dict(p, matches={'MU': ['$MU']}) for p in posts] if selected else []
        signals.save(self.db, self.source, items, {'_acquired_posts': posts}, checked,
                     signals.fingerprint(self.source, list(signals.ALIASES)), 0)

    def test_recent_unclassified_and_selected_rows_survive_soft_limit(self):
        posts = [post(i) for i in range(1, 1003)]
        self.save_batch(posts, selected=True)
        for table in ('signal_x_acquisition', 'signal_events', 'signal_documents'):
            self.assertEqual(self.db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0], 1002)
        # Also retain a fresh unsupported company-relevant post without an event.
        self.save_batch([post(1003, 'Micron memory market commentary requiring editorial review.')])
        coverage = signals.x_intake_coverage(self.db, self.source)
        self.assertEqual(coverage['rowsAboveRetentionTarget'], 3)
        self.assertEqual(coverage['knownOmittedAcquisitionRows'], 0)
        self.assertTrue(coverage['retentionTargetIsSoft'])
        self.assertEqual(self.db.execute('SELECT selected_for_processing FROM signal_x_acquisition WHERE url=?',
                                        (post(1003)['url'],)).fetchone()[0], 0)

    def test_expired_omissions_are_counted_but_old_job_evidence_is_preserved(self):
        old = (NOW-timedelta(days=9)).isoformat()
        # Insert old raw/event/document evidence first, then a job protects it.
        self.save_batch([post(1, published=old)], selected=True, checked=old)
        event = self.db.execute('SELECT id FROM signal_events').fetchone()[0]
        self.db.execute('CREATE TABLE official_research_jobs(event_id INTEGER PRIMARY KEY,sha TEXT,lease TEXT,state TEXT)')
        sha = self.db.execute('SELECT sha FROM signal_events WHERE id=?', (event,)).fetchone()[0]
        self.db.execute('INSERT INTO official_research_jobs VALUES(?,?,?,?)', (event, sha, 'pending-lease', 'running'))
        self.db.commit()
        # One expired unlinked row will fall outside the soft target.
        self.save_batch([post(2, published=old)], selected=True, checked=old)
        self.save_batch([post(i) for i in range(3, 1003)], selected=True)
        for table in ('signal_x_acquisition', 'signal_events', 'signal_documents'):
            self.assertIsNotNone(self.db.execute(f'SELECT 1 FROM {table} WHERE url=?', (post(1)['url'],)).fetchone())
            self.assertIsNone(self.db.execute(f'SELECT 1 FROM {table} WHERE url=?', (post(2)['url'],)).fetchone())
        self.assertEqual(self.db.execute('SELECT id,sha FROM signal_events WHERE url=?',
                                        (post(1)['url'],)).fetchone()[:], (event, sha))
        self.assertEqual(self.db.execute('SELECT sha,text FROM signal_documents WHERE url=?',
                                        (post(1)['url'],)).fetchone()[:], (sha, post(1)['text']))
        self.assertEqual(self.db.execute('SELECT * FROM official_research_jobs').fetchone()[:],
                         (event, sha, 'pending-lease', 'running'))
        coverage = signals.x_intake_coverage(self.db, self.source)
        for key in ('knownOmittedAcquisitionRows', 'knownOmittedDocumentRows', 'knownOmittedEventRows'):
            self.assertEqual(coverage[key], 1)
        self.assertEqual(coverage['rowsAboveRetentionTarget'], 1)
        self.assertTrue(coverage['historicalOmissionsBeforeTrackingUnknown'])
        before = self.db.total_changes
        signals.x_intake_coverage(self.db, self.source)
        self.assertEqual(self.db.total_changes, before)

    def test_expired_unlinked_event_omissions_work_without_job_tables(self):
        old = (NOW-timedelta(days=9)).isoformat()
        self.save_batch([post(1, published=old)], selected=True, checked=old)
        self.save_batch([post(i) for i in range(2, 1002)], selected=True)
        for table in ('signal_x_acquisition', 'signal_events', 'signal_documents'):
            self.assertIsNone(self.db.execute(f'SELECT 1 FROM {table} WHERE url=?', (post(1)['url'],)).fetchone())
        self.assertEqual(signals.x_intake_coverage(self.db, self.source)['knownOmittedEventRows'], 1)

    def test_unscoped_routes_keep_hard_retention_target(self):
        self.source['id'] = 'x-other-existing-route'
        self.save_batch([post(i) for i in range(1002)])
        coverage = signals.x_intake_coverage(self.db, self.source)
        self.assertEqual(coverage['retainedAcquisitionRows'], 1000)
        self.assertEqual(coverage['knownOmittedAcquisitionRows'], 2)
        self.assertFalse(coverage['retentionTargetIsSoft'])


if __name__ == '__main__':
    unittest.main()
