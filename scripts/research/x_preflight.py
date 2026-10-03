"""One-shot, service-owned, default-off X metadata preflight. No credential reads.

Only five fixed GET paths exist here. The service supplies an existing bearer
lazily, after fresh operator approval gates, /data capacity, and a durable
full worst-case reservation or explicitly approved unknown-exposure record. An attempted run is never replayed or refunded.
This private evidence does NOT establish entitlement, a money cap, auto-recharge
settings, or account-wide consumer exclusivity. It cannot activate a stream.

Contracts checked against official X documentation on 2026-10-03:
https://docs.x.com/x-api/stream/get-stream-rules
https://docs.x.com/x-api/stream/get-stream-rule-counts
https://docs.x.com/x-api/connections/get-connection-history
https://docs.x.com/x-api/usage/get-usage
https://docs.x.com/x-api/usage/get-usage-credits
"""
import asyncio
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
import os
import re
import sqlite3

import aiohttp

import x_stream

ORIGIN = 'https://api.x.com'
RULES = '/2/tweets/search/stream/rules'
COUNTS = RULES + '/counts'
CONNECTIONS = '/2/connections'
USAGE = '/2/usage/tweets'
CREDITS = '/2/usage/credits'
PATHS = frozenset((RULES, COUNTS, CONNECTIONS, USAGE, CREDITS))
COUNT_FIELDS = 'cap_per_client_app,cap_per_project,client_app_rules_count,project_rules_count,all_project_client_apps'
CONNECTION_FIELDS = 'id,endpoint_name,connected_at,disconnected_at'
USAGE_FIELDS = 'project_id,project_usage,project_cap,cap_reset_day,daily_client_app_usage'
BASE_PARAMS = {
    RULES: {'max_results': 1000},
    COUNTS: {'rules_count.fields': COUNT_FIELDS},
    CONNECTIONS: {'status': 'all', 'max_results': 100, 'connection.fields': CONNECTION_FIELDS},
    USAGE: {'days': 1, 'usage.fields': USAGE_FIELDS},
    CREDITS: {},
}
ENDPOINT_NAMES = frozenset(('filtered_stream', 'sample_stream', 'sample10_stream',
    'firehose_stream', 'tweets_compliance_stream', 'users_compliance_stream',
    'tweet_label_stream', 'firehose_stream_lang_en', 'firehose_stream_lang_ja',
    'firehose_stream_lang_ko', 'firehose_stream_lang_pt', 'likes_firehose_stream',
    'likes_sample10_stream', 'likes_compliance_stream'))
MAX_BODY_BYTES = 256 * 1024
REQUEST_SECONDS = 20
CLOSE_SECONDS = 5
MAX_PAGES = 10
MAX_RULES = 1000
MAX_CONNECTIONS = 1000
MIN_FREE_BYTES = 8 * 1024 * 1024
MAX_REPORT_BYTES = 64 * 1024
MAX_TRIAL_MICROS = 1_000_000
FRESH_SECONDS = 900
PINNED_AIOHTTP = '3.14.3'
SAFE_REF = re.compile(r'[A-Za-z0-9_.:-]{1,100}\Z')
DIGITS = re.compile(r'[0-9]{1,19}\Z')
APP_ID = re.compile(r'[0-9]{1,32}\Z')
BASE_APPROVAL_KEYS = frozenset(('version', 'approved', 'approval_id', 'approved_at',
    'expires_at', 'manifest_sha256', 'cost_mode', 'account_evidence',
    'trial_limit_micros', 'trial_spent_micros', 'max_requests', 'max_pages'))
PRICED_KEYS = frozenset(('metadata_price_verified', 'metadata_cost_evidence',
    'metadata_cost_verified_at', 'metadata_max_request_micros', 'metadata_reserve_micros'))
ACCOUNT_KEYS = frozenset(('reference', 'verified_at', 'cycle_cap_micros', 'baseline_micros',
                          'auto_recharge_enabled', 'consumers_checked'))
HISTORICAL_ACCOUNT_KEYS = ACCOUNT_KEYS | {'cycle_start_date', 'cycle_end_date', 'session_expires_at',
                                         'same_key_tech_phase_only'}
MAX_APPROVED_SESSION_SECONDS = 4 * 3600


FIXED_REASONS = frozenset('x-preflight-' + code for code in (
    'account-evidence-insufficient',
    'account-evidence-required',
    'account-evidence-stale',
    'active-consumer-present',
    'already-attempted',
    'approval-reference-invalid',
    'approval-required',
    'approval-schema-invalid',
    'approval-stale',
    'cleanup-failed',
    'connection-schema-invalid',
    'cost-mode-required',
    'credits-balance-mismatch',
    'credits-denied',
    'credits-schema-invalid',
    'durable-admission-required',
    'durable-ledger-required',
    'endpoint-invalid',
    'foreign-or-unknown-rule',
    'http-failed',
    'identity-invalid',
    'inventory-count-mismatch',
    'inventory-incomplete',
    'inventory-page-limit',
    'inventory-too-large',
    'ledger-transaction-open',
    'manifest-changed',
    'metadata-price-stale',
    'metadata-price-unverified',
    'number-invalid',
    'other-app-rules-present',
    'other-app-usage-present',
    'pagination-invalid',
    'pagination-repeated',
    'parameters-invalid',
    'rate-limited',
    'request-budget-exhausted',
    'request-budget-invalid',
    'request-id-invalid',
    'response-format-invalid',
    'response-incomplete',
    'response-json-invalid',
    'response-schema-invalid',
    'response-size-invalid',
    'response-too-large',
    'retry-control-unavailable',
    'rule-count-mismatch',
    'rule-count-schema-invalid',
    'rule-set-incomplete-or-duplicate',
    'scope-denied',
    'service-admission-failed',
    'service-admission-required',
    'time-invalid',
    'token-unavailable',
    'transport-disabled',
    'transport-failed',
    'transport-version-unreviewed',
    'trial-exposure-exhausted',
    'trial-exposure-unresolved',
    'unknown-cost-approval-required',
    'usage-app-identity-unverified',
    'usage-schema-invalid',
    'volume-path-invalid',
    'volume-space-insufficient',
    'volume-unavailable',
    'internal-failure',
    'stream-owner-present',
    'storage-policy-invalid',
    'report-too-large',
))


