"""Opt-in private Web Push pilot. Shared source reads; durable per-device dedup.

No delivery until configured. Ambiguous network failures are NOT retried: this
pilot favors avoiding duplicate alerts; its ledger records uncertain delivery.
"""
import base64
from datetime import datetime, timezone
import hashlib
import json
import math
import os
import re
import sqlite3
import time
from urllib.parse import urlsplit, urlencode, urlunsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

DEVICE_LIMIT = 20
DELIVERY_RETENTION_SECONDS = 7 * 86400
PROVIDER_DURATION_LIMIT_MS = 60_000


def configuration():
    ready = all(os.environ.get(k, '').strip() for k in (
        'WEB_PUSH_PRIVATE_KEY', 'WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_SUBJECT'))
    enabled = os.environ.get('WEB_PUSH_ENABLED', '').lower() == 'true' and ready
    return {'memberAccessVersion': 1 if os.environ.get('WEB_PUSH_MEMBERSHIP_URL') else 0, 'enabled': enabled, 'publicKey': os.environ.get('WEB_PUSH_PUBLIC_KEY', '') if enabled else ''}


def member_expiry(owner):
    """Fresh authoritative check. Errors and redirects fail closed; never log credentials."""
    base = os.environ.get('WEB_PUSH_MEMBERSHIP_URL', '')
    token = os.environ.get('RESEARCH_API_TOKEN', '')
    url = urlsplit(base)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.fragment or not token:
        return 0
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json'}
    bypass = os.environ.get('WEB_PUSH_MEMBERSHIP_BYPASS', '')
    if bypass:
        headers['x-vercel-protection-bypass'] = bypass
    target = urlunsplit((url.scheme, url.netloc, url.path, urlencode({'memberId': owner}), ''))
    try:
        with build_opener(NoRedirect).open(Request(target, headers=headers), timeout=8) as response:
            raw = response.read(4097)
            if len(raw) > 4096:
                return 0
            data = json.loads(raw)
        until = data.get('accessExpiresAt')
        return until if data.get('ok') is True and data.get('pro') is True and isinstance(until, (int, float)) and not isinstance(until, bool) and math.isfinite(until) else 0
    except Exception:
        return 0


def connect(path):
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.executescript('''
    CREATE TABLE IF NOT EXISTS push_devices (
      id TEXT PRIMARY KEY, subscription TEXT NOT NULL, tickers TEXT NOT NULL,
      language TEXT NOT NULL, since REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS push_deliveries (
      device_id TEXT NOT NULL, event_key TEXT NOT NULL, status TEXT NOT NULL,
      attempted_at REAL NOT NULL, observed_at REAL, provider_duration_ms REAL,
      PRIMARY KEY(device_id,event_key));
    ''')
    columns = {row['name'] for row in db.execute('PRAGMA table_info(push_deliveries)')}
    if 'observed_at' not in columns:
        db.execute('ALTER TABLE push_deliveries ADD COLUMN observed_at REAL')
    if 'provider_duration_ms' not in columns:
        db.execute('ALTER TABLE push_deliveries ADD COLUMN provider_duration_ms REAL')
    columns = {row['name'] for row in db.execute('PRAGMA table_info(push_devices)')}
    if 'owner_id' not in columns:
        db.execute("ALTER TABLE push_devices ADD COLUMN owner_id TEXT")
    if 'access_until' not in columns:
        db.execute("ALTER TABLE push_devices ADD COLUMN access_until REAL")
    return db


