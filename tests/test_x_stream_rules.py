"""Synthetic-only exact-rule setup: no live token, provider, or filesystem probe."""
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

import aiohttp

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import x_preflight
import x_stream
import x_stream_rules as setup

NOW = datetime(2026, 10, 3, 5, tzinfo=timezone.utc)
TOKEN = 'SYNTHETIC-SECRET'
SENTINEL = 'PRIVATE-BODY 192.0.2.20'
RUN_ID = 'a' * 64


def rules():
    return [{'id': str(100 + i), 'value': r['value'], 'tag': r['tag']}
            for i, r in enumerate(x_stream.manifest())]


def metadata(existing=None):
    existing = [] if existing is None else existing
    present = {(r['value'], r['tag']) for r in existing}
    return {'request_id': RUN_ID, 'status': 'observed', 'reason': 'x-preflight-metadata-only',
            'storage_resume_prepared_at': NOW.isoformat(), 'verified_at': NOW.isoformat(),
            'requests_admitted': 7, 'inventory': existing, 'rules_complete': True, 'inventory_complete': True,
            'missing_rules': [r for r in x_stream.manifest() if (r['value'], r['tag']) not in present],
            'required_rules_present': len(existing) == 4,
            'rule_counts': {'client_app_id': '777', 'client_app_rules_count': len(existing),
                            'project_rules_count': len(existing), 'other_app_rule_count': 0,
                            'project_app_count': 1, 'cap_per_client_app': 5, 'cap_per_project': 5},
            'connections': {'inventory_complete': True, 'active_count': 0, 'active_by_endpoint': {}},
            'usage': {'counts_usage_app_identity_matches': True, 'other_app_usage_posts_one_day': 0},
            'credits': {'currency': 'USD', 'prepaid_balance': '1.00', 'free_balance': '0.00', 'total_balance': '1.00'}}


def config(report):
    return {'version': 1, 'setup_id': 'synthetic-setup', 'approval_id': 'synthetic-approval',
            'approved_at': NOW.isoformat(), 'prepared_at': NOW.isoformat(),
            'expires_at': (NOW + timedelta(minutes=10)).isoformat(),
            'manifest_sha256': setup.manifest_sha(), 'metadata_request_id': RUN_ID,
            'metadata_result_sha256': setup.digest(report), 'expected_app_id': '777',
            'create_missing_rules_approved': True, 'single_consumer_verified': True,
            'account_cap_verified': True, 'account_cap_micros': 20_000_000,
            'account_headroom_micros': 2_000_000, 'auto_recharge_disabled_verified': True,
            'account_evidence_ref': 'synthetic-account-review', 'storage_evidence_ref': 'synthetic-stable-backup-review',
            'reconciliation_evidence_ref': 'synthetic-exposure-review', 'unknown_cost_approved': True,
            'local_aim_micros': 1_000_000, 'prior_exposure_contingency_micros': 100_000,
            'control_contingency_micros': 100_000, 'polling_contingency_micros': 100_000,
            'storage_required_bytes': 64 * 1024 * 1024}


def post(rows):
    return {'data': rows, 'meta': {'sent': NOW.isoformat(), 'summary': {}}}


def page(rows):
    return {'data': rows, 'meta': {'result_count': len(rows)}}


class FakeTransport:
    def __init__(self, owner, **options):
        self.owner, self.options = owner, options

    async def request(self, method, additions, request_id):
        admission = self.options['admission']
        assert admission(request_id, method, setup.digest(additions)) is True
        assert admission(request_id, method, setup.digest(additions)) is False
        assert self.options['token_provider']() == TOKEN
        self.owner.calls.append((method, deepcopy(additions), request_id))
        value = self.owner.responses[method]
        if callable(value):
            value = value()
        if isinstance(value, BaseException):
            raise value
        return deepcopy(value)


class InstallerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'service.sqlite'
        self.db = sqlite3.connect(self.path); self.addCleanup(self.db.close)
        self.db.row_factory = sqlite3.Row
        self.report = metadata(); self.config = config(self.report)
        x_preflight.schema(self.db)
        self.save_metadata()
        self.token = Mock(return_value=TOKEN); self.review = Mock(return_value=True)
        self.storage = Mock(return_value={'metadata_storage_sufficient': True, 'available_bytes': 70 * 1024 * 1024})
        self.calls = []; self.responses = {'POST': post(rules()), 'GET': page(rules())}
        self.stop = threading.Event(); self.now = NOW
        self.factory = Mock(side_effect=lambda **kw: FakeTransport(self, **kw))
        for target, name in ((aiohttp, 'ClientSession'), (x_stream, 'schema'), (x_stream, 'Coordinator')):
            guard = patch.object(target, name, side_effect=AssertionError('forbidden live or canonical access'))
            guard.start(); self.addCleanup(guard.stop)
        guard = patch.object(x_preflight.os, 'statvfs', side_effect=AssertionError('real volume forbidden'))
        guard.start(); self.addCleanup(guard.stop)

    def save_metadata(self):
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO x_metadata_preflight_runs '
                '(request_id,approval_id,approved_at,run_prepared_at,expires_at,account_anchor,reserved_micros,cost_status,'
                'requests_admitted,max_requests,status,result) VALUES(?,?,?,?,?,?,NULL,\'unknown\',7,7,?,?)',
                (RUN_ID, 'synthetic-metadata-approval', NOW.isoformat(), NOW.isoformat(),
                 (NOW + timedelta(minutes=10)).isoformat(), '{}', self.report['status'], json.dumps(self.report)))
            self.db.execute('INSERT OR REPLACE INTO x_metadata_preflight_storage_resume VALUES(?,?,?,2)',
                            (RUN_ID, NOW.isoformat(), (NOW + timedelta(minutes=10)).isoformat()))
        self.config['metadata_result_sha256'] = setup.digest(self.report)

    def worker(self, **changes):
        opts = dict(db=self.db, enabled=True, config=self.config, token_provider=self.token,
                    reviewed_admission=self.review, storage_preflight=self.storage, transport_factory=self.factory,
                    stop_event=self.stop, clock=lambda: self.now)
        opts.update(changes)
        return setup.Installer(**opts)

    def row(self):
        return self.db.execute('SELECT * FROM x_stream_rule_setup').fetchone()

    def owner_present(self):
        return self.db.execute('SELECT 1 FROM x_stream_supervisor_owner').fetchone() is not None

    async def blocked_before_token(self, reason=None, **changes):
        value = await self.worker(**changes).run()
        self.assertEqual(value['status'], 'blocked', value)
        if reason:
            self.assertEqual(value['reason'], 'x-rule-setup-' + reason)
        self.token.assert_not_called(); self.assertEqual(self.calls, [])
        return value

    async def test_default_off_is_completely_inert(self):
        obj = setup.Installer(db=object(), config=object(), token_provider=self.token, reviewed_admission=self.review)
        self.assertEqual(await obj.run(), {'status': 'disabled', 'reason': 'x-rule-setup-disabled'})
        self.token.assert_not_called(); self.review.assert_not_called()

    async def test_exact_missing_post_and_single_get_with_unknown_cost_preserved(self):
        result = await self.worker().run()
        self.assertEqual(result['status'], 'verified', result)
        self.assertEqual([c[0] for c in self.calls], ['POST', 'GET'])
        self.assertEqual(self.calls[0][1], setup.missing_rules([]))
        self.assertEqual(self.calls[1][1], None)
        self.assertEqual(result['inventory'], rules())
        self.assertEqual(result['cost_status'], 'unknown'); self.assertIsNone(result['reserved_micros'])
        self.assertFalse(result['cost_reconciled']); self.assertFalse(self.owner_present())
        self.assertEqual(self.row()['post_claimed'], 1); self.assertEqual(self.row()['get_claimed'], 1)
        self.assertEqual(self.row()['control_contingency_micros'], 100000)
        tables = {r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertNotIn('x_stream_runtime', tables); self.assertNotIn('x_stream_state', tables)
        self.assertEqual(self.db.execute('SELECT cost_status FROM x_metadata_preflight_runs').fetchone()[0], 'unknown')
        evidence = self.review.call_args.args[1]
        self.assertEqual(evidence['metadata_exposure']['unknown_runs'], 1)
        self.assertEqual(evidence['cost_status'], 'unknown')

    async def test_owned_subset_preserves_existing_ids_and_only_adds_missing(self):
        self.report = metadata(rules()[:2]); self.save_metadata()
        self.responses['POST'] = post(rules()[2:])
        result = await self.worker().run()
        self.assertEqual(result['status'], 'verified', result)
        self.assertEqual(self.calls[0][1], [{k: r[k] for k in ('value', 'tag')} for r in rules()[2:]])
        self.assertEqual(result['inventory'], rules())

    async def test_complete_inventory_is_noop_without_token_or_transport(self):
        self.report = metadata(rules()); self.save_metadata()
        result = await self.worker().run()
        self.assertEqual(result['reason'], 'x-rule-setup-already-complete')
        self.token.assert_not_called(); self.factory.assert_not_called()

    async def test_restart_or_new_approval_cannot_repeat(self):
        await self.worker().run(); self.token.reset_mock()
        self.config['approval_id'] = 'different-approval'
        result = await self.worker().run()
        self.assertEqual(result['reason'], 'x-rule-setup-already-used')
        self.token.assert_not_called(); self.assertEqual(len(self.calls), 2)

    async def test_crash_after_reservation_consumes_one_shot_before_token(self):
        first = self.worker(); first.initialize()
        self.assertTrue(self.owner_present())
        await self.blocked_before_token('already-used')
        self.assertEqual(self.row()['post_claimed'], 0)

    async def test_partial_add_keeps_real_ids_unknown_cost_owner_and_never_gets_or_retries(self):
        self.responses['POST'] = dict(post(rules()[:2]), errors=[{'detail': SENTINEL}])
        result = await self.worker().run()
        self.assertEqual(result['status'], 'blocked'); self.assertEqual(len(self.calls), 1)
        self.assertEqual(result['observed_post_inventory'], rules()[:2])
        self.assertTrue(self.owner_present()); self.assertEqual(self.row()['get_claimed'], 0)
        self.assertEqual(result['cost_status'], 'unknown')
        self.assertNotIn(SENTINEL, json.dumps(result)); self.assertNotIn(SENTINEL, str(tuple(self.row())))
        again = await self.worker().run(); self.assertEqual(again['reason'], 'x-rule-setup-already-used')
        self.assertEqual(len(self.calls), 1)

    async def test_ambiguous_post_has_no_retry_and_retains_owner(self):
        self.responses['POST'] = RuntimeError(SENTINEL)
        result = await self.worker().run()
        self.assertEqual(result['reason'], 'x-rule-setup-internal-failure')
        self.assertEqual(len(self.calls), 1); self.assertTrue(self.owner_present())
        self.assertNotIn(SENTINEL, json.dumps(result))

    async def test_failed_verification_retains_created_ids_and_owner(self):
        self.responses['GET'] = page(rules()[:3])
        result = await self.worker().run()
        self.assertEqual(result['reason'], 'x-rule-setup-inventory-changed')
        self.assertEqual(result['observed_post_inventory'], rules())
        self.assertEqual(result['inventory'], []); self.assertTrue(self.owner_present())
        self.assertEqual(len(self.calls), 2)

    async def test_verification_rejects_pagination_without_followup(self):
        self.responses['GET']['meta']['next_token'] = '0123456789ABCDEF'
        result = await self.worker().run()
        self.assertEqual(result['reason'], 'x-rule-setup-inventory-incomplete')
        self.assertEqual(len(self.calls), 2); self.assertTrue(self.owner_present())

    async def test_verification_rejects_reassigned_existing_id(self):
        self.report = metadata(rules()[:1]); self.save_metadata()
        self.responses['POST'] = post(rules()[1:]); self.responses['GET']['data'][0]['id'] = '999'
        result = await self.worker().run()
        self.assertEqual(result['reason'], 'x-rule-setup-inventory-changed')

    async def test_missing_review_never_reads_token(self):
        await self.blocked_before_token('reviewed-admission-required', reviewed_admission=None)

    async def test_denied_review_never_reads_token(self):
        self.review.return_value = False
        await self.blocked_before_token('reviewed-admission-required')

    async def test_review_cannot_commit(self):
        self.review.side_effect = lambda *args: self.db.commit() or True
        await self.blocked_before_token('reviewed-admission-committed')

    async def test_config_mandatory_fields_and_strict_evidence(self):
        for key in setup.REQUIRED:
            with self.subTest(key=key):
                changed = dict(self.config); changed.pop(key)
                with self.assertRaises(setup.RuleSetupBlocked): setup.validate_config(changed, NOW)
        for key in ('create_missing_rules_approved', 'single_consumer_verified', 'account_cap_verified',
                    'auto_recharge_disabled_verified', 'unknown_cost_approved'):
            with self.subTest(key=key):
                changed = dict(self.config, **{key: 1})
                with self.assertRaises(setup.RuleSetupBlocked): setup.validate_config(changed, NOW)

    async def test_modified_manifest_stale_account_and_unknown_cost_block(self):
        self.config['manifest_sha256'] = 'b' * 64
        await self.blocked_before_token('manifest-changed')
        self.config['manifest_sha256'] = setup.manifest_sha()
        self.config['approved_at'] = (NOW - timedelta(hours=5)).isoformat()
        await self.blocked_before_token('approval-stale')

    async def test_complete_resumed_metadata_required(self):
        with self.db: self.db.execute('DELETE FROM x_metadata_preflight_storage_resume')
        await self.blocked_before_token('metadata-incomplete')

    async def test_original_partial_storage_result_cannot_admit(self):
        self.report.update(status='blocked', reason='x-preflight-volume-space-insufficient', requests_admitted=2)
        self.save_metadata()
        await self.blocked_before_token('metadata-incomplete')

    async def test_changed_report_hash_blocks_before_token(self):
        self.config['metadata_result_sha256'] = 'b' * 64
        await self.blocked_before_token('metadata-changed')

    async def test_active_other_consumer_and_wrong_app_block(self):
        self.report['connections']['active_count'] = 1; self.save_metadata()
        await self.blocked_before_token('active-consumer-present')
        self.report['connections']['active_count'] = 0
        self.report['rule_counts']['client_app_id'] = '999'; self.save_metadata()
        await self.blocked_before_token('identity-mismatch')

    async def test_foreign_inventory_and_insufficient_capacity_block(self):
        self.report['inventory'] = [{'id': '5', 'value': 'from:thefly', 'tag': 'foreign'}]; self.save_metadata()
        await self.blocked_before_token('foreign-or-unknown-rule')
        self.report = metadata(); self.report['rule_counts']['cap_per_client_app'] = 3; self.save_metadata()
        await self.blocked_before_token('rule-cap-insufficient')

    async def test_stale_metadata_blocks_independently_of_fresh_config(self):
        self.now = NOW + timedelta(minutes=20)
        self.config['prepared_at'] = self.now.isoformat()
        self.config['expires_at'] = (self.now + timedelta(minutes=5)).isoformat()
        await self.blocked_before_token('metadata-stale')

    async def test_ongoing_metadata_and_prior_denied_scope_block(self):
        self.report['status'] = 'running'; self.save_metadata()
        await self.blocked_before_token('metadata-worker-owned')
        self.report.update(status='blocked', reason='x-preflight-scope-denied'); self.save_metadata()
        await self.blocked_before_token('metadata-scope-or-billing-stop')

    async def test_existing_supervisor_owner_is_never_deleted(self):
        setup._schema(self.db)
        with self.db: self.db.execute("INSERT INTO x_stream_supervisor_owner VALUES(1,'other-owner','now')")
        await self.blocked_before_token('another-owner-present')
        self.assertEqual(self.db.execute('SELECT owner FROM x_stream_supervisor_owner').fetchone()[0], 'other-owner')

    async def test_global_stop_blocks_without_changing_budget(self):
        self.db.execute('CREATE TABLE x_budget_stop(singleton INTEGER, reason TEXT)')
        with self.db: self.db.execute("INSERT INTO x_budget_stop VALUES(1,'billing-stop')")
        await self.blocked_before_token('account-stop-present')
        self.assertEqual(self.db.execute('SELECT reason FROM x_budget_stop').fetchone()[0], 'billing-stop')

    async def test_migration_or_probe_marker_blocks(self):
        self.db.execute('CREATE TABLE x_stream_probe_run(state TEXT)')
        with self.db: self.db.execute("INSERT INTO x_stream_probe_run VALUES('ended')")
        await self.blocked_before_token('migration-or-probe-present')

    async def test_storage_or_stop_blocks_before_credential(self):
        self.storage.return_value['available_bytes'] = setup.MIN_FREE_BYTES - 1
        await self.blocked_before_token('storage-insufficient')
        self.storage.return_value['available_bytes'] = 70 * 1024 * 1024
        self.stop.set(); await self.blocked_before_token('stopped')

    async def test_storage_loss_after_post_prevents_get(self):
        def response():
            self.storage.return_value['available_bytes'] = 1
            return post(rules())
        self.responses['POST'] = response
        result = await self.worker().run()
        self.assertEqual(result['reason'], 'x-rule-setup-storage-insufficient')
        self.assertEqual(len(self.calls), 1); self.assertTrue(self.owner_present())
        self.assertEqual(self.row()['get_claimed'], 0)

    async def test_token_observes_committed_reservation_and_owner(self):
        observer = sqlite3.connect(self.path); self.addCleanup(observer.close)
        def token():
            row = observer.execute('SELECT state,cost_status FROM x_stream_rule_setup').fetchone()
            self.assertIn(row[0], ('post-claimed', 'get-claimed')); self.assertEqual(row[1], 'unknown')
            self.assertIsNotNone(observer.execute('SELECT 1 FROM x_stream_supervisor_owner').fetchone())
            return TOKEN
        self.token.side_effect = token
        self.assertEqual((await self.worker().run())['status'], 'verified')

    async def test_cancellation_retains_unknown_exposure_and_owner(self):
        self.responses['POST'] = asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError): await self.worker().run()
        self.assertEqual(self.row()['reason'], 'x-rule-setup-interrupted')
        self.assertEqual(self.row()['cost_status'], 'unknown'); self.assertTrue(self.owner_present())

    async def test_cleanup_failure_keeps_private_safe_provider_ids(self):
        failure = setup.RuleSetupBlocked('x-rule-setup-cleanup-failed')
        failure.observed_inventory = rules()
        self.responses['POST'] = failure
        result = await self.worker().run()
        self.assertEqual(result['reason'], 'x-rule-setup-cleanup-failed')
        self.assertEqual(result['observed_post_inventory'], rules())
        self.assertEqual(json.loads(self.row()['observed_post_inventory']), rules())
        self.assertTrue(self.owner_present()); self.assertEqual(len(self.calls), 1)

    async def test_new_account_stop_after_verification_is_not_success(self):
        def response():
            self.db.execute('CREATE TABLE x_budget_stop(singleton INTEGER, reason TEXT)')
            with self.db: self.db.execute("INSERT INTO x_budget_stop VALUES(1,'auth-stop')")
            return page(rules())
        self.responses['GET'] = response
        result = await self.worker().run()
        self.assertEqual(result['reason'], 'x-rule-setup-account-stop-present')
        self.assertTrue(self.owner_present())


