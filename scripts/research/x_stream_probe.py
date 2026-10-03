"""Default-OFF PAID, one-connection receive-only experiment (never publication).

There is deliberately no environment/service wiring or live configuration here.
An operator must supply validate_config's exact evidence and a separately reviewed
``reviewed_admission(config, metadata_exposure) -> True`` implementation. That
callback is the integration boundary for the account-wide budget anchor and for
ongoing polling exposure; this module cannot infer either from a credit balance.
It executes under BEGIN IMMEDIATE, must be local/read-only and must not commit.

Only x_stream_probe_* tables store this experiment. The compatible supervisor
owner row excludes metadata/migration workers, without creating their migration
marker or changing ordinary polling. The singleton reservation is never reused,
even after a crash before token access. Unknown cost and all unused reservations
remain exposure. The local AIM is not a provider cap: data already in flight and
unmeterable/unknown fees can exceed it. Metadata/control calls are not assumed free.
When prior/control cost is unknown, its numeric admission contingency is NOT a
verified billing upper bound; the review callback must preserve that distinction.
"""
import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import time

import x_budget
import x_stream

MAX_AIM_MICROS = 1_000_000
MAX_SECONDS = 900
MAX_ROWS = 128
MAX_METADATA_BYTES = 64 * 1024
MAX_WIRE_BYTES = 512 * 1024
READ_BYTES = 4096
MAX_METADATA_ROW_BYTES = 1024
MIN_BASELINE_MARGIN = 8 * 1024 * 1024
REVIEWED_STORAGE_FLOOR = 8 * 1024 * 1024  # The measured page-based reserve plus baseline margin is mandatory.
MAX_READS = 128  # Bound metadata/WAL write amplification from tiny fragments.
PARAMS = {'tweet.fields': 'created_at,author_id,referenced_tweets',
          'expansions': 'author_id', 'user.fields': 'username'}
ACCOUNTS = {'x-wallstengine': frozenset(('wallstengine', 'tipranks', 'fabymetal4')),
            'x-nebius-official': frozenset(('nebiusai',)),
            'x-trendspider': frozenset(('trendspider',)),
            'x-barchart': frozenset(('barchart',))}
REQUIRED = frozenset(('version', 'probe_id', 'approval_id', 'approved_at', 'verified_at', 'end_at',
    'manifest_sha256', 'inventory', 'rules_complete', 'stream_attempt_approved',
    'single_consumer_verified', 'account_cap_verified', 'account_cap_micros', 'account_headroom_micros',
    'auto_recharge_disabled_verified', 'spending_approved', 'prices_verified',
    'post_micros', 'user_micros', 'pricing_evidence_ref', 'budget_anchor_ref',
    'reconciliation_evidence_ref', 'local_aim_micros', 'prior_exposure_bound_micros',
    'polling_contingency_micros', 'rule_control_contingency_micros', 'stream_allowance_micros',
    'unknown_prior_cost_approved', 'control_cost_unknown', 'max_reads', 'baseline_service_margin_bytes', 'storage_evidence_ref', 'max_rows', 'max_metadata_bytes', 'max_wire_bytes'))


class ProbeBlocked(ValueError):
    """Only fixed internal reason codes may reach reports."""


def _block(code):
    raise ProbeBlocked('x-probe-' + code) from None


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)


def _digest(value):
    return hashlib.sha256(_json(value).encode()).hexdigest()


def _utc(value):
    result = x_budget.utc(value)
    original = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace('Z', '+00:00'))
    if original.utcoffset() != timedelta(0):
        _block('utc-required')
    return result


def _integer(value, low=0, high=10**12):
    if type(value) is not int or not low <= value <= high:
        _block('integer-invalid')
    return value


def manifest_sha():
    return _digest(x_stream.manifest())