def validate_subscription(value):
    if not isinstance(value, dict):
        raise ValueError('invalid-subscription')
    endpoint = value.get('endpoint', '')
    if not isinstance(endpoint, str) or len(endpoint) > 2048:
        raise ValueError('invalid-endpoint')
    url = urlsplit(endpoint)
    # Strict push-service allowlist; never POST to user-selected arbitrary hosts.
    if (url.scheme != 'https' or url.hostname not in {
        'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'
    } or url.port not in (None, 443) or url.username or url.password or url.fragment):
        raise ValueError('unsupported-push-service')
    keys = value.get('keys', {})
    for name, size in [('p256dh', 65), ('auth', 16)]:
        raw = keys.get(name, '') if isinstance(keys, dict) else ''
        if not isinstance(raw, str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,100}={0,2}', raw):
            raise ValueError('invalid-push-key')
        try:
            decoded = base64.urlsafe_b64decode(raw + '=' * (-len(raw) % 4))
        except ValueError as exc:
            raise ValueError('invalid-push-key') from exc
        if len(decoded) != size or name == 'p256dh' and decoded[0] != 4:
            raise ValueError('invalid-push-key')
    return {'endpoint': endpoint, 'keys': {k: keys[k] for k in ('p256dh', 'auth')}}


def register(db, payload, allowed, now=None, device_limit=DEVICE_LIMIT):
    subscription = validate_subscription(payload.get('subscription'))
    tickers = ['*'] if payload.get('allTargets') is True else payload.get('tickers')
    lang = payload.get('language', 'ja')
    if (not isinstance(tickers, list) or not 1 <= len(tickers) <= 50 or
            any(not isinstance(t, str) or t not in allowed and not (t == '*' and payload.get('allTargets') is True) for t in tickers) or lang not in {'ja', 'en'}):
        raise ValueError('invalid-preferences')
    device = hashlib.sha256(subscription['endpoint'].encode()).hexdigest()
    now = time.time() if now is None else now
    with db:
        if not db.execute('SELECT 1 FROM push_devices WHERE id=?', (device,)).fetchone() and db.execute(
                'SELECT COUNT(*) FROM push_devices').fetchone()[0] >= device_limit:
            raise ValueError('pilot-device-limit')
        # Updating preferences resets the baseline, never backfills old alerts.
        db.execute('''INSERT INTO push_devices (id,subscription,tickers,language,since,active) VALUES(?,?,?,?,?,1)
            ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,
            tickers=excluded.tickers,language=excluded.language,since=excluded.since,active=1''',
            (device, json.dumps(subscription), json.dumps(sorted(set(tickers))), lang, now))
    return {'registered': True}


def member_identity(payload):
    owner = payload.get('memberId')
    if not isinstance(owner, str) or not re.fullmatch(r'user_[A-Za-z0-9]{1,128}', owner):
        raise ValueError('invalid-member')
    return owner


def register_member(db, payload, allowed, now=None):
    owner = member_identity(payload)
    now = time.time() if now is None else now
    until = payload.get('accessExpiresAt')
    if not isinstance(until, (float, int)) or isinstance(until, bool) or not math.isfinite(until) or until <= now:
        raise ValueError('expired-membership')
    sub = validate_subscription(payload.get('subscription'))
    device = hashlib.sha256(sub['endpoint'].encode()).hexdigest()
    with db:
        db.execute('BEGIN IMMEDIATE')
        existing = db.execute('SELECT * FROM push_devices WHERE id=?', (device,)).fetchone()
        if existing and existing['owner_id'] not in (None, owner):
            raise ValueError('device-owned-by-another-member')
        if existing and json.loads(existing['subscription']) != sub:
            raise ValueError('subscription-mismatch')
        if not existing and db.execute('SELECT COUNT(*) FROM push_devices WHERE owner_id=?', (owner,)).fetchone()[0] >= 10:
            raise ValueError('member-device-limit')
        # Save all fields atomically. Existing delivery history is preserved.
        tickers = ['*'] if payload.get('allTargets') is True else payload.get('tickers')
        lang = payload.get('language', 'ja')
        if (not isinstance(tickers, list) or not 1 <= len(tickers) <= 50 or
                any(not isinstance(t, str) or t not in allowed and not (t == '*' and payload.get('allTargets') is True) for t in tickers)
                or lang not in {'ja', 'en'}):
            raise ValueError('invalid-preferences')
        db.execute("""INSERT INTO push_devices (id,subscription,tickers,language,since,active,owner_id,access_until)
          VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET tickers=excluded.tickers,
          language=excluded.language,since=excluded.since,active=1,owner_id=excluded.owner_id,access_until=excluded.access_until""",
          (device,json.dumps(sub),json.dumps(sorted(set(tickers))),lang,now,owner,until))
    return {'registered': True}


