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
LOCAL = 'X_STREAM_TRIAL_LOCAL_DIAGNOSTICS'
CONTINUATION_ENABLED = 'X_STREAM_TRIAL_CONTINUATION_ENABLED'
CONTINUATION = 'X_STREAM_TRIAL_CONTINUATION_JSON'
SECOND_ENABLED = 'X_STREAM_SECOND_DIAGNOSTIC_ENABLED'
SECOND = 'X_STREAM_SECOND_DIAGNOSTIC_JSON'
SHUTDOWN_MARGIN_SECONDS = 30
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
    env = os.environ if env is None else env
    return any(str(env.get(key, '')).strip().lower() == 'true' for key in (ENABLED, LOCAL, CONTINUATION_ENABLED, SECOND_ENABLED))


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


def _error_class(error):
    """Finite local classification; exception/provider text is never returned."""
    if isinstance(error, sqlite3.Error):
        code = getattr(error, 'sqlite_errorcode', 0) & 255
        if code in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
            return 'sqlite-busy'
        if code == sqlite3.SQLITE_FULL:
            return 'sqlite-full'
        return 'sqlite-error'
    for kind, name in ((TypeError, 'type-error'), (KeyError, 'key-error'),
                       (ValueError, 'value-error'), (OSError, 'os-error')):
        if isinstance(error, kind):
            return name
    return 'other-error'


def _ledger_diagnostic(db):
    """Bounded read-only counts/fixed states; never IDs, bodies or evidence."""
    if not isinstance(db, sqlite3.Connection):
        return {'available': False}
    result = {'available': True}
    names = ('x_stream_trial_run', 'x_stream_trial_readiness', 'x_stream_trial_readiness_requests',
             'x_stream_rule_setup', 'x_stream_probe_run', 'x_stream_supervisor_owner',
             'x_stream_trial_continuation', 'x_stream_trial_continuation_readiness', 'x_stream_trial_continuation_requests',
             'x_stream_second_diagnostic', 'x_stream_second_readiness', 'x_stream_second_requests',
             'x_stream_second_probe_run')
    states = frozenset(('running', 'reserved', 'blocked', 'observed', 'verified', 'ended',
                        'post-claimed', 'post-verified', 'get-claimed'))
    try:
        for name in names:
            if not x_stream_rules._table(db, name):
                result[name] = {'present': False}
                continue
            count = db.execute('SELECT COUNT(*) FROM (SELECT 1 FROM ' + name + ' LIMIT 1025)').fetchone()[0]
            item = {'present': True, 'rows': count}
            if count == 1 and name in ('x_stream_trial_run', 'x_stream_trial_readiness',
                                      'x_stream_rule_setup', 'x_stream_probe_run', 'x_stream_trial_continuation',
                                      'x_stream_trial_continuation_readiness', 'x_stream_second_diagnostic',
                                      'x_stream_second_readiness', 'x_stream_second_probe_run'):
                column = 'status' if name == 'x_stream_trial_run' else 'state'
                state = db.execute('SELECT ' + column + ' FROM ' + name + ' LIMIT 1').fetchone()[0]
                item['state'] = state if state in states else 'unrecognized'
                fields = {'x_stream_trial_readiness': (('requests_admitted', 5),),
                          'x_stream_trial_continuation_readiness': (('requests_admitted', 5),),
                          'x_stream_rule_setup': (('post_claimed', 1), ('get_claimed', 1)),
                          'x_stream_probe_run': (('attempts', 1), ('close_confirmed', 1)),
                          'x_stream_second_readiness': (('requests_admitted', 5),),
                          'x_stream_second_probe_run': (('attempts', 1), ('close_confirmed', 1))}.get(name, ())
                for field, maximum in fields:
                    value = db.execute('SELECT ' + field + ' FROM ' + name + ' LIMIT 1').fetchone()[0]
                    item[field] = value if type(value) is int and 0 <= value <= maximum else 'unrecognized'
            if name == 'x_stream_probe_run' and count == 1:
                item.update(x_stream_probe.transport_diagnostic(db))
                cursor = db.execute('SELECT * FROM x_stream_probe_run WHERE singleton=1')
                row = cursor.fetchone()
                item['row_sha256'] = digest(dict(zip((c[0] for c in cursor.description), row)))
            if name == 'x_stream_second_probe_run' and count == 1:
                item.update(x_stream_probe.transport_diagnostic(db, _second_diagnostic=True))
            result[name] = item
    except Exception:
        result['available'] = False
    return result


