"""Default-OFF, service-owned, one-shot installation of exact missing rules.

No CLI/environment wiring, credential discovery, streaming, deletion or retry.
Use ``Installer(...).run()`` only with fresh, persisted, completed storage-resumed
metadata evidence and a separately reviewed ``reviewed_admission(config,
evidence) -> True`` callback. That local/read-only callback runs under BEGIN
IMMEDIATE, must not commit, and must review account-wide billing/exclusivity,
ongoing polling, unknown prior/control costs, and stable backup/storage evidence.
References are opaque review IDs, not secrets. A balance is never an invoice.

The singleton ledger is permanently consumed, including crashes before token
access. Control cost remains UNKNOWN even after success; contingency is only
an admission allowance, not a tariff or a guaranteed provider spending bound.
Only successful full verification releases our compatible supervisor owner;
ambiguous writes/failed verification retain it for explicit operator review.

Official contracts checked 2026-10-03 (OpenAPI 2.169):
https://docs.x.com/x-api/stream/update-stream-rules
https://docs.x.com/x-api/stream/get-stream-rules
https://docs.x.com/openapi.json
POST success is 200; summary is an unstructured object, not billing evidence.
"""
import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3

import aiohttp

import x_preflight
import x_stream

RULES_URL = 'https://api.x.com/2/tweets/search/stream/rules'
PINNED_AIOHTTP = '3.14.3'
MAX_BODY_BYTES = 256 * 1024
MAX_RULES = 1000
REQUEST_SECONDS = 20
FRESH_SECONDS = 900
MIN_FREE_BYTES = 8 * 1024 * 1024  # Controller enforces the stronger measured probe reserve.
REQUIRED = frozenset(('version', 'setup_id', 'approval_id', 'approved_at', 'prepared_at',
    'expires_at', 'manifest_sha256', 'metadata_request_id', 'metadata_result_sha256',
    'expected_app_id', 'create_missing_rules_approved', 'single_consumer_verified',
    'account_cap_verified', 'account_cap_micros', 'account_headroom_micros',
    'auto_recharge_disabled_verified', 'account_evidence_ref', 'storage_evidence_ref',
    'reconciliation_evidence_ref', 'unknown_cost_approved', 'local_aim_micros',
    'prior_exposure_contingency_micros', 'control_contingency_micros',
    'polling_contingency_micros', 'storage_required_bytes'))
FIXED_REASONS = frozenset('x-rule-setup-' + code for code in (
    'disabled', 'configuration-invalid', 'configuration-changed', 'evidence-reference-invalid',
    'approval-required', 'approval-stale', 'manifest-changed', 'number-invalid',
    'account-evidence-insufficient', 'unknown-cost-approval-required', 'aim-exceeded',
    'metadata-unavailable', 'metadata-incomplete', 'metadata-changed', 'metadata-stale',
    'metadata-worker-owned', 'metadata-ledger-invalid', 'metadata-scope-or-billing-stop',
    'identity-mismatch', 'active-consumer-present', 'foreign-or-unknown-rule',
    'rule-cap-insufficient', 'inventory-invalid', 'inventory-incomplete',
    'inventory-changed', 'response-invalid', 'partial-or-ambiguous-add', 'already-used',
    'durable-ledger-required', 'service-volume-required', 'durability-required',
    'storage-insufficient', 'storage-unavailable', 'account-stop-present', 'another-owner-present',
    'migration-or-probe-present', 'reviewed-admission-required', 'reviewed-admission-committed',
    'prior-exposure-uncovered', 'stopped', 'durable-admission-required', 'transport-disabled',
    'transport-version-unreviewed', 'request-invalid', 'token-unavailable',
    'retry-control-unavailable', 'scope-denied', 'billing-denied', 'rate-limited',
    'http-failed', 'response-format-invalid', 'response-too-large', 'transport-failed',
    'cleanup-failed', 'interrupted', 'internal-failure', 'persistence-failed', 'verified',
    'already-complete'))