class PreflightBlocked(ValueError):
    """Only module-owned fixed reason codes are surfaced to the service."""
    def __init__(self, reason):
        super().__init__(reason if type(reason) is str and reason in FIXED_REASONS
                         else 'x-preflight-internal-failure')


def _blocked(code):
    raise PreflightBlocked('x-preflight-' + code) from None


def _utc(value):
    try:
        result = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.tzinfo is None:
            raise ValueError
        return result.astimezone(timezone.utc)
    except (TypeError, ValueError, AttributeError, OverflowError):
        _blocked('time-invalid')


def _integer(value, low=0, high=10**18):
    if type(value) is not int or not low <= value <= high:
        _blocked('number-invalid')
    return value


def _count(value):
    if type(value) is str and re.fullmatch(r'[0-9]{1,19}', value):
        value = int(value)
    return _integer(value)


def _identity(value):
    if type(value) is not str or APP_ID.fullmatch(value) is None:
        _blocked('identity-invalid')
    return value


def manifest_sha():
    return hashlib.sha256(json.dumps(x_stream.manifest(), sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate_approval(approval, now):
    """Validate either an independently priced bound or explicit unknown exposure.

    Unknown mode never invents a unit price/reservation. It authorizes at most
    seven metadata GETs once, based on separate fresh account evidence. Its $1
    limit is a stopping aim, NOT a guaranteed cost bound. Result cannot admit a
    stream or be interpreted as reconciled spending.
    """
    if type(approval) is not dict:
        _blocked('approval-schema-invalid')
    mode = approval.get('cost_mode')
    if mode not in ('verified-bound', 'unknown-explicitly-approved'):
        _blocked('cost-mode-required')
    required = BASE_APPROVAL_KEYS | (PRICED_KEYS if mode == 'verified-bound' else {'unknown_cost_approved', 'run_prepared_at'})
    if set(approval) != required:
        _blocked('approval-schema-invalid')
    if type(approval['version']) is not int or approval['version'] != 1 or approval['approved'] is not True:
        _blocked('approval-required')
    if type(approval['approval_id']) is not str or SAFE_REF.fullmatch(approval['approval_id']) is None:
        _blocked('approval-reference-invalid')
    current = _utc(now)
    approved, expiry = (_utc(approval[k]) for k in ('approved_at', 'expires_at'))
    prepared = approved if mode == 'verified-bound' else _utc(approval['run_prepared_at'])
    if not approved <= prepared <= current < expiry <= prepared + timedelta(seconds=FRESH_SECONDS):
        _blocked('approval-stale')
    evidence = approval['account_evidence']
    account_keys = ACCOUNT_KEYS if mode == 'verified-bound' else HISTORICAL_ACCOUNT_KEYS
    if type(evidence) is not dict or set(evidence) != account_keys:
        _blocked('account-evidence-required')
    if type(evidence['reference']) is not str or SAFE_REF.fullmatch(evidence['reference']) is None:
        _blocked('account-evidence-required')
    verified = _utc(evidence['verified_at'])
    if mode == 'verified-bound':
        if not current - timedelta(seconds=FRESH_SECONDS) <= verified <= approved:
            _blocked('account-evidence-stale')
    else:
        # This is an immutable historical account/configuration anchor, not a
        # new measurement of spend. The original user approval timestamp stays
        # unchanged; run_prepared_at starts only a short one-shot dispatch window.
        try:
            dates = [evidence[k] for k in ('cycle_start_date', 'cycle_end_date')]
            if any(type(v) is not str or re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', v) is None for v in dates):
                raise ValueError
            start_date, end_date = (date.fromisoformat(v) for v in dates)
            # Date-only provider evidence is NOT an authoritative UTC reset.
            # Exclude a whole UTC day at each uncertain time-zone boundary.
            earliest_safe = datetime.combine(start_date + timedelta(days=1), datetime.min.time(), timezone.utc)
            latest_safe = datetime.combine(end_date - timedelta(days=1), datetime.min.time(), timezone.utc)
        except (ValueError, TypeError, OverflowError):
            _blocked('account-evidence-stale')
        session_end = _utc(evidence['session_expires_at'])
        if (not earliest_safe <= verified <= prepared <= current < session_end <= latest_safe
                or not earliest_safe <= approved < latest_safe
                or session_end > verified + timedelta(seconds=MAX_APPROVED_SESSION_SECONDS)
                or expiry > session_end):
            _blocked('account-evidence-stale')
        if evidence['same_key_tech_phase_only'] is not True:
            _blocked('account-evidence-insufficient')
    cap = _integer(evidence['cycle_cap_micros'], 1, 20_000_000)
    baseline = _integer(evidence['baseline_micros'], 0, 20_000_000)
    if cap - baseline < 2_000_000 or evidence['auto_recharge_enabled'] is not False or evidence['consumers_checked'] is not True:
        _blocked('account-evidence-insufficient')
    if approval['manifest_sha256'] != manifest_sha():
        _blocked('manifest-changed')
    pages = _integer(approval['max_pages'], 1, MAX_PAGES if mode == 'verified-bound' else 2)
    maximum = _integer(approval['max_requests'], 5, MAX_PAGES * 2 + 3)
    limit = _integer(approval['trial_limit_micros'], 1, MAX_TRIAL_MICROS)
    spent = _integer(approval['trial_spent_micros'], 0, MAX_TRIAL_MICROS)
    if maximum != pages * 2 + 3 or spent >= limit:
        _blocked('request-budget-invalid')
    if mode == 'verified-bound':
        if approval['metadata_price_verified'] is not True:
            _blocked('metadata-price-unverified')
        reference = approval['metadata_cost_evidence']
        if type(reference) is not str or SAFE_REF.fullmatch(reference) is None:
            _blocked('approval-reference-invalid')
        priced = _utc(approval['metadata_cost_verified_at'])
        if not current - timedelta(seconds=FRESH_SECONDS) <= priced <= approved:
            _blocked('metadata-price-stale')
        unit = _integer(approval['metadata_max_request_micros'], 1, MAX_TRIAL_MICROS)
        reserve = _integer(approval['metadata_reserve_micros'], 1, MAX_TRIAL_MICROS)
        if reserve != maximum * unit or spent + reserve > limit:
            _blocked('request-budget-invalid')
    elif approval['unknown_cost_approved'] is not True:
        _blocked('unknown-cost-approval-required')
    return dict(approval, account_evidence=dict(evidence))


def metadata_storage_reserve(db, max_requests):
    """Conservative admission headroom, NOT a proven SQLite/WAL upper bound.

    Budget 64 pages per bounded request commit plus setup/finalization commits
    and four report copies. B-tree splits/checkpoints and other writers can vary;
    capacity is rechecked before every claim and token admission.
    """
    requests = _integer(max_requests, 5, MAX_PAGES * 2 + 3)
    try:
        page_size = db.execute('PRAGMA page_size').fetchone()[0]
        if type(page_size) is not int or not 512 <= page_size <= 65536 or page_size & (page_size - 1):
            raise ValueError
    except Exception:
        _blocked('storage-policy-invalid')
    return max(MIN_FREE_BYTES, (requests + 4) * 64 * page_size + 4 * MAX_REPORT_BYTES)


def local_free_space(path='/data', *, statvfs=None, minimum_free_bytes=MIN_FREE_BYTES):
    """Read the authorized service volume only; return byte totals, never paths."""
    if type(path) is not str or path != '/data':
        _blocked('volume-path-invalid')
    _integer(minimum_free_bytes, MIN_FREE_BYTES, 256 * 1024 * 1024)
    try:
        stat = (os.statvfs if statvfs is None else statvfs)(path)
        block = _integer(stat.f_frsize, 1)
        total = _integer(stat.f_blocks) * block
        free = _integer(stat.f_bfree) * block
        available = _integer(stat.f_bavail) * block
        if not 0 <= available <= free <= total <= 10**21:
            raise ValueError
    except Exception:
        _blocked('volume-unavailable')
    return {'total_bytes': total, 'free_bytes': free, 'available_bytes': available,
            'minimum_free_bytes': minimum_free_bytes,
            'metadata_storage_sufficient': available >= minimum_free_bytes,
            'storage_reserve_is_guarantee': False, 'stream_storage_sufficient': False}


def local_storage_snapshot(*, statvfs=None, scandir=None):
    """Bounded immediate-file size categories; no file contents or symlink walk.

    This does not prove space for stream ingestion, SQLite WAL growth, or backups.
    The metadata headroom check applies only to this bounded operation.
    """
    result = local_free_space(statvfs=statvfs)
    sizes = {'database_bytes': 0, 'wal_bytes': 0, 'backup_bytes': 0, 'other_bytes': 0}
    count = 0
    complete = True
    try:
        with (os.scandir if scandir is None else scandir)('/data') as entries:
            for entry in entries:
                count += 1
                if count > 1024:
                    complete = False
                    break
                if not entry.is_file(follow_symlinks=False):
                    continue
                size = _integer(entry.stat(follow_symlinks=False).st_size, 0, 10**21)
                name = entry.name.lower()
                if name.endswith(('-wal', '-shm')):
                    key = 'wal_bytes'
                elif name.endswith(('.bak', '.backup', '.gz', '.zip')) or 'backup' in name:
                    key = 'backup_bytes'
                elif name.endswith(('.db', '.sqlite', '.sqlite3')):
                    key = 'database_bytes'
                else:
                    key = 'other_bytes'
                sizes[key] += size
    except Exception:
        complete = False
    result.update(immediate_file_sizes=sizes, immediate_file_sizes_complete=complete,
                  entries_examined=min(count, 1024))
    return result


def schema(db):
    if db.in_transaction:
        _blocked('ledger-transaction-open')
    db.executescript('''
      CREATE TABLE IF NOT EXISTS x_metadata_preflight_runs (
        request_id TEXT PRIMARY KEY, approval_id TEXT NOT NULL UNIQUE,
        approved_at TEXT NOT NULL, run_prepared_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        account_anchor TEXT NOT NULL,
        reserved_micros INTEGER CHECK(reserved_micros > 0),
        cost_status TEXT NOT NULL CHECK(cost_status IN ('bounded','unknown')),
        requests_admitted INTEGER NOT NULL DEFAULT 0,
        max_requests INTEGER NOT NULL, status TEXT NOT NULL, result TEXT NOT NULL,
        CHECK((cost_status='unknown' AND reserved_micros IS NULL) OR
              (cost_status='bounded' AND reserved_micros IS NOT NULL)));
      CREATE TABLE IF NOT EXISTS x_metadata_preflight_requests (
        request_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, path TEXT NOT NULL,
        admitted_at TEXT NOT NULL, unit_bound_micros INTEGER);
    ''')


def reserved_exposure(db):
    """All attempted-run reservations remain exposure, including failed runs."""
    row = db.execute(
        "SELECT COALESCE(SUM(reserved_micros),0), COALESCE(SUM(cost_status='unknown'),0) FROM x_metadata_preflight_runs"
    ).fetchone()
    return {'known_reserved_micros': _integer(row[0]), 'unknown_runs': _integer(row[1]),
            'reconciled': False}


def latest_result(db):
    row = db.execute('SELECT result FROM x_metadata_preflight_runs ORDER BY rowid DESC LIMIT 1').fetchone()
    return json.loads(row[0]) if row else None


def _assert_no_live_stream(db):
    # Called while holding BEGIN IMMEDIATE. Never clear another owner's rows.
    tables = {row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
        "('x_stream_supervisor_owner','x_stream_owner','x_stream_pilot')")}
    for name in ('x_stream_supervisor_owner', 'x_stream_owner'):
        if name in tables and db.execute('SELECT 1 FROM ' + name + ' LIMIT 1').fetchone():
            _blocked('stream-owner-present')
    if 'x_stream_pilot' in tables and db.execute("SELECT 1 FROM x_stream_pilot WHERE state='running' LIMIT 1").fetchone():
        _blocked('stream-owner-present')


def _reserve_run(db, approval):
    if db.in_transaction:
        _blocked('ledger-transaction-open')
    identity = hashlib.sha256(('x-metadata-v1:' + approval['approval_id']).encode()).hexdigest()
    with db:
        db.execute('BEGIN IMMEDIATE')
        _assert_no_live_stream(db)
        if db.execute('SELECT 1 FROM x_metadata_preflight_runs WHERE approval_id=? OR request_id=?',
                      (approval['approval_id'], identity)).fetchone():
            _blocked('already-attempted')
        exposure = reserved_exposure(db)
        if exposure['unknown_runs']:
            _blocked('trial-exposure-unresolved')
        reserve = approval.get('metadata_reserve_micros')
        prior = exposure['known_reserved_micros'] + approval['trial_spent_micros']
        if (reserve is None and prior >= approval['trial_limit_micros']
                or reserve is not None and prior + reserve > approval['trial_limit_micros']):
            _blocked('trial-exposure-exhausted')
        db.execute('INSERT INTO x_metadata_preflight_runs '
                   '(request_id,approval_id,approved_at,run_prepared_at,expires_at,account_anchor,'
                   'reserved_micros,cost_status,max_requests,status,result) '
                   'VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                   (identity, approval['approval_id'], approval['approved_at'],
                    approval.get('run_prepared_at', approval['approved_at']), approval['expires_at'],
                    json.dumps(approval['account_evidence'], sort_keys=True), reserve, 'unknown' if reserve is None else 'bounded', approval['max_requests'], 'reserved',
                    '{"status":"blocked","reason":"x-preflight-incomplete-or-interrupted"}'))
    return identity


def _claim_request(db, run_id, path, approval, now):
    if db.in_transaction:
        _blocked('ledger-transaction-open')
    with db:
        db.execute('BEGIN IMMEDIATE')
        _assert_no_live_stream(db)
        row = db.execute('SELECT requests_admitted,max_requests,status FROM x_metadata_preflight_runs WHERE request_id=?',
                         (run_id,)).fetchone()
        if not row or row[2] not in ('reserved', 'running') or row[0] >= row[1]:
            _blocked('request-budget-exhausted')
        identity = hashlib.sha256(f'{run_id}:{row[0]}:{path}'.encode()).hexdigest()
        db.execute('INSERT INTO x_metadata_preflight_requests VALUES(?,?,?,?,?)',
                   (identity, run_id, path, _utc(now).isoformat(), approval.get('metadata_max_request_micros')))
        db.execute('UPDATE x_metadata_preflight_runs SET requests_admitted=requests_admitted+1,status=? WHERE request_id=?',
                   ('running', run_id))
    return identity


def _params(path, params):
    if type(path) is not str or path not in PATHS or type(params) is not dict:
        _blocked('endpoint-invalid')
    expected = BASE_PARAMS[path]
    extra = set(params) - set(expected)
    if extra not in (set(), {'pagination_token'}) or (extra and path not in (RULES, CONNECTIONS)):
        _blocked('parameters-invalid')
    if any(params.get(k) != v or type(params.get(k)) is not type(v) for k, v in expected.items()):
        _blocked('parameters-invalid')
    if extra:
        token = params['pagination_token']
        pattern = r'[0-9A-Va-v]{16}' if path == RULES else r'[A-Za-z0-9_-]{1,1024}={0,2}'
        if type(token) is not str or re.fullmatch(pattern, token) is None:
            _blocked('pagination-invalid')


def _json(body):
    def constant(_value):
        raise ValueError
    def unique(pairs):
        result = {}
        for k, v in pairs:
            if k in result:
                raise ValueError
            result[k] = v
        return result
    return json.loads(body, parse_constant=constant, parse_float=Decimal, object_pairs_hook=unique)


async def _close_owned(response, session):
    """Finite shielded cleanup, including cancellation; failed closure is fatal."""
    failed = False
    try:
        if response is not None:
            response.close()
    except Exception:
        failed = True
    try:
        task = asyncio.create_task(session.close())
    except Exception:
        _blocked('cleanup-failed')
    deadline = asyncio.get_running_loop().time() + CLOSE_SECONDS
    cancelled = False
    while not task.done():
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            task.cancel()
            _blocked('cleanup-failed')
        try:
            await asyncio.wait_for(asyncio.shield(task), remaining)
        except asyncio.CancelledError:
            cancelled = True
        except Exception:
            failed = True
            break
    try:
        failed |= task.cancelled() or not task.done() or task.exception() is not None
        failed |= session.closed is not True or (response is not None and response.closed is not True)
    except Exception:
        failed = True
    if failed:
        if not task.done():
            task.cancel()
        _blocked('cleanup-failed')
    if cancelled:
        raise asyncio.CancelledError


class AiohttpTransport:
    """Inert constructor; fresh session per request; no cookies/proxy/redirect/retry."""
    def __init__(self, *, enabled=False, admission=None, token_provider=None, session_factory=None):
        self.enabled = enabled
        self.admission = admission
        self.token_provider = token_provider
        self.session_factory = session_factory

    async def get(self, path, params, request_id):
        if self.enabled is not True:
            _blocked('transport-disabled')
        _params(path, params)
        if type(request_id) is not str or re.fullmatch(r'[0-9a-f]{64}', request_id) is None:
            _blocked('request-id-invalid')
        if self.session_factory is None and aiohttp.__version__ != PINNED_AIOHTTP:
            _blocked('transport-version-unreviewed')
        try:
            admitted = callable(self.admission) and self.admission(request_id, path) is True
        except PreflightBlocked:
            raise
        except Exception:
            admitted = False
        if not admitted:
            _blocked('durable-admission-required')
        try:
            token = self.token_provider()
            if (type(token) is not str or not 1 <= len(token) <= 8192 or not token.isascii()
                    or any(ord(c) <= 32 or ord(c) >= 127 for c in token)):
                raise ValueError
        except Exception:
            _blocked('token-unavailable')
        headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
                   'Accept-Encoding': 'identity', 'User-Agent': 'TechPhaseResearchMetadata/1.0'}
        token = None
        session, response = None, None
        try:
            factory = self.session_factory if self.session_factory is not None else aiohttp.ClientSession
            session = factory(trust_env=False, auth=None, cookie_jar=aiohttp.DummyCookieJar(),
                              auto_decompress=False, raise_for_status=False,
                              timeout=aiohttp.ClientTimeout(total=REQUEST_SECONDS, connect=10, sock_read=10))
            if not hasattr(session, '_retry_connection'):
                _blocked('retry-control-unavailable')
            session._retry_connection = False
            if session._retry_connection is not False:
                _blocked('retry-control-unavailable')
            async with asyncio.timeout(REQUEST_SECONDS):
                response = await session.get(ORIGIN + path, params=dict(params), headers=headers,
                                             allow_redirects=False, ssl=True, proxy=None, auth=None)
                if response.status in (401, 403):
                    _blocked('scope-denied')
                if response.status == 402:
                    _blocked('credits-denied')
                if response.status == 429:
                    _blocked('rate-limited')
                if response.status != 200:
                    _blocked('http-failed')
                if (response.headers.get('Content-Type', '').split(';', 1)[0].strip().lower() != 'application/json'
                        or response.headers.get('Content-Encoding', 'identity').lower() != 'identity'):
                    _blocked('response-format-invalid')
                body = bytearray()
                while True:
                    size = min(65536, MAX_BODY_BYTES + 1 - len(body))
                    block = await response.content.read(size)
                    if type(block) is not bytes or len(block) > size:
                        _blocked('response-size-invalid')
                    if not block:
                        break
                    body.extend(block)
                    if len(body) > MAX_BODY_BYTES:
                        _blocked('response-too-large')
                try:
                    return _json(bytes(body))
                except (ValueError, UnicodeError, RecursionError):
                    _blocked('response-json-invalid')
        except PreflightBlocked:
            raise
        except Exception:
            _blocked('transport-failed')
        finally:
            headers.clear()
            if session is not None:
                await _close_owned(response, session)