class Controller:
    readiness_table = 'x_stream_trial_readiness'
    requests_table = 'x_stream_trial_readiness_requests'
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
        self.stage = 'not-started'
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
        end = end or self._dispatch_end()
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

    def _dispatch_end(self):
        return _utc(self.frozen['probe_end_at'])

    def _validate_current_plan(self):
        validate_plan(self.plan, self.clock())
        if digest(self.plan) != self.plan_sha:
            _block('plan-changed')

    def _require_inventory(self, inventory):
        # Ordinary initial setup may add the approved missing rules.
        pass

    def _guards(self, owner=None):
        self._validate_current_plan()
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
        self.stage = 'plan-validation'
        validate_plan(self.plan, self.clock())
        if not isinstance(self.db, sqlite3.Connection) or self.db.in_transaction or not callable(self.token_provider):
            _block('durable-ledger-required')
        self.stage = 'database-location'
        location = self.db.execute('PRAGMA database_list').fetchone()
        if not location or not location[2] or (self.storage_preflight is None and not Path(location[2]).resolve().is_relative_to('/data')):
            _block('service-volume-required')
        self.frozen = x_preflight._json(_json(self.plan)); self.plan_sha = digest(self.frozen)
        self.monotonic_end = self.monotonic() + (_utc(self.frozen['probe_end_at']) - _utc(self.clock())).total_seconds()
        self.stage = 'storage-readiness'
        reserve = x_stream_probe.storage_reserve(self.db, dict(self.frozen, max_reads=64, max_metadata_bytes=65536))
        self.required_storage = max(x_stream_rules.MIN_FREE_BYTES, x_stream_probe.REVIEWED_STORAGE_FLOOR,
                                    reserve['required_free_bytes'])
        self._storage()
        self.stage = 'database-durability'
        self.db.execute('PRAGMA synchronous=FULL'); self.db.execute('PRAGMA busy_timeout=5000')
        if self.db.execute('PRAGMA synchronous').fetchone()[0] < 2:
            _block('durability-required')
        self.stage = 'database-schema'
        _schema(self.db)
        self.readiness_id = digest(['x-stream-trial-readiness-v1', self.plan_sha])
        self.owner = 'trial-readiness:' + self.readiness_id
        self.stage = 'trial-reservation'
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if self.db.execute('SELECT 1 FROM x_stream_trial_run').fetchone():
                _block('already-used')
            for table in ('x_stream_probe_run', 'x_stream_rule_setup'):
                if x_stream_rules._table(self.db, table) and self.db.execute('SELECT 1 FROM ' + table).fetchone():
                    _block('another-trial-present')
            self.stage = 'original-evidence'
            self.original_snapshot, self.original_exposure, self.original_report = self._original()
            self._guards()
            self.stage = 'trial-claim'
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
            row = self.db.execute('SELECT run_id,path,cost_status,reserved_micros FROM ' + self.requests_table + ' '
                                  'WHERE request_id=?', (request_id,)).fetchone()
            if not row or tuple(row) != (self.readiness_id, path, 'unknown', None):
                return False
        return True

    async def _get(self, transport, path):
        self.stage = 'readiness-claim'
        with self.db:
            self.db.execute('BEGIN IMMEDIATE'); self._guards(self.owner)
            count = self.db.execute('SELECT requests_admitted FROM ' + self.readiness_table).fetchone()[0]
            if count >= 5 or path != ORDER[count]:
                _block('request-budget-exhausted')
            identity = digest([self.readiness_id, path])
            self.db.execute("INSERT INTO " + self.requests_table + " VALUES(?,?,?,?,'unknown',NULL)",
                            (identity, self.readiness_id, path, x_stream.stamp(self.clock())))
            self.db.execute('UPDATE ' + self.readiness_table + ' SET requests_admitted=requests_admitted+1')
        capability = identity, path
        self.capabilities.add(capability)
        try:
            self.stage = 'readiness-request'
            return await transport.get(path, dict(x_preflight.BASE_PARAMS[path]), identity)
        finally:
            self.capabilities.discard(capability)

    def _credits(self, current):
        p = self.frozen
        tolerance = Decimal(p['credit_rounding_tolerance_micros']) / 1_000_000
        decline = Decimal(p['maximum_unexplained_decrease_micros']) / 1_000_000
        reports = [self.original_report]
        if hasattr(self, 'prior_readiness'):
            reports.append(self.prior_readiness)
        # Keep the cumulative ORIGINAL allowance; a continuation must not stack
        # a second unexplained-decrease allowance on its more recent snapshot.
        for report in reports:
            old = report['credits']
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
        self.inventory_rows_seen = len(rows)
        inventory = x_preflight._rules(rows)
        self._require_inventory(inventory)
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
        self.stage = 'readiness-persistence'
        started = self.db.execute('SELECT started_at FROM ' + self.readiness_table).fetchone()[0]
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
            self.db.execute("UPDATE " + self.readiness_table + " SET state='observed',verified_at=?,result=?",
                            (self.fresh['verified_at'], _json(self.fresh)))
            self.db.execute('DELETE FROM x_stream_supervisor_owner WHERE owner=?', (self.owner,))
        self._log('readiness', {'status': 'observed', 'requests_admitted': 5, 'cost_status': 'unknown',
                               'reserved_micros': None, 'verified_at': self.fresh['verified_at']})

    def _fresh_check(self):
        row = self.db.execute('SELECT state,requests_admitted,result FROM ' + self.readiness_table).fetchone()
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
        # Finite SQLite waits and owned transport cleanup consume shutdown headroom.
        end = min(self._dispatch_end() - timedelta(seconds=SHUTDOWN_MARGIN_SECONDS),
                  _utc(self.clock()) + timedelta(seconds=p['max_probe_seconds']))
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
            self.stage = 'rule-setup'
            self.rule_result = await x_stream_rules.Installer(db=self.db, enabled=True, config=self._rules_config(),
                token_provider=self.token_provider, reviewed_admission=self._review_rules, storage_preflight=self._storage,
                transport_factory=self.rules_factory, stop_event=self.stop_event, clock=self.clock).run()
            self._log('rules', {k: self.rule_result[k] for k in ('status', 'reason', 'stage', 'error_class')
                                if k in self.rule_result})
            if self.rule_result.get('status') != 'verified' or self.rule_result.get('owner_released') is not True:
                _block('rule-setup-blocked')
            self.stage = 'probe-setup'
            self.probe_config = self._probe_config()
            self.stage = 'probe-run'
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
        except Exception as exc:
            result = {'status': 'blocked', 'reason': 'x-trial-internal-failure',
                      'stage': self.stage, 'error_class': _error_class(exc), 'ledger': _ledger_diagnostic(self.db)}
        finally:
            if self.claimed:
                try:
                    with self.db:
                        self.db.execute('UPDATE x_stream_trial_run SET status=?,reason=?,ended_at=?',
                                        (result['status'], result.get('reason'), x_stream.stamp(self.clock())))
                        # A failed readiness retains its exclusion row and unknown
                        # request claims. No automatic recovery/replay after restart.
                        self.db.execute("UPDATE x_stream_trial_readiness SET state='blocked' WHERE state='running'")
                except Exception as exc:
                    result = {'status': 'blocked', 'reason': 'x-trial-persistence-failed',
                              'stage': 'finalization', 'error_class': _error_class(exc),
                              'ledger': _ledger_diagnostic(self.db)}
            self._log('result', result)
        return result


