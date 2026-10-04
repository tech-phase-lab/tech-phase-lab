"""Default-off service wiring and guarded fallback, with zero live I/O."""
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor
import service
import signals
import x_api
import x_budget
import x_stream
import x_stream_runtime as runtime
from test_x_stream import NOW, envelope, policy, search_payload, FakeStream


def bundle(now=NOW):
    rules = [dict(rule, id=str(index)) for index, rule in enumerate(x_stream.manifest(), 1)]
    return {'version': 1, 'approved': True, 'approval_id': 'synthetic-fixture-only', 'approved_at': now.isoformat(),
            'manifest_sha256': runtime.manifest_sha(), 'verified_at': now.isoformat(), 'inventory': rules,
            'rules_complete': True, 'single_consumer_verified': True, 'stream_entitlement_verified': True,
            'spending_approved': True, 'budget': policy(now), 'initial_recovery_start': (now-timedelta(minutes=10)).isoformat(),
            'stream_allowance_micros': 15000, 'reconcile_seconds': 300, 'fallback_seconds': 30}


class SecretGuard(dict):
    reads = 0
    allow = False

    def get(self, key, default=None):
        if key == 'X_BEARER_TOKEN':
            self.reads += 1
            if not self.allow:
                raise AssertionError('credential accessed before preflight + budget admission')
            return 'synthetic-token'
        return super().get(key, default)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.path = self.root / 'monitor.sqlite'
        self.config = self.root / 'preflight.json'
        self.payload = bundle()
        self.config.write_text(json.dumps(self.payload))
        self.env = SecretGuard({runtime.FLAG: 'true', runtime.BUNDLE_ENV: str(self.config),
                               'X_API_ENABLED': 'true', 'RESEARCH_SIGNALS_ENABLED': 'true'})
        self.now = NOW
        self.stop = threading.Event()
        self.report = Mock()
        self.factory = Mock(side_effect=AssertionError('provider construction forbidden'))
        self.supervisor = runtime.Supervisor(self.path, list(monitor.PROVIDERS), self.stop, Mock(),
                                             env=self.env, clock=lambda: self.now, transport_factory=self.factory,
                                             report=self.report)

    def tearDown(self):
        if self.supervisor.db:
            self.supervisor.db.close()
        self.temp.cleanup()

    def test_off_has_no_db_bundle_client_token_or_loop_side_effect(self):
        self.env[runtime.FLAG] = 'false'
        with patch.object(runtime, 'load_bundle', side_effect=AssertionError('preflight read on OFF')), \
             patch.object(runtime.asyncio, 'run', side_effect=AssertionError('loop created on OFF')):
            self.supervisor.run()
        self.assertFalse(self.path.exists())
        self.assertEqual(self.env.reads, 0)
        self.factory.assert_not_called()

    def test_every_missing_activation_proof_fails_before_credentials_or_database(self):
        changes = [
            {'approved': False}, {'rules_complete': False}, {'single_consumer_verified': False},
            {'stream_entitlement_verified': False}, {'spending_approved': False},
            {'inventory': self.payload['inventory'] + [{'id': '999', 'value': 'cats', 'tag': 'foreign'}]},
            {'manifest_sha256': 'unreviewed'}, {'verified_at': (NOW-timedelta(minutes=16)).isoformat()},
            {'budget': policy(all_consumers_identified=False)}, {'budget': policy(spend_reconciled=False)},
            {'budget': policy(prices_verified=False)}, {'budget': policy(account_cap_micros=25_000_000)},
            {'budget': policy(reserve_micros=0)}, {'stream_allowance_micros': 0},
            {'initial_recovery_start': (NOW-timedelta(days=8)).isoformat()},
        ]
        for change in changes:
            with self.subTest(change=change):
                self.config.write_text(json.dumps(self.payload | change))
                with self.assertRaises((x_stream.StreamBlocked, x_budget.BudgetBlocked)):
                    self.supervisor.initialize()
                self.assertFalse(self.path.exists())
                self.assertEqual(self.env.reads, 0)
                self.factory.assert_not_called()

    def test_requested_but_missing_preflight_is_reported_without_paid_fallback(self):
        del self.env[runtime.BUNDLE_ENV]
        self.supervisor.run()
        self.assertEqual(self.report.call_args[0][0]['mode'], 'operator-blocked')
        self.assertEqual(self.env.reads, 0)
        self.factory.assert_not_called()
        self.assertFalse(self.path.exists())

    def test_initialize_is_pure_local_and_bootstrap_is_explicit_bounded(self):
        self.assertTrue(self.supervisor.initialize())
        self.factory.assert_not_called()
        self.assertEqual(self.env.reads, 0)
        rows = self.supervisor.db.execute('SELECT * FROM x_stream_gaps').fetchall()
        self.assertEqual(len(rows), 4)
        self.assertEqual(x_budget.utc(rows[0]['start_at']), NOW-timedelta(minutes=10))
        self.assertEqual(x_budget.utc(rows[0]['end_at']), NOW-timedelta(seconds=10))
        self.assertEqual(self.supervisor.db.execute('SELECT COUNT(*) FROM x_budget_reservations').fetchone()[0], 0)

    def test_money_admission_precedes_token_and_search_and_projection_preserves_quarantine(self):
        self.supervisor.initialize()
        co, db = self.supervisor.co, self.supervisor.db
        # A post quarantined via stream must remain private when Search returns it.
        co.offline = True
        old = envelope(published=NOW-timedelta(minutes=2))
        co.ingest_fixture(old)
        co.drain()
        edited = envelope(identity='101', published=NOW-timedelta(minutes=1))
        edited['data']['edit_history_post_ids'] = ['100', '101']
        co.ingest_fixture(edited)
        co.drain()
        co.offline = False
        self.assertEqual(signals.public_price_targets(db, now=NOW)['items'], [])
        env, assertions, calls = self.env, self, []
        class Client:
            def __init__(self, **kwargs):
                self.options = kwargs
            async def search(self, url, params):
                assertions.assertEqual(url, x_api.API_URL)
                assertions.assertTrue(self.options['admission']())
                assertions.assertGreater(db.execute('SELECT reserved FROM x_budget_reservations ORDER BY rowid DESC LIMIT 1').fetchone()[0], 0)
                env.allow = True
                assertions.assertEqual(self.options['token_provider'](), 'synthetic-token')
                calls.append(params)
                return search_payload(old)
        self.supervisor.transport_factory = Client
        with patch.dict('os.environ', {'X_API_DAILY_REQUEST_LIMIT': '4400'}):
            self.assertTrue(asyncio.run(self.supervisor.recover_once()))
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]['query'], co.sources['x-wallstengine']['query'])
        self.assertEqual(env.reads, 1)
        self.assertEqual(signals.public_price_targets(db, now=NOW)['items'], [])
        self.assertEqual(db.execute('SELECT COUNT(*) FROM signal_index_state').fetchone()[0], 0)
        self.assertEqual(db.execute('SELECT reserved FROM x_budget_reservations').fetchone()[0], 15000)

    def test_budget_exhaustion_and_stale_snapshot_never_construct_client(self):
        self.supervisor.initialize()
        x_budget.reserve(self.supervisor.db, 'control', 1_000_000, NOW)
        with patch.dict('os.environ', {'X_API_DAILY_REQUEST_LIMIT': '4400'}):
            with self.assertRaises(x_budget.BudgetBlocked):
                asyncio.run(self.supervisor.recover_once())
        self.factory.assert_not_called()
        self.now += timedelta(minutes=16)
        with self.assertRaises((x_budget.BudgetBlocked, x_stream.StreamBlocked)):
            self.supervisor.refresh()
        self.assertEqual(self.env.reads, 0)

    def test_second_supervisor_and_flag_rollback_cannot_spend_outside_shared_ledger(self):
        self.supervisor.initialize()
        other = runtime.Supervisor(self.path, [], threading.Event(), Mock(), env=self.env,
                                   clock=lambda: NOW, transport_factory=self.factory)
        try:
            with self.assertRaisesRegex(x_stream.StreamBlocked, 'existing-owner-needs-review'):
                other.initialize()
        finally:
            if other.db:
                other.db.close()
        self.factory.assert_not_called()
        with patch.dict('os.environ', {runtime.FLAG: 'false'}):
            with self.assertRaisesRegex(ValueError, 'stream-supervisor-required'):
                signals.reserve_x_api_request(self.supervisor.db, self.supervisor.co.sources['x-wallstengine'], NOW)
        self.assertEqual(self.env.reads, 0)

    def test_provider_quota_stops_all_shared_reads_and_no_paid_retry(self):
        self.supervisor.initialize()
        calls = []
        class Client:
            def __init__(self, **_kwargs):
                pass
            async def search(self, *_args):
                calls.append(1)
                raise x_stream.TransportFailure(429, quota=True)
        self.supervisor.transport_factory = Client
        with patch.dict('os.environ', {'X_API_DAILY_REQUEST_LIMIT': '4400'}):
            self.assertFalse(asyncio.run(self.supervisor.recover_once()))
        with self.assertRaises(x_budget.BudgetBlocked):
            asyncio.run(self.supervisor.recover_once())
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.supervisor.db.execute('SELECT reserved FROM x_budget_reservations').fetchone()[0], 450000)

    def test_unconfirmed_search_socket_close_globally_blocks_replacement(self):
        self.supervisor.initialize()
        class Client:
            def __init__(self, **_kwargs):
                pass
            async def search(self, *_args):
                raise x_stream.TransportFailure(None, connection_conflict=True)
        self.supervisor.transport_factory = Client
        with patch.dict('os.environ', {'X_API_DAILY_REQUEST_LIMIT': '4400'}):
            self.assertFalse(asyncio.run(self.supervisor.recover_once()))
        db = self.supervisor.db
        self.assertEqual(db.execute('SELECT state FROM x_stream_state').fetchone()[0], 'operator-blocked')
        self.assertEqual(db.execute('SELECT reserved FROM x_budget_reservations').fetchone()[0], 450000)
        with self.assertRaises(x_budget.BudgetBlocked):
            x_budget.reserve(db, 'stream', 15000, NOW)

    def test_invalid_query_and_redirect_search_failures_are_terminal(self):
        for status in (302, 400, 404):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as root:
                supervisor = runtime.Supervisor(Path(root)/'intake.sqlite', [], self.stop, Mock(),
                                                env=self.env, clock=lambda: NOW)
                supervisor.initialize()
                class Client:
                    def __init__(self, **_kwargs):
                        pass
                    async def search(self, *_args):
                        raise x_stream.TransportFailure(status)
                supervisor.transport_factory = Client
                with patch.dict('os.environ', {'X_API_DAILY_REQUEST_LIMIT': '4400'}):
                    self.assertFalse(asyncio.run(supervisor.recover_once()))
                self.assertEqual(supervisor.db.execute('SELECT state FROM x_stream_state').fetchone()[0], 'operator-blocked')
                self.assertEqual(supervisor.db.execute('SELECT COUNT(*) FROM x_stream_search_retry').fetchone()[0], 0)
                self.assertEqual(supervisor.db.execute('SELECT COUNT(*) FROM x_budget_stop').fetchone()[0], 1)
                supervisor.db.close()

    def test_known_search_payload_is_metered_when_cleanup_fails(self):
        self.supervisor.initialize()
        payload = search_payload(envelope())
        payload['data'] = [dict(payload['data'][0], id=str(i)) for i in range(40)]
        payload['includes']['users'] = [{'id': str(i), 'username': 'TipRanks'} for i in range(40)]
        payload['meta']['result_count'] = 40
        class Client:
            def __init__(self, **_kwargs):
                pass
            async def search(self, *_args):
                failure = x_stream.TransportFailure(None, connection_conflict=True)
                failure.received_payload = payload
                raise failure
        self.supervisor.transport_factory = Client
        with patch.dict('os.environ', {'X_API_DAILY_REQUEST_LIMIT': '4400'}):
            self.assertFalse(asyncio.run(self.supervisor.recover_once()))
        db = self.supervisor.db
        self.assertEqual(db.execute('SELECT consumed FROM x_budget_reservations').fetchone()[0], 600000)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM signal_events').fetchone()[0], 0)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM x_budget_stop').fetchone()[0], 1)

    def test_recoverable_search_error_persists_bounded_retry_and_reservation(self):
        self.supervisor.initialize()
        class Client:
            def __init__(self, **_kwargs):
                pass
            async def search(self, *_args):
                raise x_stream.TransportFailure(503, retry_after=120)
        self.supervisor.transport_factory = Client
        with patch.dict('os.environ', {'X_API_DAILY_REQUEST_LIMIT': '4400'}):
            self.assertFalse(asyncio.run(self.supervisor.recover_once()))
        row = self.supervisor.db.execute('SELECT * FROM x_stream_search_retry').fetchone()
        self.assertEqual(x_budget.utc(row['retry_at']), NOW+timedelta(seconds=120))
        self.assertEqual(self.supervisor.db.execute('SELECT COUNT(*) FROM x_budget_stop').fetchone()[0], 0)
        self.assertEqual(self.supervisor.db.execute('SELECT reserved FROM x_budget_reservations').fetchone()[0], 450000)

    def test_full_supervisor_fake_stream_acquires_and_stops_own_socket(self):
        stop, env, frame = self.stop, self.env, envelope()
        sockets = []
        class Client:
            def __init__(self, **kwargs):
                self.options = kwargs
            def stream_factory(self, _url, _params):
                if self.options['admission']() is not True:
                    raise AssertionError
                env.allow = True
                self.options['token_provider']()
                stream = FakeStream([json.dumps(frame).encode()+b'\n'])
                sockets.append(stream)
                return stream
            async def search(self, *_args):
                return {'meta': {'result_count': 0}}
        def report(state):
            if sockets and sockets[0].closed:
                stop.set()
        self.supervisor.transport_factory = Client
        self.supervisor.report = report
        with patch.dict('os.environ', {'X_API_DAILY_REQUEST_LIMIT': '4400'}):
            asyncio.run(asyncio.wait_for(self.supervisor.run_async(), 5))
        self.assertTrue(sockets)
        self.assertTrue(sockets[0].closed)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM signal_events').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM x_stream_owner').fetchone()[0], 0)

    def test_slow_search_never_delays_stream_projection_or_publication_wake(self):
        self.payload['stream_allowance_micros'] = 100000
        self.config.write_text(json.dumps(self.payload))
        observed, stop = [], self.stop
        class Reader(FakeStream):
            async def read(self, limit):
                chunk = next(self.chunks, None)
                if chunk is None:
                    await asyncio.Event().wait()
                return chunk
        socket = Reader([json.dumps(envelope()).encode()+b'\n'])
        class Client:
            def __init__(self, **kwargs):
                self.options = kwargs
            def stream_factory(self, *_args):
                self.options['admission']()
                return socket
            async def search(self, *_args):
                observed.append('search-started')
                await asyncio.Event().wait()
        self.supervisor.transport_factory = Client
        def wake():
            if 'search-started' in observed:
                observed.append('committed-while-search-pending')
                stop.set()
        self.supervisor.wake = wake
        with patch.dict('os.environ', {'X_API_DAILY_REQUEST_LIMIT': '4400'}):
            asyncio.run(asyncio.wait_for(self.supervisor.run_async(), 3))
        self.assertIn('committed-while-search-pending', observed)
        self.assertTrue(socket.closed)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM signal_events').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM x_stream_supervisor_owner').fetchone()[0], 0)

    def test_refresh_preserves_reservations_and_rejects_scope_change(self):
        self.supervisor.initialize()
        reservation = x_budget.reserve(self.supervisor.db, 'stream', 15000, NOW)
        self.now += timedelta(minutes=1)
        self.payload['verified_at'] = self.now.isoformat()
        self.payload['budget']['verified_at'] = self.now.isoformat()
        self.config.write_text(json.dumps(self.payload))
        self.supervisor.refresh()
        self.assertEqual(self.supervisor.db.execute('SELECT reserved FROM x_budget_reservations WHERE id=?', (reservation,)).fetchone()[0], 15000)
        self.payload['inventory'][0]['value'] += ' OR cats'
        self.config.write_text(json.dumps(self.payload))
        with self.assertRaises(x_stream.StreamBlocked):
            self.supervisor.refresh()

    def test_legacy_fetch_and_service_dispatch_cannot_bypass_requested_mode(self):
        with patch.dict('os.environ', {runtime.FLAG: 'true'}):
            with patch.object(x_api, 'build_opener', side_effect=AssertionError('network forbidden')):
                with self.assertRaisesRegex(ValueError, 'stream-supervisor-required'):
                    x_api.fetch_posts({}, [])
            self.assertFalse(any(source.get('format') == 'x-api' for source in signals.enabled_sources()))
            app = service.AutomaticMonitor(self.root/'service.sqlite', self.root/'snapshot.json')
            self.assertIsNotNone(app.x_stream_thread)
            with patch.object(signals, 'acquire', side_effect=AssertionError('legacy acquisition forbidden')):
                app.check_signal_source({'id': 'x-wallstengine', 'format': 'x-api'})
        with patch.dict('os.environ', {runtime.FLAG: 'false'}):
            app = service.AutomaticMonitor(self.root/'off.sqlite', self.root/'off.json')
            self.assertIsNone(app.x_stream_thread)
            self.assertIsNone(app.x_stream_status)


if __name__ == '__main__':
    unittest.main()
