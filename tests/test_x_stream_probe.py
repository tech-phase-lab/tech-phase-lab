"""Synthetic-only paid receive probe tests. No provider/credentials are used."""
import asyncio
from contextlib import asynccontextmanager
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
import x_stream
import x_stream_probe as probe
import x_stream_transport

NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)


def config(now=NOW):
    """Complete example with SYNTHETIC review IDs/prices, never live approval."""
    return {'version': 1, 'probe_id': 'synthetic-probe', 'approval_id': 'synthetic-approval',
            'approved_at': now.isoformat(), 'verified_at': now.isoformat(),
            'end_at': (now + timedelta(minutes=5)).isoformat(),
            'manifest_sha256': probe.manifest_sha(),
            'inventory': [dict(r, id=str(i)) for i, r in enumerate(x_stream.manifest(), 1)],
            'rules_complete': True, 'stream_attempt_approved': True, 'single_consumer_verified': True,
            'account_cap_verified': True, 'account_cap_micros': 20_000_000, 'account_headroom_micros': 2_000_000,
            'auto_recharge_disabled_verified': True, 'spending_approved': True, 'prices_verified': True,
            'post_micros': 5000, 'user_micros': 10000, 'pricing_evidence_ref': 'synthetic-price-review',
            'budget_anchor_ref': 'synthetic-budget-anchor', 'reconciliation_evidence_ref': 'synthetic-reconciliation',
            'local_aim_micros': 1_000_000, 'prior_exposure_bound_micros': 100_000,
            'polling_contingency_micros': 500_000, 'rule_control_contingency_micros': 100_000,
            'stream_allowance_micros': 100_000, 'unknown_prior_cost_approved': False,
            'control_cost_unknown': True, 'max_reads': 64, 'baseline_service_margin_bytes': 8 * 1024 * 1024,
            'storage_evidence_ref': 'synthetic-stable-backup-review', 'max_rows': 100, 'max_metadata_bytes': 65536,
            'max_wire_bytes': 262144}


def frame(identity='1', rule='1', username='wallstengine', **changes):
    value = {'data': {'id': identity, 'author_id': '99', 'created_at': (NOW - timedelta(seconds=2)).isoformat(),
                      'text': 'PRIVATE-BODY-NOT-RETAINED'},
             'includes': {'users': [{'id': '99', 'username': username}]}, 'matching_rules': [{'id': rule}]}
    value.update(changes)
    return value


def wire(*values):
    return b''.join(json.dumps(value).encode() + b'\n' for value in values)


class Reader:
    def __init__(self, chunks):
        self.chunks = list(chunks)
        self.reads = 0
        self.started = asyncio.Event()

    async def read(self, _size):
        self.started.set()
        self.reads += 1
        item = self.chunks.pop(0) if self.chunks else b''
        if isinstance(item, Exception):
            raise item
        if callable(item):
            item = item()
        if asyncio.iscoroutine(item):
            item = await item
        return item


class Transport:
    def __init__(self, reader, options, *, close_error=None, connect=None):
        self.reader, self.options = reader, options
        self.close_error, self.connect = close_error, connect
        self.calls, self.closed = [], False

    @asynccontextmanager
    async def stream_factory(self, url, params):
        self.calls.append((url, params))
        if self.options['admission']() is not True:
            raise x_stream.StreamBlocked('not-admitted')
        self.options['token_provider']()
        try:
            if self.connect is not None:
                await self.connect()
            yield self.reader
        finally:
            self.closed = True
            if self.close_error:
                raise self.close_error


class ProbeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = sqlite3.connect(Path(self.temp.name) / 'service.sqlite')
        self.addCleanup(self.db.close)
        self.now, self.mono = NOW, 1.0
        self.config = config()
        self.token = Mock(return_value='SYNTHETIC-SECRET')
        self.admission = Mock(return_value=True)
        self.storage = Mock(return_value={'metadata_storage_sufficient': True, 'available_bytes': 70 * 1024 * 1024})
        self.reader = Reader([])
        self.transports = []
        self.connect = self.close_error = None
        self.stop = threading.Event()
        for target, name in ((x_stream, 'Coordinator'), (x_stream, 'schema'), (x_stream_transport, 'service_token')):
            guard = patch.object(target, name, side_effect=AssertionError('forbidden canonical or token access'))
            guard.start()
            self.addCleanup(guard.stop)
        import aiohttp
        guard = patch.object(aiohttp, 'ClientSession', side_effect=AssertionError('live network forbidden'))
        guard.start()
        self.addCleanup(guard.stop)
        self.worker = self.make_worker()

    def factory(self, **options):
        obj = Transport(self.reader, options, close_error=self.close_error, connect=self.connect)
        self.transports.append(obj)
        return obj

    def make_worker(self, **kwargs):
        return probe.Probe(db=self.db, enabled=True, config=self.config, token_provider=self.token,
                           reviewed_admission=self.admission, clock=lambda: self.now, monotonic=lambda: self.mono,
                           storage_preflight=self.storage, stop_event=self.stop, transport_factory=self.factory, **kwargs)

    def row(self):
        self.db.row_factory = sqlite3.Row
        return self.db.execute('SELECT * FROM x_stream_probe_run').fetchone()

    def receipt(self):
        self.db.row_factory = sqlite3.Row
        return self.db.execute('SELECT * FROM x_stream_probe_receipts ORDER BY sequence').fetchall()

    def tables(self):
        return {r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}

    def metadata(self, status='verified', cost='bounded', reserve=20000):
        self.db.execute('CREATE TABLE x_metadata_preflight_runs(request_id TEXT,approval_id TEXT,reserved_micros INTEGER,'
                        'cost_status TEXT,requests_admitted INTEGER,status TEXT)')
        with self.db:
            self.db.execute('INSERT INTO x_metadata_preflight_runs VALUES(?,?,?,?,?,?)',
                            ('fixture-metadata', 'fixture-approval', reserve, cost, 5, status))

    async def test_default_off_is_completely_inert(self):
        obj = probe.Probe(db=object(), config=object(), token_provider=self.token, reviewed_admission=self.admission)
        self.assertEqual((await obj.run())['status'], 'disabled')
        self.token.assert_not_called()
        self.admission.assert_not_called()
        self.assertEqual(self.tables(), set())

    async def test_required_reviewed_admission_and_token_callback(self):
        self.worker.reviewed_admission = None
        self.assertEqual((await self.worker.run())['status'], 'blocked')
        self.assertEqual(self.tables(), set())
        self.token.assert_not_called()

    async def test_strict_config_fields_all_required(self):
        for key in list(self.config):
            copy = dict(self.config)
            del copy[key]
            with self.subTest(key=key), self.assertRaises(probe.ProbeBlocked):
                probe.validate_config(copy, NOW)
        with self.assertRaises(probe.ProbeBlocked):
            probe.validate_config(dict(self.config, extra=True), NOW)

    async def test_config_rejects_invalid_bounds_truth_and_scope(self):
        bad = [{'version': True}, {'local_aim_micros': 1_000_001}, {'post_micros': 0},
               {'stream_attempt_approved': 1}, {'account_cap_micros': 20_000_001},
               {'max_rows': 513}, {'max_metadata_bytes': 262145}, {'max_wire_bytes': 4194305},
               {'end_at': NOW.isoformat()}, {'end_at': (NOW + timedelta(seconds=901)).isoformat()},
               {'manifest_sha256': 'bad'}, {'inventory': []}, {'account_headroom_micros': 1},
               {'stream_allowance_micros': 1}, {'unknown_prior_cost_approved': 1}]
        for change in bad:
            with self.subTest(change=change), self.assertRaises((probe.ProbeBlocked, x_stream.StreamBlocked)):
                probe.validate_config(self.config | change, NOW)

    async def test_midnight_and_non_utc_and_stale_deadlines_block(self):
        late = NOW.replace(hour=23, minute=58)
        with self.assertRaises(probe.ProbeBlocked):
            probe.validate_config(config(late), late)
        with self.assertRaises(probe.ProbeBlocked):
            probe.validate_config(self.config | {'verified_at': (NOW - timedelta(minutes=11)).isoformat()}, NOW)
        with self.assertRaises(probe.ProbeBlocked):
            probe.validate_config(self.config | {'end_at': '2026-10-03T21:05:00+09:00'}, NOW)

    async def test_normal_polling_contingency_separate_from_incremental_aim(self):
        self.config.update(local_aim_micros=300000, polling_contingency_micros=900000)
        result = await self.worker.run()
        self.assertEqual(result['retained_reservation_micros'], 300000)
        self.assertEqual(result['polling_contingency_micros'], 900000)
        self.assertFalse(result['provider_cost_reconciled'])
        self.assertTrue(result['control_cost_unknown'])

    async def test_full_claim_is_durable_before_lazy_token(self):
        def token():
            self.assertFalse(self.db.in_transaction)
            self.assertEqual(self.row()['attempts'], 1)
            self.assertEqual(self.row()['retained_reservation_micros'], 300000)
            self.assertTrue(self.db.execute('SELECT 1 FROM x_stream_supervisor_owner').fetchone())
            return 'SYNTHETIC-SECRET'
        self.token.side_effect = token
        result = await self.worker.run()
        self.assertEqual(result['connection_attempts'], 1)
        self.token.assert_called_once()
        self.assertEqual(len(self.transports[0].calls), 1)
        self.assertTrue(self.transports[0].closed)
        self.assertEqual(self.tables(), {'x_stream_probe_run', 'x_stream_probe_receipts', 'x_stream_supervisor_owner',
                                              'x_stream_probe_transport_diagnostic'})

    async def test_probe_never_creates_canonical_migration_marker(self):
        await self.worker.run()
        self.assertNotIn('x_stream_runtime', self.tables())
        self.assertFalse(any(t.startswith('signal_') for t in self.tables()))

    async def test_durable_singleton_cannot_rearm_after_clean_close(self):
        await self.worker.run()
        self.config['probe_id'] = 'different-id'
        self.config['end_at'] = (NOW + timedelta(minutes=8)).isoformat()
        other = self.make_worker()
        result = await other.run()
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(len(self.transports), 1)
        self.token.assert_called_once()

    async def test_crash_before_token_cannot_rearm(self):
        self.worker.initialize()
        self.assertTrue(self.db.execute('SELECT 1 FROM x_stream_supervisor_owner').fetchone())
        other = self.make_worker()
        self.assertEqual((await other.run())['status'], 'blocked')
        self.token.assert_not_called()

    async def test_active_migration_and_metadata_ownership_block(self):
        self.db.execute('CREATE TABLE x_stream_runtime(singleton INTEGER)')
        with self.db:
            self.db.execute('INSERT INTO x_stream_runtime VALUES(1)')
        await self.worker.run()
        self.token.assert_not_called()
        self.assertFalse(self.db.execute('SELECT 1 FROM x_stream_probe_run').fetchone())

    async def test_active_metadata_worker_blocks(self):
        self.metadata(status='running')
        await self.worker.run()
        self.token.assert_not_called()

    async def test_probe_owner_blocks_existing_metadata_checker(self):
        import x_preflight
        self.worker.initialize()
        with self.assertRaisesRegex(x_preflight.PreflightBlocked, 'stream-owner-present'):
            x_preflight._assert_no_live_stream(self.db)
        self.token.assert_not_called()

    async def test_unknown_metadata_cost_requires_explicit_reviewed_bound(self):
        self.metadata(status='observed', cost='unknown', reserve=None)
        await self.worker.run()
        self.token.assert_not_called()
        self.config['unknown_prior_cost_approved'] = True
        self.worker = self.make_worker()
        result = await self.worker.run()
        self.assertTrue(result['prior_cost_unknown'])
        self.assertFalse(result['provider_cost_reconciled'])
        self.assertEqual(self.admission.call_args.args[1]['unknown_runs'], 1)
        self.assertEqual(self.db.execute('SELECT reserved_micros FROM x_metadata_preflight_runs').fetchone()[0], None)

    async def test_prior_known_exposure_never_discarded(self):
        self.metadata(reserve=100001)
        await self.worker.run()
        self.token.assert_not_called()

    async def test_callback_must_return_exact_true(self):
        self.admission.return_value = 1
        await self.worker.run()
        self.token.assert_not_called()
        self.assertFalse(self.db.execute('SELECT 1 FROM x_stream_probe_run').fetchone())

    async def test_storage_shortage_blocks_before_claim_or_token(self):
        self.storage.return_value['available_bytes'] = 1
        await self.worker.run()
        self.token.assert_not_called()
        self.assertEqual(self.tables(), set())

    async def test_in_memory_ledger_is_not_durable(self):
        with sqlite3.connect(':memory:') as db:
            self.worker.db = db
            await self.worker.run()
        self.token.assert_not_called()

    async def test_valid_receipt_has_only_small_metadata_and_latency(self):
        self.reader.chunks = [wire(frame())]
        result = await self.worker.run()
        self.assertEqual(result['source_original_latency_samples'], 1)
        self.assertEqual(result['source_to_durable_min_ms'], 2000)
        self.assertEqual(result['post_resources'], 1)
        self.assertEqual(result['user_resources'], 1)
        rows = self.receipt()
        self.assertEqual(rows[0]['post_id_or_hash'], '1')
        self.assertEqual(rows[0]['raw_received_at'], x_stream.stamp(NOW))
        self.assertEqual(rows[0]['durable_received_at'], x_stream.stamp(NOW))
        dump = '\n'.join(self.db.iterdump())
        for secret in ('PRIVATE-BODY-NOT-RETAINED', 'SYNTHETIC-SECRET', '"username"'):
            self.assertNotIn(secret, dump)
        self.assertFalse(result['publication_latency_measured'])

    async def test_all_four_routes_and_combined_wallstengine_accounts(self):
        pairs = [('1', 'wallstengine'), ('1', 'TipRanks'), ('1', 'FABYMETAL4'),
                 ('2', 'nebiusai'), ('3', 'TrendSpider'), ('4', 'Barchart')]
        self.reader.chunks = [wire(*(frame(str(i), rule, name) for i, (rule, name) in enumerate(pairs, 1)))]
        result = await self.worker.run()
        self.assertEqual(result['source_original_latency_samples'], 6)
        self.assertEqual(result['delivered_estimate_micros'], 90000)

    async def test_duplicate_and_quote_and_unknown_author_costs_all_count(self):
        quoted = frame('2', username='other-author')
        quoted['data']['referenced_tweets'] = [{'id': '77', 'type': 'quoted'}]
        self.reader.chunks = [wire(frame(), frame(), quoted, frame('3', username='unknown'))]
        result = await self.worker.run()
        self.assertEqual(result['delivered_estimate_micros'], 60000)
        self.assertEqual(result['complete_deliveries'], 4)
        self.assertEqual(result['source_original_latency_samples'], 2)
        self.assertEqual(self.receipt()[2]['source_author_verified'], 0)
        self.assertEqual(self.receipt()[2]['query_match'], 1)
        self.assertEqual(self.receipt()[2]['quote'], 1)

    async def test_approved_quote_author_also_excluded_from_original_samples(self):
        value = frame()
        value['data']['referenced_tweets'] = [{'id': '77', 'type': 'quoted'}]
        self.reader.chunks = [wire(value)]
        result = await self.worker.run()
        self.assertEqual(result['source_original_latency_samples'], 0)
        self.assertEqual(result['post_resources'], 1)

    async def test_all_complete_chunk_tail_metered_after_allowance_stop(self):
        self.config['stream_allowance_micros'] = 15000
        self.reader.chunks = [wire(frame('1'), frame('2'), frame('3')), wire(frame('4'))]
        result = await self.worker.run()
        self.assertEqual(result['delivered_estimate_micros'], 45000)
        self.assertEqual(result['complete_deliveries'], 3)
        self.assertEqual(self.reader.reads, 1)
        self.assertTrue(result['inflight_or_unknown_cost_may_exceed_aim'])
        self.assertEqual(result['retained_reservation_micros'], 245000)

    async def test_rejected_rule_then_valid_tail_both_metered_no_next_read(self):
        self.reader.chunks = [wire(frame('1', '999'), frame('2')), wire(frame('3'))]
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 2)
        self.assertEqual(self.reader.reads, 1)
        self.assertEqual(result['reason'], 'unowned-or-invalid-rule')

    async def test_invalid_json_does_not_hide_valid_complete_tail(self):
        self.reader.chunks = [wire(frame('1')) + b'{bad-json}\n' + wire(frame('2')), wire(frame('3'))]
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 2)
        self.assertEqual(result['unknown_delivery'], 1)
        self.assertEqual(self.reader.reads, 1)

    async def test_ambiguous_envelope_meters_identifiable_resources(self):
        broken = frame('1', errors=[{'title': 'SENSITIVE-PROVIDER-ERROR'}])
        broken['includes']['tweets'] = [{'id': '555', 'text': 'QUOTED-PRIVATE-BODY'}]
        self.reader.chunks = [wire(broken, frame('2'))]
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 3)
        self.assertEqual(result['user_resources'], 2)
        self.assertEqual(result['unknown_delivery'], 1)
        self.assertNotIn('SENSITIVE-PROVIDER-ERROR', json.dumps(result))
        self.assertNotIn('QUOTED-PRIVATE-BODY', '\n'.join(self.db.iterdump()))

    async def test_partial_frame_is_unknown_and_never_fetches_recovery(self):
        self.reader.chunks = [wire(frame()) + b'{"data":']
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 1)
        self.assertEqual(result['unknown_delivery'], 1)
        self.assertEqual(result['connection_attempts'], 1)
        self.assertEqual(self.worker.decoder.buffer, bytearray())

    async def test_split_utf8_and_frames_work(self):
        value = frame()
        value['data']['text'] = '日本語'
        encoded = json.dumps(value, ensure_ascii=False).encode() + b'\n'
        point = encoded.index('日'.encode()) + 1
        self.reader.chunks = [encoded[:point], encoded[point:]]
        self.assertEqual((await self.worker.run())['post_resources'], 1)

    async def test_row_bound_preserves_aggregate_tail_costs(self):
        self.config['max_rows'] = 1
        self.reader.chunks = [wire(frame('1'), frame('2'), frame('3'))]
        result = await self.worker.run()
        self.assertEqual(len(self.receipt()), 1)
        self.assertEqual(result['complete_deliveries'], 3)
        self.assertEqual(result['metadata_rows_dropped'], 2)
        self.assertEqual(result['delivered_estimate_micros'], 45000)
        self.assertEqual(self.reader.reads, 1)

    async def test_metadata_byte_bound_is_strict(self):
        self.config['max_metadata_bytes'] = 1024
        self.reader.chunks = [wire(frame('1'), frame('2'), frame('3'))]
        result = await self.worker.run()
        self.assertLessEqual(result['metadata_bytes'], 1024)
        self.assertEqual(result['post_resources'], 3)
        self.assertEqual(self.reader.reads, 1)

    async def test_monotonic_deadline_survives_wall_clock_rollback(self):
        def finish():
            self.now -= timedelta(minutes=1)
            self.mono += 301
            return wire(frame())
        self.reader.chunks = [finish, wire(frame('2'))]
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 1)
        self.assertEqual(result['reason'], 'deadline')
        self.assertEqual(self.reader.reads, 1)

    async def test_wall_deadline_meters_already_returned_bytes(self):
        def finish():
            self.now += timedelta(minutes=5)
            return wire(frame(), frame('2'))
        self.reader.chunks = [finish, wire(frame('3'))]
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 2)
        self.assertEqual(self.reader.reads, 1)
        self.assertEqual(result['reason'], 'deadline')

    async def test_configuration_mutation_never_rearms_deadline(self):
        def change():
            self.config['end_at'] = (NOW + timedelta(minutes=14)).isoformat()
            return wire(frame())
        self.reader.chunks = [change]
        result = await self.worker.run()
        self.assertEqual(result['reason'], 'configuration-changed')
        self.assertEqual(self.reader.reads, 1)
        self.assertEqual(self.row()['end_at'], (NOW + timedelta(minutes=5)).isoformat())

    async def test_transport_error_never_retries_and_reports_no_provider_detail(self):
        self.reader.chunks = [wire(frame()), RuntimeError('SECRET-IP-1.2.3.4')]
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 1)
        self.assertEqual(result['connection_attempts'], 1)
        self.assertNotIn('SECRET', json.dumps(result))
        self.assertEqual(len(self.transports), 1)

    async def test_preaccept_category_persisted_without_retry_or_rearming(self):
        async def fail():
            raise x_stream.TransportFailure(None, category='post-connect-header-deadline')
        self.connect = fail
        result = await self.worker.run()
        self.assertEqual(result['transport_failure_category'], 'post-connect-header-deadline')
        self.assertIsNone(result['transport_http_status'])
        self.assertIsNone(result['connected_at'])
        self.assertEqual(result['connection_attempts'], 1)
        self.assertEqual(result['read_calls'], 0)
        self.assertEqual(result['close_confirmed'], 1)
        before = self.db.execute('SELECT * FROM x_stream_probe_run').fetchall()
        diagnostic = self.db.execute('SELECT * FROM x_stream_probe_transport_diagnostic').fetchall()
        self.token.reset_mock()
        again = await self.make_worker().run()
        self.assertEqual(again['status'], 'blocked')
        self.token.assert_not_called()
        self.assertEqual(self.db.execute('SELECT * FROM x_stream_probe_run').fetchall(), before)
        self.assertEqual(self.db.execute('SELECT * FROM x_stream_probe_transport_diagnostic').fetchall(), diagnostic)

    async def test_read_idle_diagnostic_survives_settle_read_and_cleanup(self):
        self.reader.chunks = [x_stream.TransportFailure(None, category='body-read-idle-timeout', http_status=200)]
        result = await self.worker.run()
        self.assertEqual(result['transport_failure_category'], 'body-read-idle-timeout')
        self.assertEqual(result['transport_http_status'], 200)
        self.assertIsNotNone(result['connected_at'])
        self.assertEqual(result['unknown_delivery'], 1)
        self.assertEqual(result['close_confirmed'], 1)
        self.assertEqual(result['connection_attempts'], 1)
        self.assertFalse(self.db.execute('SELECT 1 FROM x_stream_supervisor_owner').fetchone())

    async def test_rejected_200_diagnostics_are_safe_in_database_and_report(self):
        from test_x_stream_transport import Response, Session
        session = Session(Response(b'PRIVATE BODY', headers={'Content-Type': 'text/PRIVATE 192.0.2.1'}))
        self.worker.transport_factory = lambda **opts: x_stream_transport.AiohttpTransport(
            **opts, session_factory=lambda **_options: session)
        result = await self.worker.run()
        self.assertEqual(result['transport_failure_category'], 'content-type-rejected')
        self.assertEqual(result['transport_http_status'], 200)
        self.assertIsNone(result['connected_at'])
        self.assertEqual(result['reason'], 'transport-error')
        self.assertEqual(result['read_calls'], 0)
        self.assertEqual(result['wire_bytes'], 0)
        self.assertEqual(result['close_confirmed'], 1)
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertNotIn('PRIVATE', '\n'.join(self.db.iterdump()))
        self.assertEqual(len(session.calls), 1)

    async def test_diagnostic_read_is_allowlisted_and_old_ledgers_stay_unknown(self):
        self.assertEqual(probe.transport_diagnostic(self.db), {})
        await self.worker.run()
        self.assertEqual(probe.transport_diagnostic(self.db), {})
        with self.db:
            self.db.execute('INSERT INTO x_stream_probe_transport_diagnostic VALUES(1,?,?)',
                            ('PRIVATE 192.0.2.1', None))
        result = self.worker.report()
        self.assertEqual(result['transport_failure_category'], 'transport-error')
        self.assertIsNone(result['transport_http_status'])
        self.assertNotIn('PRIVATE', json.dumps(result))

    async def test_failed_close_retains_owner_and_uncertainty(self):
        self.close_error = x_stream.TransportFailure(None, connection_conflict=True)
        result = await self.worker.run()
        self.assertEqual(result['close_confirmed'], 0)
        self.assertEqual(result['unknown_delivery'], 1)
        self.assertTrue(self.db.execute('SELECT 1 FROM x_stream_supervisor_owner').fetchone())

    async def test_operator_stop_only_stops_probe(self):
        def stop():
            self.stop.set()
            return wire(frame())
        self.reader.chunks = [stop]
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 1)
        self.assertEqual(result['reason'], 'operator-stop')
        self.assertEqual(self.reader.reads, 1)

    async def test_deadline_also_bounds_connection_setup(self):
        started = asyncio.Event()
        async def connect():
            started.set()
            await asyncio.Event().wait()
        self.connect = connect
        task = asyncio.create_task(self.worker.run())
        await started.wait()
        self.mono += 301
        result = await asyncio.wait_for(task, 2)
        self.assertEqual(result['reason'], 'deadline')
        self.assertEqual(result['connection_attempts'], 1)
        self.assertEqual(self.reader.reads, 0)
        self.assertTrue(self.transports[0].closed)

    async def test_cancellation_race_retains_returned_complete_resources(self):
        waiting = asyncio.Event()
        async def racing_read():
            waiting.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                return wire(frame('1'), frame('2'))
        self.reader.chunks = [racing_read]
        task = asyncio.create_task(self.worker.run())
        await waiting.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(self.row()['posts'], 2)
        self.assertEqual(self.row()['users'], 2)
        self.assertTrue(self.transports[0].closed)


    async def test_duplicate_json_keys_and_nonfinite_values_stop_but_meter_tail(self):
        self.reader.chunks = [b'{"data":{},"data":{}}\n' + b'{"data":{"id":"1","x":NaN}}\n' + wire(frame('2'))]
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 1)
        self.assertEqual(result['unknown_delivery'], 1)
        self.assertEqual(self.reader.reads, 1)

    async def test_unhashable_matching_rule_keeps_resource_metering(self):
        self.reader.chunks = [wire(frame(matching_rules=[{'id': []}]), frame('2'))]
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 2)
        self.assertEqual(result['user_resources'], 2)
        self.assertEqual(self.reader.reads, 1)

    async def test_preexisting_stop_produces_terminal_report_without_token(self):
        self.stop.set()
        result = await self.worker.run()
        self.assertEqual(result['status'], 'ended')
        self.assertEqual(result['reason'], 'operator-stop')
        self.token.assert_not_called()
        self.assertFalse(self.db.execute('SELECT 1 FROM x_stream_supervisor_owner').fetchone())

    async def test_metadata_changes_before_admission_block_token(self):
        self.metadata()
        original = self.factory
        def changed(**options):
            with self.db:
                self.db.execute('UPDATE x_metadata_preflight_runs SET requests_admitted=6')
            return original(**options)
        self.worker.transport_factory = changed
        result = await self.worker.run()
        self.token.assert_not_called()
        self.assertEqual(result['connection_attempts'], 0)

    async def test_delivered_latency_uses_observed_commit_time(self):
        self.reader.chunks = [wire(frame())]
        calls = [0]
        def clock():
            calls[0] += 1
            return self.now
        self.worker.clock = clock
        result = await self.worker.run()
        self.assertEqual(result['source_to_durable_min_ms'], 2000)
        self.assertIsNotNone(self.receipt()[0]['durable_received_at'])

    async def test_real_transport_is_used_with_fake_session_only(self):
        from test_x_stream_transport import Response, Session
        session = Session(response=Response(wire(frame())))
        self.worker.transport_factory = lambda **opts: x_stream_transport.AiohttpTransport(
            **opts, session_factory=lambda **_kwargs: session)
        result = await self.worker.run()
        self.assertEqual(result['connection_attempts'], 1)
        self.assertEqual(result['post_resources'], 1)
        self.assertEqual(session.calls[0][0], x_stream.STREAM_URL)
        self.assertEqual(session.calls[0][1]['params'], probe.PARAMS)
        self.assertFalse(session._retry_connection)
        self.assertTrue(session.closed)
        self.assertTrue(session.response.closed)


    async def test_existing_foreign_owner_is_never_deleted(self):
        self.db.execute('CREATE TABLE x_stream_supervisor_owner(singleton INTEGER PRIMARY KEY,owner TEXT,started_at TEXT)')
        with self.db:
            self.db.execute('INSERT INTO x_stream_supervisor_owner VALUES(1,?,?)', ('foreign-owner', NOW.isoformat()))
        await self.worker.run()
        self.token.assert_not_called()
        self.assertEqual(self.db.execute('SELECT owner FROM x_stream_supervisor_owner').fetchone()[0], 'foreign-owner')

    async def test_ownership_loss_stops_before_another_read_without_deleting_replacement(self):
        def stolen():
            with self.db:
                self.db.execute("UPDATE x_stream_supervisor_owner SET owner='replacement'")
            return wire(frame())
        self.reader.chunks = [stolen, wire(frame('2'))]
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 1)
        self.assertEqual(self.reader.reads, 1)
        self.assertEqual(self.db.execute('SELECT owner FROM x_stream_supervisor_owner').fetchone()[0], 'replacement')

    async def test_a_second_transport_admission_cannot_read_token(self):
        self.worker.initialize()
        self.assertTrue(self.worker._admit())
        self.assertFalse(self.worker._admit())
        self.assertEqual(self.row()['attempts'], 1)
        self.token.assert_not_called()

    async def test_wired_storage_preflight_requires_same_service_volume(self):
        self.worker.storage_preflight = None
        result = await self.worker.run()
        self.assertEqual(result['status'], 'blocked')
        self.token.assert_not_called()


    async def test_wire_bound_stops_heartbeat_only_read(self):
        self.config['max_wire_bytes'] = probe.READ_BYTES
        self.reader.chunks = [b'\r\n' * (probe.READ_BYTES // 2), wire(frame())]
        result = await self.worker.run()
        self.assertEqual(result['reason'], 'wire-bound')
        self.assertEqual(result['wire_bytes'], probe.READ_BYTES)
        self.assertEqual(self.reader.reads, 1)

    async def test_tiny_fragment_reads_have_fixed_write_amplification_bound(self):
        self.reader.chunks = [b'\n', b'\n', wire(frame())]
        self.config['max_reads'] = 2
        result = await self.worker.run()
        self.assertEqual(result['reason'], 'read-bound')
        self.assertEqual(result['read_calls'], 2)
        self.assertEqual(self.reader.reads, 2)


    async def test_current_referenced_posts_variants_never_count_as_originals(self):
        values = []
        for i, kind in enumerate(('quoted', 'replied_to', 'retweeted'), 1):
            value = frame(str(i))
            value['data']['referenced_posts'] = [{'id': '77', 'type': kind}]
            values.append(value)
        self.reader.chunks = [wire(*values)]
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 3)
        self.assertEqual(result['source_original_latency_samples'], 0)
        self.assertEqual(self.receipt()[0]['quote'], 1)

    async def test_conflicting_or_malformed_reference_aliases_never_count_as_originals(self):
        first, second, third = frame('1'), frame('2'), frame('3')
        first['data'].update(referenced_posts=[], referenced_tweets=[{'id': '77', 'type': 'quoted'}])
        second['data'].update(referenced_posts=None, referenced_tweets=[])
        third['data'].update(referenced_posts={'id': '77', 'type': 'quoted'})
        self.reader.chunks = [wire(first, second, third)]
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 3)
        self.assertEqual(result['source_original_latency_samples'], 0)
        self.assertEqual(self.receipt()[0]['quote'], 1)

    async def test_unexpected_current_includes_posts_resources_are_metered(self):
        value = frame()
        value['includes']['posts'] = [{'id': '777', 'text': 'UNRETAINED-BODY'}]
        self.reader.chunks = [wire(value)]
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 2)
        self.assertEqual(result['unknown_delivery'], 1)
        self.assertEqual(result['source_original_latency_samples'], 0)

    async def test_existing_account_budget_stop_cannot_be_bypassed(self):
        self.db.execute('CREATE TABLE x_budget_stop(singleton INTEGER,reason TEXT)')
        with self.db:
            self.db.execute('INSERT INTO x_budget_stop VALUES(1,?)', ('ambiguous-delivery',))
        await self.worker.run()
        self.token.assert_not_called()
        self.admission.assert_not_called()
        self.assertEqual(self.db.execute('SELECT reason FROM x_budget_stop').fetchone()[0], 'ambiguous-delivery')

    async def test_existing_entitlement_stop_cannot_be_bypassed(self):
        self.db.execute('CREATE TABLE x_stream_state(state TEXT)')
        with self.db:
            self.db.execute("INSERT INTO x_stream_state VALUES('entitlement-blocked')")
        await self.worker.run()
        self.token.assert_not_called()
        self.admission.assert_not_called()

    async def test_polling_contingency_can_exceed_incremental_aim_with_verified_headroom(self):
        self.config.update(polling_contingency_micros=1500000, account_headroom_micros=2000000, local_aim_micros=300000)
        result = await self.worker.run()
        self.assertEqual(result['retained_reservation_micros'], 300000)
        self.assertEqual(result['polling_contingency_micros'], 1500000)


    async def test_storage_rechecked_before_token_and_every_read(self):
        self.reader.chunks = [wire(frame()), wire(frame('2'))]
        def fall():
            # Initial preflight, durable claim, token claim, first read succeed.
            available = 70 * 1024 * 1024 if self.storage.call_count <= 4 else 1
            return {'metadata_storage_sufficient': available > 1, 'available_bytes': available}
        self.storage.side_effect = fall
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 1)
        self.assertEqual(self.reader.reads, 1)
        self.assertEqual(result['reason'], 'storage-low-or-unavailable')
        self.assertTrue(result['close_confirmed'])

    async def test_storage_drop_in_returned_chunk_still_meters_its_whole_tail(self):
        def fall():
            self.storage.return_value['available_bytes'] = 1
            return wire(frame('1'), frame('2'))
        self.reader.chunks = [fall, wire(frame('3'))]
        result = await self.worker.run()
        self.assertEqual(result['post_resources'], 2)
        self.assertEqual(self.reader.reads, 1)
        self.assertEqual(result['reason'], 'storage-low-or-unavailable')

    async def test_storage_reserve_uses_actual_pages_and_separate_baseline_margin(self):
        reserve = probe.storage_reserve(self.db, self.config)
        self.assertEqual(reserve['sqlite_page_size'], self.db.execute('PRAGMA page_size').fetchone()[0])
        self.assertEqual(reserve['required_free_bytes'], reserve['probe_operational_bytes'] + 8 * 1024 * 1024)
        self.assertEqual(reserve['probe_operational_bytes'], (64 + 4) * 64 * reserve['sqlite_page_size'] + 4 * 65536)
        self.worker.initialize()
        self.assertEqual(self.worker.required_storage, 26476544)

    async def test_offline_wal_stress_disabled_checkpoints_fits_operational_slack(self):
        for page_size in (4096, 8192):
            with self.subTest(page_size=page_size):
                path = Path(self.temp.name) / ('stress-' + str(page_size) + '.sqlite')
                db = sqlite3.connect(path)
                try:
                    db.execute('PRAGMA page_size=' + str(page_size))
                    self.assertEqual(db.execute('PRAGMA journal_mode=WAL').fetchone()[0], 'wal')
                    db.execute('PRAGMA wal_autocheckpoint=0')
                    c = config()
                    c.update(max_reads=128, max_rows=128, max_metadata_bytes=65536,
                             max_wire_bytes=524288, post_micros=1, user_micros=1)
                    worker = probe.Probe(db=db, enabled=True, config=c, token_provider=self.token,
                        reviewed_admission=self.admission, clock=lambda: NOW, monotonic=lambda: 1.0,
                        storage_preflight=lambda: {'metadata_storage_sufficient': True, 'available_bytes': 256 * 1024 * 1024})
                    worker.initialize()
                    for i in range(128):
                        value = frame(str(10**31 + i))
                        value['matching_rules'] = [{'id': str(n)} for n in range(1, 5)]
                        # Exercise all bounded writes even after logical limits;
                        # live intake itself would have stopped earlier.
                        worker._meter(wire(value), NOW)
                    wal_bytes = Path(str(path) + '-wal').stat().st_size
                    measured_total = wal_bytes + path.stat().st_size
                    operational = probe.storage_reserve(db, c)['probe_operational_bytes']
                    self.assertLess(measured_total * 4, operational)  # >=4x measured slack.
                    self.assertLessEqual(db.execute('SELECT metadata_bytes FROM x_stream_probe_run').fetchone()[0], 65536)
                    self.assertLessEqual(db.execute('SELECT COUNT(*) FROM x_stream_probe_receipts').fetchone()[0], 128)
                    self.assertEqual(db.execute('PRAGMA wal_autocheckpoint').fetchone()[0], 0)
                finally:
                    db.close()
        self.token.assert_not_called()


    async def test_actual_success_records_entitlement_only_after_connection(self):
        self.assertNotIn('stream_entitlement_verified', self.config)
        self.assertTrue(self.config['stream_attempt_approved'])
        result = await self.worker.run()
        self.assertTrue(result['stream_entitlement_verified'])
        self.assertEqual(result['connected_at'], NOW.isoformat(timespec='milliseconds'))

    async def test_denied_connection_records_no_verified_entitlement_and_never_retries(self):
        from test_x_stream_transport import Response, Session
        for status in (401, 403, 402):
            with self.subTest(status=status), sqlite3.connect(Path(self.temp.name) / ('denied-' + str(status) + '.sqlite')) as db:
                session = Session(response=Response(b'{"errors":[{"title":"PRIVATE-PROVIDER-ERROR"}]}', status=status))
                worker = self.make_worker()
                worker.db = db
                worker.transport_factory = lambda **opts: x_stream_transport.AiohttpTransport(
                    **opts, session_factory=lambda **_kwargs: session)
                result = await worker.run()
                self.assertFalse(result['stream_entitlement_verified'])
                self.assertIsNone(result['connected_at'])
                self.assertEqual(len(session.calls), 1)
                self.assertEqual(result['connection_attempts'], 1)
                expected = 'payment-or-quota-blocked' if status == 402 else 'authentication-or-entitlement-denied'
                self.assertEqual(result['reason'], expected)
                self.assertNotIn('PRIVATE-PROVIDER-ERROR', json.dumps(result))
                self.assertTrue(session.closed)


if __name__ == '__main__':
    unittest.main()
