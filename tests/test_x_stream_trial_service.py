"""Fully synthetic one-shot orchestration; network, secrets and real disk denied."""
import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import aiohttp
import x_preflight
import x_stream
import x_stream_rules
import x_stream_trial_service as trial

NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)
RID = 'a' * 64
SECRET = 'synthetic-token'
PRIVATE = 'PRIVATE-BODY 192.0.2.99'


def rules():
    return [dict(value=row['value'], tag=row['tag'], id=str(i)) for i, row in enumerate(x_stream.manifest(), 1)]


def page(rows):
    return {'data': rows, 'meta': {'result_count': len(rows)}}


def responses():
    return {x_preflight.RULES: page([]), x_preflight.COUNTS: {'data': {
        'cap_per_client_app': '5', 'cap_per_project': '5', 'project_rules_count': '0',
        'client_app_rules_count': {'client_app_id': '111', 'rule_count': 0},
        'all_project_client_apps': [{'client_app_id': '111', 'rule_count': 0}]}},
        x_preflight.CONNECTIONS: page([]), x_preflight.USAGE: {'data': {
            'cap_reset_day': 1, 'project_id': '222', 'project_usage': '12', 'project_cap': '10000',
            'daily_client_app_usage': [{'client_app_id': '111', 'usage_result_count': 1,
                'usage': [{'date': '2026-10-03', 'usage': '12'}]}]}},
        x_preflight.CREDITS: {'data': {'prepaid_balance': Decimal('2.00'), 'free_balance': 0,
                                     'total_balance': Decimal('2.00'), 'free_grants': []}}}


def anchor():
    return dict(reference='synthetic-anchor', cycle_cap_micros=20_000_000, baseline_micros=2_000_000,
                auto_recharge_enabled=False, consumers_checked=True, same_key_tech_phase_only=True,
                verified_at=(NOW - timedelta(hours=1)).isoformat(),
                session_expires_at=(NOW + timedelta(hours=2)).isoformat())


def original(data):
    counts = x_preflight._counts(data[x_preflight.COUNTS], [])
    return dict(request_id=RID, status='observed', reason='x-preflight-metadata-only',
                storage_resume_prepared_at=(NOW - timedelta(minutes=30)).isoformat(),
                verified_at=(NOW - timedelta(minutes=30)).isoformat(), requests_admitted=7,
                rules_complete=True, inventory_complete=True, inventory=[], required_rules_present=False,
                missing_rules=x_stream.manifest(), rule_counts=counts,
                connections=x_preflight._connections([]), usage=x_preflight._usage(data[x_preflight.USAGE], '111'),
                credits=x_preflight._credits(data[x_preflight.CREDITS]))


def plan(report):
    value = dict(version=1, trial_id='synthetic-trial', approval_id='synthetic-approval',
        approved_at=(NOW-timedelta(hours=1)).isoformat(), prepared_at=NOW.isoformat(),
        session_expires_at=anchor()['session_expires_at'], probe_end_at=(NOW+timedelta(minutes=5)).isoformat(),
        original_metadata_request_id=RID, original_metadata_result_sha256=trial.digest(report),
        original_account_anchor_sha256=trial.digest(anchor()), expected_app_id='111',
        manifest_sha256=x_stream_rules.manifest_sha(), account_evidence_ref='synthetic-anchor',
        storage_evidence_ref='synthetic-backup', reconciliation_evidence_ref='synthetic-review',
        pricing_evidence_ref='synthetic-prices', reviewed_plan=True, create_missing_rules_approved=True,
        stream_attempt_approved=True, unknown_prior_cost_approved=True, single_consumer_verified=True,
        account_cap_verified=True, auto_recharge_disabled_verified=True, prices_verified=True,
        account_cap_micros=20_000_000, account_headroom_micros=2_000_000, local_aim_micros=1_000_000,
        prior_exposure_contingency_micros=100_000, setup_readiness_contingency_micros=100_000,
        stream_allowance_micros=100_000, polling_contingency_micros=100_000, post_micros=5000, user_micros=10000,
        credit_rounding_tolerance_micros=1, maximum_unexplained_decrease_micros=10000,
        max_probe_seconds=120, backup_margin_seconds=60, baseline_service_margin_bytes=8*1024*1024)
    assert set(value) == trial.REQUIRED
    return value