class Content:
    def __init__(self, raw): self.raw = raw
    async def read(self, size):
        block, self.raw = self.raw[:size], self.raw[size:]
        return block


class Response:
    def __init__(self, payload=None, *, raw=None, status=200, headers=None):
        self.status, self.closed = status, False
        self.headers = headers or {'Content-Type': 'application/json'}
        self.content = Content(json.dumps(payload).encode() if raw is None else raw)
    def close(self): self.closed = True


class Session:
    def __init__(self, response, **options):
        self.response, self.options = response, options
        self._retry_connection = True; self.closed = False; self.calls = []
    async def post(self, url, **kwargs): return await self.request('POST', url, **kwargs)
    async def get(self, url, **kwargs): return await self.request('GET', url, **kwargs)
    async def request(self, method, url, **kwargs):
        self.calls.append((method, url, deepcopy(kwargs)))
        assert self._retry_connection is False
        if isinstance(self.response, BaseException): raise self.response
        return self.response
    async def close(self): self.closed = True


class TransportTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.token = Mock(return_value=TOKEN); self.admission = Mock(return_value=True)
        self.response = Response(post(rules())); self.sessions = []
        def factory(**options):
            session = Session(self.response, **options); self.sessions.append(session); return session
        self.factory = Mock(side_effect=factory)
        self.worker = setup.AiohttpTransport(enabled=True, admission=self.admission,
                                            token_provider=self.token, session_factory=self.factory)
        guard = patch.object(aiohttp, 'ClientSession', side_effect=AssertionError('network forbidden'))
        self.network = guard.start(); self.addCleanup(guard.stop)

    async def request(self, method='POST', additions=None):
        return await self.worker.request(method, setup.missing_rules([]) if additions is None and method == 'POST' else additions, RUN_ID)

    async def test_pinned_transport_fixed_url_exact_body_no_retry_redirect_proxy_cookie(self):
        self.assertEqual(await self.request(), post(rules()))
        session = self.sessions[0]; method, url, options = session.calls[0]
        self.assertEqual((method, url), ('POST', setup.RULES_URL))
        self.assertEqual(options['json'], {'add': setup.missing_rules([])})
        self.assertNotIn('params', options); self.assertFalse(options['allow_redirects'])
        self.assertIsNone(options['proxy']); self.assertIsNone(options['auth']); self.assertTrue(options['ssl'])
        self.assertFalse(session.options['trust_env']); self.assertFalse(session.options['auto_decompress'])
        self.assertIsInstance(session.options['cookie_jar'], aiohttp.DummyCookieJar)
        self.assertEqual(options['headers']['Accept-Encoding'], 'identity')
        self.assertTrue(session.closed); self.assertTrue(self.response.closed)

    async def test_get_always_full_inventory_single_page_limit(self):
        self.response = Response(page(rules()))
        await self.request('GET')
        self.assertEqual(self.sessions[0].calls[0][2]['params'], {'max_results': 1000})
        self.assertNotIn('json', self.sessions[0].calls[0][2])

    async def test_disabled_and_denied_admission_are_lazy(self):
        self.worker.enabled = False
        with self.assertRaisesRegex(setup.RuleSetupBlocked, 'transport-disabled'): await self.request()
        self.worker.enabled = True; self.admission.return_value = False
        with self.assertRaisesRegex(setup.RuleSetupBlocked, 'durable-admission-required'): await self.request()
        self.token.assert_not_called(); self.factory.assert_not_called()

    async def test_version_pin_fails_before_admission_or_token(self):
        self.worker.session_factory = None
        with patch.object(aiohttp, '__version__', '999'):
            with self.assertRaisesRegex(setup.RuleSetupBlocked, 'transport-version-unreviewed'): await self.request()
        self.admission.assert_not_called(); self.token.assert_not_called(); self.network.assert_not_called()

    async def test_admission_exception_is_fixed_before_token(self):
        self.admission.side_effect = RuntimeError(SENTINEL)
        with self.assertRaisesRegex(setup.RuleSetupBlocked, 'durable-admission-required') as caught: await self.request()
        self.assertNotIn(SENTINEL, str(caught.exception))
        self.token.assert_not_called(); self.factory.assert_not_called()

    async def test_bad_method_duplicate_and_widened_rules_block_before_token(self):
        for method, additions in [('DELETE', None), ('GET', []),
                ('POST', [{'value': 'from:thefly', 'tag': 'foreign'}]),
                ('POST', [setup.missing_rules([])[0]] * 2), ('POST', [])]:
            with self.subTest(method=method, additions=additions):
                with self.assertRaises(setup.RuleSetupBlocked):
                    await self.worker.request(method, additions, RUN_ID)
        self.token.assert_not_called(); self.factory.assert_not_called()

    async def test_http_failures_are_fixed_and_have_no_retry(self):
        for status, reason in ((201, 'http-failed'), (301, 'http-failed'), (401, 'scope-denied'),
                               (403, 'scope-denied'), (402, 'billing-denied'), (429, 'rate-limited'), (503, 'http-failed')):
            with self.subTest(status=status):
                self.response = Response(raw=SENTINEL.encode(), status=status)
                with self.assertRaisesRegex(setup.RuleSetupBlocked, reason) as caught: await self.request()
                self.assertNotIn(SENTINEL, str(caught.exception))
                self.assertEqual(len(self.sessions[-1].calls), 1)
                self.assertTrue(self.sessions[-1].closed)
                self.assertEqual(self.response.content.raw, SENTINEL.encode())

    async def test_malformed_duplicate_json_and_nan_are_sanitized(self):
        for raw in (b'{', b'{"a":1,"a":2}', b'{"a":NaN}', b'\xff'):
            with self.subTest(raw=raw):
                self.response = Response(raw=raw)
                with self.assertRaisesRegex(setup.RuleSetupBlocked, 'response-invalid'): await self.request()

    async def test_response_size_and_format_are_bounded(self):
        self.response = Response(raw=b' ' * (setup.MAX_BODY_BYTES + 1))
        with self.assertRaisesRegex(setup.RuleSetupBlocked, 'response-too-large'): await self.request()
        self.response = Response({}, headers={'Content-Type': 'application/json', 'Content-Encoding': 'gzip'})
        with self.assertRaisesRegex(setup.RuleSetupBlocked, 'response-format-invalid'): await self.request()

    async def test_connection_failure_never_returns_provider_error_or_retries(self):
        self.response = RuntimeError(SENTINEL)
        with self.assertRaisesRegex(setup.RuleSetupBlocked, 'transport-failed') as caught: await self.request()
        self.assertNotIn(SENTINEL, str(caught.exception)); self.assertEqual(len(self.sessions[0].calls), 1)
        self.assertTrue(self.sessions[0].closed)

    async def test_cleanup_failure_is_fixed_and_transfers_only_known_rule_ids(self):
        self.response = Response(dict(post(rules()), private=SENTINEL))
        with patch.object(x_preflight, '_close_owned', side_effect=x_preflight.PreflightBlocked('x-preflight-cleanup-failed')):
            with self.assertRaisesRegex(setup.RuleSetupBlocked, 'cleanup-failed') as caught: await self.request()
        self.assertEqual(caught.exception.observed_inventory, rules())
        self.assertNotIn(SENTINEL, str(vars(caught.exception)))


