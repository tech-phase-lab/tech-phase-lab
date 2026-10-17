"""Default-OFF, separately approved second and final receive-only diagnostic.

Fixed additive tables in the SAME service SQLite DB, sharing the original global
owner and all stop/storage/backup/token guards. No rules mutation, Search, retry,
reconnect, reconciliation, original-row updates, or automatic approval values.
The old $1 and new $0.50 are retained independently. Neither is a provider cap.
"""
import asyncio
from datetime import timedelta
from pathlib import Path
import re
import sqlite3

import x_preflight
import x_stream
import x_stream_probe as probe
import x_stream_rules
import x_stream_trial_service as trial

ENABLED = 'X_STREAM_SECOND_DIAGNOSTIC_ENABLED'
PLAN = 'X_STREAM_SECOND_DIAGNOSTIC_JSON'
KEYS = frozenset('version diagnostic_id approval_id approved_at prepared_at end_at original_plan_sha256 '
    'original_probe_sha256 reviewed_diagnostic stream_attempt_approved unknown_cost_approved '
    'account_headroom_micros local_aim_micros metadata_contingency_micros stream_allowance_micros '
    'max_probe_seconds'.split())
HISTORY = ('x_stream_trial_run', 'x_stream_trial_readiness', 'x_stream_trial_readiness_requests',
    'x_stream_rule_setup', 'x_stream_trial_continuation', 'x_stream_trial_continuation_readiness',
    'x_stream_trial_continuation_requests', 'x_stream_probe_run', 'x_stream_probe_receipts')


def validate(value, original, now):
    if (type(value) is not dict or set(value) != KEYS or type(value['version']) is not int
            or value['version'] != 1 or len(trial._json(value).encode()) > 4096):
        trial._block('second-plan-invalid')
    trial.validate_plan(original, original['prepared_at'])
    for key in ('diagnostic_id', 'approval_id'):
        if type(value[key]) is not str or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}', value[key]):
            trial._block('second-reference-invalid')
    for key in ('original_plan_sha256', 'original_probe_sha256'):
        if type(value[key]) is not str or not re.fullmatch('[0-9a-f]{64}', value[key]):
            trial._block('second-reference-invalid')
    if (value['original_plan_sha256'] != trial.digest(original)
            or value['approval_id'] == original['approval_id']
            or any(value[k] is not True for k in ('reviewed_diagnostic', 'stream_attempt_approved', 'unknown_cost_approved'))):
        trial._block('second-approval-invalid')
    approved, prepared, current, end = map(trial._utc, (value['approved_at'], value['prepared_at'], now, value['end_at']))
    if not (trial._utc(original['approved_at']) < approved <= prepared <= current < end
            <= prepared + timedelta(minutes=10) and prepared >= current - timedelta(minutes=10)
            and end <= trial._utc(original['session_expires_at']) and end.date() == current.date()):
        trial._block('second-expired')
    exact = {'local_aim_micros': 500_000, 'metadata_contingency_micros': 350_000,
             'stream_allowance_micros': 150_000}
    if any(type(value[k]) is not int or value[k] != expected for k, expected in exact.items()):
        trial._block('second-allowance-invalid')
    trial._int(value['max_probe_seconds'], 1, 60)
    headroom = trial._int(value['account_headroom_micros'], 1, original['account_headroom_micros'])
    if 1_000_000 + value['local_aim_micros'] + original['polling_contingency_micros'] > headroom:
        trial._block('second-headroom-insufficient')
    if original['post_micros'] + original['user_micros'] > value['stream_allowance_micros']:
        trial._block('second-prices-or-allowance-invalid')


