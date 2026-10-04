"""Synthetic-only second invocation: fixed tables, retained history, no live API."""
import asyncio
from copy import deepcopy
from datetime import timedelta
import json
import sqlite3
import threading
import unittest
from unittest.mock import Mock, patch

import test_x_stream_trial_service as fixtures
from test_x_stream_trial_service import NOW, ReadinessTransport, StreamTransport, PRIVATE, SECRET, rules, page
import x_preflight
import x_stream
import x_stream_probe
import x_stream_second_diagnostic as second
import x_stream_trial_service as trial


class SecondTests(unittest.IsolatedAsyncioTestCase):
    setUp = fixtures.ControllerTests.setUp
    controller = fixtures.ControllerTests.controller
    continuation = fixtures.ContinuationTests.continuation

    async def asyncSetUp(self):
        # Historical synthetic plan uses its full original $1 reservation.
        self.plan.update(prior_exposure_contingency_micros=450_000,
                         setup_readiness_contingency_micros=400_000, stream_allowance_micros=150_000)
        await fixtures.ContinuationTests.asyncSetUp(self)
        self.stream_error = x_stream.TransportFailure(0)
        old = await self.continuation().run()
        self.assertEqual(old['reason'], 'transport-error', old)
        self.assertEqual(old['retained_reservation_micros'], 1_000_000)
        self.second_now = self.cont_now + timedelta(minutes=2)
        self.diagnostic = dict(version=1, diagnostic_id='synthetic-second', approval_id='synthetic-second-approval',
            approved_at=(self.second_now-timedelta(seconds=30)).isoformat(), prepared_at=self.second_now.isoformat(),
            end_at=(self.second_now+timedelta(minutes=5)).isoformat(), original_plan_sha256=trial.digest(self.plan),
            original_probe_sha256=trial._ledger_diagnostic(self.db)['x_stream_probe_run']['row_sha256'],
            reviewed_diagnostic=True, stream_attempt_approved=True, unknown_cost_approved=True,
            account_headroom_micros=2_000_000, local_aim_micros=500_000, metadata_contingency_micros=350_000,
            stream_allowance_micros=150_000, max_probe_seconds=60)
        self.readiness_request_table = 'x_stream_second_requests'
        self.backup.side_effect = lambda *_: dict(healthy=True, verified_at=self.second_now.isoformat(),
            next_backup_at=(self.second_now+timedelta(hours=1)).isoformat())
        self.history_tables = second.HISTORY + ('x_metadata_preflight_runs', 'x_metadata_preflight_requests',
                                               'x_stream_probe_transport_diagnostic')
        self.history = {name: self.db.execute('SELECT * FROM '+name).fetchall() for name in self.history_tables}
        self.stream_error = None
        self.calls.clear(); self.logs.clear(); self.token.reset_mock()

    def diagnostic_controller(self, **changes):
        kw = dict(db=self.db, enabled=True, plan=self.plan, diagnostic=self.diagnostic, token_provider=self.token,
            backup_readiness=self.backup, storage_preflight=self.storage, stop_event=self.stop, emit=self.logs.append,
            clock=lambda:self.second_now, monotonic=lambda:1.0,
            readiness_transport_factory=lambda **opts: ReadinessTransport(self, **opts),
            rules_transport_factory=Mock(side_effect=AssertionError('rule mutation forbidden')),
            stream_transport_factory=lambda **opts: StreamTransport(self, **opts))
        kw.update(changes)
        return second.SecondDiagnostic(**kw)

    def assert_history(self):
        for name in self.history_tables:
            self.assertEqual(self.db.execute('SELECT * FROM '+name).fetchall(), self.history[name], name)

    async def test_default_off_inert(self):
        result = await second.SecondDiagnostic(db=object(), plan=object(), diagnostic=object()).run()
        self.assertEqual(result['status'], 'disabled'); self.token.assert_not_called()

    async def test_five_gets_one_new_attempt_same_database_history_unchanged(self):
        c = self.diagnostic_controller(); result = await c.run()
        self.assertEqual(result['status'], 'ended', result)
        self.assertEqual(result['connection_attempts'], 1)
        self.assertEqual(result['retained_reservation_micros'], 500_000)
        self.assertEqual(result['combined_retained_micros'], 1_500_000)
        self.assertEqual(self.calls, [('GET', p) for p in trial.ORDER]+[('GET','stream')])
        self.assertEqual(c.probe_config['end_at'], x_stream.stamp(self.second_now+timedelta(seconds=60)))
        self.assertEqual(c.probe_config['approved_at'], self.diagnostic['approved_at'])
        self.assertEqual(c.probe_config['approval_id'], self.diagnostic['approval_id'])
        self.assertEqual(c.probe_config['account_headroom_micros'], 1_000_000)
        self.assertEqual(c.probe_config['prior_exposure_bound_micros'], 0)
        self.assertFalse(result['cost_reconciled'])
        self.assertFalse(self.db.execute('SELECT 1 FROM x_stream_supervisor_owner').fetchone())
        self.assert_history()
        self.token.reset_mock(); self.calls.clear()
        again = await self.diagnostic_controller().run()
        self.assertEqual(again['reason'], 'x-trial-second-already-used')
        self.token.assert_not_called(); self.assertEqual(self.calls, []); self.assert_history()

    async def test_new_transport_failure_evidence_is_separate(self):
        self.stream_error = x_stream.TransportFailure(429, category='http-status', http_status=429)
        result = await self.diagnostic_controller().run()
        self.assertEqual(result['connection_attempts'], 1, result)
        self.assertEqual(result['transport_http_status'], 429)
        self.assertEqual(result['transport_failure_category'], 'http-status')
        self.assertEqual(self.db.execute('SELECT category,http_status FROM x_stream_second_probe_transport_diagnostic').fetchone(),
                         ('http-status', 429))
        self.assert_history()

    async def test_invalid_plan_limits_hash_and_approval_block_before_credentials(self):
        for change in ({'max_probe_seconds':61}, {'local_aim_micros':500001}, {'metadata_contingency_micros':349999},
                       {'stream_allowance_micros':150001}, {'account_headroom_micros':1599999},
                       {'approval_id':self.plan['approval_id']}, {'approved_at':self.plan['approved_at']},
                       {'unknown_cost_approved':False}, {'original_plan_sha256':'0'*64}, {'original_probe_sha256':'0'*64},
                       {'end_at': self.second_now.isoformat()}):
            with self.subTest(change=change):
                result = await self.diagnostic_controller(diagnostic=self.diagnostic | change).run()
                self.assertEqual(result['status'], 'blocked', result)
                self.token.assert_not_called(); self.assertEqual(self.calls, []); self.assert_history()

    async def test_crash_after_reservation_cannot_replay(self):
        self.diagnostic_controller().initialize()
        result = await self.diagnostic_controller().run()
        self.assertEqual(result['reason'], 'x-trial-second-already-used')
        self.assertEqual(self.db.execute('SELECT original_retained_micros,retained_reservation_micros FROM x_stream_second_diagnostic').fetchone(),
                         (1000000, 500000))
        self.token.assert_not_called(); self.assert_history()

    async def test_original_terminal_proof_required(self):
        with self.db:
            self.db.execute('UPDATE x_stream_probe_run SET close_confirmed=0')
        result = await self.diagnostic_controller().run()
        self.assertEqual(result['reason'], 'x-trial-second-history-invalid')
        self.token.assert_not_called(); self.assertEqual(self.calls, [])

    async def test_global_owner_blocks_before_credentials(self):
        with self.db:
            self.db.execute("INSERT INTO x_stream_supervisor_owner VALUES(1,'other-owner','synthetic')")
        result = await self.diagnostic_controller().run()
        self.assertEqual(result['reason'], 'x-trial-another-owner-present')
        self.token.assert_not_called(); self.assert_history()

    async def test_original_history_change_during_fresh_reads_stops(self):
        class ChangedReadiness(ReadinessTransport):
            async def get(inner, path, params, request_id):
                result = await super().get(path, params, request_id)
                if path == x_preflight.RULES:
                    with self.db:
                        self.db.execute("UPDATE x_stream_trial_run SET reason='changed'")
                return result
        result = await self.diagnostic_controller(readiness_transport_factory=lambda **opts:ChangedReadiness(self,**opts)).run()
        self.assertEqual(result['reason'], 'x-trial-second-history-changed', result)
        self.assertEqual(self.calls, [('GET', x_preflight.RULES)])

    async def test_missing_rules_no_post_and_no_second_read(self):
        self.data[x_preflight.RULES] = page(rules()[:2])
        result = await self.diagnostic_controller().run()
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(self.calls, [('GET', x_preflight.RULES)])
        self.assert_history()

    async def test_active_consumer_no_stream(self):
        self.data[x_preflight.CONNECTIONS]=page([dict(id='synthetic',endpoint_name='filtered_stream',connected_at=NOW.isoformat())])
        result = await self.diagnostic_controller().run()
        self.assertEqual(result['reason'], 'x-trial-active-consumer-present')
        self.assertEqual(len(self.calls), 3); self.assert_history()

    async def test_backup_fails_before_claim(self):
        self.backup.side_effect=lambda *_:dict(healthy=False)
        result = await self.diagnostic_controller().run()
        self.assertEqual(result['reason'], 'x-trial-backup-unavailable-or-overlap')
        self.token.assert_not_called(); self.assert_history()

    async def test_real_row_factory_with_existing_diagnostic_evidence(self):
        self.db.row_factory = sqlite3.Row
        # Real monitor.connect uses Row, including historical populated diagnostics.
        self.assertTrue(self.db.execute('SELECT 1 FROM x_stream_probe_transport_diagnostic').fetchone())
        class RowReadiness(ReadinessTransport):
            def assert_claim(inner, path, request_id):
                row = self.db.execute('SELECT cost_status,reserved_micros FROM x_stream_second_requests WHERE request_id=?', (request_id,)).fetchone()
                self.assertEqual(tuple(row), ('unknown', None))
                self.assertTrue(inner.options['admission'](request_id, path))
                self.assertFalse(inner.options['admission'](request_id, path))
                self.assertEqual(inner.options['token_provider'](), SECRET)
        result = await self.diagnostic_controller(readiness_transport_factory=lambda **opts:RowReadiness(self, **opts)).run()
        self.assertEqual(result['status'], 'ended', result)
        self.db.row_factory = None
        self.assert_history()

    async def test_stop_and_budget_markers_block_before_credentials(self):
        self.stop.set()
        result = await self.diagnostic_controller().run()
        self.assertEqual(result['reason'], 'x-trial-stopped')
        self.stop.clear()
        with self.db:
            self.db.execute('CREATE TABLE x_budget_stop(reason TEXT)')
            self.db.execute("INSERT INTO x_budget_stop VALUES('synthetic-stop')")
        result = await self.diagnostic_controller().run()
        self.assertEqual(result['reason'], 'x-trial-account-stop-or-migration-present')
        self.token.assert_not_called(); self.assert_history()

    async def test_hash_only_local_diagnostic_no_row_fields(self):
        report=trial._ledger_diagnostic(self.db)
        self.assertEqual(report['x_stream_probe_run']['row_sha256'], self.diagnostic['original_probe_sha256'])
        serialized=json.dumps(report)
        for field in ('approval_id','approved_at','retained_reservation_micros', 'synthetic-token'):
            self.assertNotIn(field,serialized)


class ServiceTests(unittest.TestCase):
    def test_second_default_off_and_conflicting_modes_never_open_database(self):
        self.assertFalse(trial.requested({second.ENABLED:'false'}))
        self.assertTrue(trial.requested({second.ENABLED:'true'}))
        for other in (trial.ENABLED, trial.CONTINUATION_ENABLED):
            logs=[]
            with patch.object(sqlite3,'connect',side_effect=AssertionError('database forbidden')):
                trial.run_once('/not-a-db',threading.Event(),env={second.ENABLED:'true',other:'true'},emit=logs.append)
            self.assertEqual(json.loads(logs[0].split(' ',1)[1])['reason'], 'x-trial-conflicting-modes')

    def test_second_flag_missing_plan_is_inert(self):
        logs=[]
        with patch.object(sqlite3,'connect',side_effect=AssertionError('database forbidden')):
            trial.run_once('/not-a-db',threading.Event(),env={second.ENABLED:'true'},emit=logs.append)
        self.assertEqual(len(logs),1)
        self.assertIn('x-trial-service-check-failed',logs[0])


if __name__ == '__main__': unittest.main()