class ParserTests(unittest.TestCase):
    def test_current_manifest_exact_source_ownership(self):
        manifest = x_stream.manifest()
        self.assertEqual(len(manifest), 4)
        wall = next(r for r in manifest if r['source_id'] == 'x-wallstengine')
        self.assertIn('from:tipranks', wall['value']); self.assertIn('FABYMETAL4', wall['value'])
        self.assertNotIn('thefly', json.dumps(manifest).lower())

    def test_summary_is_optional_but_partial_or_wrong_data_is_not(self):
        self.assertEqual(setup.added_rules({'data': rules()}, setup.missing_rules([])), rules())
        for payload in (post(rules()[:3]), dict(post(rules()), errors=[{}]),
                        {'data': rules(), 'meta': {'summary': {'not_created': 1}}},
                        {'data': rules(), 'meta': {'summary': {'created': True}}}):
            with self.subTest(payload=payload):
                with self.assertRaises(setup.RuleSetupBlocked): setup.added_rules(payload, setup.missing_rules([]))

    def test_duplicates_foreign_rule_and_oversized_inventory_block(self):
        for values in (rules() + rules()[:1], [{'id': '1', 'value': 'cat', 'tag': 'foreign'}],
                       [rules()[0]] * 1001, [dict(rules()[0], id='9' * 20)]):
            with self.subTest(values=len(values)):
                with self.assertRaises(setup.RuleSetupBlocked): setup.inventory(values)


if __name__ == '__main__':
    unittest.main()
