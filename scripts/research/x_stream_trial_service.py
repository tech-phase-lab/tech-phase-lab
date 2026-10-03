"""Default-OFF one-shot paid receive trial. Private operational evidence only.

No CLI, provider discovery, retries, Search, deletion, public output or billing
reconciliation. The original metadata ledger is read-only. Five new readiness
GETs have their own durable unknown-cost claims; numeric contingencies are local
admission allowances, never tariffs, invoices or provider spending guarantees.
"""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
import os
from pathlib import Path
import re
import sqlite3
import time

import x_preflight
import x_stream
import x_stream_probe
import x_stream_rules

ENABLED = 'X_STREAM_TRIAL_ENABLED'
PLAN = 'X_STREAM_TRIAL_PLAN_JSON'
REQUIRED = frozenset('version trial_id approval_id approved_at prepared_at session_expires_at probe_end_at '
    'original_metadata_request_id original_metadata_result_sha256 original_account_anchor_sha256 '
    'expected_app_id manifest_sha256 account_evidence_ref storage_evidence_ref reconciliation_evidence_ref '
    'pricing_evidence_ref reviewed_plan create_missing_rules_approved stream_attempt_approved '
    'unknown_prior_cost_approved single_consumer_verified account_cap_verified auto_recharge_disabled_verified '
    'prices_verified account_cap_micros account_headroom_micros local_aim_micros '
    'prior_exposure_contingency_micros setup_readiness_contingency_micros stream_allowance_micros '
    'polling_contingency_micros post_micros user_micros credit_rounding_tolerance_micros '
    'maximum_unexplained_decrease_micros max_probe_seconds backup_margin_seconds baseline_service_margin_bytes'.split())
ORDER = (x_preflight.RULES, x_preflight.COUNTS, x_preflight.CONNECTIONS,
         x_preflight.USAGE, x_preflight.CREDITS)


class TrialBlocked(ValueError):
    pass


def _block(code):
    raise TrialBlocked('x-trial-' + code) from None


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return x_stream_rules.digest(value)


def _utc(value):
    try:
        result = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.tzinfo is None or result.utcoffset() != timedelta(0):
            raise ValueError
        return result
    except (TypeError, ValueError, AttributeError):
        _block('time-invalid')


def _int(value, low=0, high=10**12):
    if type(value) is not int or not low <= value <= high:
        _block('number-invalid')
    return value


def requested(env=None):
    return str((os.environ if env is None else env).get(ENABLED, '')).strip().lower() == 'true'


def validate_plan(plan, now):
    if (type(plan) is not dict or set(plan) != REQUIRED or type(plan['version']) is not int
            or plan['version'] != 1 or len(_json(plan).encode()) > 16384):
        _block('plan-invalid')
    for key in ('trial_id', 'approval_id', 'account_evidence_ref', 'storage_evidence_ref',
                'reconciliation_evidence_ref', 'pricing_evidence_ref'):
        if type(plan[key]) is not str or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}', plan[key]):
            _block('reference-invalid')
    for key in ('original_metadata_request_id', 'original_metadata_result_sha256',
                'original_account_anchor_sha256', 'manifest_sha256'):
        if type(plan[key]) is not str or not re.fullmatch('[0-9a-f]{64}', plan[key]):
            _block('reference-invalid')
    if (type(plan['expected_app_id']) is not str or not re.fullmatch('[0-9]{1,32}', plan['expected_app_id'])
            or plan['manifest_sha256'] != x_stream_rules.manifest_sha()):
        _block('identity-or-manifest-invalid')
    for key in ('reviewed_plan', 'create_missing_rules_approved', 'stream_attempt_approved',
                'unknown_prior_cost_approved', 'single_consumer_verified', 'account_cap_verified',
                'auto_recharge_disabled_verified', 'prices_verified'):
        if plan[key] is not True:
            _block('approval-required')
    current, approved, prepared, session, end = map(_utc, (now, plan['approved_at'], plan['prepared_at'],
                                                           plan['session_expires_at'], plan['probe_end_at']))
    if not (approved <= prepared <= current < end <= session <= approved + timedelta(hours=4)
            and current - timedelta(minutes=15) <= prepared and end <= prepared + timedelta(minutes=15)
            and end.date() == current.date()):
        _block('plan-expired')
    if _int(plan['account_cap_micros'], 1, 20_000_000) != 20_000_000:
        _block('account-cap-invalid')
    headroom = _int(plan['account_headroom_micros'], 1, plan['account_cap_micros'])
    aim = _int(plan['local_aim_micros'], 1, 1_000_000)
    total = sum(_int(plan[k], 1, aim) for k in ('prior_exposure_contingency_micros',
        'setup_readiness_contingency_micros', 'stream_allowance_micros'))
    if total > aim or total + _int(plan['polling_contingency_micros'], 0, headroom) > headroom:
        _block('allowance-exceeded')
    if sum(_int(plan[k], 1, aim) for k in ('post_micros', 'user_micros')) > plan['stream_allowance_micros']:
        _block('prices-or-allowance-invalid')
    _int(plan['credit_rounding_tolerance_micros'], 0, 10000)
    _int(plan['maximum_unexplained_decrease_micros'], 0,
         plan['prior_exposure_contingency_micros'] + plan['setup_readiness_contingency_micros'])
    _int(plan['max_probe_seconds'], 1, 120)
    _int(plan['backup_margin_seconds'], 30, 300)
    _int(plan['baseline_service_margin_bytes'], 8 * 1024 * 1024, 64 * 1024 * 1024)
    return plan