def _payload(payload):
    if type(payload) is not dict or 'errors' in payload and payload['errors'] != []:
        _blocked('response-incomplete')
    return payload


def _data(payload):
    payload = _payload(payload)
    if type(payload.get('data')) is not dict:
        _blocked('response-schema-invalid')
    if 'meta' in payload:
        meta = payload['meta']
        if type(meta) is not dict or 'next_token' in meta:
            _blocked('response-incomplete')
    return payload['data']


def _page(payload, path):
    payload = _payload(payload)
    data, meta = payload.get('data', []), payload.get('meta')
    maximum = 1000 if path == RULES else 100
    if type(data) is not list or len(data) > maximum or type(meta) is not dict:
        _blocked('inventory-incomplete')
    if _integer(meta.get('result_count'), 0, maximum) != len(data):
        _blocked('inventory-count-mismatch')
    token = meta.get('next_token')
    if 'next_token' in meta:
        _params(path, dict(BASE_PARAMS[path], pagination_token=token))
        if not data:
            _blocked('inventory-incomplete')
    return data, token


def _rules(rows):
    """Sanitize a COMPLETE inventory, including an empty/owned-subset inventory.

    Missing reviewed rules are reported separately, never created. Foreign,
    ambiguous, and duplicate rules block. Completeness is pagination evidence;
    it does not mean the app already has all rules needed to activate a stream.
    """
    result, seen_ids, seen_rules = [], set(), set()
    allowed = {(r['value'], r['tag']) for r in x_stream.manifest()}
    for row in rows:
        if (type(row) is not dict or type(row.get('id')) is not str
                or DIGITS.fullmatch(row['id']) is None
                or type(row.get('value')) is not str or type(row.get('tag')) is not str
                or (row['value'], row['tag']) not in allowed):
            _blocked('foreign-or-unknown-rule')
        key = row['value'], row['tag']
        if row['id'] in seen_ids or key in seen_rules:
            _blocked('rule-set-incomplete-or-duplicate')
        seen_ids.add(row['id'])
        seen_rules.add(key)
        result.append({k: row[k] for k in ('id', 'value', 'tag')})
    return result


