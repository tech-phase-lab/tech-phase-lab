"""Explicitly reviewed, default-off X stream supervisor for the monitor service.

The feature flag alone is insufficient. A bounded, fresh preflight bundle and
shared budget must validate before lazy credential access or client creation.
"""
import asyncio
from contextlib import suppress
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import uuid

import monitor
import signals
import x_api
import x_budget
import x_stream

FLAG = 'X_FILTERED_STREAM_ENABLED'
BUNDLE_ENV = 'X_FILTERED_STREAM_PREFLIGHT_FILE'
MAX_BUNDLE_BYTES = 65536
TRUTH = {'1', 'true', 'yes'}


def requested(env=None):
    env = os.environ if env is None else env
    return str(env.get(FLAG, '')).strip().lower() in TRUTH


def manifest_sha():
    return hashlib.sha256(json.dumps(x_stream.manifest(), sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def load_bundle(env, now):
    """Read only the explicit non-secret operator bundle, never credentials."""
    if not requested(env):
        raise x_stream.StreamBlocked('x-stream-not-requested')
    if any(str(env.get(name, '')).strip().lower() not in TRUTH
           for name in ('X_API_ENABLED', 'RESEARCH_SIGNALS_ENABLED')):
        raise x_stream.StreamBlocked('x-stream-existing-intake-not-enabled')
    raw_path = env.get(BUNDLE_ENV, '')
    if not isinstance(raw_path, str) or not raw_path or len(raw_path) > 4096:
        raise x_stream.StreamBlocked('x-stream-preflight-missing')
    path = Path(raw_path)
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise x_stream.StreamBlocked('x-stream-preflight-path-invalid')
    try:
        with path.open('rb') as handle:
            raw = handle.read(MAX_BUNDLE_BYTES + 1)
        if len(raw) > MAX_BUNDLE_BYTES:
            raise ValueError
        bundle = json.loads(raw)
    except (OSError, ValueError, UnicodeDecodeError, RecursionError) as exc:
        raise x_stream.StreamBlocked('x-stream-preflight-invalid') from exc
    validate_bundle(bundle, now)
    return bundle, hashlib.sha256(raw).hexdigest()


def validate_bundle(bundle, now):
    required = {'version', 'approved', 'approval_id', 'approved_at', 'manifest_sha256',
                'verified_at', 'inventory', 'rules_complete', 'single_consumer_verified',
                'stream_entitlement_verified', 'spending_approved', 'budget',
                'initial_recovery_start', 'stream_allowance_micros', 'reconcile_seconds', 'fallback_seconds'}
    if not isinstance(bundle, dict) or set(bundle) != required or type(bundle['version']) is not int or bundle['version'] != 1:
        raise x_stream.StreamBlocked('x-stream-preflight-schema-invalid')
    if bundle['approved'] is not True or bundle['rules_complete'] is not True:
        raise x_stream.StreamBlocked('x-stream-preflight-unapproved')
    if not isinstance(bundle['approval_id'], str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}', bundle['approval_id']):
        raise x_stream.StreamBlocked('x-stream-approval-reference-invalid')
    current = x_budget.utc(now)
    approved = x_budget.utc(bundle['approved_at'])
    initial = x_budget.utc(bundle['initial_recovery_start'])
    if not current-timedelta(days=7) <= approved <= current or not current-timedelta(days=7) <= initial <= current:
        raise x_stream.StreamBlocked('x-stream-approved-window-invalid')
    if bundle['manifest_sha256'] != manifest_sha():
        raise x_stream.StreamBlocked('x-stream-reviewed-manifest-changed')
    activation_for(bundle).check(current, x_stream.manifest())
    policy = x_budget.validate_policy(bundle['budget'], current)
    # This rollout cannot expand the currently approved $20 account ceiling.
    if policy['account_cap_micros'] > 20_000_000 or policy['reserve_micros'] < 2_000_000:
        raise x_budget.BudgetBlocked('x-budget-rollout-cap-or-reserve-invalid')
    for key, low, high in (('stream_allowance_micros', 15000, 450000),
                           ('reconcile_seconds', 300, 86400), ('fallback_seconds', 30, 3600)):
        if type(bundle[key]) is not int or not low <= bundle[key] <= high:
            raise x_stream.StreamBlocked('x-stream-rollout-limit-invalid')
    if bundle['stream_allowance_micros'] > policy['daily_limit_micros']:
        raise x_budget.BudgetBlocked('x-budget-stream-allowance-invalid')
    return bundle


def activation_for(bundle):
    # Both integration attestations below are fulfilled by the service routing
    # and x_api legacy guard in this version, not by an unchecked operator claim.
    return x_stream.Activation(bundle['inventory'], bundle['verified_at'],
                               bundle['single_consumer_verified'], bundle['stream_entitlement_verified'],
                               bundle['spending_approved'], True, True)


def schema(db):
    x_stream.schema(db)
    db.executescript('''
      CREATE TABLE IF NOT EXISTS x_stream_runtime (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), started_at TEXT NOT NULL,
        last_window_end TEXT, last_reconcile_at TEXT, last_fallback_at TEXT);
      CREATE TABLE IF NOT EXISTS x_stream_supervisor_owner (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT NOT NULL, started_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS x_stream_search_retry (
        source_id TEXT PRIMARY KEY, retry_at TEXT NOT NULL, failures INTEGER NOT NULL);
    ''')


class Supervisor:
    def __init__(self, db_path, tickers, stop_event, wake, *, env=None, clock=None,
                 transport_factory=None, report=None):
        self.db_path, self.tickers, self.stop_event, self.wake = db_path, tickers, stop_event, wake
        self.env = os.environ if env is None else env
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.transport_factory = transport_factory
        self.report = report or (lambda _state: None)
        self.db = self.co = self.bundle = None
        self.bundle_fingerprint = None
        self.owner = 'techphase-' + uuid.uuid4().hex
        self.stream_task = None
        self.search_task = None
        self.invalid = False

    def refresh(self):
        bundle, fingerprint = load_bundle(self.env, self.clock())
        if self.bundle_fingerprint != fingerprint:
            x_budget.install_policy(self.db, bundle['budget'], self.clock())
            self.bundle_fingerprint = fingerprint
        self.bundle = bundle
        self.co.activation = activation_for(bundle)
        x_budget.policy_for(self.db, self.clock())
        self.invalid = False

    def initialize(self):
        if not requested(self.env):
            return False
        # Validate before opening DB, importing aiohttp, or looking up a token.
        bundle, fingerprint = load_bundle(self.env, self.clock())
        self.db = monitor.connect(self.db_path)
        schema(self.db)
        self.co = x_stream.Coordinator(self.db, self.tickers, enabled=True, offline=False,
                                       activation=activation_for(bundle), wake=self.wake, clock=self.clock)
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if (self.db.execute('SELECT 1 FROM x_stream_supervisor_owner').fetchone()
                    or self.db.execute('SELECT 1 FROM x_stream_owner').fetchone()):
                raise x_stream.StreamBlocked('x-stream-existing-owner-needs-review')
            self.db.execute('INSERT INTO x_stream_supervisor_owner VALUES(1,?,?)',
                            (self.owner, x_stream.stamp(self.clock())))
        try:
            x_budget.install_policy(self.db, bundle['budget'], self.clock())
        except Exception:
            with self.db:
                self.db.execute('DELETE FROM x_stream_supervisor_owner WHERE owner=?', (self.owner,))
            raise
        self.bundle, self.bundle_fingerprint = bundle, fingerprint
        with self.db:
            row = self.db.execute('SELECT * FROM x_stream_runtime WHERE singleton=1').fetchone()
            if not row:
                self.db.execute('INSERT INTO x_stream_runtime(singleton,started_at,last_window_end) VALUES(1,?,?)',
                                (x_stream.stamp(self.clock()), x_stream.stamp(bundle['initial_recovery_start'])))
        # An explicit finite bootstrap is owned by the bundle; never legacy 12h.
        self.add_window(self.clock(), initial=True)
        with self.db:
            state = self.db.execute('SELECT disconnected_since FROM x_stream_state WHERE singleton=1').fetchone()
            if not state[0]:
                boundary = self.db.execute('SELECT last_window_end FROM x_stream_runtime WHERE singleton=1').fetchone()[0]
                self.db.execute('UPDATE x_stream_state SET disconnected_since=? WHERE singleton=1', (boundary,))
        return True

    def admit(self, reservation):
        if self.invalid or self.stop_event.is_set():
            raise x_stream.StreamBlocked('x-stream-runtime-stopped')
        self.refresh()
        if not self.db.execute('SELECT 1 FROM x_stream_supervisor_owner WHERE owner=?', (self.owner,)).fetchone():
            raise x_stream.StreamBlocked('x-stream-supervisor-owner-lost')
        row = self.db.execute('SELECT * FROM x_budget_reservations WHERE id=?', (reservation,)).fetchone()
        now = x_budget.utc(self.clock())
        if (not row or row['state'] != 'open' or row['day'] != now.date().isoformat()
                or row['cycle'] != self.bundle['budget']['cycle_id']):
            raise x_budget.BudgetBlocked('x-budget-admission-inactive')
        if row['purpose'] == 'stream' and not self.db.execute(
                'SELECT 1 FROM x_stream_owner WHERE owner=? AND reservation_id=?', (self.owner, reservation)).fetchone():
            raise x_stream.StreamBlocked('x-stream-runtime-owner-lost')
        return True

    def client(self, reservation):
        # This point is reached only after full validation plus committed money
        # and (for stream) ownership admission. Tokens remain in this runtime.
        if self.transport_factory is None:
            from x_stream_transport import AiohttpTransport
            factory = AiohttpTransport
        else:
            factory = self.transport_factory
        return factory(enabled=True, admission=lambda: self.admit(reservation),
                       token_provider=lambda: self.env.get('X_BEARER_TOKEN', ''))

    def stream_factory(self, url, params):
        return self.client(self.co.reservation).stream_factory(url, params)

    def add_window(self, end, *, initial=False, fallback=False):
        current = x_budget.utc(end)
        row = self.db.execute('SELECT * FROM x_stream_runtime WHERE singleton=1').fetchone()
        if not row:
            return
        start = x_budget.utc(row['last_window_end'])
        # Recent Search requires a completed (not present-second) interval.
        frozen = current-timedelta(seconds=10)
        if frozen <= start:
            return
        self.co.open_gap(start, frozen)
        with self.db:
            self.db.execute('UPDATE x_stream_runtime SET last_window_end=?,last_reconcile_at=?,last_fallback_at=? WHERE singleton=1',
                            (x_stream.stamp(frozen), row['last_reconcile_at'] if fallback else x_stream.stamp(current),
                             x_stream.stamp(current) if fallback else row['last_fallback_at']))

    async def recover_once(self):
        self.refresh()
        if self.stop_event.is_set():
            return False
        state = self.db.execute('SELECT state FROM x_stream_state WHERE singleton=1').fetchone()[0]
        if state in {'entitlement-blocked', 'budget-paused', 'operator-blocked'}:
            return False
        # One page per call; lowest page count and oldest route attempt are fair.
        now = x_budget.utc(self.clock())
        rows = self.db.execute('''SELECT g.*,r.retry_at FROM x_stream_gaps g
          LEFT JOIN x_stream_search_retry r ON r.source_id=g.source_id
          WHERE g.status='pending' ORDER BY g.page_count,g.id''').fetchall()
        eligible = [row for row in rows if x_budget.utc(row['end_at']) <= now-timedelta(seconds=10)
                    and (not row['retry_at'] or x_budget.utc(row['retry_at']) <= now)]
        if not eligible:
            return False
        source_ids = list(dict.fromkeys(row['source_id'] for row in eligible))
        # Align with the existing request guard's least-served route choice.
        usage = {row['source_id']: row for row in self.db.execute('''SELECT source_id,COUNT(*) AS attempts,MAX(attempted_at) AS latest
          FROM signal_x_request_attempts WHERE julianday(attempted_at)>julianday(?) GROUP BY source_id''',
          ((now-timedelta(days=1)).isoformat(),))}
        source_id = min(source_ids, key=lambda key: (usage.get(key, {'attempts': 0})['attempts'],
                                                    usage.get(key, {'latest': ''})['latest'], source_ids.index(key)))
        gap = next(row for row in eligible if row['source_id'] == source_id)
        try:
            params = self.co.recovery_request(gap['id'], now)
        except x_stream.StreamBlocked:
            return False
        try:
            signals.reserve_x_api_request(self.db, self.co.sources[source_id], now,
                                          eligible_source_ids=source_ids, include_configuration=False)
        except (signals.XApiPacing, signals.XApiDailyLimit):
            return False
        reservation = x_budget.search_reservation(self.db, 30, now, purpose='recovery')
        try:
            payload = await self.client(reservation).search(x_api.API_URL, params)
            self.co.commit_recovery_page(gap['id'], payload, expected_token=gap['next_token'],
                                         reservation=reservation, received_at=self.clock())
            with self.db:
                self.db.execute('DELETE FROM x_stream_search_retry WHERE source_id=?', (source_id,))
            return True
        except asyncio.CancelledError as exc:
            with self.db:
                self.db.execute('BEGIN IMMEDIATE')
                delivered = getattr(exc, 'received_payload', None)
                if isinstance(delivered, dict):
                    x_budget.account_receipt(self.db, reservation, delivered, self.clock())
                self.db.execute("INSERT OR REPLACE INTO x_budget_stop VALUES(1,'cancelled-search-uncertainty')")
            raise
        except Exception as exc:
            delivered = getattr(exc, 'received_payload', None)
            if isinstance(delivered, dict):
                with self.db:
                    self.db.execute('BEGIN IMMEDIATE')
                    x_budget.account_receipt(self.db, reservation, delivered, self.clock())
                    self.db.execute("INSERT OR REPLACE INTO x_budget_stop VALUES(1,'received-search-cleanup-failed')")
            if isinstance(exc, x_stream.TransportFailure):
                status, quota = exc.status, exc.quota
                hint = exc.retry_after
                conflict = exc.connection_conflict
                ambiguity = getattr(exc, 'ambiguous_billing', False) or conflict
            else:
                # All transport failures are typed above. An unexpected parser,
                # storage or application fault cannot authorize a paid retry.
                status, quota, hint, ambiguity, conflict = None, False, 0, True, False
            terminal_status = status is not None and status != 429 and not 500 <= status <= 599
            if terminal_status or quota or ambiguity:
                with self.db:
                    self.db.execute("INSERT OR REPLACE INTO x_budget_stop VALUES(1,'search-provider-or-response-block')")
                if conflict:
                    self.co.fail(connection_conflict=True)
                elif terminal_status:
                    self.co.fail(status)
                else:
                    self.co.fail(402)
                return False
            prior = self.db.execute('SELECT failures FROM x_stream_search_retry WHERE source_id=?', (source_id,)).fetchone()
            failures = min(20, (prior[0] if prior else 0) + 1)
            seconds = min(3600, 30 * 2 ** (failures-1))
            if status == 429:
                seconds = max(60, seconds)
            if type(hint) in (float, int) and 0 <= hint <= 86400:
                seconds = max(seconds, hint)
            with self.db:
                self.db.execute('INSERT INTO x_stream_search_retry VALUES(?,?,?) ON CONFLICT(source_id) DO UPDATE SET retry_at=excluded.retry_at,failures=excluded.failures',
                                (source_id, x_stream.stamp(now+timedelta(seconds=seconds)), failures))
            return False
        finally:
            with self.db:
                x_budget.close_reservation(self.db, reservation)

    async def stop_stream(self):
        if self.stream_task:
            self.stream_task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await self.stream_task
            self.stream_task = None

    async def stop_search(self):
        if self.search_task:
            self.search_task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await self.search_task
            self.search_task = None

    async def run_async(self):
        try:
            if not self.initialize():
                return
            while not self.stop_event.is_set():
                try:
                    self.refresh()
                    self.co.drain()
                    if self.stream_task and self.stream_task.done():
                        try:
                            self.stream_task.result()
                        except x_budget.BudgetBlocked:
                            self.co.fail(402)
                        except Exception:
                            self.co.fail(400)
                        self.stream_task = None
                    state = self.db.execute('SELECT * FROM x_stream_state WHERE singleton=1').fetchone()
                    if not self.stream_task and state['state'] not in {'entitlement-blocked', 'operator-blocked', 'budget-paused'}:
                        if not state['retry_at'] or x_budget.utc(state['retry_at']) <= x_budget.utc(self.clock()):
                            self.stream_task = asyncio.create_task(self.co.run_once(
                                self.stream_factory, owner=self.owner, allowance_micros=self.bundle['stream_allowance_micros']))
                    timing = self.db.execute('SELECT * FROM x_stream_runtime WHERE singleton=1').fetchone()
                    now = x_budget.utc(self.clock())
                    if state['state'] == 'retrying':
                        if not timing['last_fallback_at'] or now-x_budget.utc(timing['last_fallback_at']) >= timedelta(seconds=self.bundle['fallback_seconds']):
                            self.add_window(now, fallback=True)
                    elif state['state'] == 'connected-quiet':
                        if not timing['last_reconcile_at'] or now-x_budget.utc(timing['last_reconcile_at']) >= timedelta(seconds=self.bundle['reconcile_seconds']):
                            self.add_window(now)
                    # Slow Search must not delay raw-stream projection or
                    # publication wakes. Both tasks use this one event loop;
                    # all SQLite transactions remain synchronous and serialized.
                    if self.search_task and self.search_task.done():
                        self.search_task.result()
                        self.search_task = None
                    if not self.search_task:
                        self.search_task = asyncio.create_task(self.recover_once())
                    self.report(self.co.health())
                except (x_budget.BudgetBlocked, x_stream.StreamBlocked, OSError, ValueError):
                    self.invalid = True
                    await self.stop_stream()
                    await self.stop_search()
                    self.report({'mode': 'operator-blocked', 'reason': 'preflight-or-budget-blocked'})
                await asyncio.sleep(.5)
        except (x_budget.BudgetBlocked, x_stream.StreamBlocked, OSError, ValueError):
            self.report({'mode': 'operator-blocked', 'reason': 'preflight-or-budget-blocked'})
        except Exception:
            self.report({'mode': 'operator-blocked', 'reason': 'runtime-failed'})
        finally:
            await self.stop_stream()
            await self.stop_search()
            if self.co:
                with suppress(Exception):
                    self.co.drain()
            if self.db:
                with self.db:
                    self.db.execute('DELETE FROM x_stream_supervisor_owner WHERE owner=?', (self.owner,))
                self.db.close()
                self.db = None

    def run(self):
        if not requested(self.env):
            return  # No event loop, DB, preflight file, token, or client on OFF.
        asyncio.run(self.run_async())