def validate_config(value, now):
    """Validate operator evidence, not an entitlement/billing discovery API.

    References are opaque non-secret review IDs, never credentials or provider
    error strings. No evidence field has a permissive default. Unit prices are
    supplied explicitly; the synthetic tests do not establish live prices.
    """
    if type(value) is not dict or set(value) != REQUIRED or type(value['version']) is not int or value['version'] != 1:
        _block('configuration-invalid')
    if len(_json(value).encode()) > 32768:
        _block('configuration-too-large')
    for key in ('probe_id', 'approval_id', 'pricing_evidence_ref', 'budget_anchor_ref', 'reconciliation_evidence_ref', 'storage_evidence_ref'):
        if type(value[key]) is not str or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}', value[key]):
            _block('evidence-reference-invalid')
    for key in ('rules_complete', 'stream_attempt_approved', 'single_consumer_verified',
                'account_cap_verified', 'auto_recharge_disabled_verified', 'spending_approved', 'prices_verified'):
        if value[key] is not True:
            _block('evidence-unverified')
    if any(type(value[k]) is not bool for k in ('unknown_prior_cost_approved', 'control_cost_unknown')):
        _block('unknown-cost-approval-invalid')
    current, approved, verified, end = map(_utc, (now, value['approved_at'], value['verified_at'], value['end_at']))
    if (not current - timedelta(days=7) <= approved <= current or not verified <= current < end
            or end > verified + timedelta(seconds=MAX_SECONDS)
            or end.date() != current.date() or verified.date() != current.date()):
        _block('deadline-or-evidence-invalid')
    if value['manifest_sha256'] != manifest_sha():
        _block('manifest-changed')
    x_stream.verified_rule_map(value['inventory'], x_stream.manifest())
    _integer(value['account_cap_micros'], 1, 20_000_000)
    _integer(value['local_aim_micros'], 1, MAX_AIM_MICROS)
    _integer(value['account_headroom_micros'], 1, value['account_cap_micros'])
    _integer(value['polling_contingency_micros'], 0, value['account_headroom_micros'])
    for key in ('prior_exposure_bound_micros', 'rule_control_contingency_micros'):
        _integer(value[key], 0, MAX_AIM_MICROS)
    for key in ('post_micros', 'user_micros', 'stream_allowance_micros'):
        _integer(value[key], 1, MAX_AIM_MICROS)
    incremental = sum(value[key] for key in ('prior_exposure_bound_micros',
                                             'rule_control_contingency_micros', 'stream_allowance_micros'))
    if (incremental > value['local_aim_micros']
            or incremental + value['polling_contingency_micros'] > value['account_headroom_micros']):
        _block('aim-exceeded')
    if value['stream_allowance_micros'] < value['post_micros'] + value['user_micros']:
        _block('allowance-too-small')
    _integer(value['max_reads'], 1, MAX_READS)
    _integer(value['baseline_service_margin_bytes'], MIN_BASELINE_MARGIN, 64 * 1024 * 1024)
    _integer(value['max_rows'], 1, MAX_ROWS)
    _integer(value['max_metadata_bytes'], 1024, MAX_METADATA_BYTES)
    _integer(value['max_wire_bytes'], READ_BYTES, MAX_WIRE_BYTES)
    return value


def storage_reserve(db, config):
    """Operational headroom, NOT a guaranteed physical SQLite/WAL bound.

    The 64-pages/read estimate budgets both metadata commits, B-tree growth and
    setup/finalization; measured no-checkpoint stress is in the offline tests.
    Other writers/backups are not paid from this envelope. A separately reviewed
    baseline-service margin and stable backup behavior are mandatory at launch.
    """
    page_size = db.execute('PRAGMA page_size').fetchone()[0]
    if type(page_size) is not int or not 512 <= page_size <= 65536 or page_size & (page_size - 1):
        _block('sqlite-page-size-invalid')
    reads = _integer(config['max_reads'], 1, MAX_READS)
    metadata = _integer(config['max_metadata_bytes'], 1024, MAX_METADATA_BYTES)
    margin = _integer(config['baseline_service_margin_bytes'], MIN_BASELINE_MARGIN, 64 * 1024 * 1024)
    operational = max(8 * 1024 * 1024, (reads + 4) * 64 * page_size + 4 * metadata)
    return {'sqlite_page_size': page_size, 'probe_operational_bytes': operational,
            'baseline_service_margin_bytes': margin, 'required_free_bytes': operational + margin}


def _table(db, name):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def metadata_exposure(db):
    """Retain unknowns and fingerprint all prior claims; do not erase/reconcile."""
    if not _table(db, 'x_metadata_preflight_runs'):
        return {'known_reserved_micros': 0, 'unknown_runs': 0, 'runs': 0, 'fingerprint': _digest([])}
    rows = list(db.execute('SELECT request_id,approval_id,reserved_micros,cost_status,requests_admitted,status '
                           'FROM x_metadata_preflight_runs ORDER BY request_id'))
    if len(rows) > 1024:
        _block('metadata-ledger-too-large')
    known, unknown = 0, 0
    for row in rows:
        if row[5] in ('reserved', 'running') or row[5] not in ('verified', 'observed', 'blocked'):
            _block('metadata-worker-owned')
        if row[3] == 'unknown' and row[2] is None:
            unknown += 1
        elif row[3] == 'bounded':
            known += _integer(row[2], 1)
        else:
            _block('metadata-ledger-invalid')
    return {'known_reserved_micros': known, 'unknown_runs': unknown, 'runs': len(rows),
            'fingerprint': _digest([list(row) for row in rows])}