def _schema(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS x_stream_trial_run (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), plan_sha TEXT NOT NULL,
        started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL, reason TEXT,
        prior_contingency_micros INTEGER NOT NULL, setup_contingency_micros INTEGER NOT NULL,
        stream_allowance_micros INTEGER NOT NULL, polling_contingency_micros INTEGER NOT NULL,
        cost_status TEXT NOT NULL CHECK(cost_status='unknown'), reserved_micros INTEGER CHECK(reserved_micros IS NULL));
      CREATE TABLE IF NOT EXISTS x_stream_trial_readiness (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), request_id TEXT NOT NULL UNIQUE,
        original_request_id TEXT NOT NULL, original_result_sha256 TEXT NOT NULL,
        original_anchor_sha256 TEXT NOT NULL, started_at TEXT NOT NULL, verified_at TEXT,
        state TEXT NOT NULL, requests_admitted INTEGER NOT NULL DEFAULT 0,
        cost_status TEXT NOT NULL CHECK(cost_status='unknown'), reserved_micros INTEGER CHECK(reserved_micros IS NULL),
        result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS x_stream_trial_readiness_requests (
        request_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
        admitted_at TEXT NOT NULL, cost_status TEXT NOT NULL CHECK(cost_status='unknown'),
        reserved_micros INTEGER CHECK(reserved_micros IS NULL));
      CREATE TABLE IF NOT EXISTS x_stream_supervisor_owner (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT NOT NULL, started_at TEXT NOT NULL);
    ''')


class Controller:
    def __init__(self, *, db=None, enabled=False, plan=None, token_provider=None, backup_readiness=None,
                 storage_preflight=None, stop_event=None, emit=None, clock=None, monotonic=None,
                 readiness_transport_factory=None, rules_transport_factory=None, stream_transport_factory=None):
        self.db, self.enabled, self.plan = db, enabled, plan
        self.token_provider, self.backup_readiness = token_provider, backup_readiness
        self.storage_preflight, self.stop_event = storage_preflight, stop_event
        self.emit = emit or (lambda value: print(value, flush=True))
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.monotonic = monotonic or time.monotonic
        self.readiness_factory = readiness_transport_factory or x_preflight.AiohttpTransport
        self.rules_factory, self.stream_factory = rules_transport_factory, stream_transport_factory
        self.frozen = self.plan_sha = self.original_snapshot = self.original_exposure = None
        self.original_report = self.fresh = self.rule_result = None
        self.claimed = False
        self.capabilities = set()

    def _log(self, phase, value):
        # Values are constructed locally or fixed helper reports; never raw HTTP.
        encoded = _json(value)
        if len(encoded.encode()) > 16384:
            _block('report-too-large')
        self.emit('x-stream-trial-' + phase + ' ' + encoded)

    def _backup(self, end=None):
        if not callable(self.backup_readiness):
            _block('backup-readiness-required')
        end = end or _utc(self.frozen['probe_end_at'])
        result = self.backup_readiness(end, self.frozen['backup_margin_seconds'])
        if (type(result) is not dict or result.get('healthy') is not True
                or not _utc(self.clock()) - timedelta(seconds=60) <= _utc(result.get('verified_at')) <= _utc(self.clock())
                or _utc(result.get('next_backup_at')) <= end + timedelta(seconds=self.frozen['backup_margin_seconds'])):
            _block('backup-unavailable-or-overlap')

    def _storage(self):
        self._backup()
        result = (self.storage_preflight() if self.storage_preflight else
                  x_preflight.local_free_space(minimum_free_bytes=self.required_storage))
        if (type(result) is not dict or result.get('metadata_storage_sufficient') is not True
                or type(result.get('available_bytes')) is not int or result['available_bytes'] < self.required_storage):
            _block('storage-insufficient')
        return result

    def _original(self):
        p = self.frozen
        rows = list(self.db.execute('SELECT request_id,approval_id,approved_at,account_anchor,reserved_micros,'
                                    'cost_status,requests_admitted,status,result FROM x_metadata_preflight_runs '
                                    'ORDER BY request_id LIMIT 1025'))
        if not rows or len(rows) > 1024:
            _block('original-ledger-invalid')
        for row in rows:
            if row[7] not in ('observed', 'verified', 'blocked') or type(row[8]) is not str or len(row[8].encode()) > 65536:
                _block('original-ledger-invalid')
            report = x_preflight._json(row[8])
            if row[7] == 'blocked' and report.get('reason') != 'x-preflight-volume-space-insufficient':
                _block('prior-stop-present')
        original = next((row for row in rows if row[0] == p['original_metadata_request_id']), None)
        if original is None or original[7] not in ('observed', 'verified'):
            _block('original-report-missing')
        report, anchor = x_preflight._json(original[8]), x_preflight._json(original[3])
        if (digest(report) != p['original_metadata_result_sha256'] or digest(anchor) != p['original_account_anchor_sha256']
                or original[1] != p['approval_id'] or _utc(original[2]) != _utc(p['approved_at']) or anchor.get('reference') != p['account_evidence_ref']
                or _utc(anchor.get('session_expires_at')) < _utc(p['session_expires_at'])
                or anchor.get('cycle_cap_micros') != 20_000_000 or anchor.get('auto_recharge_enabled') is not False
                or anchor.get('consumers_checked') is not True or anchor.get('same_key_tech_phase_only') is not True
                or p['account_headroom_micros'] + _int(anchor.get('baseline_micros')) > 20_000_000
                or report.get('request_id') != p['original_metadata_request_id']
                or report.get('reason') != 'x-preflight-metadata-only'
                or report.get('rules_complete') is not True or report.get('inventory_complete') is not True
                or report.get('rule_counts', {}).get('client_app_id') != p['expected_app_id']):
            _block('original-evidence-mismatch')
        exposure = x_stream_probe.metadata_exposure(self.db)
        if exposure['known_reserved_micros'] > p['prior_exposure_contingency_micros']:
            _block('prior-exposure-uncovered')
        snapshot = digest([list(row) for row in rows])
        if self.original_snapshot is not None and (snapshot != self.original_snapshot or exposure != self.original_exposure):
            _block('original-evidence-changed')
        return snapshot, exposure, report

    def _guards(self, owner=None):
        validate_plan(self.plan, self.clock())
        if digest(self.plan) != self.plan_sha:
            _block('plan-changed')
        if self.stop_event is not None and self.stop_event.is_set():
            _block('stopped')
        if self.monotonic() >= self.monotonic_end:
            _block('deadline')
        for table in ('x_budget_stop', 'x_stream_runtime', 'x_stream_owner'):
            if x_stream_rules._table(self.db, table) and self.db.execute('SELECT 1 FROM ' + table + ' LIMIT 1').fetchone():
                _block('account-stop-or-migration-present')
        if x_stream_rules._table(self.db, 'x_stream_state') and self.db.execute(
                "SELECT 1 FROM x_stream_state WHERE state IN ('entitlement-blocked','budget-paused','operator-blocked')").fetchone():
            _block('account-stop-or-migration-present')
        if x_stream_rules._table(self.db, 'x_stream_pilot') and self.db.execute('SELECT 1 FROM x_stream_pilot LIMIT 1').fetchone():
            _block('another-trial-present')
        row = self.db.execute('SELECT owner FROM x_stream_supervisor_owner').fetchone()
        if (owner is None and row) or (owner is not None and (not row or row[0] != owner)):
            _block('another-owner-present')
        self._original()
        self._storage()

    def initialize(self):
        validate_plan(self.plan, self.clock())
        if not isinstance(self.db, sqlite3.Connection) or self.db.in_transaction or not callable(self.token_provider):
            _block('durable-ledger-required')
        location = self.db.execute('PRAGMA database_list').fetchone()
        if not location or not location[2] or (self.storage_preflight is None and not Path(location[2]).resolve().is_relative_to('/data')):
            _block('service-volume-required')
        self.frozen = x_preflight._json(_json(self.plan)); self.plan_sha = digest(self.frozen)
        self.monotonic_end = self.monotonic() + (_utc(self.frozen['probe_end_at']) - _utc(self.clock())).total_seconds()
        reserve = x_stream_probe.storage_reserve(self.db, dict(self.frozen, max_reads=64, max_metadata_bytes=65536))
        self.required_storage = max(x_stream_rules.MIN_FREE_BYTES, x_stream_probe.REVIEWED_STORAGE_FLOOR,
                                    reserve['required_free_bytes'])
        self._storage()
        self.db.execute('PRAGMA synchronous=FULL'); self.db.execute('PRAGMA busy_timeout=100')
        if self.db.execute('PRAGMA synchronous').fetchone()[0] < 2:
            _block('durability-required')
        _schema(self.db)
        self.readiness_id = digest(['x-stream-trial-readiness-v1', self.plan_sha])
        self.owner = 'trial-readiness:' + self.readiness_id
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if self.db.execute('SELECT 1 FROM x_stream_trial_run').fetchone():
                _block('already-used')
            for table in ('x_stream_probe_run', 'x_stream_rule_setup'):
                if x_stream_rules._table(self.db, table) and self.db.execute('SELECT 1 FROM ' + table).fetchone():
                    _block('another-trial-present')
            self.original_snapshot, self.original_exposure, self.original_report = self._original()
            self._guards()
            p = self.frozen; stamp = x_stream.stamp(self.clock())
            self.db.execute("INSERT INTO x_stream_trial_run VALUES(1,?,?,NULL,'running',NULL,?,?,?,?,'unknown',NULL)",
                (self.plan_sha, stamp, p['prior_exposure_contingency_micros'], p['setup_readiness_contingency_micros'],
                 p['stream_allowance_micros'], p['polling_contingency_micros']))
            self.db.execute("INSERT INTO x_stream_trial_readiness VALUES(1,?,?,?,?,?,NULL,'running',0,'unknown',NULL,'{}')",
                (self.readiness_id, p['original_metadata_request_id'], p['original_metadata_result_sha256'],
                 p['original_account_anchor_sha256'], stamp))
            self.db.execute('INSERT INTO x_stream_supervisor_owner VALUES(1,?,?)', (self.owner, stamp))
        self.claimed = True

    def _readiness_admit(self, request_id, path):
        capability = request_id, path
        if capability not in self.capabilities or self.db.in_transaction:
            return False
        self.capabilities.remove(capability)
        with self.db:
            self.db.execute('BEGIN IMMEDIATE'); self._guards(self.owner)
            row = self.db.execute('SELECT run_id,path,cost_status,reserved_micros FROM x_stream_trial_readiness_requests '
                                  'WHERE request_id=?', (request_id,)).fetchone()
            if not row or tuple(row) != (self.readiness_id, path, 'unknown', None):
                return False
        return True

    async def _get(self, transport, path):
        with self.db:
            self.db.execute('BEGIN IMMEDIATE'); self._guards(self.owner)
            count = self.db.execute('SELECT requests_admitted FROM x_stream_trial_readiness').fetchone()[0]
            if count >= 5 or path != ORDER[count]:
                _block('request-budget-exhausted')
            identity = digest([self.readiness_id, path])
            self.db.execute("INSERT INTO x_stream_trial_readiness_requests VALUES(?,?,?,?,'unknown',NULL)",
                            (identity, self.readiness_id, path, x_stream.stamp(self.clock())))
            self.db.execute('UPDATE x_stream_trial_readiness SET requests_admitted=requests_admitted+1')
        capability = identity, path
        self.capabilities.add(capability)
        try:
            return await transport.get(path, dict(x_preflight.BASE_PARAMS[path]), identity)
        finally:
            self.capabilities.discard(capability)

    def _credits(self, current):
        old = self.original_report['credits']; p = self.frozen
        tolerance = Decimal(p['credit_rounding_tolerance_micros']) / 1_000_000
        decline = Decimal(p['maximum_unexplained_decrease_micros']) / 1_000_000
        for key in ('prepaid_balance', 'free_balance', 'total_balance'):
            before, after = Decimal(old[key]), Decimal(current[key])
            if not before.is_finite() or after > before + tolerance or before - after > decline + tolerance:
                _block('credit-adjustment-or-unexplained-decrease')
        for key in ('free_grant_count', 'free_grants_without_expiry_count', 'earliest_known_free_grant_expiry'):
            if current.get(key) != old.get(key):
                _block('credit-grants-changed')

    async def _readiness(self):
        transport = self.readiness_factory(enabled=True, admission=self._readiness_admit, token_provider=self.token_provider)
        rows, token = x_preflight._page(await self._get(transport, ORDER[0]), ORDER[0])
        if token is not None:
            _block('inventory-incomplete')
        inventory = x_preflight._rules(rows)
        counts = x_preflight._counts(await self._get(transport, ORDER[1]), inventory)
        if counts['client_app_id'] != self.frozen['expected_app_id'] or counts['project_app_count'] != 1 or counts['other_app_rule_count']:
            _block('identity-or-foreign-app')
        if min(counts['cap_per_client_app'], counts['cap_per_project']) < 4:
            _block('rule-cap-insufficient')
        rows, token = x_preflight._page(await self._get(transport, ORDER[2]), ORDER[2])
        if token is not None:
            _block('inventory-incomplete')
        connections = x_preflight._connections(rows)
        if connections['active_count']:
            _block('active-consumer-present')
        usage = x_preflight._usage(await self._get(transport, ORDER[3]), counts['client_app_id'])
        if usage['other_app_usage_posts_one_day']:
            _block('other-app-usage-present')
        credits = x_preflight._credits(await self._get(transport, ORDER[4])); self._credits(credits)
        started = self.db.execute('SELECT started_at FROM x_stream_trial_readiness').fetchone()[0]
        present = {(row['value'], row['tag']) for row in inventory}
        missing = [row for row in x_stream.manifest() if (row['value'], row['tag']) not in present]
        self.fresh = dict(request_id=self.readiness_id, status='observed', reason='x-preflight-metadata-only',
            started_at=started, verified_at=x_stream.stamp(self.clock()), requests_admitted=5,
            original_metadata_request_id=self.frozen['original_metadata_request_id'],
            original_metadata_result_sha256=self.frozen['original_metadata_result_sha256'],
            cost_status='unknown', reserved_micros=None, inventory=inventory, rules_complete=True,
            inventory_complete=True, missing_rules=missing, required_rules_present=not missing,
            rule_counts=counts, connections=connections, usage=usage, credits=credits,
            stream_entitlement_verified=False, fresh_spend_verified=False, fresh_headroom_verified=False)
        with self.db:
            self.db.execute('BEGIN IMMEDIATE'); self._guards(self.owner)
            self.db.execute("UPDATE x_stream_trial_readiness SET state='observed',verified_at=?,result=?",
                            (self.fresh['verified_at'], _json(self.fresh)))
            self.db.execute('DELETE FROM x_stream_supervisor_owner WHERE owner=?', (self.owner,))
        self._log('readiness', {'status': 'observed', 'requests_admitted': 5, 'cost_status': 'unknown',
                               'reserved_micros': None, 'verified_at': self.fresh['verified_at']})

    def _fresh_check(self):
        row = self.db.execute('SELECT state,requests_admitted,result FROM x_stream_trial_readiness').fetchone()
        if not row or tuple(row[:2]) != ('observed', 5) or x_preflight._json(row[2]) != self.fresh:
            _block('readiness-changed')
        if not _utc(self.clock()) - timedelta(minutes=15) <= _utc(self.fresh['verified_at']) <= _utc(self.clock()):
            _block('readiness-stale')

    def _rules_config(self):
        p = self.frozen
        return dict(version=1, setup_id=p['trial_id'], approval_id=p['approval_id'], approved_at=p['approved_at'],
            prepared_at=p['prepared_at'], expires_at=p['probe_end_at'], manifest_sha256=p['manifest_sha256'],
            metadata_request_id=self.readiness_id, metadata_result_sha256=digest(self.fresh),
            expected_app_id=p['expected_app_id'], create_missing_rules_approved=True, single_consumer_verified=True,
            account_cap_verified=True, account_cap_micros=p['account_cap_micros'], account_headroom_micros=p['account_headroom_micros'],
            auto_recharge_disabled_verified=True, account_evidence_ref=p['account_evidence_ref'],
            storage_evidence_ref=p['storage_evidence_ref'], reconciliation_evidence_ref=p['reconciliation_evidence_ref'],
            unknown_cost_approved=True, local_aim_micros=p['local_aim_micros'],
            prior_exposure_contingency_micros=p['prior_exposure_contingency_micros'],
            control_contingency_micros=p['setup_readiness_contingency_micros'],
            polling_contingency_micros=p['polling_contingency_micros'], storage_required_bytes=self.required_storage)

    def _review_rules(self, config, evidence):
        self._original(); self._storage(); self._fresh_check()
        return (config == self._rules_config() and evidence['metadata'] == self.fresh
                and evidence['metadata_exposure']['known_reserved_micros'] == self.original_exposure['known_reserved_micros']
                and evidence['metadata_exposure']['unknown_runs'] == self.original_exposure['unknown_runs'] + 1
                and evidence['cost_status'] == 'unknown' and evidence['reserved_micros'] is None)

    def _probe_config(self):
        p = self.frozen
        end = min(_utc(p['probe_end_at']), _utc(self.clock()) + timedelta(seconds=p['max_probe_seconds']))
        self._backup(end)
        return dict(version=1, probe_id=p['trial_id'], approval_id=p['approval_id'], approved_at=p['approved_at'],
            verified_at=self.fresh['verified_at'], end_at=x_stream.stamp(end), manifest_sha256=p['manifest_sha256'],
            inventory=self.rule_result['inventory'], rules_complete=True, stream_attempt_approved=True,
            single_consumer_verified=True, account_cap_verified=True, account_cap_micros=p['account_cap_micros'],
            account_headroom_micros=p['account_headroom_micros'], auto_recharge_disabled_verified=True,
            spending_approved=True, prices_verified=True, post_micros=p['post_micros'], user_micros=p['user_micros'],
            pricing_evidence_ref=p['pricing_evidence_ref'], budget_anchor_ref=p['account_evidence_ref'],
            reconciliation_evidence_ref=p['reconciliation_evidence_ref'], local_aim_micros=p['local_aim_micros'],
            prior_exposure_bound_micros=p['prior_exposure_contingency_micros'], polling_contingency_micros=p['polling_contingency_micros'],
            rule_control_contingency_micros=p['setup_readiness_contingency_micros'], stream_allowance_micros=p['stream_allowance_micros'],
            unknown_prior_cost_approved=True, control_cost_unknown=True, max_reads=64,
            baseline_service_margin_bytes=p['baseline_service_margin_bytes'], storage_evidence_ref=p['storage_evidence_ref'],
            max_rows=128, max_metadata_bytes=65536, max_wire_bytes=524288)

    def _review_probe(self, config, exposure):
        self._original(); self._storage(); self._fresh_check()
        row = self.db.execute('SELECT state,post_claimed,get_claimed,verified_inventory,cost_status,reserved_micros '
                              'FROM x_stream_rule_setup').fetchone()
        if not row or row[0] != 'verified' or row[4] != 'unknown' or row[5] is not None:
            return False
        inventory = x_preflight._json(row[3])
        x_stream.verified_rule_map(inventory, x_stream.manifest())
        return (config == self.probe_config and exposure == self.original_exposure
                and inventory == self.rule_result['inventory'] and self.rule_result['owner_released'] is True
                and ((row[1] == row[2] == 1) if self.fresh['missing_rules'] else (row[1] == row[2] == 0)))

    def _stream_transport(self, **options):
        if self.stream_factory is None:
            import aiohttp
            from x_stream_transport import AiohttpTransport
            if aiohttp.__version__ != x_preflight.PINNED_AIOHTTP:
                _block('transport-version-unreviewed')
            factory = AiohttpTransport
        else:
            factory = self.stream_factory
        inner = factory(**options)
        controller = self
        class ObservedTransport:
            @asynccontextmanager
            async def stream_factory(self, url, params):
                async with inner.stream_factory(url, params) as reader:
                    controller._log('connection', {'status': 'accepted', 'connection_attempt': 1,
                                                  'observed_at': x_stream.stamp(controller.clock())})
                    yield reader
        return ObservedTransport()

    async def run(self):
        if self.enabled is not True:
            return {'status': 'disabled', 'reason': 'x-trial-disabled'}
        result = {'status': 'blocked', 'reason': 'x-trial-internal-failure'}
        try:
            self.initialize()
            await self._readiness()
            self.rule_result = await x_stream_rules.Installer(db=self.db, enabled=True, config=self._rules_config(),
                token_provider=self.token_provider, reviewed_admission=self._review_rules, storage_preflight=self._storage,
                transport_factory=self.rules_factory, stop_event=self.stop_event, clock=self.clock).run()
            self._log('rules', {k: self.rule_result[k] for k in ('status', 'reason')})
            if self.rule_result.get('status') != 'verified' or self.rule_result.get('owner_released') is not True:
                _block('rule-setup-blocked')
            self.probe_config = self._probe_config()
            result = await x_stream_probe.Probe(db=self.db, enabled=True, config=self.probe_config,
                token_provider=self.token_provider, reviewed_admission=self._review_probe, storage_preflight=self._storage,
                transport_factory=self._stream_transport, stop_event=self.stop_event, clock=self.clock,
                monotonic=self.monotonic).run()
            result.update(control_cost_status='unknown', control_reserved_micros=None, cost_reconciled=False,
                          readiness_requests_admitted=5)
        except asyncio.CancelledError:
            result = {'status': 'blocked', 'reason': 'x-trial-interrupted'}
            raise
        except (TrialBlocked, x_preflight.PreflightBlocked, x_stream_rules.RuleSetupBlocked) as exc:
            result = {'status': 'blocked', 'reason': str(exc)}
        except Exception:
            result = {'status': 'blocked', 'reason': 'x-trial-internal-failure'}
        finally:
            if self.claimed:
                try:
                    with self.db:
                        self.db.execute('UPDATE x_stream_trial_run SET status=?,reason=?,ended_at=?',
                                        (result['status'], result.get('reason'), x_stream.stamp(self.clock())))
                        # A failed readiness retains its exclusion row and unknown
                        # request claims. No automatic recovery/replay after restart.
                        self.db.execute("UPDATE x_stream_trial_readiness SET state='blocked' WHERE state='running'")
                except Exception:
                    result = {'status': 'blocked', 'reason': 'x-trial-persistence-failed'}
            self._log('result', result)
        return result


def run_once(db_path, stop_event, *, env=None, emit=None, backup_readiness=None):
    """Service-thread entry point. Existing bearer is accessed only after claims."""
    env = os.environ if env is None else env
    if not requested(env) or stop_event.is_set():
        return
    emit = emit or (lambda value: print(value, flush=True))
    db = None
    try:
        raw = env.get(PLAN, '')
        if type(raw) is not str or not 1 <= len(raw.encode()) <= 16384:
            _block('plan-invalid')
        plan = x_preflight._json(raw)
        validate_plan(plan, datetime.now(timezone.utc))
        import monitor
        db = monitor.connect(db_path)
        return asyncio.run(Controller(db=db, enabled=True, plan=plan, stop_event=stop_event,
            token_provider=lambda: env.get('X_BEARER_TOKEN', ''), backup_readiness=backup_readiness, emit=emit).run())
    except Exception:
        emit('x-stream-trial-result {"status":"blocked","reason":"x-trial-service-check-failed"}')
    finally:
        if db is not None:
            db.close()