CONTINUATION_KEYS = frozenset(('version', 'continuation_id', 'original_plan_sha256',
    'prepared_at', 'end_at', 'reviewed_continuation', 'existing_unknown_cost_contingency_covers_reads'))


def validate_continuation(value, original, now):
    if (type(value) is not dict or set(value) != CONTINUATION_KEYS or type(value['version']) is not int
            or value['version'] != 1 or len(_json(value).encode()) > 4096
            or type(value['continuation_id']) is not str
            or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}', value['continuation_id'])
            or value['original_plan_sha256'] != digest(original)
            or value['reviewed_continuation'] is not True
            or value['existing_unknown_cost_contingency_covers_reads'] is not True):
        _block('continuation-approval-invalid')
    # Validate historical input at its original preparation, without refreshing it.
    validate_plan(original, original['prepared_at'])
    prepared, current, end = map(_utc, (value['prepared_at'], now, value['end_at']))
    if not (prepared <= current < end <= prepared + timedelta(minutes=10)
            and _utc(original['prepared_at']) < prepared
            and end <= _utc(original['session_expires_at']) and end.date() == current.date()):
        _block('continuation-expired')


def _continuation_schema(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS x_stream_trial_continuation (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), config_sha TEXT NOT NULL,
        original_plan_sha TEXT NOT NULL, prepared_at TEXT NOT NULL, end_at TEXT NOT NULL,
        started_at TEXT NOT NULL, ended_at TEXT, state TEXT NOT NULL, reason TEXT,
        prior_snapshot_sha TEXT NOT NULL, original_owner TEXT NOT NULL, original_owner_started_at TEXT NOT NULL,
        cost_status TEXT NOT NULL CHECK(cost_status='unknown'), reserved_micros INTEGER CHECK(reserved_micros IS NULL));
      CREATE TABLE IF NOT EXISTS x_stream_trial_continuation_readiness (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), request_id TEXT NOT NULL UNIQUE,
        original_request_id TEXT NOT NULL, original_result_sha256 TEXT NOT NULL,
        original_anchor_sha256 TEXT NOT NULL, started_at TEXT NOT NULL, verified_at TEXT,
        state TEXT NOT NULL, requests_admitted INTEGER NOT NULL DEFAULT 0,
        cost_status TEXT NOT NULL CHECK(cost_status='unknown'), reserved_micros INTEGER CHECK(reserved_micros IS NULL),
        result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS x_stream_trial_continuation_requests (
        request_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
        admitted_at TEXT NOT NULL, cost_status TEXT NOT NULL CHECK(cost_status='unknown'),
        reserved_micros INTEGER CHECK(reserved_micros IS NULL));
    ''')


class Continuation(Controller):
    """One additive no-POST verification of an exact interrupted rule attempt.

    Historical preparation/claims/unknown costs are immutable. New reads consume
    the SAME operator-approved setup contingency; no new local aim is created.
    """
    readiness_table = 'x_stream_trial_continuation_readiness'
    requests_table = 'x_stream_trial_continuation_requests'

    def __init__(self, *, continuation=None, **options):
        super().__init__(**options)
        self.continuation = continuation
        self.continuation_frozen = self.continuation_sha = self.prior_snapshot = None
        self.inventory_rows_seen = 0
        self.missing_routes = []

    def _dispatch_end(self):
        return _utc(self.continuation_frozen['end_at'])

    def _validate_current_plan(self):
        validate_continuation(self.continuation, self.plan, self.clock())
        if digest(self.plan) != self.plan_sha or digest(self.continuation) != self.continuation_sha:
            _block('continuation-changed')

    def _one(self, table):
        cursor = self.db.execute('SELECT * FROM ' + table + ' LIMIT 2')
        rows = cursor.fetchall()
        if len(rows) != 1:
            _block('continuation-history-invalid')
        return dict(zip((c[0] for c in cursor.description), rows[0]))

    def _prior(self):
        run = self._one('x_stream_trial_run')
        readiness = self._one('x_stream_trial_readiness')
        rules = self._one('x_stream_rule_setup')
        report = x_preflight._json(readiness['result'])
        claims = list(self.db.execute('SELECT request_id,run_id,path,admitted_at,cost_status,reserved_micros '
                                     'FROM x_stream_trial_readiness_requests ORDER BY path LIMIT 6'))
        if (run['plan_sha'] != self.plan_sha or run['status'] != 'running'
                or readiness['state'] != 'observed' or readiness['requests_admitted'] != 5
                or [r[2] for r in claims] != sorted(x_preflight.PATHS)
                or any(r[1] != readiness['request_id'] or r[4] != 'unknown' or r[5] is not None for r in claims)
                or report.get('request_id') != readiness['request_id']
                or report.get('requests_admitted') != 5 or report.get('status') != 'observed'
                or rules['metadata_request_id'] != readiness['request_id']
                or rules['state'] != 'post-claimed' or rules['post_claimed'] != 1 or rules['get_claimed'] != 0
                or rules['approval_id'] != self.frozen['approval_id']
                or any(row['cost_status'] != 'unknown' or row['reserved_micros'] is not None
                       for row in (run, readiness, rules))):
            _block('continuation-history-invalid')
        # Reconstruct the exact old admission from its unchanged report/plan.
        previous, previous_id = self.fresh, getattr(self, 'readiness_id', None)
        try:
            self.fresh, self.readiness_id = report, readiness['request_id']
            if digest(self._rules_config()) != rules['config_sha']:
                _block('continuation-rule-plan-mismatch')
        finally:
            self.fresh, self.readiness_id = previous, previous_id
        for column, key in (('prior_contingency_micros', 'prior_exposure_contingency_micros'),
                            ('setup_contingency_micros', 'setup_readiness_contingency_micros'),
                            ('stream_allowance_micros', 'stream_allowance_micros'),
                            ('polling_contingency_micros', 'polling_contingency_micros')):
            if run[column] != self.frozen[key]:
                _block('continuation-budget-changed')
        snapshot = digest([run, readiness, rules, [list(r) for r in claims]])
        if self.prior_snapshot is not None and snapshot != self.prior_snapshot:
            _block('continuation-history-changed')
        return snapshot, report, rules

    def _original(self):
        result = super()._original()
        if self.prior_snapshot is not None:
            self._prior()
        return result

    def initialize(self):
        self.stage = 'continuation-validation'
        validate_continuation(self.continuation, self.plan, self.clock())
        if not isinstance(self.db, sqlite3.Connection) or self.db.in_transaction or not callable(self.token_provider):
            _block('durable-ledger-required')
        location = self.db.execute('PRAGMA database_list').fetchone()
        if not location or not location[2] or (self.storage_preflight is None and not Path(location[2]).resolve().is_relative_to('/data')):
            _block('service-volume-required')
        self.frozen = x_preflight._json(_json(self.plan)); self.plan_sha = digest(self.frozen)
        self.continuation_frozen = x_preflight._json(_json(self.continuation))
        self.continuation_sha = digest(self.continuation_frozen)
        self.monotonic_end = self.monotonic() + (self._dispatch_end() - _utc(self.clock())).total_seconds()
        reserve = x_stream_probe.storage_reserve(self.db, dict(self.frozen, max_reads=64, max_metadata_bytes=65536))
        self.required_storage = max(x_stream_rules.MIN_FREE_BYTES, x_stream_probe.REVIEWED_STORAGE_FLOOR,
                                    reserve['required_free_bytes'])
        self._storage()
        self.db.execute('PRAGMA synchronous=FULL'); self.db.execute('PRAGMA busy_timeout=5000')
        if self.db.execute('PRAGMA synchronous').fetchone()[0] < 2:
            _block('durability-required')
        _continuation_schema(self.db)
        self.stage = 'continuation-reservation'
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if self.db.execute('SELECT 1 FROM x_stream_trial_continuation').fetchone():
                _block('continuation-already-used')
            if x_stream_rules._table(self.db, 'x_stream_probe_run') and self.db.execute('SELECT 1 FROM x_stream_probe_run').fetchone():
                _block('probe-already-used')
            self.original_snapshot, self.original_exposure, self.original_report = super()._original()
            self.prior_snapshot, self.prior_readiness, rules = self._prior()
            self.owner = 'rule-setup:' + rules['config_sha']
            self._guards(self.owner)
            owner = self.db.execute('SELECT owner,started_at FROM x_stream_supervisor_owner').fetchone()
            self.readiness_id = digest(['x-trial-no-post-continuation-v1', self.continuation_sha])
            stamp = x_stream.stamp(self.clock()); c = self.continuation_frozen; p = self.frozen
            self.db.execute("INSERT INTO x_stream_trial_continuation VALUES(1,?,?,?,?,?,NULL,'running',NULL,?,?,?,'unknown',NULL)",
                (self.continuation_sha, self.plan_sha, c['prepared_at'], c['end_at'], stamp,
                 self.prior_snapshot, owner[0], owner[1]))
            self.db.execute("INSERT INTO x_stream_trial_continuation_readiness VALUES(1,?,?,?,?,?,NULL,'running',0,'unknown',NULL,'{}')",
                (self.readiness_id, p['original_metadata_request_id'], p['original_metadata_result_sha256'],
                 p['original_account_anchor_sha256'], stamp))
        self.claimed = True

    def _require_inventory(self, inventory):
        self.inventory_rows_seen = len(inventory)
        present = {(r['value'], r['tag']) for r in inventory}
        self.missing_routes = [r['source_id'] for r in x_stream.manifest() if (r['value'], r['tag']) not in present]
        if self.missing_routes:
            _block('continuation-rules-incomplete')
        x_stream.verified_rule_map(inventory, x_stream.manifest())

    def _review_probe(self, config, exposure):
        self._validate_current_plan(); self._original(); self._storage(); self._fresh_check()
        record = self._one('x_stream_trial_continuation')
        if (record['config_sha'] != self.continuation_sha or record['state'] != 'verified'
                or record['prior_snapshot_sha'] != self.prior_snapshot
                or record['cost_status'] != 'unknown' or record['reserved_micros'] is not None):
            return False
        claims = list(self.db.execute('SELECT path,cost_status,reserved_micros FROM ' + self.requests_table + ' ORDER BY path'))
        self._require_inventory(self.fresh['inventory'])
        return (config == self.probe_config and exposure == self.original_exposure
                and [r[0] for r in claims] == sorted(x_preflight.PATHS)
                and all(r[1] == 'unknown' and r[2] is None for r in claims))

    async def run(self):
        if self.enabled is not True:
            return {'status': 'disabled', 'reason': 'x-trial-disabled'}
        result = {'status': 'blocked', 'reason': 'x-trial-internal-failure'}
        try:
            self.initialize()
            await self._readiness()  # Reuses only allowlisted GET transport/parsers.
            with self.db:
                self.db.execute("UPDATE x_stream_trial_continuation SET state='verified'")
            self.rule_result = {'inventory': self.fresh['inventory'], 'owner_released': True}
            self.probe_config = self._probe_config()
            self.stage = 'continuation-probe'
            result = await x_stream_probe.Probe(db=self.db, enabled=True, config=self.probe_config,
                token_provider=self.token_provider, reviewed_admission=self._review_probe, storage_preflight=self._storage,
                transport_factory=self._stream_transport, stop_event=self.stop_event, clock=self.clock,
                monotonic=self.monotonic).run()
            result.update(control_cost_status='unknown', control_reserved_micros=None, cost_reconciled=False,
                          continuation_readiness_requests_admitted=5, original_claims_unchanged=True)
        except asyncio.CancelledError:
            result = {'status': 'blocked', 'reason': 'x-trial-interrupted'}
            raise
        except (TrialBlocked, x_preflight.PreflightBlocked, x_stream_rules.RuleSetupBlocked) as exc:
            result = {'status': 'blocked', 'reason': str(exc), 'inventory_count': self.inventory_rows_seen,
                      'missing_route_ids': self.missing_routes}
        except Exception as exc:
            result = {'status': 'blocked', 'reason': 'x-trial-internal-failure', 'stage': self.stage,
                      'error_class': _error_class(exc)}
        finally:
            if self.claimed:
                try:
                    with self.db:
                        self.db.execute('UPDATE x_stream_trial_continuation SET state=?,reason=?,ended_at=?',
                                        (result['status'], result.get('reason'), x_stream.stamp(self.clock())))
                        self.db.execute("UPDATE x_stream_trial_continuation_readiness SET state='blocked' WHERE state='running'")
                except Exception as exc:
                    result = {'status': 'blocked', 'reason': 'x-trial-persistence-failed',
                              'stage': 'continuation-finalization', 'error_class': _error_class(exc)}
            self._log('continuation-result', result)
            self._log('local', _ledger_diagnostic(self.db))
        return result


def local_diagnostic(db_path):
    """Open the existing volume DB read-only; never initialize, claim or connect."""
    db = None
    try:
        db = sqlite3.connect(Path(db_path).resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
        db.execute('PRAGMA query_only=ON')
        return _ledger_diagnostic(db)
    except Exception as exc:
        return {'available': False, 'error_class': _error_class(exc)}
    finally:
        if db is not None:
            db.close()


def run_once(db_path, stop_event, *, env=None, emit=None, backup_readiness=None):
    """Service-thread entry point. Existing bearer is accessed only after claims."""
    env = os.environ if env is None else env
    if not requested(env) or stop_event.is_set():
        return
    emit = emit or (lambda value: print(value, flush=True))
    if str(env.get(LOCAL, '')).strip().lower() == 'true':
        emit('x-stream-trial-local ' + _json(local_diagnostic(db_path)))
    initial = str(env.get(ENABLED, '')).strip().lower() == 'true'
    continuation_enabled = str(env.get(CONTINUATION_ENABLED, '')).strip().lower() == 'true'
    second_enabled = str(env.get(SECOND_ENABLED, '')).strip().lower() == 'true'
    if not any((initial, continuation_enabled, second_enabled)) or stop_event.is_set():
        return
    if sum((initial, continuation_enabled, second_enabled)) > 1:
        emit('x-stream-trial-result {"status":"blocked","reason":"x-trial-conflicting-modes"}')
        return
    db = None
    try:
        raw = env.get(PLAN, '')
        if type(raw) is not str or not 1 <= len(raw.encode()) <= 16384:
            _block('plan-invalid')
        plan = x_preflight._json(raw)
        continuation = diagnostic = None
        if second_enabled:
            import x_stream_second_diagnostic as second
            diagnostic_raw = env.get(SECOND, '')
            if type(diagnostic_raw) is not str or not 1 <= len(diagnostic_raw.encode()) <= 4096:
                _block('second-plan-invalid')
            diagnostic = x_preflight._json(diagnostic_raw)
            second.validate(diagnostic, plan, datetime.now(timezone.utc))
        elif continuation_enabled:
            continuation_raw = env.get(CONTINUATION, '')
            if type(continuation_raw) is not str or not 1 <= len(continuation_raw.encode()) <= 4096:
                _block('continuation-approval-invalid')
            continuation = x_preflight._json(continuation_raw)
            validate_continuation(continuation, plan, datetime.now(timezone.utc))
        else:
            validate_plan(plan, datetime.now(timezone.utc))
        import monitor
        db = monitor.connect(db_path)
        cls = second.SecondDiagnostic if second_enabled else Continuation if continuation_enabled else Controller
        extra = ({'diagnostic': diagnostic} if second_enabled else
                 {'continuation': continuation} if continuation_enabled else {})
        return asyncio.run(cls(db=db, enabled=True, plan=plan, stop_event=stop_event,
            token_provider=lambda: env.get('X_BEARER_TOKEN', ''), backup_readiness=backup_readiness, emit=emit, **extra).run())
    except Exception:
        emit('x-stream-trial-result {"status":"blocked","reason":"x-trial-service-check-failed"}')
    finally:
        if db is not None:
            db.close()