def _counts(payload, inventory):
    data = _data(payload)
    app = data.get('client_app_rules_count')
    apps = data.get('all_project_client_apps')
    if type(app) is not dict or type(apps) is not list or not 1 <= len(apps) <= 100:
        _blocked('rule-count-schema-invalid')
    app_id = _identity(app.get('client_app_id'))
    count = _integer(app.get('rule_count'))
    project = _count(data.get('project_rules_count'))
    cap = _count(data.get('cap_per_client_app'))
    project_cap = _count(data.get('cap_per_project'))
    found = {}
    for item in apps:
        if type(item) is not dict:
            _blocked('rule-count-schema-invalid')
        identity = _identity(item.get('client_app_id'))
        if identity in found:
            _blocked('rule-count-schema-invalid')
        found[identity] = _integer(item.get('rule_count'))
    if (count != len(inventory) or found.get(app_id) != count or sum(found.values()) != project
            or count > cap or project > project_cap):
        _blocked('rule-count-mismatch')
    return {'client_app_id': app_id, 'client_app_rules_count': count, 'project_rules_count': project,
            'cap_per_client_app': cap, 'cap_per_project': project_cap,
            'other_app_rule_count': project - count, 'project_app_count': len(apps)}


def _connections(rows):
    seen = set()
    active = {}
    inactive = 0
    for row in rows:
        if (type(row) is not dict or type(row.get('id')) is not str
                or re.fullmatch(r'[A-Za-z0-9_-]{1,128}', row['id']) is None
                or row['id'] in seen or row.get('endpoint_name') not in ENDPOINT_NAMES):
            _blocked('connection-schema-invalid')
        seen.add(row['id'])
        connected = _utc(row.get('connected_at'))
        disconnected = row.get('disconnected_at')
        if disconnected is None:
            name = row['endpoint_name']
            active[name] = active.get(name, 0) + 1
        else:
            if _utc(disconnected) < connected:
                _blocked('connection-schema-invalid')
            inactive += 1
    return {'active_count': sum(active.values()), 'active_by_endpoint': dict(sorted(active.items())),
            'inactive_count': inactive, 'inventory_complete': True,
            'account_wide_consumers_verified': False}