def _schema(db):
    # No call to x_stream.schema/signals.schema, and never a runtime marker.
    db.executescript('''
      CREATE TABLE IF NOT EXISTS x_stream_probe_run (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), config_sha TEXT NOT NULL,
        probe_id TEXT NOT NULL, approval_id TEXT NOT NULL, end_at TEXT NOT NULL,
        started_at TEXT NOT NULL, connected_at TEXT, ended_at TEXT, state TEXT NOT NULL, reason TEXT,
        local_aim_micros INTEGER NOT NULL, retained_reservation_micros INTEGER NOT NULL,
        prior_bound_micros INTEGER NOT NULL, prior_cost_unknown INTEGER NOT NULL,
        control_cost_unknown INTEGER NOT NULL,
        polling_contingency_micros INTEGER NOT NULL, control_contingency_micros INTEGER NOT NULL,
        stream_allowance_micros INTEGER NOT NULL, post_micros INTEGER NOT NULL, user_micros INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, receipts INTEGER NOT NULL DEFAULT 0,
        posts INTEGER NOT NULL DEFAULT 0, users INTEGER NOT NULL DEFAULT 0,
        delivered_estimate_micros INTEGER NOT NULL DEFAULT 0,
        read_calls INTEGER NOT NULL DEFAULT 0, wire_bytes INTEGER NOT NULL DEFAULT 0, metadata_bytes INTEGER NOT NULL DEFAULT 0,
        dropped_rows INTEGER NOT NULL DEFAULT 0, unknown_delivery INTEGER NOT NULL DEFAULT 0,
        close_confirmed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS x_stream_probe_receipts (
        sequence INTEGER PRIMARY KEY, source_ids TEXT NOT NULL, verified_source_ids TEXT NOT NULL,
        post_id_or_hash TEXT NOT NULL, post_created_at TEXT, raw_received_at TEXT NOT NULL,
        durable_received_at TEXT, posts INTEGER NOT NULL, users INTEGER NOT NULL,
        query_match INTEGER NOT NULL, source_author_verified INTEGER NOT NULL, quote INTEGER NOT NULL,
        raw_latency_ms INTEGER, durable_latency_ms INTEGER);
      CREATE TABLE IF NOT EXISTS x_stream_supervisor_owner (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT NOT NULL, started_at TEXT NOT NULL);
    ''')


class _Decoder(x_stream.Decoder):
    """Keep reviewed framing limits; also reject duplicate keys/NaN/Infinity.

    An invalid line is removed before raising so its already-returned complete
    tail can still be metered. Partial or malformed bytes remain unknown cost.
    """
    def feed(self, chunk):
        if not isinstance(chunk, bytes) or len(chunk) > 65536:
            _block('chunk-invalid')
        self.buffer.extend(chunk)
        while b'\n' in self.buffer:
            line, _, rest = self.buffer.partition(b'\n')
            self.buffer = bytearray(rest)
            if len(line) > x_stream.MAX_FRAME_BYTES:
                _block('frame-too-large')
            if not line.strip():
                continue
            def unique(pairs):
                result = {}
                for key, value in pairs:
                    if key in result:
                        raise ValueError
                    result[key] = value
                return result
            def invalid_constant(_value):
                raise ValueError
            try:
                value = json.loads(line, object_pairs_hook=unique, parse_constant=invalid_constant)
                if not isinstance(value, dict):
                    raise ValueError
            except (ValueError, UnicodeDecodeError, RecursionError):
                _block('frame-invalid')
            yield value
        if len(self.buffer) > x_stream.MAX_FRAME_BYTES:
            _block('frame-too-large')