def member_action(db, payload, action, transport=None, now=None):
    owner = member_identity(payload)
    now = time.time() if now is None else now
    sub = validate_subscription(payload.get('subscription'))
    device = hashlib.sha256(sub['endpoint'].encode()).hexdigest()
    row = db.execute('SELECT * FROM push_devices WHERE id=?', (device,)).fetchone()
    owns = bool(row and row['owner_id'] == owner and json.loads(row['subscription']) == sub)
    if not owns:
        if action == 'status':
            return {'registered': False}
        raise ValueError('not-owned')
    if action == 'remove':
        return remove(db, payload)
    eligible = bool(row['active'] and row['access_until'] and row['access_until'] > now)
    if action == 'status':
        return {'registered': eligible}
    if action != 'test' or not eligible:
        raise ValueError('expired-membership')
    if member_expiry(owner) <= now:
        raise ValueError('expired-membership')
    return test_notification(db, payload, transport, now)


def revoke_member(db, payload):
    owner = member_identity(payload)
    with db:
        db.execute('UPDATE push_devices SET active=0,access_until=0 WHERE owner_id=?', (owner,))
    return {'revoked': True}


def remove(db, payload):
    subscription = validate_subscription(payload.get('subscription'))
    device = hashlib.sha256(subscription['endpoint'].encode()).hexdigest()
    with db:
        db.execute('DELETE FROM push_devices WHERE id=?', (device,))
        db.execute('DELETE FROM push_deliveries WHERE device_id=?', (device,))
    return {'registered': False}


def device_status(db, payload):
    subscription = validate_subscription(payload.get('subscription'))
    device = hashlib.sha256(subscription['endpoint'].encode()).hexdigest()
    row = db.execute('SELECT * FROM push_devices WHERE id=? AND active=1', (device,)).fetchone()
    registered = bool(row and json.loads(row['subscription']) == subscription)
    return {'registered': registered}


def test_notification(db, payload, transport=None, now=None):
    if not configuration()['enabled']:
        raise ValueError('disabled')
    subscription = validate_subscription(payload.get('subscription'))
    if not device_status(db, payload)['registered']:
        raise ValueError('not-registered')
    device = hashlib.sha256(subscription['endpoint'].encode()).hexdigest()
    now = time.time() if now is None else now
    # Reserve before transport, including ambiguous outcomes; no automatic retry.
    with db:
        db.execute('CREATE TABLE IF NOT EXISTS push_test_attempts (device_id TEXT PRIMARY KEY, attempted_at REAL NOT NULL)')
        claim = db.execute("""INSERT INTO push_test_attempts VALUES(?,?)
            ON CONFLICT(device_id) DO UPDATE SET attempted_at=excluded.attempted_at
            WHERE push_test_attempts.attempted_at <= excluded.attempted_at - 60""", (device, now)).rowcount
    if not claim:
        return {'accepted': False, 'retryAfter': 60}
    row = db.execute('SELECT language FROM push_devices WHERE id=?', (device,)).fetchone()
    ja = row['language'] == 'ja'
    message = {'title': 'Tech Phase · ' + ('テスト通知' if ja else 'Test notification'),
               'body': 'この通知が届いたら、設定画面で「届きました」を押してください。' if ja else 'If you see this, select “Received” in notification settings.',
               'tag': 'tech-phase-test', 'url': '/research/notifications'}
    failure_kind = None
    try:
        code = (transport or send)(subscription, message)
    except Exception as exc:
        code = 0
        failure_kind = type(exc).__name__ if type(exc).__name__ in {
            'ImportError', 'ModuleNotFoundError', 'TypeError', 'ValueError',
            'ConnectionError', 'ConnectTimeout', 'ReadTimeout', 'Timeout',
            'SSLError', 'KeyError',
        } else 'other'
    if not 200 <= code < 300:
        # Never record subscription endpoints, keys, request bodies or provider response text.
        print(f'push-test-failed provider_status={code} failure_kind={failure_kind or "provider"}', flush=True)
    if code in (404, 410):
        remove(db, payload)
    return {'accepted': 200 <= code < 300, 'expired': code in (404, 410),
            'providerStatus': code, 'failureKind': failure_kind}


