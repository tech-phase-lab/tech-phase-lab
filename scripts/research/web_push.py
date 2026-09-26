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
from urllib.parse import urlsplit

DEVICE_LIMIT = 20
DELIVERY_RETENTION_SECONDS = 7 * 86400
PROVIDER_DURATION_LIMIT_MS = 60_000


def configuration():
    ready = all(os.environ.get(k, '').strip() for k in (
        'WEB_PUSH_PRIVATE_KEY', 'WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_SUBJECT'))
    enabled = os.environ.get('WEB_PUSH_ENABLED', '').lower() == 'true' and ready
    return {'enabled': enabled, 'publicKey': os.environ.get('WEB_PUSH_PUBLIC_KEY', '') if enabled else ''}


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


def register(db, payload, allowed, now=None):
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
                'SELECT COUNT(*) FROM push_devices').fetchone()[0] >= DEVICE_LIMIT:
            raise ValueError('pilot-device-limit')
        # Updating preferences resets the baseline, never backfills old alerts.
        db.execute('''INSERT INTO push_devices VALUES(?,?,?,?,?,1)
            ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,
            tickers=excluded.tickers,language=excluded.language,since=excluded.since,active=1''',
            (device, json.dumps(subscription), json.dumps(sorted(set(tickers))), lang, now))
    return {'registered': True}


def remove(db, payload):
    subscription = validate_subscription(payload.get('subscription'))
    device = hashlib.sha256(subscription['endpoint'].encode()).hexdigest()
    with db:
        db.execute('DELETE FROM push_devices WHERE id=?', (device,))
        db.execute('DELETE FROM push_deliveries WHERE device_id=?', (device,))
    return {'registered': False}


def event_key(item):
    # Same broker action reported by several accounts is one notification.
    date = datetime.fromisoformat(item['publishedAt'].replace('Z', '+00:00')).astimezone(timezone.utc).date().isoformat()
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
                vapid_claims={'sub': os.environ['WEB_PUSH_SUBJECT']},
                ttl=300, timeout=10, requests_session=session, headers={'Urgency': 'high'})
        return response.status_code
    except WebPushException as exc:
        return exc.response.status_code if exc.response is not None else 0


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
      FROM push_deliveries WHERE attempted_at>=?''',
        (DELIVERY_RETENTION_SECONDS, DELIVERY_RETENTION_SECONDS,
         DELIVERY_RETENTION_SECONDS,
         PROVIDER_DURATION_LIMIT_MS, PROVIDER_DURATION_LIMIT_MS,
         PROVIDER_DURATION_LIMIT_MS,
         DELIVERY_RETENTION_SECONDS, PROVIDER_DURATION_LIMIT_MS,
         DELIVERY_RETENTION_SECONDS, PROVIDER_DURATION_LIMIT_MS,
         DELIVERY_RETENTION_SECONDS, PROVIDER_DURATION_LIMIT_MS,
         now - 86400)).fetchone()
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
            wall_now=time.time):
    if not configuration()['enabled']:
        return {'status': 'disabled', 'attempted': 0}
    now = wall_now() if now is None else now
    attempted = accepted = uncertain = 0
    for device in db.execute('SELECT * FROM push_devices WHERE active=1').fetchall():
        watched = set(json.loads(device['tickers']))
        for item in items:
            observed = datetime.fromisoformat(item['observedAt'].replace('Z', '+00:00')).timestamp()
            if ('*' not in watched and item['ticker'] not in watched) or observed <= device['since'] or not 0 <= now - observed <= 300:
                continue
            key = event_key(item)
            # Record each network attempt when it actually starts. Reusing the
            # batch timestamp understates queueing for later devices.
            attempted_at = wall_now()
            # Reserve before network; a restart cannot silently send it twice.
            with db:
                claim = db.execute('''INSERT OR IGNORE INTO push_deliveries
                    (device_id,event_key,status,attempted_at,observed_at) VALUES(?,?,?,?,?)''',
                    (device['id'], key, 'uncertain', attempted_at, observed)).rowcount
            if not claim:
                continue
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
            'uncertain': uncertain, **public_status(db, now)}