class Probe:
    def __init__(self, *, db=None, enabled=False, config=None, token_provider=None,
                 reviewed_admission=None, clock=None, monotonic=None, stop_event=None,
                 storage_preflight=None, transport_factory=None):
        self.db, self.enabled, self.config = db, enabled, config
        self.token_provider, self.reviewed_admission = token_provider, reviewed_admission
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.monotonic = monotonic or time.monotonic
        self.stop_event, self.storage_preflight = stop_event, storage_preflight
        self.transport_factory = transport_factory
        self.frozen = self.fingerprint = self.exposure = self.rule_map = None
        self.end = self.monotonic_end = None
        self.required_storage = None
        self.owner = None
        self.attempted = self.claimed = self.delivery_unknown = False
        self.reason = None
        self.pending_read = None
        self.connection_task = None
        self.connection_entered = self.connection_closed = False
        self.decoder = _Decoder()

    def _check_ownership(self, ours=False):
        if _table(self.db, 'x_budget_stop') and self.db.execute('SELECT 1 FROM x_budget_stop LIMIT 1').fetchone():
            _block('account-budget-stop-present')
        if (_table(self.db, 'x_stream_state') and self.db.execute(
                "SELECT 1 FROM x_stream_state WHERE state IN ('entitlement-blocked','budget-paused','operator-blocked')").fetchone()):
            _block('account-stream-stop-present')
        for table in ('x_stream_runtime', 'x_stream_owner'):
            if _table(self.db, table) and self.db.execute('SELECT 1 FROM ' + table + ' LIMIT 1').fetchone():
                _block('active-migration-present')
        row = self.db.execute('SELECT owner FROM x_stream_supervisor_owner').fetchone()
        if row and (not ours or row[0] != self.owner) or ours and not row:
            _block('another-owner-present')
        if _table(self.db, 'x_stream_pilot') and self.db.execute("SELECT 1 FROM x_stream_pilot WHERE state='running'").fetchone():
            _block('active-migration-present')

    def initialize(self):
        if self.enabled is not True:
            return False
        validate_config(self.config, self.clock())
        if not callable(self.reviewed_admission) or not callable(self.token_provider):
            _block('reviewed-admission-required')
        if not isinstance(self.db, sqlite3.Connection) or self.db.in_transaction:
            _block('durable-ledger-required')
        location = self.db.execute('PRAGMA database_list').fetchone()
        if not location or not location[2]:
            _block('durable-ledger-required')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('PRAGMA busy_timeout=5000')
        if self.db.execute('PRAGMA synchronous').fetchone()[0] < 2:
            _block('durability-required')
        if self.storage_preflight is None and not Path(location[2]).resolve().is_relative_to('/data'):
            _block('service-volume-required')
        reserve = storage_reserve(self.db, self.config)
        self.required_storage = max(REVIEWED_STORAGE_FLOOR, reserve['required_free_bytes'])
        self._check_storage()
        self.frozen = json.loads(_json(self.config))
        self.fingerprint = _digest(self.frozen)
        self.end = _utc(self.frozen['end_at'])
        remaining = (self.end - _utc(self.clock())).total_seconds()
        mono = self.monotonic()
        if not math.isfinite(mono) or not 0 < remaining <= MAX_SECONDS:
            _block('deadline-invalid')
        self.monotonic_end = mono + remaining
        self.rule_map = x_stream.verified_rule_map(self.frozen['inventory'], x_stream.manifest())
        self.owner = 'receive-probe:' + self.fingerprint
        _schema(self.db)
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if self.db.execute('SELECT 1 FROM x_stream_probe_run').fetchone():
                _block('already-used')
            self._check_ownership()
            self._check_storage()
            exposure = metadata_exposure(self.db)
            if exposure['known_reserved_micros'] > self.frozen['prior_exposure_bound_micros']:
                _block('prior-exposure-uncovered')
            if exposure['unknown_runs'] and (self.frozen['unknown_prior_cost_approved'] is not True
                                               or self.frozen['prior_exposure_bound_micros'] == 0):
                _block('prior-unknown-cost-unapproved')
            # The integration MUST validate the reviewed account-wide anchor,
            # continuing ordinary polling and any unknown preflight-cost bound.
            if self.reviewed_admission(json.loads(_json(self.frozen)), dict(exposure)) is not True:
                _block('reviewed-admission-required')
            if not self.db.in_transaction:
                _block('reviewed-admission-committed')
            self._check_ownership()
            if metadata_exposure(self.db) != exposure:
                _block('metadata-changed')
            validate_config(self.config, self.clock())
            if _digest(self.config) != self.fingerprint:
                _block('configuration-changed')
            self.exposure = exposure
            c = self.frozen
            reserve = sum(c[key] for key in ('prior_exposure_bound_micros',
                                             'rule_control_contingency_micros', 'stream_allowance_micros'))
            self.db.execute('INSERT INTO x_stream_probe_run '
                '(singleton,config_sha,probe_id,approval_id,end_at,started_at,state,local_aim_micros,'
                'retained_reservation_micros,prior_bound_micros,prior_cost_unknown,control_cost_unknown,polling_contingency_micros,'
                'control_contingency_micros,stream_allowance_micros,post_micros,user_micros) '
                'VALUES(1,?,?,?,?,?,\'reserved\',?,?,?,?,?,?,?,?,?,?)',
                (self.fingerprint, c['probe_id'], c['approval_id'], c['end_at'], x_stream.stamp(self.clock()),
                 c['local_aim_micros'], reserve, c['prior_exposure_bound_micros'], bool(exposure['unknown_runs']), c['control_cost_unknown'],
                 c['polling_contingency_micros'], c['rule_control_contingency_micros'], c['stream_allowance_micros'],
                 c['post_micros'], c['user_micros']))
            self.db.execute('INSERT INTO x_stream_supervisor_owner VALUES(1,?,?)', (self.owner, x_stream.stamp(self.clock())))
        self.claimed = True
        return True

    def _check_storage(self):
        if self.storage_preflight is None:
            from x_preflight import local_free_space
            storage = local_free_space(minimum_free_bytes=self.required_storage)
        else:
            storage = self.storage_preflight()
        if (type(storage) is not dict or storage.get('metadata_storage_sufficient') is not True
                or type(storage.get('available_bytes')) is not int
                or storage['available_bytes'] < self.required_storage):
            _block('storage-preflight-failed')

    def _stopped(self):
        if self.reason:
            return True
        if self.stop_event is not None and self.stop_event.is_set():
            self.reason = 'operator-stop'
        elif (_utc(self.clock()) >= self.end or self.monotonic() >= self.monotonic_end
              or _utc(self.clock()).date() != _utc(self.frozen['verified_at']).date()):
            self.reason = 'deadline'
        elif _digest(self.config) != self.fingerprint:
            self.reason = 'configuration-changed'
        if self.reason is None and self.claimed:
            try:
                self._check_ownership(ours=True)
                if metadata_exposure(self.db) != self.exposure:
                    self.reason = 'metadata-changed'
            except Exception:
                self.reason = 'ownership-check-failed'
        return self.reason is not None

    def _admit(self):
        if not self.claimed or self.attempted or self.db.in_transaction or self._stopped():
            return False
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            self._check_ownership(ours=True)
            self._check_storage()
            if metadata_exposure(self.db) != self.exposure:
                _block('metadata-changed')
            row = self.db.execute('SELECT config_sha,attempts,state FROM x_stream_probe_run').fetchone()
            if not row or row[0] != self.fingerprint or row[1] != 0 or row[2] != 'reserved':
                _block('admission-inactive')
            self.db.execute("UPDATE x_stream_probe_run SET attempts=1,state='running' WHERE singleton=1")
        self.attempted = True
        return True

    def _resources(self, payload):
        try:
            resources = x_budget.payload_resources(payload)
            return sum(k == 'post' for k, _ in resources), sum(k == 'user' for k, _ in resources), False
        except x_budget.BudgetBlocked:
            # Count every identifiable returned post/user even when IDs/errors
            # make billing ambiguous. Unpriced resource types remain unknown.
            data, includes = payload.get('data'), payload.get('includes')
            posts = 1 if isinstance(data, dict) else len(data) if isinstance(data, list) else 0
            users = 0
            if isinstance(includes, dict):
                users = len(includes['users']) if isinstance(includes.get('users'), list) else 0
                for name in ('tweets', 'posts'):
                    posts += len(includes[name]) if isinstance(includes.get(name), list) else 0
            return posts, users, True

    def _record(self, payload, raw_at):
        posts, users, unknown = self._resources(payload)
        post = payload.get('data')
        unknown |= not isinstance(post, dict)
        post = post if isinstance(post, dict) else {}
        matched = payload.get('matching_rules')
        selected = set()
        rules_valid = isinstance(matched, list) and 1 <= len(matched) <= len(self.rule_map)
        if rules_valid:
            for rule in matched:
                if not isinstance(rule, dict) or not isinstance(rule.get('id'), str) or rule['id'] not in self.rule_map:
                    rules_valid = False
                else:
                    selected.add(self.rule_map[rule['id']])
        if not rules_valid:
            self.reason = self.reason or 'unowned-or-invalid-rule'
        included = payload.get('includes', {})
        returned_users = included.get('users', []) if isinstance(included, dict) else []
        authors = [u for u in returned_users if isinstance(u, dict) and u.get('id') == post.get('author_id')] if isinstance(returned_users, list) else []
        username = authors[0].get('username') if len(authors) == 1 else None
        verified = {s for s in selected if isinstance(username, str) and username.lower() in ACCOUNTS[s]}
        # Current responses use referenced_posts while the request field and
        # older responses retain referenced_tweets. Ambiguous aliases are never
        # evidence that an outer post is an original source publication.
        refs = post.get('referenced_posts', post.get('referenced_tweets', []))
        variants = [post[name] for name in ('referenced_posts', 'referenced_tweets') if name in post]
        quote = any(isinstance(v, dict) and v.get('type') == 'quoted'
                    for values in variants if isinstance(values, list) for v in values)
        conflict = len(variants) == 2 and variants[0] != variants[1]
        refs_valid = (not conflict and isinstance(refs, list)
                      and all(isinstance(v, dict) and v.get('type') in ('quoted', 'replied_to', 'retweeted')
                              for v in refs))
        created, raw_latency = None, None
        try:
            dt = _utc(post.get('created_at'))
            created = x_stream.stamp(dt)
            latency = (_utc(raw_at) - dt).total_seconds() * 1000
            if 0 <= latency <= 7 * 86400 * 1000:
                raw_latency = round(latency)
        except (ValueError, TypeError, OverflowError):
            pass
        identity = post.get('id')
        if type(identity) is not str or not re.fullmatch('[0-9]{1,32}', identity):
            identity = 'sha256:' + _digest(payload)
        # Query matches and approved ORIGINAL source samples are distinct.
        # Never attribute a quote's outer-created timestamp to its quoted source.
        sample = bool(verified and rules_valid and refs_valid and not refs and not unknown and created and raw_latency is not None)
        item = {'source_ids': sorted(selected), 'verified_source_ids': sorted(verified),
                'post_id_or_hash': identity, 'post_created_at': created, 'raw_received_at': x_stream.stamp(raw_at),
                'posts': posts, 'users': users, 'query_match': bool(rules_valid),
                'source_author_verified': sample, 'quote': quote, 'raw_latency_ms': raw_latency}
        return item, unknown

    def _meter(self, chunk, raw_at):
        """Consume the entire returned chunk, even after any local stop is hit."""
        if not isinstance(chunk, bytes) or len(chunk) > READ_BYTES:
            self.reason = 'invalid-read'
            with self.db:
                self.db.execute('UPDATE x_stream_probe_run SET unknown_delivery=1')
            return
        items, ambiguous = [], False
        incoming = chunk
        while True:
            try:
                for payload in self.decoder.feed(incoming):
                    item, unknown = self._record(payload, raw_at)
                    items.append(item)
                    ambiguous |= unknown
                break
            except (x_stream.StreamBlocked, ValueError, TypeError, OverflowError):
                ambiguous = True
                self.reason = self.reason or 'ambiguous-delivery'
                # Decoder removed the invalid completed line; parse complete tail
                # already returned by this read. Never fetch a replacement chunk.
                incoming = b''
                if b'\n' not in self.decoder.buffer:
                    break
        if ambiguous:
            self.reason = self.reason or 'ambiguous-delivery'
        inserted = []
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            row = self.db.execute('SELECT receipts,metadata_bytes,delivered_estimate_micros,wire_bytes '
                                  ',read_calls FROM x_stream_probe_run').fetchone()
            sequence, metadata_bytes, spend, wire, read_calls = row
            for item in items:
                sequence += 1
                charge = item['posts'] * self.frozen['post_micros'] + item['users'] * self.frozen['user_micros']
                spend += charge
                # Reserve space for commit-observed timestamp/latency and SQLite
                # row bookkeeping, even before the second acknowledgement commit.
                size = len(_json(item).encode()) + 256
                store = (size <= MAX_METADATA_ROW_BYTES and sequence <= self.frozen['max_rows']
                         and metadata_bytes + size <= self.frozen['max_metadata_bytes'])
                if store:
                    metadata_bytes += size
                    self.db.execute('INSERT INTO x_stream_probe_receipts VALUES(?,?,?,?,?,?,NULL,?,?,?,?,?,?,NULL)',
                        (sequence, _json(item['source_ids']), _json(item['verified_source_ids']), item['post_id_or_hash'],
                         item['post_created_at'], item['raw_received_at'], item['posts'], item['users'],
                         item['query_match'], item['source_author_verified'], item['quote'], item['raw_latency_ms']))
                    inserted.append((sequence, item['post_created_at']))
                else:
                    self.reason = self.reason or 'metadata-bound'
                self.db.execute('UPDATE x_stream_probe_run SET posts=posts+?,users=users+?,dropped_rows=dropped_rows+?',
                                (item['posts'], item['users'], int(not store)))
            wire += len(chunk)
            self.db.execute('UPDATE x_stream_probe_run SET receipts=?,metadata_bytes=?,delivered_estimate_micros=?,'
                            'wire_bytes=?,read_calls=read_calls+1,unknown_delivery=MAX(unknown_delivery,?),'
                            'retained_reservation_micros=prior_bound_micros+control_contingency_micros+'
                            'MAX(stream_allowance_micros,?)',
                            (sequence, metadata_bytes, spend, wire, int(ambiguous), spend))
        # This timestamp observes completion of the FIRST durable metadata
        # commit. A crash before this acknowledgement leaves NULL, not a lie.
        durable_at = _utc(self.clock())
        with self.db:
            for sequence, created in inserted:
                latency = round((durable_at - _utc(created)).total_seconds() * 1000) if created else None
                if latency is not None and latency < 0:
                    latency = None
                self.db.execute('UPDATE x_stream_probe_receipts SET durable_received_at=?,durable_latency_ms=? WHERE sequence=?',
                                (x_stream.stamp(durable_at), latency, sequence))
        if spend >= self.frozen['stream_allowance_micros']:
            self.reason = self.reason or 'stream-allowance'
        if wire >= self.frozen['max_wire_bytes']:
            self.reason = self.reason or 'wire-bound'
        if read_calls + 1 >= self.frozen['max_reads']:
            self.reason = self.reason or 'read-bound'
        if sequence >= self.frozen['max_rows'] or metadata_bytes + 1024 > self.frozen['max_metadata_bytes']:
            self.reason = self.reason or 'metadata-bound'

    async def _settle_read(self):
        # The pinned aiohttp reader cooperates with cancellation; arbitrary
        # noncooperative injected readers are outside this shutdown guarantee.
        task, self.pending_read = self.pending_read, None
        if task is None:
            return None
        if not task.done():
            task.cancel()
        # Cancellation/timeout races may already have delivered a complete read.
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        if task.cancelled():
            self.delivery_unknown = True
            return None
        try:
            return task.result()
        except Exception:
            self.delivery_unknown = True
            self.reason = self.reason or 'transport-error'
            return None

    async def _read(self, reader):
        chunk = await reader.read(READ_BYTES)
        return chunk, self.clock()

    async def _receive(self, reader):
        while not self._stopped():
            try:
                self._check_storage()
            except Exception:
                self.reason = 'storage-low-or-unavailable'
                return
            self.pending_read = asyncio.create_task(self._read(reader))
            read_start = self.monotonic()
            while not self.pending_read.done() and not self._stopped():
                remaining = min(self.monotonic_end - self.monotonic(),
                                (self.end - _utc(self.clock())).total_seconds(),
                                x_stream.HEARTBEAT_SECONDS - (self.monotonic() - read_start))
                if remaining <= 0:
                    self.reason = self.reason or 'heartbeat-or-deadline'
                    break
                await asyncio.wait({self.pending_read}, timeout=min(0.25, remaining))
            returned = await self._settle_read()
            if returned is not None:
                chunk, received_at = returned
                if chunk:
                    self._meter(chunk, received_at)
                else:
                    self.reason = self.reason or 'remote-close'
            elif not self.reason:
                self.reason = 'transport-error'

    def report(self):
        if not self.claimed:
            return {'status': 'disabled' if self.enabled is not True else 'blocked',
                    'reason': self.reason or 'not-admitted'}
        row = self.db.execute('SELECT state,reason,attempts,receipts,posts,users,delivered_estimate_micros,'
            'local_aim_micros,retained_reservation_micros,prior_bound_micros,prior_cost_unknown,control_cost_unknown,'
            'polling_contingency_micros,control_contingency_micros,stream_allowance_micros,'
            'read_calls,wire_bytes,metadata_bytes,dropped_rows,unknown_delivery,close_confirmed,connected_at FROM x_stream_probe_run').fetchone()
        keys = ('status', 'reason', 'connection_attempts', 'complete_deliveries', 'post_resources', 'user_resources',
                'delivered_estimate_micros', 'local_aim_micros', 'retained_reservation_micros', 'prior_bound_micros',
                'prior_cost_unknown', 'control_cost_unknown', 'polling_contingency_micros', 'rule_control_contingency_micros',
                'stream_allowance_micros', 'read_calls', 'wire_bytes', 'metadata_bytes', 'metadata_rows_dropped',
                'unknown_delivery', 'close_confirmed', 'connected_at')
        result = dict(zip(keys, row))
        result['stream_entitlement_verified'] = result['connected_at'] is not None
        result['entitlement_scope'] = 'this-connection-attempt-only'
        samples = self.db.execute('SELECT COUNT(*),MIN(durable_latency_ms),MAX(durable_latency_ms) '
                                 'FROM x_stream_probe_receipts WHERE source_author_verified=1 '
                                 'AND durable_latency_ms IS NOT NULL').fetchone()
        result.update(source_original_latency_samples=samples[0], source_to_durable_min_ms=samples[1],
                      source_to_durable_max_ms=samples[2], metric='source-created-to-durable-receipt',
                      publication_latency_measured=False, provider_cost_reconciled=False,
                      inflight_or_unknown_cost_may_exceed_aim=True)
        return result

    async def _connection(self, client):
        try:
            async with client.stream_factory(x_stream.STREAM_URL, dict(PARAMS)) as reader:
                self.connection_entered = True
                with self.db:
                    self.db.execute('UPDATE x_stream_probe_run SET connected_at=?', (x_stream.stamp(self.clock()),))
                try:
                    await self._receive(reader)
                finally:
                    pending = await self._settle_read()
                    if pending is not None and pending[0]:
                        self._meter(*pending)
            self.connection_closed = True
        except x_stream.TransportFailure as exc:
            self.connection_closed = not exc.connection_conflict
            if exc.connection_conflict:
                self.reason = 'owned-close-unconfirmed'
            elif exc.status in (401, 403):
                self.reason = 'authentication-or-entitlement-denied'
            elif exc.status == 402 or exc.quota:
                self.reason = 'payment-or-quota-blocked'
            else:
                self.reason = self.reason or 'transport-error'

    async def _finish_connection(self):
        # Pinned cancellable reads plus transport's finite5s owned cleanup.
        task = self.connection_task
        if task is None:
            return
        if not task.done():
            task.cancel()
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        if not task.cancelled():
            task.result()

    async def run(self):
        if self.enabled is not True:
            return self.report()
        try:
            if not self.initialize():
                return self.report()
            if self._stopped():
                _block('stopped-before-transport')
            if self.transport_factory is None:
                from x_stream_transport import AiohttpTransport
                factory = AiohttpTransport
            else:
                factory = self.transport_factory
            client = factory(enabled=True, admission=self._admit, token_provider=self.token_provider)
            # One context, one admitted GET. No search, recovery, rules or retry.
            self.connection_task = asyncio.create_task(self._connection(client))
            while not self.connection_task.done():
                if self._stopped() and not self.connection_entered:
                    self.connection_task.cancel()  # Bound connection setup too.
                await asyncio.wait({self.connection_task}, timeout=0.25)
            if not self.connection_task.cancelled():
                self.connection_task.result()
        except asyncio.CancelledError:
            self.reason = self.reason or 'cancelled'
            # Settle the owned reader and transport, retaining completed bytes.
            await self._finish_connection()
            raise
        except (ProbeBlocked, x_stream.StreamBlocked, x_budget.BudgetBlocked):
            self.reason = self.reason or 'admission-or-configuration-blocked'
        except Exception:
            self.reason = self.reason or 'local-failure'
        finally:
            if self.claimed:
                partial = bool(self.decoder.buffer.strip())
                if partial:
                    self.reason = self.reason or 'incomplete-frame'
                self.decoder.buffer.clear()  # No post body survives terminal reporting.
                with self.db:
                    self.db.execute('UPDATE x_stream_probe_run SET state=\'ended\',ended_at=?,reason=?,'
                                    'unknown_delivery=MAX(unknown_delivery,?),close_confirmed=?',
                                    (x_stream.stamp(self.clock()), self.reason or 'stopped',
                                     int(self.delivery_unknown or partial or (self.attempted and not self.connection_closed)),
                                     int(self.connection_closed)))
                    # Before any attempt there is no socket to own. Uncertain
                    # close/crash must retain our exclusion row for review.
                    if self.connection_closed or not self.attempted:
                        self.db.execute('DELETE FROM x_stream_supervisor_owner WHERE owner=?', (self.owner,))
        return self.report()