def _usage(payload, app_id):
    data = _data(payload)
    # X's usage contract reports counts as decimal strings; these are not dollars.
    project_id = _identity(data.get('project_id'))
    usage = _count(data.get('project_usage'))
    cap = _count(data.get('project_cap'))
    reset = _integer(data.get('cap_reset_day'), 1, 31)
    apps = data.get('daily_client_app_usage')
    if type(apps) is not list or not 1 <= len(apps) <= 100:
        _blocked('usage-app-identity-unverified')
    seen = set()
    other = 0
    current = 0
    for app in apps:
        if type(app) is not dict:
            _blocked('usage-schema-invalid')
        identity = _identity(app.get('client_app_id'))
        entries = app.get('usage')
        if identity in seen or type(entries) is not list or len(entries) > 1:
            _blocked('usage-schema-invalid')
        seen.add(identity)
        if _integer(app.get('usage_result_count'), 0, 1) != len(entries):
            _blocked('usage-schema-invalid')
        amount = 0
        for entry in entries:
            if type(entry) is not dict or type(entry.get('date')) is not str:
                _blocked('usage-schema-invalid')
            try:
                # Docs expose a string date; allow ISO date and ISO UTC timestamps.
                datetime.fromisoformat(entry['date'].replace('Z', '+00:00'))
            except (ValueError, TypeError):
                _blocked('usage-schema-invalid')
            amount += _count(entry.get('usage'))
        if identity == app_id:
            current = amount
        else:
            other += amount
    if app_id not in seen:
        _blocked('usage-app-identity-unverified')
    return {'project_id': project_id, 'project_usage_posts': usage, 'project_cap_posts': cap,
            'cap_reset_day': reset, 'current_app_usage_posts_one_day': current,
            'other_app_usage_posts_one_day': other, 'counts_usage_app_identity_matches': True,
            'money_spend_or_cap_verified': False}