def parse_event_time(value):
    """Return a bounded aware UTC event time, or None for unusable evidence."""
    if not isinstance(value, str) or not 1 <= len(value) <= 64:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(timezone.utc)
    except (AttributeError, TypeError, ValueError, OverflowError):
        return None


def normalize_event(item):
    """Validate public change data before it can reach a push provider."""
    if not isinstance(item, dict):
        return None
    ticker, firm = item.get('ticker'), item.get('firm')
    if (not isinstance(ticker, str) or not re.fullmatch(r'[A-Z][A-Z0-9.-]{0,14}', ticker)
            or not isinstance(firm, str) or not 1 <= len(firm.strip()) <= 120):
        return None
    try:
        previous, latest = float(item.get('previous')), float(item.get('latest'))
    except (TypeError, ValueError, OverflowError):
        return None
    if (not math.isfinite(previous) or not math.isfinite(latest)
            or not 0 < previous <= 1_000_000_000 or not 0 < latest <= 1_000_000_000):
        return None
    published = parse_event_time(item.get('publishedAt'))
    observed = parse_event_time(item.get('observedAt'))
    if published is None or observed is None:
        return None
    try:
        observed_timestamp = observed.timestamp()
    except (OverflowError, OSError, ValueError):
        return None
    return {
        'ticker': ticker, 'firm': firm.strip(), 'previous': previous, 'latest': latest,
        'published': published, 'observed_timestamp': observed_timestamp,
    }


def event_key(item):
    # Same broker action reported by several accounts is one notification.
    date = item['published'].date().isoformat()
    facts = [item['ticker'], item['firm'].casefold(), float(item['previous']), float(item['latest']), date]
    return hashlib.sha256(json.dumps(facts).encode()).hexdigest()


def send(subscription, payload):
    import requests
    from pywebpush import webpush, WebPushException
    class NoRedirectSession(requests.Session):
        def request(self, method, url, **kwargs):
            kwargs['allow_redirects'] = False
            return super().request(method, url, **kwargs)
    try:
        with NoRedirectSession() as session:
            response = webpush(subscription_info=subscription, data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=os.environ['WEB_PUSH_PRIVATE_KEY'],
                vapid_claims={'sub': vapid_subject(os.environ['WEB_PUSH_SUBJECT'])},
                ttl=300, timeout=10, requests_session=session, headers={'Urgency': 'high'})
        return response.status_code
    except WebPushException as exc:
        return exc.response.status_code if exc.response is not None else 0


def vapid_subject(value):
    """py_vapid requires an HTTPS origin or mailto contact, without a URL path."""
    if value.startswith('mailto:'):
        return value
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('invalid-vapid-subject')
    return urlunsplit((parsed.scheme, parsed.netloc, '', '', ''))