def _schema(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS x_stream_second_diagnostic (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), config_sha TEXT NOT NULL,
        original_plan_sha TEXT NOT NULL, original_probe_sha TEXT NOT NULL,
        approval_id TEXT NOT NULL, approved_at TEXT NOT NULL, started_at TEXT NOT NULL,
        ended_at TEXT, state TEXT NOT NULL, reason TEXT, prior_snapshot_sha TEXT NOT NULL,
        original_retained_micros INTEGER NOT NULL CHECK(original_retained_micros=1000000),
        retained_reservation_micros INTEGER NOT NULL CHECK(retained_reservation_micros=500000),
        control_cost_status TEXT NOT NULL CHECK(control_cost_status='unknown'));
      CREATE TABLE IF NOT EXISTS x_stream_second_readiness (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), request_id TEXT NOT NULL UNIQUE,
        original_request_id TEXT NOT NULL, original_result_sha256 TEXT NOT NULL,
        original_anchor_sha256 TEXT NOT NULL, started_at TEXT NOT NULL, verified_at TEXT,
        state TEXT NOT NULL, requests_admitted INTEGER NOT NULL DEFAULT 0,
        cost_status TEXT NOT NULL CHECK(cost_status='unknown'), reserved_micros INTEGER CHECK(reserved_micros IS NULL),
        result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS x_stream_second_requests (
        request_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
        admitted_at TEXT NOT NULL, cost_status TEXT NOT NULL CHECK(cost_status='unknown'),
        reserved_micros INTEGER CHECK(reserved_micros IS NULL));
    ''')


class _SecondProbe(probe.Probe):
    # Internal fixed namespace, never configurable via plan or environment.
    run_table = 'x_stream_second_probe_run'
    receipts_table = 'x_stream_second_probe_receipts'
    diagnostic_table = 'x_stream_second_probe_transport_diagnostic'

    def __init__(self, *, controller, **options):
        super().__init__(**options)
        self.controller = controller

    def _schema(self):
        probe._schema(self.db, _second_diagnostic=True)

    def _transport_diagnostic(self):
        return probe.transport_diagnostic(self.db, _second_diagnostic=True)

    def _check_prior_exposure(self, exposure):
        # Historical metadata exposure is still paid from the immutable original
        # $1 reservation. It is NOT assigned a zero cost or paid a second time.
        old = self.controller._one('x_stream_probe_run')
        if (exposure != self.controller.original_exposure
                or old['prior_bound_micros'] < exposure['known_reserved_micros']
                or exposure['unknown_runs'] and (old['prior_bound_micros'] <= 0 or old['prior_cost_unknown'] != 1)):
            trial._block('second-prior-exposure-uncovered')

    def _check_ownership(self, ours=False):
        super()._check_ownership(ours)
        self.controller._validate_current_plan()
        self.controller._original()


class SecondDiagnostic(trial.Controller):
    readiness_table = 'x_stream_second_readiness'
    requests_table = 'x_stream_second_requests'
    _one = trial.Continuation._one
    _require_inventory = trial.Continuation._require_inventory

    def __init__(self, *, diagnostic=None, **options):
        super().__init__(**options)
        self.diagnostic = diagnostic
        self.diagnostic_frozen = self.diagnostic_sha = self.prior_snapshot = None
        self.inventory_rows_seen = 0
        self.missing_routes = []

    def _dispatch_end(self):
        return trial._utc(self.diagnostic_frozen['end_at'])

    def _validate_current_plan(self):
        validate(self.diagnostic, self.plan, self.clock())
        if trial.digest(self.plan) != self.plan_sha or trial.digest(self.diagnostic) != self.diagnostic_sha:
            trial._block('second-plan-changed')

    def _prior(self):
        data = {}
        for name in HISTORY:
            cursor = self.db.execute('SELECT * FROM ' + name + ' ORDER BY 1 LIMIT 1025')
            columns = [c[0] for c in cursor.description]
            rows = cursor.fetchall()
            if len(rows) > 1024:
                trial._block('second-history-invalid')
            data[name] = [dict(zip(columns, row)) for row in rows]
        if probe._table(self.db, 'x_stream_probe_transport_diagnostic'):
            data['x_stream_probe_transport_diagnostic'] = [list(row) for row in self.db.execute(
                'SELECT singleton,category,http_status FROM x_stream_probe_transport_diagnostic ORDER BY singleton')]
        run, readiness, rules, continuation, fresh, old = [self._one(name) for name in (
            'x_stream_trial_run', 'x_stream_trial_readiness', 'x_stream_rule_setup',
            'x_stream_trial_continuation', 'x_stream_trial_continuation_readiness', 'x_stream_probe_run')]
        if (run['plan_sha'] != self.plan_sha or run['status'] != 'running'
                or continuation['original_plan_sha'] != self.plan_sha or continuation['state'] != 'ended'
                or continuation['reason'] != 'transport-error'
                or rules['state'] != 'post-claimed' or rules['post_claimed'] != 1 or rules['get_claimed'] != 0
                or old['state'] != 'ended' or old['reason'] != 'transport-error'
                or old['attempts'] != 1 or old['close_confirmed'] != 1 or old['connected_at'] is not None
                or any(old[k] != 0 for k in ('receipts', 'posts', 'users', 'delivered_estimate_micros', 'wire_bytes'))
                or data['x_stream_probe_receipts'] or old['retained_reservation_micros'] != 1_000_000
                or old['approval_id'] != self.frozen['approval_id']
                or trial.digest(old) != self.diagnostic_frozen['original_probe_sha256']
                or trial._utc(old['ended_at']) >= trial._utc(self.diagnostic_frozen['approved_at'])):
            trial._block('second-history-invalid')
        if old['local_aim_micros'] != 1_000_000 or sum(self.frozen[k] for k in (
                'prior_exposure_contingency_micros', 'setup_readiness_contingency_micros', 'stream_allowance_micros')) != 1_000_000:
            trial._block('second-original-reservation-invalid')
        for record, table in ((readiness, 'x_stream_trial_readiness_requests'),
                              (fresh, 'x_stream_trial_continuation_requests')):
            claims = data[table]
            if (record['state'] != 'observed' or record['requests_admitted'] != 5
                    or sorted(r['path'] for r in claims) != sorted(x_preflight.PATHS)
                    or any(r['run_id'] != record['request_id'] or r['cost_status'] != 'unknown'
                           or r['reserved_micros'] is not None for r in claims)):
                trial._block('second-history-invalid')
        if any(r['cost_status'] != 'unknown' or r['reserved_micros'] is not None
               for r in (run, readiness, rules, continuation, fresh)):
            trial._block('second-history-invalid')
        snapshot = trial.digest(data)
        if self.prior_snapshot is not None and snapshot != self.prior_snapshot:
            trial._block('second-history-changed')
        return snapshot, x_preflight._json(fresh['result'])

    def _original(self):
        result = super()._original()
        if self.prior_snapshot is not None:
            self._prior()
        return result

    def initialize(self):
        self.stage = 'second-validation'
        validate(self.diagnostic, self.plan, self.clock())
        if not isinstance(self.db, sqlite3.Connection) or self.db.in_transaction or not callable(self.token_provider):
            trial._block('durable-ledger-required')
        location = self.db.execute('PRAGMA database_list').fetchone()
        if not location or not location[2] or (self.storage_preflight is None and not Path(location[2]).resolve().is_relative_to('/data')):
            trial._block('service-volume-required')
        self.frozen = x_preflight._json(trial._json(self.plan)); self.plan_sha = trial.digest(self.frozen)
        self.diagnostic_frozen = x_preflight._json(trial._json(self.diagnostic))
        self.diagnostic_sha = trial.digest(self.diagnostic_frozen)
        self.monotonic_end = self.monotonic() + (self._dispatch_end() - trial._utc(self.clock())).total_seconds()
        reserve = probe.storage_reserve(self.db, dict(self.frozen, max_reads=64, max_metadata_bytes=65536))
        self.required_storage = max(x_stream_rules.MIN_FREE_BYTES, probe.REVIEWED_STORAGE_FLOOR, reserve['required_free_bytes'])
        self._storage()
        self.db.execute('PRAGMA synchronous=FULL'); self.db.execute('PRAGMA busy_timeout=5000')
        if self.db.execute('PRAGMA synchronous').fetchone()[0] < 2:
            trial._block('durability-required')
        _schema(self.db)
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if self.db.execute('SELECT 1 FROM x_stream_second_diagnostic').fetchone():
                trial._block('second-already-used')
            if probe._table(self.db, 'x_stream_second_probe_run') and self.db.execute('SELECT 1 FROM x_stream_second_probe_run').fetchone():
                trial._block('second-already-used')
            self.original_snapshot, self.original_exposure, self.original_report = super()._original()
            self.prior_snapshot, self.prior_readiness = self._prior()
            self._guards()
            self.readiness_id = trial.digest(['x-stream-second-diagnostic-v1', self.diagnostic_sha])
            self.owner = 'second-diagnostic:' + self.readiness_id
            stamp = x_stream.stamp(self.clock()); c = self.diagnostic_frozen; p = self.frozen
            self.db.execute("INSERT INTO x_stream_second_diagnostic VALUES(1,?,?,?,?,?,?,NULL,'running',NULL,?,1000000,500000,'unknown')",
                (self.diagnostic_sha, self.plan_sha, c['original_probe_sha256'], c['approval_id'], c['approved_at'], stamp, self.prior_snapshot))
            self.db.execute("INSERT INTO x_stream_second_readiness VALUES(1,?,?,?,?,?,NULL,'running',0,'unknown',NULL,'{}')",
                (self.readiness_id, p['original_metadata_request_id'], p['original_metadata_result_sha256'], p['original_account_anchor_sha256'], stamp))
            self.db.execute('INSERT INTO x_stream_supervisor_owner VALUES(1,?,?)', (self.owner, stamp))
        self.claimed = True

    def _probe_config(self):
        config = super()._probe_config(); c = self.diagnostic_frozen
        end = min(self._dispatch_end() - timedelta(seconds=trial.SHUTDOWN_MARGIN_SECONDS),
                  trial._utc(self.clock()) + timedelta(seconds=c['max_probe_seconds']))
        config.update(probe_id=c['diagnostic_id'], approval_id=c['approval_id'], approved_at=c['approved_at'],
            end_at=x_stream.stamp(end), account_headroom_micros=c['account_headroom_micros'] - 1_000_000,
            local_aim_micros=c['local_aim_micros'], prior_exposure_bound_micros=0,
            rule_control_contingency_micros=c['metadata_contingency_micros'], stream_allowance_micros=c['stream_allowance_micros'])
        return config

    def _review_probe(self, config, exposure):
        self._validate_current_plan(); self._original(); self._storage(); self._fresh_check()
        record = self._one('x_stream_second_diagnostic')
        self._require_inventory(self.fresh['inventory'])
        claims = list(self.db.execute('SELECT path,cost_status,reserved_micros FROM x_stream_second_requests ORDER BY path'))
        return (config == self.probe_config and exposure == self.original_exposure
            and record['config_sha'] == self.diagnostic_sha and record['state'] == 'verified'
            and record['prior_snapshot_sha'] == self.prior_snapshot
            and [r[0] for r in claims] == sorted(x_preflight.PATHS)
            and all(r[1] == 'unknown' and r[2] is None for r in claims))

    async def run(self):
        if self.enabled is not True:
            return {'status': 'disabled', 'reason': 'x-trial-disabled'}
        result = {'status': 'blocked', 'reason': 'x-trial-internal-failure'}
        try:
            self.initialize()
            await self._readiness()
            with self.db:
                self.db.execute("UPDATE x_stream_second_diagnostic SET state='verified'")
            self.rule_result = {'inventory': self.fresh['inventory'], 'owner_released': True}
            self.probe_config = self._probe_config()
            self.stage = 'second-probe'
            result = await _SecondProbe(controller=self, db=self.db, enabled=True, config=self.probe_config,
                token_provider=self.token_provider, reviewed_admission=self._review_probe, storage_preflight=self._storage,
                transport_factory=self._stream_transport, stop_event=self.stop_event, clock=self.clock,
                monotonic=self.monotonic).run()
            result.update(control_cost_status='unknown', control_reserved_micros=None, cost_reconciled=False,
                second_readiness_requests_admitted=5, original_claims_unchanged=True, original_retained_micros=1_000_000,
                combined_retained_micros=1_000_000 + result.get('retained_reservation_micros', 500_000))
        except asyncio.CancelledError:
            result = {'status': 'blocked', 'reason': 'x-trial-interrupted'}
            raise
        except (trial.TrialBlocked, x_preflight.PreflightBlocked, x_stream_rules.RuleSetupBlocked) as exc:
            result = {'status': 'blocked', 'reason': str(exc)}
        except Exception as exc:
            result = {'status': 'blocked', 'reason': 'x-trial-internal-failure', 'stage': self.stage,
                      'error_class': trial._error_class(exc)}
        finally:
            if self.claimed:
                try:
                    with self.db:
                        self.db.execute('UPDATE x_stream_second_diagnostic SET state=?,reason=?,ended_at=?',
                            (result['status'], result.get('reason'), x_stream.stamp(self.clock())))
                        self.db.execute("UPDATE x_stream_second_readiness SET state='blocked' WHERE state='running'")
                except Exception as exc:
                    result = {'status': 'blocked', 'reason': 'x-trial-persistence-failed',
                              'stage': 'second-finalization', 'error_class': trial._error_class(exc)}
            self._log('second-result', result)
        return result