def _credits(payload):
    data = _data(payload)
    values = {}
    for key in ('prepaid_balance', 'free_balance', 'total_balance'):
        value = data.get(key)
        if type(value) not in (int, float, Decimal):
            _blocked('credits-schema-invalid')
        decimal = Decimal(str(value))
        if not decimal.is_finite() or abs(decimal) > 10**9 or decimal.as_tuple().exponent < -9:
            _blocked('credits-schema-invalid')
        if key != 'prepaid_balance' and decimal < 0:
            _blocked('credits-schema-invalid')
        values[key] = decimal
    if abs(values['total_balance'] - max(Decimal(0), values['prepaid_balance'] + values['free_balance'])) > Decimal('0.000001'):
        _blocked('credits-balance-mismatch')
    grants = data.get('free_grants')
    if type(grants) is not list or len(grants) > 100:
        _blocked('credits-schema-invalid')
    expiries = []
    without_expiry = 0
    for grant in grants:
        if type(grant) is not dict or type(grant.get('amount')) not in (int, float, Decimal):
            _blocked('credits-schema-invalid')
        amount = Decimal(str(grant['amount']))
        if not amount.is_finite() or not 0 <= amount <= 10**9 or amount.as_tuple().exponent < -9:
            _blocked('credits-schema-invalid')
        if 'expires_at' not in grant:
            without_expiry += 1
            continue
        expiry = grant['expires_at']
        if type(expiry) is not str or len(expiry) > 40:
            _blocked('credits-schema-invalid')
        expiries.append(_utc(expiry))
    return {'currency': 'USD', **{key: format(value, 'f') for key, value in values.items()},
            'free_grant_count': len(grants), 'free_grants_without_expiry_count': without_expiry,
            'earliest_known_free_grant_expiry': min(expiries).isoformat() if expiries else None,
            'cycle_cap_verified': False, 'auto_recharge_verified': False}