class RuleSetupBlocked(ValueError):
    def __init__(self, reason):
        super().__init__(reason if type(reason) is str and reason in FIXED_REASONS
                         else 'x-rule-setup-internal-failure')


def _block(code):
    raise RuleSetupBlocked('x-rule-setup-' + code) from None


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)


def digest(value):
    return hashlib.sha256(_json(value).encode()).hexdigest()


def manifest_sha():
    return digest(x_stream.manifest())


def _utc(value):
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
            raise ValueError
        return parsed.astimezone(timezone.utc)
    except (ValueError, TypeError, AttributeError, OverflowError):
        _block('configuration-invalid')


def _integer(value, low=0, high=10**12):
    if type(value) is not int or not low <= value <= high:
        _block('number-invalid')
    return value


def validate_config(value, now):
    if type(value) is not dict or set(value) != REQUIRED or type(value['version']) is not int or value['version'] != 1:
        _block('configuration-invalid')
    if len(_json(value).encode()) > 16384:
        _block('configuration-invalid')
    for key in ('setup_id', 'approval_id', 'account_evidence_ref', 'storage_evidence_ref', 'reconciliation_evidence_ref'):
        if type(value[key]) is not str or re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}', value[key]) is None:
            _block('evidence-reference-invalid')
    for key in ('manifest_sha256', 'metadata_request_id', 'metadata_result_sha256'):
        if type(value[key]) is not str or re.fullmatch(r'[0-9a-f]{64}', value[key]) is None:
            _block('configuration-invalid')
    for key in ('create_missing_rules_approved', 'single_consumer_verified',
                'account_cap_verified', 'auto_recharge_disabled_verified'):
        if value[key] is not True:
            _block('approval-required')
    if value['unknown_cost_approved'] is not True:
        _block('unknown-cost-approval-required')
    current, approved, prepared, expiry = map(_utc, (now, value['approved_at'], value['prepared_at'], value['expires_at']))
    if not current - timedelta(hours=4) <= approved <= prepared <= current < expiry <= prepared + timedelta(seconds=FRESH_SECONDS):
        _block('approval-stale')
    if value['manifest_sha256'] != manifest_sha():
        _block('manifest-changed')
    if type(value['expected_app_id']) is not str or re.fullmatch(r'[0-9]{1,32}', value['expected_app_id']) is None:
        _block('identity-mismatch')
    if _integer(value['account_cap_micros'], 1, 20_000_000) != 20_000_000:
        _block('account-evidence-insufficient')
    headroom = _integer(value['account_headroom_micros'], 1, value['account_cap_micros'])
    aim = _integer(value['local_aim_micros'], 1, 1_000_000)
    prior = _integer(value['prior_exposure_contingency_micros'], 1, aim)
    control = _integer(value['control_contingency_micros'], 1, aim)
    polling = _integer(value['polling_contingency_micros'], 0, headroom)
    if prior + control > aim or prior + control + polling > headroom:
        _block('aim-exceeded')
    _integer(value['storage_required_bytes'], MIN_FREE_BYTES, 256 * 1024 * 1024)
    return value


def inventory(rows):
    """Exact manifest subset only; preserve actual provider IDs, never invent IDs."""
    if type(rows) is not list or len(rows) > MAX_RULES:
        _block('inventory-invalid')
    allowed = {(r['value'], r['tag']) for r in x_stream.manifest()}
    result, ids, keys = [], set(), set()
    for row in rows:
        if (type(row) is not dict or type(row.get('id')) is not str
                or re.fullmatch(r'[0-9]{1,19}', row['id']) is None
                or type(row.get('value')) is not str or type(row.get('tag')) is not str):
            _block('inventory-invalid')
        key = row['value'], row['tag']
        if key not in allowed:
            _block('foreign-or-unknown-rule')
        if row['id'] in ids or key in keys:
            _block('inventory-invalid')
        ids.add(row['id']); keys.add(key)
        result.append({k: row[k] for k in ('id', 'value', 'tag')})
    return result


def missing_rules(rows):
    present = {(r['value'], r['tag']) for r in inventory(rows)}
    return [{k: row[k] for k in ('value', 'tag')} for row in x_stream.manifest()
            if (row['value'], row['tag']) not in present]


