"""Synthetic-only metadata preflight, transaction, parser and HTTP contracts."""
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import traceback
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import aiohttp
from multidict import CIMultiDict

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import x_preflight as preflight
import x_stream

NOW = datetime(2026, 10, 3, 3, 0, tzinfo=timezone.utc)
TOKEN = 'synthetic-metadata-test-token'
SENTINEL = 'SECRET-DO-NOT-RETURN 192.0.2.99'
REQUEST_ID = 'a' * 64


def approval(*, unknown=False, pages=1, identity='fixture-approval', unit=1000):
    value = {'version': 1, 'approved': True, 'approval_id': identity,
             'approved_at': NOW.isoformat(), 'expires_at': (NOW + timedelta(minutes=10)).isoformat(),
             'manifest_sha256': preflight.manifest_sha(),
             'cost_mode': 'unknown-explicitly-approved' if unknown else 'verified-bound',
             'account_evidence': {'reference': 'operator-account-fixture', 'verified_at': NOW.isoformat(),
                                  'cycle_cap_micros': 20_000_000, 'baseline_micros': 2_000_000,
                                  'auto_recharge_enabled': False, 'consumers_checked': True},
             'trial_limit_micros': 1_000_000, 'trial_spent_micros': 0,
             'max_pages': pages, 'max_requests': pages * 2 + 3}
    if unknown:
        value['unknown_cost_approved'] = True
        value['run_prepared_at'] = NOW.isoformat()
        value['account_evidence'].update(cycle_start_date='2026-09-25',
                                         cycle_end_date='2026-10-25',
                                         session_expires_at=(NOW+timedelta(hours=4)).isoformat(),
                                         same_key_tech_phase_only=True)
    else:
        value.update(metadata_price_verified=True, metadata_cost_evidence='operator-price-fixture',
                     metadata_cost_verified_at=NOW.isoformat(), metadata_max_request_micros=unit,
                     metadata_reserve_micros=(pages * 2 + 3) * unit)
    return value


def disk(available=100_000):
    return SimpleNamespace(f_frsize=4096, f_blocks=200_000, f_bfree=100_000, f_bavail=available)


def inventory():
    return [{'id': str(i), 'value': row['value'], 'tag': row['tag']}
            for i, row in enumerate(x_stream.manifest(), 1)]


def page(rows, token=None):
    meta = {'result_count': len(rows)}
    if token is not None:
        meta['next_token'] = token
    return {'data': rows, 'meta': meta}


def fixtures():
    return {preflight.RULES: page(inventory()),
            preflight.COUNTS: {'data': {'cap_per_client_app': '1000', 'cap_per_project': '1000',
                'client_app_rules_count': {'client_app_id': '111', 'rule_count': 4},
                'project_rules_count': '4', 'all_project_client_apps': [{'client_app_id': '111', 'rule_count': 4}]}},
            preflight.CONNECTIONS: page([]),
            preflight.USAGE: {'data': {'cap_reset_day': 1, 'project_id': '222', 'project_usage': '12',
                'project_cap': '10000', 'daily_client_app_usage': [{'client_app_id': '111', 'usage_result_count': 1,
                                                                 'usage': [{'date': '2026-10-03', 'usage': '2'}]}]}},
            preflight.CREDITS: {'data': {'free_balance': Decimal('1.50'), 'prepaid_balance': Decimal('-0.20'),
                                        'total_balance': Decimal('1.30'), 'free_grants': [{'amount': Decimal('1.50'), 'expires_at': '2026-11-01T00:00:00Z', 'private': SENTINEL}]}}}


class FakeTransport:
    def __init__(self, *, responses, calls, **options):
        self.responses, self.calls, self.options = responses, calls, options

    async def get(self, path, params, request_id):
        assert self.options['admission'](request_id, path) is True
        assert self.options['admission'](request_id, path) is False
        assert self.options['token_provider']() == TOKEN
        self.calls.append((path, params, request_id))
        result = self.responses[path]
        if isinstance(result, list):
            result = result.pop(0)
        if isinstance(result, BaseException):
            raise result
        return deepcopy(result)


class CheckerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.data, self.calls = fixtures(), []
        self.token = Mock(return_value=TOKEN)
        self.factory = Mock(side_effect=lambda **kw: FakeTransport(responses=self.data, calls=self.calls, **kw))
        self.storage = Mock(return_value=disk())
        # Real HTTP and real filesystem probes are forbidden in every test.
        self.network_patch = patch.object(aiohttp, 'ClientSession', side_effect=AssertionError('network forbidden'))
        self.network = self.network_patch.start()
        self.addCleanup(self.network_patch.stop)
        self.storage_patch = patch.object(preflight.os, 'statvfs', side_effect=AssertionError('real volume forbidden'))
        self.storage_patch.start()
        self.addCleanup(self.storage_patch.stop)

    def checker(self, config=None, **kwargs):
        return preflight.Checker(db=self.db, enabled=True, approval=approval() if config is None else config,
                                 token_provider=self.token, transport_factory=self.factory,
                                 statvfs=self.storage, clock=lambda: NOW, **kwargs)

    async def test_default_off_is_inert(self):
        result = await preflight.Checker(db=self.db, approval=approval(), token_provider=self.token,
                                        transport_factory=self.factory, statvfs=self.storage).run()
        self.assertEqual(result, {'status': 'disabled', 'reason': 'x-preflight-disabled'})
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM sqlite_master").fetchone()[0], 0)
        self.token.assert_not_called()
        self.factory.assert_not_called()
        self.storage.assert_not_called()

    async def test_missing_approval_has_no_database_disk_client_or_token(self):
        result = await preflight.Checker(enabled=True, db=self.db, token_provider=self.token,
                                         transport_factory=self.factory, statvfs=self.storage).run()
        self.assertEqual(result['reason'], 'x-preflight-approval-schema-invalid')
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM sqlite_master").fetchone()[0], 0)
        self.storage.assert_not_called()
        self.factory.assert_not_called()
        self.token.assert_not_called()

    async def test_every_approval_gate_precedes_disk_and_token(self):
        changes = [
            {'approved': False}, {'version': True}, {'approval_id': SENTINEL}, {'cost_mode': 'free'},
            {'metadata_price_verified': False}, {'metadata_max_request_micros': 0},
            {'metadata_cost_evidence': ''}, {'metadata_reserve_micros': 1}, {'trial_limit_micros': 1_000_001},
            {'trial_spent_micros': 999_999}, {'max_requests': 4}, {'max_pages': 11},
            {'manifest_sha256': 'wrong'}, {'approved_at': (NOW+timedelta(seconds=1)).isoformat()},
            {'expires_at': NOW.isoformat()}, {'expires_at': (NOW+timedelta(minutes=16)).isoformat()},
            {'metadata_cost_verified_at': (NOW-timedelta(minutes=16)).isoformat()}, {'unexpected': True},
        ]
        for change in changes:
            with self.subTest(change=change):
                result = await self.checker(approval() | change).run()
                self.assertEqual(result['status'], 'blocked')
        for key in list(approval()):
            invalid = approval()
            del invalid[key]
            self.assertEqual((await self.checker(invalid).run())['status'], 'blocked')
        self.storage.assert_not_called()
        self.factory.assert_not_called()
        self.token.assert_not_called()

    async def test_account_evidence_is_fresh_and_separate(self):
        changes = [{'cycle_cap_micros': 20_000_001}, {'baseline_micros': 18_000_001},
                   {'auto_recharge_enabled': True}, {'auto_recharge_enabled': 0},
                   {'consumers_checked': False}, {'reference': ''},
                   {'verified_at': (NOW-timedelta(minutes=16)).isoformat()}]
        for unknown in (False, True):
            for change in changes:
                if unknown and 'verified_at' in change:
                    continue  # Unknown-mode anchor is historical within an explicit session.
                config = approval(unknown=unknown)
                config['account_evidence'].update(change)
                self.assertEqual((await self.checker(config).run())['status'], 'blocked')
        self.token.assert_not_called()
        self.factory.assert_not_called()

    async def test_full_reserve_and_request_claim_committed_before_client_token(self):
        def checked_factory(**options):
            self.assertFalse(self.db.in_transaction)
            row = self.db.execute('SELECT reserved_micros,requests_admitted,status FROM x_metadata_preflight_runs').fetchone()
            self.assertEqual(row, (5000, 1, 'running'))
            return FakeTransport(responses=self.data, calls=self.calls, **options)
        self.factory.side_effect = checked_factory
        self.token.side_effect = lambda: TOKEN if not self.db.in_transaction else self.fail('uncommitted request')
        result = await self.checker().run()
        self.assertEqual(result['status'], 'verified')
        self.assertEqual(result['requests_admitted'], 5)
        self.assertEqual(result['reserved_micros'], 5000)
        self.assertEqual(result['inventory'], inventory())
        self.assertEqual([path for path, _, _ in self.calls],
                         [preflight.RULES, preflight.COUNTS, preflight.CONNECTIONS, preflight.USAGE, preflight.CREDITS])
        self.assertEqual(preflight.latest_result(self.db), result)
        self.assertEqual(preflight.reserved_exposure(self.db),
                         {'known_reserved_micros': 5000, 'unknown_runs': 0, 'reconciled': False})
        for flag in ('account_cap_verified', 'auto_recharge_verified', 'stream_entitlement_verified',
                     'stream_activation_authorized', 'account_wide_consumers_verified'):
            self.assertIs(result[flag], False)
        self.assertNotIn(SENTINEL, json.dumps(result))

    async def test_unknown_mode_is_explicit_and_never_zero_or_verified(self):
        config = approval(unknown=True)
        for invalid in (config | {'unknown_cost_approved': False}, config | {'unknown_cost_approved': 1},
                        config | {'metadata_max_request_micros': 0}, config | {'max_pages': 3, 'max_requests': 9}):
            self.assertEqual((await self.checker(invalid).run())['status'], 'blocked')
        self.token.assert_not_called()
        result = await self.checker(config).run()
        self.assertEqual(result['status'], 'observed')
        self.assertEqual(result['cost_status'], 'unknown')
        self.assertIsNone(result['reserved_micros'])
        row = self.db.execute('SELECT reserved_micros,cost_status FROM x_metadata_preflight_runs').fetchone()
        self.assertEqual(row, (None, 'unknown'))
        self.assertTrue(all(row[0] is None for row in self.db.execute('SELECT unit_bound_micros FROM x_metadata_preflight_requests')))
        self.assertEqual(preflight.reserved_exposure(self.db),
                         {'known_reserved_micros': 0, 'unknown_runs': 1, 'reconciled': False})
        self.assertNotIn('prices_verified', result)
        self.assertNotIn('spend_reconciled', result)
        self.assertNotIn('single_consumer_verified', result)

    async def test_historical_anchor_preserves_approval_and_uses_fresh_dispatch_window(self):
        cfg = approval(unknown=True)
        cfg['approved_at'] = (NOW-timedelta(minutes=50)).isoformat()
        cfg['account_evidence']['verified_at'] = (NOW-timedelta(minutes=40)).isoformat()
        cfg['account_evidence']['session_expires_at'] = (NOW+timedelta(hours=2)).isoformat()
        result = await self.checker(cfg).run()
        self.assertEqual(result['status'], 'observed')
        self.assertEqual(result['account_anchor']['historical_verified_at'], cfg['account_evidence']['verified_at'])
        self.assertFalse(result['account_anchor']['fresh_spend_verified'])
        self.assertFalse(result['account_anchor']['fresh_headroom_verified'])
        row = self.db.execute('SELECT approved_at,run_prepared_at,account_anchor FROM x_metadata_preflight_runs').fetchone()
        self.assertEqual(row[0], cfg['approved_at'])
        self.assertEqual(row[1], NOW.isoformat())
        self.assertEqual(json.loads(row[2]), cfg['account_evidence'])

    async def test_historical_anchor_cannot_cross_cycle_renew_session_or_change_key(self):
        modifications = [
            {'cycle_start_date': '2026-10-03'},
            {'cycle_end_date': '2026-10-03'}, {'cycle_start_date': '2026-09-25T00:00:00Z'}, {'session_expires_at': NOW.isoformat()},
            {'session_expires_at': (NOW+timedelta(hours=4, seconds=1)).isoformat()},
            {'same_key_tech_phase_only': False}, {'same_key_tech_phase_only': 1},
            {'verified_at': (NOW+timedelta(seconds=1)).isoformat()},
        ]
        for change in modifications:
            cfg = approval(unknown=True)
            cfg['account_evidence'].update(change)
            self.assertEqual((await self.checker(cfg).run())['status'], 'blocked')
        for change in ({'run_prepared_at': (NOW+timedelta(seconds=1)).isoformat()},
                       {'approved_at': (NOW+timedelta(seconds=1)).isoformat()},
                       {'run_prepared_at': (NOW-timedelta(minutes=16)).isoformat()},
                       {'expires_at': (NOW+timedelta(minutes=16)).isoformat()}):
            self.assertEqual((await self.checker(approval(unknown=True) | change).run())['status'], 'blocked')
        self.factory.assert_not_called()
        self.token.assert_not_called()

    async def test_unknown_exposure_blocks_later_new_approval(self):
        await self.checker(approval(unknown=True)).run()
        self.calls.clear()
        for unknown in (False, True):
            result = await self.checker(approval(unknown=unknown, identity='second')).run()
            self.assertEqual(result['reason'], 'x-preflight-trial-exposure-unresolved')
        self.assertEqual(self.calls, [])
        self.assertEqual(self.factory.call_count, 1)

    async def test_same_instance_and_restart_never_repeat_or_overwrite_original(self):
        runner = self.checker()
        first = await runner.run()
        self.assertEqual((await runner.run())['reason'], 'x-preflight-already-attempted')
        result = await self.checker().run()
        self.assertEqual(result['reason'], 'x-preflight-already-attempted')
        self.assertEqual(self.factory.call_count, 1)
        self.assertEqual(len(self.calls), 5)
        self.assertEqual(preflight.latest_result(self.db), first)

    async def test_disk_blocks_without_reservation_client_or_secret(self):
        self.storage.return_value = disk(1)
        result = await self.checker().run()
        self.assertEqual(result['reason'], 'x-preflight-volume-space-insufficient')
        self.assertFalse(result['disk']['metadata_storage_sufficient'])
        self.assertFalse(result['disk']['stream_storage_sufficient'])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM sqlite_master').fetchone()[0], 0)
        self.factory.assert_not_called()
        self.token.assert_not_called()

    async def test_storage_rechecked_before_claim_and_again_before_token(self):
        # Initial check succeeds, then pre-claim check fails: no paid request.
        self.storage.side_effect = [disk(), disk(1)]
        result = await self.checker().run()
        self.assertEqual(result['reason'], 'x-preflight-volume-space-insufficient')
        self.assertEqual(result['requests_admitted'], 0)
        self.factory.assert_not_called()
        self.token.assert_not_called()
        # A separate run loses capacity between its committed claim and token.
        self.storage.side_effect = [disk(), disk(), disk(1)]
        result = await self.checker(approval(identity='after-claim')).run()
        self.assertEqual(result['reason'], 'x-preflight-volume-space-insufficient')
        self.assertEqual(result['requests_admitted'], 1)
        self.token.assert_not_called()
        self.assertEqual(self.calls, [])

    async def test_result_size_is_bounded_and_persistence_failure_keeps_exposure(self):
        runner = self.checker(approval(unknown=True))
        with patch.object(preflight, 'MAX_REPORT_BYTES', 1):
            result = await runner.run()
        self.assertEqual(result['reason'], 'x-preflight-result-persistence-failed')
        self.assertEqual(preflight.reserved_exposure(self.db)['unknown_runs'], 1)
        self.assertEqual(preflight.latest_result(self.db)['reason'], 'x-preflight-incomplete-or-interrupted')
        self.assertEqual((await self.checker(approval(unknown=True)).run())['reason'], 'x-preflight-already-attempted')

    async def test_callback_refusal_is_durable_but_no_client_or_token(self):
        callback = Mock(return_value=False)
        result = await self.checker(reserve_request=callback).run()
        self.assertEqual(result['reason'], 'x-preflight-service-admission-required')
        self.assertEqual(result['requests_admitted'], 1)
        self.assertEqual(preflight.reserved_exposure(self.db)['known_reserved_micros'], 5000)
        self.factory.assert_not_called()
        self.token.assert_not_called()
        self.assertEqual(callback.call_args.kwargs['reserve_micros'], 5000)

    async def test_transport_error_and_untrusted_exception_are_sanitized_reserved(self):
        self.data[preflight.RULES] = RuntimeError(SENTINEL)
        result = await self.checker().run()
        self.assertEqual(result['reason'], 'x-preflight-internal-failure')
        self.assertNotIn(SENTINEL, json.dumps(result))
        self.assertEqual(preflight.reserved_exposure(self.db)['known_reserved_micros'], 5000)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(str(preflight.PreflightBlocked(SENTINEL)), 'x-preflight-internal-failure')

    async def test_cancelled_run_retains_full_reserve_and_is_not_replayed(self):
        self.data[preflight.RULES] = asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            await self.checker().run()
        self.assertEqual(preflight.latest_result(self.db)['reason'], 'x-preflight-interrupted')
        self.assertEqual(preflight.reserved_exposure(self.db)['known_reserved_micros'], 5000)
        self.assertEqual((await self.checker().run())['reason'], 'x-preflight-already-attempted')

    async def test_budget_accumulates_across_runs_and_new_ids(self):
        await self.checker(approval(unit=100_000)).run()
        await self.checker(approval(identity='second', unit=100_000)).run()
        result = await self.checker(approval(identity='third')).run()
        self.assertEqual(result['reason'], 'x-preflight-trial-exposure-exhausted')
        self.assertEqual(preflight.reserved_exposure(self.db)['known_reserved_micros'], 1_000_000)

    async def test_rules_full_pagination_never_uses_ids_filter(self):
        rules = inventory()
        self.data[preflight.RULES] = [page(rules[:2], '0123456789ABCDEF'), page(rules[2:])]
        result = await self.checker(approval(pages=2)).run()
        self.assertEqual(result['status'], 'verified')
        self.assertEqual(result['requests_admitted'], 6)
        self.assertEqual(self.calls[0][1], {'max_results': 1000})
        self.assertEqual(self.calls[1][1], {'max_results': 1000, 'pagination_token': '0123456789ABCDEF'})
        self.assertTrue(all('ids' not in params for _, params, _ in self.calls))

    async def test_incomplete_pagination_retains_reserve_and_stops(self):
        self.data[preflight.RULES] = page(inventory()[:2], '0123456789ABCDEF')
        result = await self.checker().run()
        self.assertEqual(result['reason'], 'x-preflight-inventory-page-limit')
        self.assertNotIn('inventory', result)
        self.assertEqual(len(self.calls), 1)

    async def test_repeated_pagination_token_stops_without_third_request(self):
        self.data[preflight.RULES] = [page(inventory()[:2], '0123456789ABCDEF'), page(inventory()[2:], '0123456789ABCDEF')]
        result = await self.checker(approval(pages=2)).run()
        self.assertEqual(result['reason'], 'x-preflight-pagination-repeated')
        self.assertEqual(len(self.calls), 2)

    async def test_unknown_foreign_rule_is_not_reflected(self):
        self.data[preflight.RULES]['data'][0]['value'] = SENTINEL
        result = await self.checker().run()
        self.assertEqual(result['reason'], 'x-preflight-foreign-or-unknown-rule')
        self.assertNotIn('inventory', result)
        self.assertNotIn(SENTINEL, json.dumps(result))
        self.assertEqual(len(self.calls), 1)

    async def test_partial_errors_fail_closed_without_reading_text(self):
        self.data[preflight.RULES]['errors'] = [{'detail': SENTINEL}]
        result = await self.checker().run()
        self.assertEqual(result['reason'], 'x-preflight-response-incomplete')
        self.assertNotIn(SENTINEL, json.dumps(result))

    async def test_other_app_rules_blocks_before_connection_fetch(self):
        count = self.data[preflight.COUNTS]['data']
        count['project_rules_count'] = '5'
        count['all_project_client_apps'].append({'client_app_id': '999', 'rule_count': 1})
        result = await self.checker().run()
        self.assertEqual(result['reason'], 'x-preflight-other-app-rules-present')
        self.assertEqual(result['rule_counts']['other_app_rule_count'], 1)
        self.assertEqual(len(self.calls), 2)

    async def test_active_consumer_sanitizes_identifiers_and_ip_then_blocks(self):
        self.data[preflight.CONNECTIONS] = page([{'id': 'private-connection-id', 'endpoint_name': 'filtered_stream',
            'connected_at': NOW.isoformat(), 'client_ip': SENTINEL, 'disconnect_reason': SENTINEL}])
        result = await self.checker().run()
        self.assertEqual(result['reason'], 'x-preflight-active-consumer-present')
        self.assertEqual(result['connections']['active_count'], 1)
        text = json.dumps(result)
        self.assertNotIn(SENTINEL, text)
        self.assertNotIn('private-connection-id', text)
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(self.calls[-1][1]['status'], 'all')
        self.assertNotIn('client_ip', self.calls[-1][1]['connection.fields'])

    async def test_connection_pagination_does_not_miss_later_active_consumer(self):
        old = {'id': 'old', 'endpoint_name': 'filtered_stream', 'connected_at': (NOW-timedelta(hours=1)).isoformat(),
               'disconnected_at': (NOW-timedelta(minutes=30)).isoformat()}
        active = {'id': 'new', 'endpoint_name': 'sample_stream', 'connected_at': NOW.isoformat()}
        self.data[preflight.CONNECTIONS] = [page([old], 'opaque_next'), page([active])]
        result = await self.checker(approval(pages=2)).run()
        self.assertEqual(result['reason'], 'x-preflight-active-consumer-present')
        self.assertEqual(result['connections']['inactive_count'], 1)
        self.assertEqual(result['connections']['active_by_endpoint'], {'sample_stream': 1})

    async def test_usage_count_identity_must_match_current_app(self):
        self.data[preflight.USAGE]['data']['daily_client_app_usage'][0]['client_app_id'] = '999'
        result = await self.checker().run()
        self.assertEqual(result['reason'], 'x-preflight-usage-app-identity-unverified')
        self.assertEqual(len(self.calls), 4)

    async def test_other_app_usage_blocks_and_reports_count_only(self):
        self.data[preflight.USAGE]['data']['daily_client_app_usage'].append(
            {'client_app_id': '999', 'usage_result_count': 1, 'usage': [{'date': '2026-10-03', 'usage': '1'}]})
        result = await self.checker().run()
        self.assertEqual(result['reason'], 'x-preflight-other-app-usage-present')
        self.assertEqual(result['usage']['other_app_usage_posts_one_day'], 1)
        self.assertEqual(len(self.calls), 4)

    async def test_expired_between_requests_stops_before_second_io(self):
        current = [NOW]
        self.token.side_effect = lambda: current.__setitem__(0, NOW+timedelta(minutes=16)) or TOKEN
        runner = self.checker()
        runner.clock = lambda: current[0]
        result = await runner.run()
        self.assertEqual(result['reason'], 'x-preflight-approval-stale')
        self.assertEqual(len(self.calls), 1)

    async def test_open_caller_transaction_is_not_implicitly_committed(self):
        self.db.execute('CREATE TABLE caller (value TEXT)')
        self.db.execute("INSERT INTO caller VALUES('uncommitted')")
        result = await self.checker().run()
        self.assertEqual(result['reason'], 'x-preflight-ledger-transaction-open')
        self.assertTrue(self.db.in_transaction)
        self.token.assert_not_called()

    async def test_owned_subset_and_empty_are_complete_but_not_stream_ready(self):
        for amount in (0, 1, 3):
            with self.subTest(amount=amount):
                self.data = fixtures()
                self.data[preflight.RULES] = page(inventory()[:amount])
                counts = self.data[preflight.COUNTS]['data']
                counts['client_app_rules_count']['rule_count'] = amount
                counts['all_project_client_apps'][0]['rule_count'] = amount
                counts['project_rules_count'] = str(amount)
                result = await self.checker(approval(identity='subset-' + str(amount))).run()
                self.assertEqual(result['status'], 'verified')
                self.assertTrue(result['inventory_complete'])
                self.assertFalse(result['required_rules_present'])
                self.assertEqual(result['inventory'], inventory()[:amount])
                self.assertEqual(result['missing_rules'], x_stream.manifest()[amount:])
                self.assertFalse(result['stream_activation_authorized'])
                self.assertEqual(result['requests_admitted'], 5)

    async def test_stream_owner_rows_block_before_reserve_and_are_never_cleared(self):
        for name in ('x_stream_supervisor_owner', 'x_stream_owner', 'x_stream_pilot'):
            if name == 'x_stream_pilot':
                self.db.execute('CREATE TABLE x_stream_pilot (state TEXT)')
                self.db.execute("INSERT INTO x_stream_pilot VALUES('running')")
            else:
                self.db.execute('CREATE TABLE ' + name + ' (owner TEXT)')
                self.db.execute('INSERT INTO ' + name + " VALUES('foreign-owner')")
            self.db.commit()
            result = await self.checker().run()
            self.assertEqual(result['reason'], 'x-preflight-stream-owner-present')
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM ' + name).fetchone()[0], 1)
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM x_metadata_preflight_runs').fetchone()[0], 0)
            self.db.execute('DROP TABLE ' + name)
            self.db.commit()
        self.factory.assert_not_called()
        self.token.assert_not_called()

    async def test_midrun_stream_owner_interleaving_blocks_next_claim(self):
        self.db.execute('CREATE TABLE x_stream_supervisor_owner (owner TEXT)')
        def token_and_interleave():
            with self.db:
                self.db.execute("INSERT INTO x_stream_supervisor_owner VALUES('interleaved-owner')")
            return TOKEN
        self.token.side_effect = token_and_interleave
        result = await self.checker().run()
        self.assertEqual(result['reason'], 'x-preflight-stream-owner-present')
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(result['requests_admitted'], 1)
        self.assertEqual(result['reserved_micros'], 5000)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM x_stream_supervisor_owner').fetchone()[0], 1)