class Checker:
    """Default-off metadata-only runner. Caller owns the supplied SQLite DB.

    Before each I/O, reserve_request (if supplied) receives keyword arguments
    approval_id, request_id, path, reserve_micros (the full run reserve). It must
    return exactly True; it can enforce additional service policy. The local
    reservation and one-shot claim are already committed at that point.
    """
    def __init__(self, *, db=None, enabled=False, approval=None, token_provider=None,
                 transport_factory=None, reserve_request=None, clock=None, statvfs=None):
        self.db = db
        self.enabled = enabled
        self.approval = approval
        self.token_provider = token_provider
        self.transport_factory = transport_factory
        self.reserve_request = reserve_request
        self.clock = clock if clock is not None else lambda: datetime.now(timezone.utc)
        self.statvfs = statvfs
        self.run_id = None
        self.required_storage = None
        self.client = None
        self.claims = set()
        self.report = {'status': 'disabled', 'reason': 'x-preflight-disabled'}

    def _check_storage(self):
        self.report['disk'] = local_free_space(statvfs=self.statvfs, minimum_free_bytes=self.required_storage)
        if not self.report['disk']['metadata_storage_sufficient']:
            _blocked('volume-space-insufficient')

    def _admission(self, request_id, path):
        # Consume an in-memory capability once; durable claims forbid restarts.
        if (request_id, path) not in self.claims:
            return False
        validate_approval(self.approval, self.clock())
        self._check_storage()
        if self.db.in_transaction:
            return False
        row = self.db.execute('SELECT 1 FROM x_metadata_preflight_requests WHERE request_id=? AND run_id=? AND path=?',
                              (request_id, self.run_id, path)).fetchone()
        if not row:
            return False
        self.claims.remove((request_id, path))
        return True

    async def _get(self, path, params):
        _params(path, params)
        validate_approval(self.approval, self.clock())
        self._check_storage()
        request_id = _claim_request(self.db, self.run_id, path, self.approval, self.clock())
        if self.reserve_request is not None:
            try:
                admitted = self.reserve_request(approval_id=self.approval['approval_id'], request_id=request_id,
                                                path=path, reserve_micros=self.approval.get('metadata_reserve_micros'))
            except Exception:
                _blocked('service-admission-failed')
            if admitted is not True:
                _blocked('service-admission-required')
        self.claims.add((request_id, path))
        if self.client is None:
            factory = self.transport_factory if self.transport_factory is not None else AiohttpTransport
            self.client = factory(enabled=True, admission=self._admission, token_provider=self.token_provider)
        try:
            return await self.client.get(path, dict(params), request_id)
        finally:
            self.claims.discard((request_id, path))

    async def _list(self, path):
        rows, seen = [], set()
        params = dict(BASE_PARAMS[path])
        for _page_number in range(self.approval['max_pages']):
            page, token = _page(await self._get(path, params), path)
            rows.extend(page)
            if len(rows) > (MAX_RULES if path == RULES else MAX_CONNECTIONS):
                _blocked('inventory-too-large')
            if token is None:
                return rows
            if token in seen:
                _blocked('pagination-repeated')
            seen.add(token)
            params['pagination_token'] = token
        _blocked('inventory-page-limit')

    def _persist(self):
        if self.run_id is None:
            return
        if self.db.in_transaction:
            _blocked('ledger-transaction-open')
        with self.db:
            count = self.db.execute('SELECT requests_admitted FROM x_metadata_preflight_runs WHERE request_id=?',
                                    (self.run_id,)).fetchone()[0]
            self.report['requests_admitted'] = count
            serialized = json.dumps(self.report, sort_keys=True)
            if len(serialized.encode('utf-8')) > MAX_REPORT_BYTES:
                _blocked('report-too-large')
            self.db.execute('UPDATE x_metadata_preflight_runs SET status=?,result=? WHERE request_id=?',
                            (self.report['status'], serialized, self.run_id))

    async def run(self):
        if self.enabled is not True:
            return {'status': 'disabled', 'reason': 'x-preflight-disabled'}
        if self.run_id is not None:
            return {'status': 'blocked', 'reason': 'x-preflight-already-attempted'}
        self.report = {'status': 'blocked', 'reason': 'x-preflight-incomplete',
                       'stream_activation_authorized': False, 'stream_entitlement_verified': False,
                       'account_cap_verified': False, 'auto_recharge_verified': False,
                       'account_wide_consumers_verified': False}
        try:
            self.approval = validate_approval(self.approval, self.clock())
            if not isinstance(self.db, sqlite3.Connection):
                _blocked('durable-ledger-required')
            self.required_storage = metadata_storage_reserve(self.db, self.approval['max_requests'])
            self._check_storage()
            schema(self.db)
            self.run_id = _reserve_run(self.db, self.approval)
            self.report['request_id'] = self.run_id
            self.report['reserved_micros'] = self.approval.get('metadata_reserve_micros')
            self.report['cost_status'] = 'bounded' if self.report['reserved_micros'] is not None else 'unknown'
            self.report['max_requests'] = self.approval['max_requests']
            evidence = self.approval['account_evidence']
            self.report['account_anchor'] = {
                'historical_verified_at': _utc(evidence['verified_at']).isoformat(),
                'historical_cycle_cap_micros': evidence['cycle_cap_micros'],
                'historical_baseline_micros': evidence['baseline_micros'],
                'fresh_spend_verified': False, 'fresh_headroom_verified': False}
            if self.approval['cost_mode'] == 'unknown-explicitly-approved':
                self.report['account_anchor'].update(
                    cycle_start_date=evidence['cycle_start_date'],
                    cycle_end_date=evidence['cycle_end_date'],
                    session_expires_at=_utc(evidence['session_expires_at']).isoformat())
            inventory = _rules(await self._list(RULES))
            self.report['inventory'] = inventory
            self.report['rules_complete'] = True
            self.report['inventory_complete'] = True
            present = {(row['value'], row['tag']) for row in inventory}
            self.report['missing_rules'] = [row for row in x_stream.manifest()
                                            if (row['value'], row['tag']) not in present]
            self.report['required_rules_present'] = not self.report['missing_rules']
            counts = _counts(await self._get(COUNTS, dict(BASE_PARAMS[COUNTS])), inventory)
            self.report['rule_counts'] = counts
            if counts['other_app_rule_count']:
                _blocked('other-app-rules-present')
            connections = _connections(await self._list(CONNECTIONS))
            self.report['connections'] = connections
            if connections['active_count']:
                _blocked('active-consumer-present')
            usage = _usage(await self._get(USAGE, dict(BASE_PARAMS[USAGE])), counts['client_app_id'])
            self.report['usage'] = usage
            if usage['other_app_usage_posts_one_day']:
                _blocked('other-app-usage-present')
            self.report['credits'] = _credits(await self._get(CREDITS, dict(BASE_PARAMS[CREDITS])))
            validate_approval(self.approval, self.clock())
            self.report.update(status='observed' if self.report['cost_status'] == 'unknown' else 'verified',
                               reason='x-preflight-metadata-only',
                               verified_at=_utc(self.clock()).isoformat())
        except asyncio.CancelledError:
            self.report.update(status='blocked', reason='x-preflight-interrupted')
            self._persist()
            raise
        except PreflightBlocked as exc:
            self.report.update(status='blocked', reason=str(exc))
        except Exception:
            self.report.update(status='blocked', reason='x-preflight-internal-failure')
        try:
            self._persist()
        except Exception:
            self.report.update(status='blocked', reason='x-preflight-result-persistence-failed')
        return dict(self.report)