def public_status(db, now=None):
    """Return bounded aggregate pilot state without endpoints, keys or payloads."""
    now = time.time() if now is None else float(now)
    devices = db.execute('SELECT COUNT(*) FROM push_devices WHERE active=1').fetchone()[0]
    row = db.execute('''SELECT
        COUNT(*) AS attempted,
        sum(CASE WHEN status='accepted' THEN 1 ELSE 0 END) AS accepted,
        sum(CASE WHEN status='uncertain' THEN 1 ELSE 0 END) AS uncertain,
        sum(CASE WHEN status='expired' THEN 1 ELSE 0 END) AS expired,
        sum(CASE WHEN observed_at IS NOT NULL AND attempted_at-observed_at BETWEEN 0 AND ?
            THEN 1 ELSE 0 END) AS latency_samples,
        avg(CASE WHEN observed_at IS NOT NULL AND attempted_at-observed_at BETWEEN 0 AND ?
            THEN attempted_at-observed_at END) AS latency_average,
        max(CASE WHEN observed_at IS NOT NULL AND attempted_at-observed_at BETWEEN 0 AND ?
            THEN attempted_at-observed_at END) AS latency_max,
        sum(CASE WHEN provider_duration_ms BETWEEN 0 AND ? THEN 1 ELSE 0 END) AS provider_samples,
        avg(CASE WHEN provider_duration_ms BETWEEN 0 AND ? THEN provider_duration_ms END) AS provider_average,
        max(CASE WHEN provider_duration_ms BETWEEN 0 AND ? THEN provider_duration_ms END) AS provider_max,
        sum(CASE WHEN observed_at IS NOT NULL AND attempted_at-observed_at BETWEEN 0 AND ?
            AND provider_duration_ms BETWEEN 0 AND ? THEN 1 ELSE 0 END) AS total_samples,
        avg(CASE WHEN observed_at IS NOT NULL AND attempted_at-observed_at BETWEEN 0 AND ?
            AND provider_duration_ms BETWEEN 0 AND ?
            THEN (attempted_at-observed_at)*1000+provider_duration_ms END) AS total_average,
        max(CASE WHEN observed_at IS NOT NULL AND attempted_at-observed_at BETWEEN 0 AND ?
            AND provider_duration_ms BETWEEN 0 AND ?
            THEN (attempted_at-observed_at)*1000+provider_duration_ms END) AS total_max,
        max(attempted_at) AS last_attempt
      FROM push_deliveries WHERE attempted_at>=? AND attempted_at<=?''',
        (DELIVERY_RETENTION_SECONDS, DELIVERY_RETENTION_SECONDS,
         DELIVERY_RETENTION_SECONDS,
         PROVIDER_DURATION_LIMIT_MS, PROVIDER_DURATION_LIMIT_MS,
         PROVIDER_DURATION_LIMIT_MS,
         DELIVERY_RETENTION_SECONDS, PROVIDER_DURATION_LIMIT_MS,
         DELIVERY_RETENTION_SECONDS, PROVIDER_DURATION_LIMIT_MS,
         DELIVERY_RETENTION_SECONDS, PROVIDER_DURATION_LIMIT_MS,
         now - 86400, now)).fetchone()
    last_attempt = row['last_attempt']
    return {
        'activeDevices': devices,
        'maxDevices': DEVICE_LIMIT,
        'attempted24Hours': row['attempted'] or 0,
        'accepted24Hours': row['accepted'] or 0,
        'uncertain24Hours': row['uncertain'] or 0,
        'expired24Hours': row['expired'] or 0,
        'detectionToAttemptSamples24Hours': row['latency_samples'] or 0,
        'detectionToAttemptAverageMs24Hours': round(row['latency_average'] * 1000) if row['latency_average'] is not None else None,
        'detectionToAttemptMaxMs24Hours': round(row['latency_max'] * 1000) if row['latency_max'] is not None else None,
        'providerResponseSamples24Hours': row['provider_samples'] or 0,
        'providerResponseAverageMs24Hours': round(row['provider_average']) if row['provider_average'] is not None else None,
        'providerResponseMaxMs24Hours': round(row['provider_max']) if row['provider_max'] is not None else None,
        'detectionToOutcomeSamples24Hours': row['total_samples'] or 0,
        'detectionToOutcomeAverageMs24Hours': round(row['total_average']) if row['total_average'] is not None else None,
        'detectionToOutcomeMaxMs24Hours': round(row['total_max']) if row['total_max'] is not None else None,
        'lastAttemptAt': datetime.fromtimestamp(last_attempt, timezone.utc).isoformat(
            timespec='milliseconds') if last_attempt is not None else None,
    }