class Content:
    def __init__(self, body=b'', *, block=False, error=None):
        self.body, self.block, self.error = body, block, error
        self.reads = 0
        self.started = asyncio.Event()

    async def read(self, size):
        self.reads += 1
        self.started.set()
        if self.block:
            await asyncio.Event().wait()
        if self.error:
            raise self.error
        result, self.body = self.body[:size], self.body[size:]
        return result


class Response:
    def __init__(self, body=b'{"data":{}}', status=200, headers=None, **content):
        self.status = status
        self.headers = CIMultiDict({'Content-Type': 'application/json'})
        self.headers.update(headers or {})
        self.content = Content(body, **content)
        self.closed = False

    def close(self):
        self.closed = True


class Session:
    def __init__(self, response=None, *, error=None, close_wait=None):
        self.response = response if response is not None else Response()
        self.error, self.close_wait = error, close_wait
        self.closed = False
        self._retry_connection = True
        self.calls = []
        self.closing = asyncio.Event()

    async def get(self, url, **kwargs):
        self.calls.append((url, dict(kwargs, headers=dict(kwargs['headers']))))
        if self.error:
            raise self.error
        return self.response

    async def close(self):
        self.closing.set()
        if self.close_wait:
            await self.close_wait.wait()
        self.closed = True


class TransportTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.session = Session()
        self.factory = Mock(return_value=self.session)
        self.token = Mock(return_value=TOKEN)
        self.admission = Mock(return_value=True)
        self.client = preflight.AiohttpTransport(enabled=True, admission=self.admission,
                         token_provider=self.token, session_factory=self.factory)
        self.guard = patch.object(aiohttp, 'ClientSession', side_effect=AssertionError('network forbidden'))
        self.guard.start()
        self.addCleanup(self.guard.stop)

    async def get(self, path=preflight.CREDITS, params=None, identity=REQUEST_ID):
        return await self.client.get(path, dict(preflight.BASE_PARAMS[path]) if params is None else params, identity)

    def closed(self):
        self.assertTrue(self.session.closed)
        self.assertTrue(self.session.response.closed)

    async def test_constructor_and_default_off_are_inert(self):
        disabled = preflight.AiohttpTransport(token_provider=self.token, session_factory=self.factory)
        with self.assertRaisesRegex(preflight.PreflightBlocked, 'transport-disabled'):
            await disabled.get(preflight.CREDITS, {}, REQUEST_ID)
        self.factory.assert_not_called()
        self.token.assert_not_called()

    async def test_fixed_https_get_no_proxy_cookie_redirect_retries(self):
        result = await self.get()
        self.assertEqual(result, {'data': {}})
        self.assertFalse(self.session._retry_connection)
        url, args = self.session.calls[0]
        self.assertEqual(url, 'https://api.x.com/2/usage/credits')
        self.assertIs(args['allow_redirects'], False)
        self.assertIs(args['ssl'], True)
        self.assertIsNone(args['proxy'])
        self.assertIsNone(args['auth'])
        self.assertEqual(args['headers']['Accept-Encoding'], 'identity')
        options = self.factory.call_args.kwargs
        self.assertIs(options['trust_env'], False)
        self.assertIs(options['auto_decompress'], False)
        self.assertIsInstance(options['cookie_jar'], aiohttp.DummyCookieJar)
        self.assertEqual(options['timeout'].total, preflight.REQUEST_SECONDS)
        self.closed()

    async def test_every_endpoint_and_query_shape_rejects_scope_expansion(self):
        values = [('https://api.x.com/2/usage/credits', {}), ('/2/tweets/search/stream', {}),
                  ('//other.example/path', {}), (preflight.RULES, {'max_results': 1000, 'ids': '123'}),
                  (preflight.CONNECTIONS, {'status': 'active'}), (preflight.USAGE, {'days': 90}),
                  (preflight.CREDITS, {'url': 'https://evil.example'})]
        for path, params in values:
            with self.assertRaises(preflight.PreflightBlocked):
                await self.client.get(path, params, REQUEST_ID)
        self.factory.assert_not_called()
        self.token.assert_not_called()
        self.admission.assert_not_called()

    async def test_uncommitted_admission_blocks_before_token_client(self):
        self.admission.return_value = False
        with self.assertRaisesRegex(preflight.PreflightBlocked, 'durable-admission-required'):
            await self.get()
        self.token.assert_not_called()
        self.factory.assert_not_called()

    async def test_version_gate_blocks_before_token(self):
        real = preflight.AiohttpTransport(enabled=True, admission=self.admission, token_provider=self.token)
        with patch.object(aiohttp, '__version__', '3.13.5'):
            with self.assertRaisesRegex(preflight.PreflightBlocked, 'transport-version-unreviewed'):
                await real.get(preflight.CREDITS, {}, REQUEST_ID)
        self.token.assert_not_called()
        self.admission.assert_not_called()

    async def test_invalid_token_never_constructs_session(self):
        for value in ('', 'has space', 'has\nnewline', '秘密', SENTINEL, None, 'a'*8193):
            self.token.return_value = value
            with self.assertRaisesRegex(preflight.PreflightBlocked, 'token-unavailable'):
                await self.get()
        self.factory.assert_not_called()

    async def test_http_denials_do_not_read_body_headers_or_retry(self):
        for status, reason in ((301, 'http-failed'), (401, 'scope-denied'), (403, 'scope-denied'),
                               (402, 'credits-denied'), (429, 'rate-limited'), (500, 'http-failed')):
            self.session = Session(Response(SENTINEL.encode(), status=status, headers={'Location': SENTINEL}))
            self.factory.return_value = self.session
            with self.assertRaisesRegex(preflight.PreflightBlocked, reason) as exc:
                await self.get()
            self.assertNotIn(SENTINEL, str(exc.exception))
            self.assertEqual(len(self.session.calls), 1)
            self.assertEqual(self.session.response.content.reads, 0)
            self.closed()

    async def test_bad_json_duplicates_nonfinite_and_oversize_are_sanitized(self):
        for body, reason in ((b'{"data":1,"data":2}', 'response-json-invalid'),
                             (b'{"value":NaN}', 'response-json-invalid'),
                             (b'not-json-' + SENTINEL.encode(), 'response-json-invalid'),
                             (b'x'*(preflight.MAX_BODY_BYTES+1), 'response-too-large')):
            self.session = Session(Response(body))
            self.factory.return_value = self.session
            with self.assertRaisesRegex(preflight.PreflightBlocked, reason):
                await self.get()
            self.closed()

    async def test_bad_encoding_and_media_type_close_without_read(self):
        for headers in ({'Content-Encoding': 'gzip'}, {'Content-Type': 'text/html'}):
            self.session = Session(Response(headers=headers))
            self.factory.return_value = self.session
            with self.assertRaisesRegex(preflight.PreflightBlocked, 'response-format-invalid'):
                await self.get()
            self.assertEqual(self.session.response.content.reads, 0)
            self.closed()

    async def test_transport_exception_is_fixed_and_not_retried(self):
        self.session.error = OSError(SENTINEL)
        with self.assertRaisesRegex(preflight.PreflightBlocked, 'transport-failed') as exc:
            await self.get()
        self.assertNotIn(SENTINEL, str(exc.exception))
        self.assertNotIn(SENTINEL, ''.join(traceback.format_exception(exc.exception)))
        self.assertEqual(len(self.session.calls), 1)
        self.assertTrue(self.session.closed)

    async def test_slow_body_is_finite(self):
        self.session.response.content.block = True
        with patch.object(preflight, 'REQUEST_SECONDS', 0.01):
            with self.assertRaisesRegex(preflight.PreflightBlocked, 'transport-failed'):
                await self.get()
        self.closed()

    async def test_cancel_waits_for_owned_cleanup_even_repeated(self):
        release = asyncio.Event()
        self.session.close_wait = release
        self.session.response.content.block = True
        task = asyncio.create_task(self.get())
        await self.session.response.content.started.wait()
        task.cancel()
        await self.session.closing.wait()
        task.cancel()
        await asyncio.sleep(0)
        self.assertFalse(task.done())
        release.set()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.closed()

    async def test_missing_retry_control_closes_without_get(self):
        del self.session._retry_connection
        with self.assertRaisesRegex(preflight.PreflightBlocked, 'retry-control-unavailable'):
            await self.get()
        self.assertEqual(self.session.calls, [])
        self.assertTrue(self.session.closed)