class ReadinessTransport:
    def __init__(self, test, **options):
        self.test, self.options = test, options

    async def get(self, path, params, request_id):
        t = self.test
        self.assert_claim(path, request_id)
        t.calls.append(('GET', path))
        value = t.data[path]
        if isinstance(value, BaseException):
            raise value
        return deepcopy(value)

    def assert_claim(self, path, request_id):
        t = self.test
        row = t.db.execute('SELECT cost_status,reserved_micros FROM x_stream_trial_readiness_requests WHERE request_id=?', (request_id,)).fetchone()
        t.assertEqual(row, ('unknown', None)); t.assertFalse(t.db.in_transaction)
        t.assertTrue(self.options['admission'](request_id, path))
        t.assertFalse(self.options['admission'](request_id, path))
        t.assertEqual(self.options['token_provider'](), SECRET)


class RuleTransport:
    def __init__(self, test, **options):
        self.test, self.options = test, options

    async def request(self, method, additions, request_id):
        t = self.test
        t.assertFalse(t.db.in_transaction)
        t.assertTrue(self.options['admission'](request_id, method, trial.digest(additions)))
        t.assertFalse(self.options['admission'](request_id, method, trial.digest(additions)))
        self.options['token_provider']()
        t.calls.append((method, 'rules'))
        if t.rule_error and method == 'POST':
            return {'data': rules()[:1], 'errors': [{'detail': PRIVATE}]}
        return {'data': rules(), 'meta': {'summary': {}}} if method == 'POST' else page(rules())


class StreamTransport:
    def __init__(self, test, **options):
        self.test, self.options = test, options

    @asynccontextmanager
    async def stream_factory(self, url, params):
        t = self.test
        t.assertTrue(self.options['admission']()); t.assertFalse(self.options['admission']())
        t.assertEqual(t.db.execute('SELECT attempts FROM x_stream_probe_run').fetchone()[0], 1)
        self.options['token_provider'](); t.calls.append(('GET', 'stream'))
        if t.stream_error:
            raise t.stream_error
        try:
            yield self
        finally:
            t.closed = True

    async def read(self, size):
        t = self.test
        t.assertTrue(any('x-stream-trial-connection ' in line for line in t.logs))
        t.assertEqual(size, 4096)
        if t.read_hook:
            t.read_hook()
        return t.chunks.pop(0) if t.chunks else b''


class ControllerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.db = sqlite3.connect(Path(self.tmp.name)/'service.sqlite'); self.addCleanup(self.db.close)
        self.data = responses(); self.report = original(self.data); self.plan = plan(self.report)
        x_preflight.schema(self.db)
        with self.db:
            self.db.execute('INSERT INTO x_metadata_preflight_runs VALUES(?,?,?,?,?,?,NULL,?,7,7,?,?)',
                (RID, 'synthetic-approval', self.plan['approved_at'], self.plan['approved_at'],
                 self.plan['session_expires_at'], json.dumps(anchor()), 'unknown', 'observed', json.dumps(self.report)))
            self.db.execute('INSERT INTO x_metadata_preflight_storage_resume VALUES(?,?,?,2)',
                            (RID, self.report['storage_resume_prepared_at'], self.plan['probe_end_at']))
        self.saved_original = self.db.execute('SELECT * FROM x_metadata_preflight_runs').fetchall()
        self.token = Mock(return_value=SECRET)
        self.backup = Mock(side_effect=lambda _end, _margin: dict(healthy=True, verified_at=NOW.isoformat(),
                              next_backup_at=(NOW+timedelta(hours=1)).isoformat()))
        self.storage = Mock(return_value={'metadata_storage_sufficient': True, 'available_bytes': 50_000_000})
        self.stop = threading.Event(); self.calls=[]; self.logs=[]; self.chunks=[]
        self.rule_error=False; self.stream_error=None; self.closed=False; self.read_hook=None
        for obj, name in ((aiohttp, 'ClientSession'), (x_preflight.os, 'statvfs'), (x_stream, 'schema'), (x_stream, 'Coordinator')):
            guard=patch.object(obj, name, side_effect=AssertionError('real operation forbidden'))
            guard.start(); self.addCleanup(guard.stop)

    def controller(self, **changes):
        kw = dict(db=self.db, enabled=True, plan=self.plan, token_provider=self.token, backup_readiness=self.backup,
                  storage_preflight=self.storage, stop_event=self.stop, emit=self.logs.append, clock=lambda: NOW,
                  monotonic=lambda: 1.0, readiness_transport_factory=lambda **opts: ReadinessTransport(self, **opts),
                  rules_transport_factory=lambda **opts: RuleTransport(self, **opts),
                  stream_transport_factory=lambda **opts: StreamTransport(self, **opts))
        kw.update(changes); return trial.Controller(**kw)

    async def test_changed_original_approval_id_is_rejected_before_credentials(self):
        self.plan['approval_id'] = 'different-approval'
        result = await self.controller().run()
        self.assertEqual(result['reason'], 'x-trial-original-evidence-mismatch')
        self.token.assert_not_called()
        self.assertEqual(self.calls, [])

    async def test_disabled_does_not_touch_anything(self):
        result=await trial.Controller(db=object(), plan=object(), token_provider=self.token).run()
        self.assertEqual(result['status'], 'disabled'); self.token.assert_not_called()

    async def test_full_one_shot_exact_five_reads_two_rule_calls_one_stream(self):
        c=self.controller(); result=await c.run()
        self.assertEqual(result['status'], 'ended', result)
        self.assertEqual(result['connection_attempts'], 1); self.assertTrue(result['stream_entitlement_verified'])
        self.assertTrue(self.closed); self.assertFalse(result['cost_reconciled'])
        self.assertEqual(self.calls, [('GET', path) for path in trial.ORDER] + [('POST','rules'),('GET','rules'),('GET','stream')])
        self.assertEqual(self.token.call_count, 8)
        self.assertEqual(self.db.execute('SELECT * FROM x_metadata_preflight_runs').fetchall(), self.saved_original)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM x_stream_trial_readiness_requests').fetchone()[0], 5)
        self.assertFalse(self.db.execute('SELECT 1 FROM x_stream_supervisor_owner').fetchone())
        self.assertEqual(c.required_storage, 26_476_544)
        self.assertEqual(c.probe_config['end_at'], x_stream.stamp(NOW+timedelta(seconds=120)))
        self.assertFalse(x_stream_rules._table(self.db, 'x_stream_runtime'))
        for secret in (SECRET, PRIVATE, '111', 'prepaid_balance'):
            self.assertNotIn(secret, '\n'.join(self.logs))
        self.token.reset_mock(); again=await self.controller().run()
        self.assertEqual(again['reason'],'x-trial-already-used'); self.token.assert_not_called()

    async def test_backup_required_not_boolean_bypass_and_overlap_block(self):
        for callback in (None, lambda *_: True, lambda *_: dict(healthy=True,verified_at=NOW.isoformat(),next_backup_at=NOW.isoformat())):
            result=await self.controller(backup_readiness=callback).run()
            self.assertEqual(result['status'],'blocked'); self.token.assert_not_called()
        self.assertEqual(self.calls,[])

    async def test_operator_can_shorten_historical_anchor_session(self):
        self.plan['session_expires_at']=(NOW+timedelta(hours=1)).isoformat()
        result=await self.controller().run()
        self.assertEqual(result['status'],'ended',result)
        self.assertEqual(self.db.execute('SELECT * FROM x_metadata_preflight_runs').fetchall(),self.saved_original)

    async def test_unknown_prior_cost_approval_missing_stops_before_token(self):
        self.plan['unknown_prior_cost_approved']=False
        result=await self.controller().run()
        self.assertEqual(result['reason'],'x-trial-approval-required'); self.token.assert_not_called()

    async def test_rule_inventory_pagination_stops_one_claim_unknown(self):
        self.data[x_preflight.RULES] = page(rules()[:1]); self.data[x_preflight.RULES]['meta']['next_token']='a'*16
        result=await self.controller().run()
        self.assertEqual(result['reason'],'x-trial-inventory-incomplete')
        self.assertEqual(len(self.calls),1)
        self.assertEqual(self.db.execute('SELECT requests_admitted,state,cost_status,reserved_micros FROM x_stream_trial_readiness').fetchone(), (1,'blocked','unknown',None))
        self.assertTrue(self.db.execute('SELECT 1 FROM x_stream_supervisor_owner').fetchone())

    async def test_identity_mismatch_stops_after_two_claims(self):
        self.data[x_preflight.COUNTS]['data']['client_app_rules_count']['client_app_id']='333'
        self.data[x_preflight.COUNTS]['data']['all_project_client_apps'][0]['client_app_id']='333'
        result=await self.controller().run()
        self.assertEqual(result['reason'],'x-trial-identity-or-foreign-app'); self.assertEqual(len(self.calls),2)

    async def test_material_decrease_stops_before_rules(self):
        self.data[x_preflight.CREDITS]['data'].update(prepaid_balance=1,total_balance=1)
        result=await self.controller().run()
        self.assertEqual(result['reason'],'x-trial-credit-adjustment-or-unexplained-decrease')
        self.assertEqual(len(self.calls),5)

    async def test_positive_adjustment_and_grant_stop_before_rules(self):
        self.data[x_preflight.CREDITS]['data'].update(prepaid_balance=3,total_balance=3)
        result=await self.controller().run()
        self.assertEqual(result['reason'],'x-trial-credit-adjustment-or-unexplained-decrease')
        self.assertEqual(len(self.calls),5)

    async def test_scope_denied_stops_and_never_retries(self):
        self.data[x_preflight.COUNTS]=x_preflight.PreflightBlocked('x-preflight-scope-denied')
        result=await self.controller().run()
        self.assertEqual(result['reason'],'x-preflight-scope-denied'); self.assertEqual(len(self.calls),2)
        await self.controller().run(); self.assertEqual(len(self.calls),2)

    async def test_partial_rule_add_stops_without_stream_or_deletion(self):
        self.rule_error=True; result=await self.controller().run()
        self.assertEqual(result['reason'],'x-trial-rule-setup-blocked'); self.assertEqual(len(self.calls),6)
        self.assertNotIn(PRIVATE,'\n'.join(self.logs))
        self.assertTrue(self.db.execute('SELECT 1 FROM x_stream_supervisor_owner').fetchone())

    async def test_stream_denied_has_no_retry_or_search(self):
        self.stream_error=x_stream.TransportFailure(403)
        result=await self.controller().run()
        self.assertEqual(result['reason'],'authentication-or-entitlement-denied')
        self.assertEqual(result['connection_attempts'],1); self.assertFalse(result['stream_entitlement_verified'])
        self.assertEqual(len(self.calls),8)
        self.assertFalse(any('x-stream-trial-connection ' in line for line in self.logs))

    async def test_read_backup_failure_closes_stream(self):
        self.chunks=[b'\n']
        self.read_hook=lambda: setattr(self.backup, 'side_effect', lambda *_: dict(healthy=False))
        result=await self.controller().run()
        self.assertEqual(result['reason'],'storage-low-or-unavailable'); self.assertTrue(self.closed)
        self.assertEqual(result['read_calls'],1)

    async def test_original_hash_mismatch_blocks_without_rewriting_history(self):
        self.plan['original_metadata_result_sha256']='b'*64
        result=await self.controller().run()
        self.assertEqual(result['reason'],'x-trial-original-evidence-mismatch'); self.token.assert_not_called()
        self.assertEqual(self.db.execute('SELECT * FROM x_metadata_preflight_runs').fetchall(),self.saved_original)

    async def test_low_storage_stops_before_claims_or_token(self):
        self.storage.return_value['available_bytes']=26_476_543
        result=await self.controller().run()
        self.assertEqual(result['reason'],'x-trial-storage-insufficient'); self.token.assert_not_called()

    async def test_crash_after_initialize_consumes_one_shot_without_token(self):
        c=self.controller(); c.initialize()
        result=await self.controller().run()
        self.assertEqual(result['reason'],'x-trial-already-used'); self.token.assert_not_called()


    async def test_real_monitor_row_factory_waits_for_competing_writer(self):
        import monitor
        path=Path(self.tmp.name)/'production.sqlite'
        db=monitor.connect(path); self.addCleanup(db.close)
        self.assertIs(db.row_factory,sqlite3.Row)
        x_preflight.schema(db)
        with db:
            db.executemany('INSERT INTO x_metadata_preflight_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',self.saved_original)
            db.executemany('INSERT INTO x_metadata_preflight_storage_resume VALUES(?,?,?,?)',
                           self.db.execute('SELECT * FROM x_metadata_preflight_storage_resume').fetchall())
        acquired=threading.Event(); released=threading.Event(); errors=[]
        def competing_writer():
            other=sqlite3.connect(path)
            try:
                other.execute('BEGIN IMMEDIATE'); acquired.set()
                time.sleep(0.35)
                other.commit()
            except Exception as exc:
                errors.append(type(exc).__name__)
            finally:
                other.close(); released.set()
        thread=threading.Thread(target=competing_writer); thread.start()
        self.addCleanup(thread.join)
        self.assertTrue(acquired.wait(2))
        started=time.monotonic()
        controller=self.controller(db=db); controller.initialize()
        self.assertGreaterEqual(time.monotonic()-started,0.2)
        self.assertTrue(released.wait(2)); self.assertEqual(errors,[])
        self.assertEqual(db.execute('PRAGMA busy_timeout').fetchone()[0],5000)
        self.assertTrue(controller.claimed); self.token.assert_not_called()
        again=await self.controller(db=db).run()
        self.assertEqual(again['reason'],'x-trial-already-used')

    async def test_unexpected_failure_logs_only_fixed_stage_class_and_counts(self):
        c=self.controller()
        with patch.object(c,'_original',side_effect=TypeError(PRIVATE)):
            result=await c.run()
        self.assertEqual(result['reason'],'x-trial-internal-failure')
        self.assertEqual(result['stage'],'original-evidence')
        self.assertEqual(result['error_class'],'type-error')
        self.assertEqual(result['ledger']['x_stream_trial_run']['rows'],0)
        self.assertNotIn(PRIVATE,json.dumps(result)); self.token.assert_not_called()

    async def test_unexpected_failure_after_claim_never_rearms(self):
        c=self.controller()
        with patch.object(c,'_readiness',side_effect=TypeError(PRIVATE)):
            result=await c.run()
        self.assertEqual(result['ledger']['x_stream_trial_run']['rows'],1)
        self.assertEqual(result['ledger']['x_stream_trial_readiness_requests']['rows'],0)
        again=await self.controller().run()
        self.assertEqual(again['reason'],'x-trial-already-used'); self.token.assert_not_called()
        diagnostic=trial.local_diagnostic(Path(self.tmp.name)/'service.sqlite')
        self.assertEqual(diagnostic['x_stream_trial_run']['state'],'blocked')
        self.assertEqual(diagnostic['x_stream_trial_readiness']['state'],'blocked')
        self.assertEqual(diagnostic['x_stream_supervisor_owner']['rows'],1)