def deliver(db, items, transport=send, now=None, monotonic_now=time.monotonic,
            wall_now=time.time, entitlement=member_expiry):
    if not configuration()['enabled']:
        return {'status': 'disabled', 'attempted': 0}
    now = wall_now() if now is None else now
    status_now = now
    attempted = accepted = uncertain = 0
    for device in db.execute('SELECT * FROM push_devices WHERE active=1').fetchall():
        if not device['owner_id'] and os.environ.get('WEB_PUSH_ALLOW_PILOT', '').lower() != 'true':
            continue
        verified_until = None
        watched = set(json.loads(device['tickers']))
        for raw_item in items:
            item = normalize_event(raw_item)
            if item is None:
                continue
            observed = item['observed_timestamp']
            # Late discoveries belong in history, never in a fresh-news push.
            if not 0 <= now - item['published'].timestamp() <= 900:
                continue
            if ('*' not in watched and item['ticker'] not in watched) or observed <= device['since'] or not 0 <= now - observed <= 300:
                continue
            key = event_key(item)
            # Record each network attempt when it actually starts. Reusing the
            # batch timestamp understates queueing for later devices.
            if db.execute('SELECT 1 FROM push_deliveries WHERE device_id=? AND event_key=?', (device['id'], key)).fetchone():
                continue
            if device['owner_id'] and verified_until is None:
                try:
                    verified_until = entitlement(device['owner_id'])
                except Exception:
                    verified_until = 0
            attempted_at = wall_now()
            if device['owner_id'] and (not isinstance(verified_until, (int, float)) or isinstance(verified_until, bool)
                    or not math.isfinite(verified_until) or verified_until <= attempted_at):
                continue
            current = db.execute('SELECT active,owner_id FROM push_devices WHERE id=?', (device['id'],)).fetchone()
            if not current or not current['active'] or current['owner_id'] != device['owner_id']:
                continue
            # Reserve before network; a restart cannot silently send it twice.
            with db:
                claim = db.execute('''INSERT OR IGNORE INTO push_deliveries
                    (device_id,event_key,status,attempted_at,observed_at) VALUES(?,?,?,?,?)''',
                    (device['id'], key, 'uncertain', attempted_at, observed)).rowcount
            if not claim:
                continue
            # A later device may start after the poll's reference timestamp.
            # Advance the aggregate boundary only from an actual claimed
            # attempt, while standalone status reads still reject future rows.
            status_now = max(status_now, attempted_at)
            ja = device['language'] == 'ja'
            payload = {'title': f"{item['ticker']} · " + ('目標株価の変更' if ja else 'Price target update'),
                       'body': f"{item['firm']}: ${item['previous']:g} → ${item['latest']:g}",
                       'tag': key, 'url': '/research#what-changed'}
            provider_started = monotonic_now()
            try:
                code = transport(json.loads(device['subscription']), payload)
            except Exception:
                code = 0  # Never log endpoint, keys, provider response, or payload.
            provider_finished = monotonic_now()
            provider_duration_ms = (provider_finished - provider_started) * 1000
            if (not math.isfinite(provider_duration_ms) or provider_duration_ms < 0 or
                    provider_duration_ms > PROVIDER_DURATION_LIMIT_MS):
                provider_duration_ms = None
            status = 'accepted' if 200 <= code < 300 else 'expired' if code in (404, 410) else 'uncertain'
            with db:
                db.execute('''UPDATE push_deliveries SET status=?,provider_duration_ms=?
                    WHERE device_id=? AND event_key=?''',
                    (status, provider_duration_ms, device['id'], key))
                if status == 'expired':
                    db.execute('DELETE FROM push_devices WHERE id=?', (device['id'],))
            attempted += 1
            accepted += status == 'accepted'
            uncertain += status == 'uncertain'
            if status == 'expired':
                break
    with db:
        db.execute('DELETE FROM push_deliveries WHERE attempted_at<?',
                   (now - DELIVERY_RETENTION_SECONDS,))
    return {'status': 'ready', 'attempted': attempted, 'accepted': accepted,
            'uncertain': uncertain, **public_status(db, status_now)}