def _payload(value):
    if (type(value) is not dict or set(value) - {'data', 'meta', 'errors'}
            or ('errors' in value and value['errors'] != [])):
        _block('response-invalid')
    return value


def added_rules(payload, missing):
    _payload(payload)
    rows = inventory(payload.get('data'))
    meta = payload.get('meta', {})
    if (type(meta) is not dict or set(meta) - {'sent', 'summary'}
            or 'sent' in meta and (type(meta['sent']) is not str or len(meta['sent']) > 64)
            or 'summary' in meta and type(meta['summary']) is not dict):
        _block('response-invalid')
    # The current official schema deliberately leaves summary unstructured.
    # Do not invent required counters, and never accept it instead of exact data.
    summary = meta.get('summary', {})
    for key, expected in (('created', len(missing)), ('valid', len(missing)), ('not_created', 0), ('invalid', 0)):
        if key in summary and (type(summary[key]) is not int or summary[key] != expected):
            _block('partial-or-ambiguous-add')
    if sorted((r['value'], r['tag']) for r in rows) != sorted((r['value'], r['tag']) for r in missing):
        _block('partial-or-ambiguous-add')
    return rows


def verified_inventory(payload, expected):
    _payload(payload)
    meta = payload.get('meta')
    rows = inventory(payload.get('data', []))
    if (type(meta) is not dict or set(meta) != {'result_count'}
            or type(meta['result_count']) is not int or meta['result_count'] != len(rows)):
        _block('inventory-incomplete')
    if missing_rules(rows) or sorted(rows, key=lambda r: r['id']) != sorted(expected, key=lambda r: r['id']):
        _block('inventory-changed')
    return rows


def _observed(payload):
    """Private safe evidence handoff when a returned POST later fails cleanup."""
    if type(payload) is not dict or type(payload.get('data')) is not list:
        return []
    try:
        return inventory(payload['data'])
    except RuleSetupBlocked:
        return []