class ServiceTests(unittest.TestCase):
    def test_default_off_does_not_open_database_or_load_token(self):
        env={}; stop=threading.Event()
        with patch.object(sqlite3,'connect',side_effect=AssertionError('db forbidden')):
            self.assertIsNone(trial.run_once('/not-a-database',stop,env=env))
        self.assertFalse(trial.requested(env))

    def test_diagnostics_only_uses_existing_db_read_only_without_plan_or_token(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'service.sqlite'
            db=sqlite3.connect(path); trial._schema(db); db.close()
            before=path.read_bytes(); logs=[]
            env={trial.LOCAL:'true',trial.ENABLED:'false',trial.PLAN:PRIVATE,'X_BEARER_TOKEN':SECRET}
            with patch.object(trial.Controller,'initialize',side_effect=AssertionError('claim forbidden')):
                trial.run_once(path,threading.Event(),env=env,emit=logs.append)
            self.assertEqual(len(logs),1); self.assertTrue(logs[0].startswith('x-stream-trial-local '))
            self.assertEqual(json.loads(logs[0].split(' ',1)[1])['x_stream_trial_run']['rows'],0)
            self.assertEqual(path.read_bytes(),before)
            self.assertNotIn(SECRET,logs[0]); self.assertNotIn(PRIVATE,logs[0])
            missing=Path(directory)/'missing.sqlite'
            self.assertFalse(trial.local_diagnostic(missing)['available']); self.assertFalse(missing.exists())

    def test_invalid_plan_is_sanitized(self):
        logs=[]
        trial.run_once('/not-a-database',threading.Event(),env={trial.ENABLED:'true',trial.PLAN:PRIVATE},emit=logs.append)
        self.assertEqual(logs,['x-stream-trial-result {"status":"blocked","reason":"x-trial-service-check-failed"}'])


if __name__ == '__main__':
    unittest.main()