class ParserTests(unittest.TestCase):
    def test_counts_type_duplicates_sum_and_missing_fields_fail(self):
        normal = fixtures()[preflight.COUNTS]
        variants = []
        for key in normal['data']:
            value = deepcopy(normal)
            del value['data'][key]
            variants.append(value)
        variants.extend([
            {'data': normal['data'] | {'client_app_rules_count': {'client_app_id': '111', 'rule_count': True}}},
            {'data': normal['data'] | {'project_rules_count': '5'}},
            {'data': normal['data'] | {'all_project_client_apps': normal['data']['all_project_client_apps']*2}},
        ])
        for value in variants:
            with self.assertRaises(preflight.PreflightBlocked):
                preflight._counts(value, inventory())

    def test_page_wrong_counts_empty_continuation_and_malformed_token(self):
        invalid = [{'data': [], 'meta': {'result_count': 1}}, {'data': [], 'meta': {'result_count': True}},
                   {'data': [], 'meta': {'result_count': 0, 'next_token': '0123456789ABCDEF'}},
                   page(inventory(), 'https://evil.example'), {'data': []},
                   {'data': [], 'meta': {'result_count': 0}, 'errors': None}]
        for value in invalid:
            with self.assertRaises(preflight.PreflightBlocked):
                preflight._page(value, preflight.RULES)
        self.assertEqual(preflight._page({'meta': {'result_count': 0}}, preflight.RULES), ([], None))

    def test_rule_ids_must_be_ascii_unique_and_no_missing_manifest_rule(self):
        for rows in (inventory()+inventory()[:1],
                     [inventory()[0] | {'id': '١٢٣'}] + inventory()[1:],
                     [inventory()[0] | {'id': inventory()[1]['id']}] + inventory()[1:]):
            with self.assertRaises(preflight.PreflightBlocked):
                preflight._rules(rows)

    def test_unknown_connection_and_duplicate_fail_closed(self):
        item = {'id': 'safe-id', 'endpoint_name': 'filtered_stream', 'connected_at': NOW.isoformat()}
        for rows in ([item | {'endpoint_name': SENTINEL}], [item, item], [item | {'connected_at': 'invalid'}],
                     [item | {'disconnected_at': (NOW-timedelta(seconds=1)).isoformat()}]):
            with self.assertRaises(preflight.PreflightBlocked):
                preflight._connections(rows)

    def test_credits_decimal_roundtrip_and_invalid_values(self):
        parsed = preflight._json(b'{"data":{"free_balance":1.5,"prepaid_balance":-0.2,"total_balance":1.3,"free_grants":[]}}')
        result = preflight._credits(parsed)
        self.assertEqual(result['prepaid_balance'], '-0.2')
        self.assertEqual(result['total_balance'], '1.3')
        for value in (True, '1.5', float('nan'), float('inf'), Decimal('1e100'), Decimal('0.0000000001')):
            parsed['data']['total_balance'] = value
            with self.assertRaises(preflight.PreflightBlocked):
                preflight._credits(parsed)

    def test_free_grant_expiry_is_optional_and_unknown_is_not_synthesized(self):
        value = fixtures()[preflight.CREDITS]
        value['data']['free_grants'] = [{'amount': 1}, {'amount': 2, 'expires_at': NOW.isoformat()}]
        result = preflight._credits(value)
        self.assertEqual(result['free_grant_count'], 2)
        self.assertEqual(result['free_grants_without_expiry_count'], 1)
        self.assertEqual(result['earliest_known_free_grant_expiry'], NOW.isoformat())
        value['data']['free_grants'] = [{'amount': 1}]
        self.assertIsNone(preflight._credits(value)['earliest_known_free_grant_expiry'])
        value['data']['free_grants'] = [{'amount': 1, 'expires_at': None}]
        with self.assertRaises(preflight.PreflightBlocked):
            preflight._credits(value)

    def test_required_free_grants_reject_missing_malformed_and_unbounded(self):
        valid = fixtures()[preflight.CREDITS]
        invalid = deepcopy(valid)
        del invalid['data']['free_grants']
        with self.assertRaises(preflight.PreflightBlocked):
            preflight._credits(invalid)
        for grants in ('invalid', None, [1], [{}], [{'amount': True, 'expires_at': NOW.isoformat()}],
                       [{'amount': -1, 'expires_at': NOW.isoformat()}],
                       [{'amount': float('inf'), 'expires_at': NOW.isoformat()}],
                       [{'amount': 1, 'expires_at': SENTINEL}], [{'amount': 1, 'expires_at': '2026-01-01'}],
                       [{'amount': 1, 'expires_at': NOW.isoformat()}] * 101):
            value = deepcopy(valid)
            value['data']['free_grants'] = grants
            with self.assertRaises(preflight.PreflightBlocked):
                preflight._credits(value)

    def test_metadata_storage_headroom_uses_page_size_and_never_claims_guarantee(self):
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        self.assertEqual(preflight.metadata_storage_reserve(db, 7), 8 * 1024 * 1024)
        db.execute('PRAGMA page_size=65536')
        self.assertEqual(preflight.metadata_storage_reserve(db, 7), 11 * 64 * 65536 + 4 * 65536)
        result = preflight.local_free_space(statvfs=lambda path: disk())
        self.assertFalse(result['storage_reserve_is_guarantee'])
        self.assertFalse(result['stream_storage_sufficient'])
        fake = Mock()
        for invalid in (0, 1000, True, 131072, '4096'):
            fake.execute.return_value.fetchone.return_value = [invalid]
            with self.assertRaisesRegex(preflight.PreflightBlocked, 'storage-policy-invalid'):
                preflight.metadata_storage_reserve(fake, 7)

    def test_volume_exact_path_and_sanitized_failure(self):
        stat = Mock(return_value=disk())
        for path in ('/data/../etc', '/tmp', Path('/data'), '/data/'):
            with self.assertRaisesRegex(preflight.PreflightBlocked, 'volume-path-invalid'):
                preflight.local_free_space(path, statvfs=stat)
        stat.assert_not_called()
        stat.side_effect = OSError(SENTINEL)
        with self.assertRaisesRegex(preflight.PreflightBlocked, 'volume-unavailable') as exc:
            preflight.local_free_space(statvfs=stat)
        self.assertNotIn(SENTINEL, str(exc.exception))

    def test_storage_categories_are_finite_and_never_follow_symlinks(self):
        class Entry:
            def __init__(self, name, size, file=True):
                self.name, self.size, self.file = name, size, file
                self.is_file = Mock(return_value=file)
                self.stat = Mock(return_value=SimpleNamespace(st_size=size))
        entries = [Entry('monitor.sqlite', 1), Entry('monitor.sqlite-wal', 2), Entry('private-backup.gz', 3),
                   Entry('other-sensitive-name', 4), Entry('symlink', 999, False)]
        class Scan:
            def __enter__(self):
                return iter(entries)
            def __exit__(self, *args):
                return False
        result = preflight.local_storage_snapshot(statvfs=lambda path: disk(), scandir=lambda path: Scan())
        self.assertEqual(result['immediate_file_sizes'],
                         {'database_bytes': 1, 'wal_bytes': 2, 'backup_bytes': 3, 'other_bytes': 4})
        self.assertTrue(result['immediate_file_sizes_complete'])
        self.assertFalse(result['stream_storage_sufficient'])
        self.assertNotIn('sensitive', json.dumps(result))
        for entry in entries:
            entry.is_file.assert_called_once_with(follow_symlinks=False)
        entries[-1].stat.assert_not_called()
        entries[:] = [Entry('x', 1)] * 1025
        result = preflight.local_storage_snapshot(statvfs=lambda path: disk(), scandir=lambda path: Scan())
        self.assertEqual(result['entries_examined'], 1024)
        self.assertFalse(result['immediate_file_sizes_complete'])

    def test_reopen_database_preserves_unknown_exposure_and_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'state.sqlite')
            db = sqlite3.connect(path)
            preflight.schema(db)
            cfg = approval(unknown=True)
            run_id = preflight._reserve_run(db, cfg)
            preflight._claim_request(db, run_id, preflight.RULES, cfg, NOW)
            db.close()
            db = sqlite3.connect(path)
            self.addCleanup(db.close)
            with self.assertRaisesRegex(preflight.PreflightBlocked, 'already-attempted'):
                preflight._reserve_run(db, cfg)
            self.assertEqual(preflight.reserved_exposure(db)['unknown_runs'], 1)
            self.assertEqual(db.execute('SELECT requests_admitted FROM x_metadata_preflight_runs').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