def _table(db, name):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def _schema(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS x_stream_rule_setup (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), setup_id TEXT NOT NULL,
        approval_id TEXT NOT NULL, config_sha TEXT NOT NULL, metadata_request_id TEXT NOT NULL,
        started_at TEXT NOT NULL, ended_at TEXT, state TEXT NOT NULL, reason TEXT,
        post_claimed INTEGER NOT NULL DEFAULT 0, get_claimed INTEGER NOT NULL DEFAULT 0,
        cost_status TEXT NOT NULL CHECK(cost_status='unknown'), reserved_micros INTEGER,
        prior_contingency_micros INTEGER NOT NULL, control_contingency_micros INTEGER NOT NULL,
        polling_contingency_micros INTEGER NOT NULL, local_aim_micros INTEGER NOT NULL,
        existing_inventory TEXT NOT NULL, requested_add TEXT NOT NULL,
        observed_post_inventory TEXT NOT NULL DEFAULT '[]', verified_inventory TEXT NOT NULL DEFAULT '[]',
        CHECK(reserved_micros IS NULL));
      CREATE TABLE IF NOT EXISTS x_stream_supervisor_owner (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT NOT NULL, started_at TEXT NOT NULL);
    ''')


class AiohttpTransport:
    """Only POST add / GET full inventory, no caller-supplied URL or query."""
    def __init__(self, *, enabled=False, admission=None, token_provider=None, session_factory=None):
        self.enabled, self.admission, self.token_provider = enabled, admission, token_provider
        self.session_factory = session_factory

    async def request(self, method, additions, request_id):
        if self.enabled is not True:
            _block('transport-disabled')
        if (method not in ('POST', 'GET') or type(request_id) is not str
                or re.fullmatch(r'[0-9a-f]{64}', request_id) is None):
            _block('request-invalid')
        if method == 'POST':
            if type(additions) is not list or not 1 <= len(additions) <= 4:
                _block('request-invalid')
            expected = [{k: r[k] for k in ('value', 'tag')} for r in x_stream.manifest()]
            if any(type(r) is not dict or set(r) != {'value', 'tag'} or r not in expected for r in additions):
                _block('request-invalid')
            if len({digest(r) for r in additions}) != len(additions):
                _block('request-invalid')
        elif additions is not None:
            _block('request-invalid')
        if self.session_factory is None and aiohttp.__version__ != PINNED_AIOHTTP:
            _block('transport-version-unreviewed')
        try:
            admitted = callable(self.admission) and self.admission(request_id, method, digest(additions)) is True
        except RuleSetupBlocked:
            raise
        except Exception:
            admitted = False
        if not admitted:
            _block('durable-admission-required')
        try:
            token = self.token_provider()
            if (type(token) is not str or not 1 <= len(token) <= 8192 or not token.isascii()
                    or any(ord(c) <= 32 or ord(c) >= 127 for c in token)):
                raise ValueError
        except Exception:
            _block('token-unavailable')
        headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
                   'Accept-Encoding': 'identity', 'User-Agent': 'TechPhaseRuleSetup/1.0'}
        token = None
        session, response, received = None, None, None
        try:
            factory = self.session_factory if self.session_factory is not None else aiohttp.ClientSession
            session = factory(trust_env=False, auth=None, cookie_jar=aiohttp.DummyCookieJar(),
                              auto_decompress=False, raise_for_status=False,
                              timeout=aiohttp.ClientTimeout(total=REQUEST_SECONDS, connect=10, sock_read=10))
            if not hasattr(session, '_retry_connection'):
                _block('retry-control-unavailable')
            session._retry_connection = False
            if session._retry_connection is not False:
                _block('retry-control-unavailable')
            async with asyncio.timeout(REQUEST_SECONDS):
                options = dict(headers=headers, allow_redirects=False, ssl=True, proxy=None, auth=None)
                if method == 'POST':
                    response = await session.post(RULES_URL, json={'add': json.loads(_json(additions))}, **options)
                else:
                    response = await session.get(RULES_URL, params={'max_results': MAX_RULES}, **options)
                if response.status in (401, 403):
                    _block('scope-denied')
                if response.status == 402:
                    _block('billing-denied')
                if response.status == 429:
                    _block('rate-limited')
                if response.status != 200:
                    _block('http-failed')
                if (response.headers.get('Content-Type', '').split(';', 1)[0].strip().lower() != 'application/json'
                        or response.headers.get('Content-Encoding', 'identity').lower() != 'identity'):
                    _block('response-format-invalid')
                body = bytearray()
                while True:
                    size = min(65536, MAX_BODY_BYTES + 1 - len(body))
                    chunk = await response.content.read(size)
                    if type(chunk) is not bytes or len(chunk) > size:
                        _block('response-invalid')
                    if not chunk:
                        break
                    body.extend(chunk)
                    if len(body) > MAX_BODY_BYTES:
                        _block('response-too-large')
                try:
                    received = x_preflight._json(bytes(body))
                    return received
                except (ValueError, UnicodeError, RecursionError):
                    _block('response-invalid')
        except RuleSetupBlocked:
            raise
        except Exception:
            _block('transport-failed')
        finally:
            headers.clear()
            if session is not None:
                try:
                    await x_preflight._close_owned(response, session)
                except x_preflight.PreflightBlocked:
                    failure = RuleSetupBlocked('x-rule-setup-cleanup-failed')
                    failure.observed_inventory = _observed(received) if method == 'POST' else []
                    raise failure from None
                except asyncio.CancelledError as exc:
                    exc.observed_inventory = _observed(received) if method == 'POST' else []
                    raise


class Installer:
    def __init__(self, *, db=None, enabled=False, config=None, token_provider=None,
                 reviewed_admission=None, storage_preflight=None, transport_factory=None,
                 stop_event=None, clock=None):
        self.db, self.enabled, self.config = db, enabled, config
        self.token_provider, self.reviewed_admission = token_provider, reviewed_admission
        self.storage_preflight, self.transport_factory = storage_preflight, transport_factory
        self.stop_event = stop_event
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.frozen = self.fingerprint = self.owner = self.metadata = self.exposure = None
        self.existing, self.missing, self.observed, self.verified = [], [], [], []
        self.claimed, self.success, self.attempted = False, False, False
        self.capabilities = set()
        self.result = {'status': 'disabled', 'reason': 'x-rule-setup-disabled'}

    def _storage(self):
        try:
            value = (self.storage_preflight() if self.storage_preflight else
                     x_preflight.local_free_space(minimum_free_bytes=self.frozen['storage_required_bytes']))
            if (type(value) is not dict or value.get('metadata_storage_sufficient') is not True
                    or _integer(value.get('available_bytes')) < self.frozen['storage_required_bytes']):
                _block('storage-insufficient')
            return {'available_bytes': value['available_bytes'], 'required_bytes': self.frozen['storage_required_bytes']}
        except RuleSetupBlocked:
            raise
        except Exception:
            _block('storage-unavailable')

    def _ownership(self, ours=False):
        if self.stop_event is not None and self.stop_event.is_set():
            _block('stopped')
        if _table(self.db, 'x_budget_stop') and self.db.execute('SELECT 1 FROM x_budget_stop LIMIT 1').fetchone():
            _block('account-stop-present')
        if _table(self.db, 'x_stream_state') and self.db.execute(
                "SELECT 1 FROM x_stream_state WHERE state IN ('entitlement-blocked','budget-paused','operator-blocked')").fetchone():
            _block('account-stop-present')
        for table in ('x_stream_runtime', 'x_stream_owner'):
            if _table(self.db, table) and self.db.execute('SELECT 1 FROM ' + table + ' LIMIT 1').fetchone():
                _block('migration-or-probe-present')
        for table in ('x_stream_pilot', 'x_stream_probe_run'):
            if _table(self.db, table) and self.db.execute('SELECT 1 FROM ' + table + ' LIMIT 1').fetchone():
                _block('migration-or-probe-present')
        row = self.db.execute('SELECT owner FROM x_stream_supervisor_owner').fetchone()
        if row and (not ours or row[0] != self.owner) or ours and not row:
            _block('another-owner-present')

    def _metadata(self):
        if not _table(self.db, 'x_metadata_preflight_runs') or not _table(self.db, 'x_metadata_preflight_storage_resume'):
            _block('metadata-unavailable')
        rows = list(self.db.execute('SELECT request_id,approval_id,reserved_micros,cost_status,requests_admitted,status,result '
                                    'FROM x_metadata_preflight_runs ORDER BY request_id LIMIT 1025'))
        if not rows or len(rows) > 1024:
            _block('metadata-ledger-invalid')
        known = unknown = 0
        selected = None
        for row in rows:
            if row[5] in ('reserved', 'running'):
                _block('metadata-worker-owned')
            if row[5] not in ('observed', 'verified', 'blocked') or type(row[6]) is not str or len(row[6].encode()) > 65536:
                _block('metadata-ledger-invalid')
            report = x_preflight._json(row[6])
            if type(report) is not dict:
                _block('metadata-ledger-invalid')
            if row[5] == 'blocked' and report.get('reason') != 'x-preflight-volume-space-insufficient':
                _block('metadata-scope-or-billing-stop')
            if row[3] == 'unknown' and row[2] is None:
                unknown += 1
            elif row[3] == 'bounded':
                known += _integer(row[2], 1)
            else:
                _block('metadata-ledger-invalid')
            if row[0] == self.frozen['metadata_request_id']:
                if row[5] not in ('observed', 'verified') or row[5] != report.get('status'):
                    _block('metadata-incomplete')
                selected = report
        readiness = None
        if selected is None and _table(self.db, 'x_stream_trial_readiness'):
            readiness = self.db.execute('SELECT request_id,original_request_id,original_result_sha256,'
                'original_anchor_sha256,started_at,verified_at,state,requests_admitted,cost_status,reserved_micros,result '
                'FROM x_stream_trial_readiness WHERE request_id=?', (self.frozen['metadata_request_id'],)).fetchone()
            if readiness:
                if (readiness[6] != 'observed' or readiness[7] != 5 or readiness[8] != 'unknown'
                        or readiness[9] is not None or type(readiness[10]) is not str
                        or len(readiness[10].encode()) > 65536
                        or not _table(self.db, 'x_stream_trial_readiness_requests')):
                    _block('metadata-incomplete')
                claims = list(self.db.execute('SELECT path FROM x_stream_trial_readiness_requests '
                                             'WHERE run_id=? ORDER BY path', (readiness[0],)))
                if [r[0] for r in claims] != sorted(x_preflight.PATHS):
                    _block('metadata-incomplete')
                original = next((r for r in rows if r[0] == readiness[1]), None)
                anchor = self.db.execute('SELECT account_anchor FROM x_metadata_preflight_runs WHERE request_id=?',
                                         (readiness[1],)).fetchone()
                if (not original or original[5] not in ('observed', 'verified')
                        or digest(x_preflight._json(original[6])) != readiness[2]
                        or not anchor or digest(x_preflight._json(anchor[0])) != readiness[3]):
                    _block('metadata-changed')
                selected = x_preflight._json(readiness[10])
                if (selected.get('verified_at') != readiness[5] or selected.get('started_at') != readiness[4]
                        or selected.get('requests_admitted') != 5 or selected.get('status') != 'observed'
                        or selected.get('original_metadata_request_id') != readiness[1]
                        or selected.get('original_metadata_result_sha256') != readiness[2]):
                    _block('metadata-incomplete')
                unknown += 1
        if selected is None or digest(selected) != self.frozen['metadata_result_sha256']:
            _block('metadata-changed')
        if selected.get('request_id') != self.frozen['metadata_request_id'] or selected.get('reason') != 'x-preflight-metadata-only':
            _block('metadata-incomplete')
        resumed = self.db.execute('SELECT prepared_at,expires_at,prior_requests FROM x_metadata_preflight_storage_resume WHERE run_id=?',
                                  (self.frozen['metadata_request_id'],)).fetchone()
        if readiness is None and (not resumed or selected.get('storage_resume_prepared_at') != resumed[0]
                or resumed[2] != 2 or selected.get('requests_admitted') != 7):
            _block('metadata-incomplete')
        now, verified = _utc(self.clock()), _utc(selected.get('verified_at'))
        prepared = readiness[4] if readiness is not None else resumed[0]
        if not now - timedelta(seconds=FRESH_SECONDS) <= _utc(prepared) <= verified <= now:
            _block('metadata-stale')
        if selected.get('rules_complete') is not True or selected.get('inventory_complete') is not True:
            _block('metadata-incomplete')
        existing = inventory(selected.get('inventory'))
        missing = missing_rules(existing)
        expected_missing = [r for r in x_stream.manifest() if {k: r[k] for k in ('value', 'tag')} in missing]
        if selected.get('missing_rules') != expected_missing or selected.get('required_rules_present') is not (not missing):
            _block('metadata-incomplete')
        counts, connections, usage, credits = (selected.get(k) for k in ('rule_counts', 'connections', 'usage', 'credits'))
        if any(type(v) is not dict for v in (counts, connections, usage, credits)):
            _block('metadata-incomplete')
        if counts.get('client_app_id') != self.frozen['expected_app_id'] or usage.get('counts_usage_app_identity_matches') is not True:
            _block('identity-mismatch')
        for key, expected in (('client_app_rules_count', len(existing)), ('project_rules_count', len(existing)),
                              ('other_app_rule_count', 0), ('project_app_count', 1)):
            if type(counts.get(key)) is not int or counts[key] != expected:
                _block('metadata-incomplete')
        if _integer(counts.get('cap_per_client_app')) < 4 or _integer(counts.get('cap_per_project')) < 4:
            _block('rule-cap-insufficient')
        if (connections.get('inventory_complete') is not True or type(connections.get('active_count')) is not int
                or connections['active_count'] != 0 or connections.get('active_by_endpoint') != {}
                or type(usage.get('other_app_usage_posts_one_day')) is not int or usage['other_app_usage_posts_one_day'] != 0):
            _block('active-consumer-present')
        # Credit response proves metadata completion only, never price/headroom.
        if credits.get('currency') != 'USD' or not all(type(credits.get(k)) is str for k in ('prepaid_balance', 'free_balance', 'total_balance')):
            _block('metadata-incomplete')
        exposure_rows = [list(r) for r in rows]
        if readiness is not None:
            exposure_rows.append(list(readiness))
        exposure = {'known_reserved_micros': known, 'unknown_runs': unknown, 'fingerprint': digest(exposure_rows)}
        if known > self.frozen['prior_exposure_contingency_micros']:
            _block('prior-exposure-uncovered')
        return selected, exposure, existing, missing

    def _review(self, ours=False):
        validate_config(self.config, self.clock())
        if digest(self.config) != self.fingerprint:
            _block('configuration-changed')
        self._ownership(ours)
        storage = self._storage()
        metadata, exposure, existing, missing = self._metadata()
        if self.metadata is not None and (metadata != self.metadata or exposure != self.exposure):
            _block('metadata-changed')
        evidence = {'metadata': metadata, 'metadata_exposure': exposure, 'storage': storage,
                    'cost_status': 'unknown', 'reserved_micros': None}
        if self.reviewed_admission(json.loads(_json(self.frozen)), json.loads(_json(evidence))) is not True:
            _block('reviewed-admission-required')
        if not self.db.in_transaction:
            _block('reviewed-admission-committed')
        self._ownership(ours)
        self._storage()
        if self._metadata() != (metadata, exposure, existing, missing) or digest(self.config) != self.fingerprint:
            _block('metadata-changed')
        return metadata, exposure, existing, missing

    def initialize(self):
        if self.enabled is not True:
            _block('disabled')
        validate_config(self.config, self.clock())
        if not callable(self.reviewed_admission) or not callable(self.token_provider):
            _block('reviewed-admission-required')
        if not isinstance(self.db, sqlite3.Connection) or self.db.in_transaction:
            _block('durable-ledger-required')
        location = self.db.execute('PRAGMA database_list').fetchone()
        if not location or not location[2]:
            _block('durable-ledger-required')
        if self.storage_preflight is None and not Path(location[2]).resolve().is_relative_to('/data'):
            _block('service-volume-required')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('PRAGMA busy_timeout=100')
        if self.db.execute('PRAGMA synchronous').fetchone()[0] < 2:
            _block('durability-required')
        self.frozen = json.loads(_json(self.config)); self.fingerprint = digest(self.frozen)
        self.owner = 'rule-setup:' + self.fingerprint
        self._storage()
        _schema(self.db)
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if self.db.execute('SELECT 1 FROM x_stream_rule_setup').fetchone():
                _block('already-used')
            self.metadata, self.exposure, self.existing, self.missing = self._review()
            c = self.frozen
            self.db.execute('INSERT INTO x_stream_rule_setup '
                '(singleton,setup_id,approval_id,config_sha,metadata_request_id,started_at,state,cost_status,reserved_micros,'
                'prior_contingency_micros,control_contingency_micros,polling_contingency_micros,local_aim_micros,existing_inventory,requested_add) '
                "VALUES(1,?,?,?,?,?,'reserved','unknown',NULL,?,?,?,?,?,?)",
                (c['setup_id'], c['approval_id'], self.fingerprint, c['metadata_request_id'], x_stream.stamp(self.clock()),
                 c['prior_exposure_contingency_micros'], c['control_contingency_micros'], c['polling_contingency_micros'],
                 c['local_aim_micros'], _json(self.existing), _json(self.missing)))
            self.db.execute('INSERT INTO x_stream_supervisor_owner VALUES(1,?,?)', (self.owner, x_stream.stamp(self.clock())))
        self.claimed = True

    def _admission(self, request_id, method, payload_sha):
        capability = (request_id, method, payload_sha)
        if capability not in self.capabilities or self.db.in_transaction:
            return False
        self.capabilities.remove(capability)
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            self._review(ours=True)
            row = self.db.execute('SELECT state,config_sha FROM x_stream_rule_setup').fetchone()
            if not row or tuple(row) != (method.lower() + '-claimed', self.fingerprint):
                _block('durable-admission-required')
        self.attempted = True
        return True

    async def _request(self, transport, method, additions):
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            self._review(ours=True)
            column = 'post_claimed' if method == 'POST' else 'get_claimed'
            row = self.db.execute('SELECT state,' + column + ' FROM x_stream_rule_setup WHERE config_sha=?', (self.fingerprint,)).fetchone()
            if not row or row[1] or row[0] != ('reserved' if method == 'POST' else 'post-verified'):
                _block('already-used')
            self.db.execute('UPDATE x_stream_rule_setup SET ' + column + '=1,state=?', (method.lower() + '-claimed',))
        capability = (digest([self.fingerprint, method]), method, digest(additions))
        self.capabilities.add(capability)
        try:
            return await transport.request(method, additions, capability[0])
        finally:
            self.capabilities.discard(capability)

    async def run(self):
        if self.enabled is not True:
            return dict(self.result)
        if self.claimed:
            return {'status': 'blocked', 'reason': 'x-rule-setup-already-used'}
        interrupted = False
        try:
            self.initialize()
            if not self.missing:
                self.verified = self.existing
                self.success = True
                self.result = {'status': 'verified', 'reason': 'x-rule-setup-already-complete'}
            else:
                factory = self.transport_factory if self.transport_factory else AiohttpTransport
                transport = factory(enabled=True, admission=self._admission, token_provider=self.token_provider)
                payload = await self._request(transport, 'POST', self.missing)
                # Preserve exact known IDs from a structurally valid partial response
                # before classifying it as ambiguous; never retain errors/raw bodies.
                if type(payload) is dict and type(payload.get('data')) is list:
                    self.observed = inventory(payload['data'])
                    with self.db:
                        self.db.execute('UPDATE x_stream_rule_setup SET observed_post_inventory=?', (_json(self.observed),))
                self.observed = added_rules(payload, self.missing)
                expected = inventory(self.existing + self.observed)
                if missing_rules(expected):
                    _block('partial-or-ambiguous-add')
                with self.db:
                    self.db.execute("UPDATE x_stream_rule_setup SET state='post-verified'")
                self.verified = verified_inventory(await self._request(transport, 'GET', None), expected)
                with self.db:
                    self.db.execute('BEGIN IMMEDIATE')
                    self._review(ours=True)
                self.success = True
                self.result = {'status': 'verified', 'reason': 'x-rule-setup-verified'}
        except asyncio.CancelledError as exc:
            self.observed = getattr(exc, 'observed_inventory', None) or self.observed
            interrupted = True
            self.result = {'status': 'blocked', 'reason': 'x-rule-setup-interrupted'}
        except RuleSetupBlocked as exc:
            self.observed = getattr(exc, 'observed_inventory', None) or self.observed
            self.result = {'status': 'blocked', 'reason': str(exc)}
        except Exception:
            self.result = {'status': 'blocked', 'reason': 'x-rule-setup-internal-failure'}
        finally:
            if self.claimed:
                try:
                    with self.db:
                        self.db.execute('UPDATE x_stream_rule_setup SET state=?,reason=?,ended_at=?,verified_inventory=?,observed_post_inventory=?',
                                        (self.result['status'], self.result['reason'], x_stream.stamp(self.clock()),
                                         _json(self.verified), _json(self.observed)))
                        if self.success or not self.attempted:
                            self.db.execute('DELETE FROM x_stream_supervisor_owner WHERE owner=?', (self.owner,))
                    self.result.update(cost_status='unknown', reserved_micros=None,
                        cost_reconciled=False, observed_post_inventory=self.observed, inventory=self.verified,
                        manifest_sha256=self.frozen['manifest_sha256'], owner_released=self.success or not self.attempted)
                except Exception:
                    self.result = {'status': 'blocked', 'reason': 'x-rule-setup-persistence-failed'}
        if interrupted:
            raise asyncio.CancelledError
        return dict(self.result)
