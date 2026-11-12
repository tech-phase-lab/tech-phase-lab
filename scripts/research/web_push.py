"""Opt-in private Web Push pilot. Shared source reads; durable per-device dedup.

No delivery until configured. Ambiguous network failures are NOT retried: this
pilot favors avoiding duplicate alerts; its ledger records uncertain delivery.
"""
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
import re
import sqlite3
import time
from pathlib import Path
from functools import lru_cache
from urllib.parse import urlsplit, urlencode, urlunsplit
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler

DEVICE_LIMIT = 20
DELIVERY_RETENTION_SECONDS = 7 * 86400
PROVIDER_DURATION_LIMIT_MS = 60_000


def configuration():
    ready = all(os.environ.get(k, '').strip() for k in (
        'WEB_PUSH_PRIVATE_KEY', 'WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_SUBJECT'))
    enabled = os.environ.get('WEB_PUSH_ENABLED', '').lower() == 'true' and ready
    return {'preferencesVersion': 1, 'memberAccessVersion': 1 if os.environ.get('WEB_PUSH_MEMBERSHIP_URL') else 0, 'enabled': enabled, 'publicKey': os.environ.get('WEB_PUSH_PUBLIC_KEY', '') if enabled else ''}


def _membership_log(result, **detail):
    """One line per failed membership check, so a device that keeps turning itself off can be explained. Never carries the token, the address or the member's id."""
    print(json.dumps({'event': 'push-membership-check', 'result': result, **detail}), flush=True)


def member_expiry(owner):
    """Fresh authoritative check. Errors and redirects fail closed; never log credentials."""
    base = os.environ.get('WEB_PUSH_MEMBERSHIP_URL', '')
    token = os.environ.get('RESEARCH_API_TOKEN', '')
    url = urlsplit(base)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.fragment or not token:
        _membership_log('not-configured', hasUrl=bool(base), hasToken=bool(token))
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
                _membership_log('too-large')
                return 0
            data = json.loads(raw)
        until = data.get('accessExpiresAt')
        if data.get('ok') is True and data.get('pro') is True and isinstance(until, (int, float)) and not isinstance(until, bool) and math.isfinite(until):
            return until
        _membership_log('not-pro', ok=data.get('ok'), pro=data.get('pro'))
        return 0
    except HTTPError as error:
        _membership_log('http-error', status=error.code, host=url.hostname)
        return 0
    except Exception as error:
        _membership_log('error', kind=type(error).__name__, host=url.hostname)
        return 0


# The nine indicators a member can switch (Nov 4); the first six start on, the last three off.
ECON_KINDS = ('jobs', 'cpi', 'pce', 'fomc', 'adp', 'ism', 'gdp', 'retail', 'claims')
ECON_DEFAULT_ON = ['jobs', 'cpi', 'pce', 'fomc', 'adp', 'ism']
QUESTION_OWNER = re.compile(r'[a-f0-9]{64}')


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
    if 'weekly_notebook' not in columns:
        db.execute("ALTER TABLE push_devices ADD COLUMN weekly_notebook INTEGER NOT NULL DEFAULT 1")
    if 'weekly_draft' not in columns:
        # "週刊の下書きができた" notices: off until turned on; only the owner's screen offers the switch (owner, Nov 2).
        db.execute("ALTER TABLE push_devices ADD COLUMN weekly_draft INTEGER NOT NULL DEFAULT 0")
    if 'note_posts' not in columns:
        # "リゼルのひとりごと" notices are off until the member turns them on (owner, Nov 2).
        db.execute("ALTER TABLE push_devices ADD COLUMN note_posts INTEGER NOT NULL DEFAULT 0")
    for column, definition in (
            # Economic-indicator notices (Nov 4): on, for the six kinds the owner chose as the starting set.
            ('econ', 'INTEGER NOT NULL DEFAULT 1'), ('econ_kinds', f"TEXT NOT NULL DEFAULT '{json.dumps(ECON_DEFAULT_ON)}'"),
            # "週刊PRO" (a new issue is out) and "リゼルに聞く" (your question was answered): off until turned on.
            ('weekly_issue', 'INTEGER NOT NULL DEFAULT 0'), ('answer_posts', 'INTEGER NOT NULL DEFAULT 0'),
            # おやすみモード: on, 23:00 to 07:00 Japan time, unless changed.
            ('quiet_on', 'INTEGER NOT NULL DEFAULT 1'), ('quiet_start', 'INTEGER NOT NULL DEFAULT 23'), ('quiet_end', 'INTEGER NOT NULL DEFAULT 7'),
            # The key the question board uses for this member, sent by the website so a reply can be told to its asker only.
            ('question_owner', 'TEXT')):
        if column not in columns:
            db.execute(f"ALTER TABLE push_devices ADD COLUMN {column} {definition}")
    db.execute('''CREATE TABLE IF NOT EXISTS push_device_preferences (
      device_id TEXT PRIMARY KEY, targets INTEGER NOT NULL, earnings INTEGER NOT NULL,
      news INTEGER NOT NULL, news_tickers TEXT NOT NULL)''')
    return db


@lru_cache(maxsize=1)
def monitored_news_tickers():
    registry = json.loads((Path(__file__).resolve().parents[2] / 'lib/research/providers.json').read_text())
    return tuple(p['ticker'] for p in registry if p.get('scope') != 'earnings')


def validate_preferences(value):
    flags = ('targets', 'earnings', 'news', 'weeklyNotebook', 'rizelNote', 'weeklyDraft', 'economic', 'weeklyIssue', 'rizelAnswer')
    if not isinstance(value, dict) or not value or set(value) - {*flags, 'newsTickers', 'economicKinds', 'quiet'}:
        raise ValueError('invalid-preferences')
    for field in flags:
        if field in value and type(value[field]) is not bool:
            raise ValueError('invalid-preferences')
    if 'newsTickers' in value:
        tickers = value['newsTickers']
        allowed = monitored_news_tickers()
        if (not isinstance(tickers, list) or len(tickers) > len(allowed) or
                any(not isinstance(t, str) or t not in allowed for t in tickers)):
            raise ValueError('invalid-preferences')
    if 'economicKinds' in value:
        kinds = value['economicKinds']
        if not isinstance(kinds, list) or any(not isinstance(k, str) or k not in ECON_KINDS for k in kinds):
            raise ValueError('invalid-preferences')
    if 'quiet' in value:
        quiet = value['quiet']
        if (not isinstance(quiet, dict) or set(quiet) != {'on', 'start', 'end'} or type(quiet['on']) is not bool
                or any(type(quiet[k]) is not int or not 0 <= quiet[k] <= 23 for k in ('start', 'end')) or quiet['start'] == quiet['end']):
            raise ValueError('invalid-preferences')
    return {**value, **({'newsTickers': sorted(set(value['newsTickers']))} if 'newsTickers' in value else {}),
            **({'economicKinds': [k for k in ECON_KINDS if k in value['economicKinds']]} if 'economicKinds' in value else {})}


def stored_preferences(db, device):
    """None means legacy delivery; malformed settings raise for the caller to handle."""
    row = db.execute('SELECT * FROM push_device_preferences WHERE device_id=?', (device,)).fetchone()
    if row is None:
        return None
    if any(type(row[k]) is not int or row[k] not in (0, 1) for k in ('targets', 'earnings', 'news')):
        raise ValueError('invalid-preferences')
    return validate_preferences({k: bool(row[k]) for k in ('targets', 'earnings', 'news')} |
                                {'newsTickers': json.loads(row['news_tickers'])})


def preference_view(db, device):
    prefs = stored_preferences(db, device['id'])
    return {**(prefs or {'targets': True, 'earnings': True, 'news': True,
                        'newsTickers': list(monitored_news_tickers())}),
            'weeklyNotebook': bool(device['weekly_notebook']), 'rizelNote': bool(device['note_posts']), 'weeklyDraft': bool(device['weekly_draft']),
            'economic': bool(device['econ']), 'economicKinds': economic_kinds(device), 'weeklyIssue': bool(device['weekly_issue']),
            'rizelAnswer': bool(device['answer_posts']),
            'quiet': {'on': bool(device['quiet_on']), 'start': device['quiet_start'], 'end': device['quiet_end']}}


def economic_kinds(device):
    try:
        kinds = json.loads(device['econ_kinds'])
        return [k for k in ECON_KINDS if k in kinds]
    except (TypeError, ValueError):
        return list(ECON_DEFAULT_ON)


def quiet_blocks(device, *moments):
    """おやすみモード: true when the device is asleep now or was asleep when the news happened, so a notice held back
    during the night is never delivered when the night ends. Hours are Japan time; 23 to 7 spans midnight."""
    if not device['quiet_on']:
        return False
    start, end = device['quiet_start'], device['quiet_end']
    for moment in moments:
        hour = datetime.fromtimestamp(moment, JST).hour
        if (start <= hour < end) if start < end else (hour >= start or hour < end):
            return True
    return False


def notification_allowed(db, device_id, category, tickers=()):
    """Preference-only fail-open. Callers MUST retain ownership/PRO/freshness checks.

    News senders must pass all matched company tickers; any selected match suffices.
    The stock-news sender is `deliver` with items of kind "news" (approved articles).
    """
    if category not in ('targets', 'earnings', 'news'):
        raise ValueError('invalid-category')
    try:
        prefs = stored_preferences(db, device_id)
    except (sqlite3.Error, ValueError, TypeError, KeyError, OSError):
        return True
    if prefs is None:
        return True
    return prefs[category] and (category != 'news' or bool(set(tickers) & set(prefs['newsTickers'])))


def write_preferences(db, device, patch):
    prefs = {**preference_view(db, device), **validate_preferences(patch)}
    db.execute('''INSERT INTO push_device_preferences VALUES(?,?,?,?,?)
      ON CONFLICT(device_id) DO UPDATE SET targets=excluded.targets,earnings=excluded.earnings,
      news=excluded.news,news_tickers=excluded.news_tickers''',
      (device['id'], int(prefs['targets']), int(prefs['earnings']), int(prefs['news']), json.dumps(prefs['newsTickers'])))
    db.execute('''UPDATE push_devices SET weekly_notebook=?, note_posts=?, weekly_draft=?, econ=?, econ_kinds=?, weekly_issue=?, answer_posts=?,
      quiet_on=?, quiet_start=?, quiet_end=? WHERE id=?''', (int(prefs['weeklyNotebook']), int(prefs['rizelNote']), int(prefs['weeklyDraft']),
      int(prefs['economic']), json.dumps(prefs['economicKinds']), int(prefs['weeklyIssue']), int(prefs['rizelAnswer']),
      int(prefs['quiet']['on']), prefs['quiet']['start'], prefs['quiet']['end'], device['id']))
    return prefs


def remember_question_owner(db, device_id, payload):
    key = payload.get('questionOwner')
    if isinstance(key, str) and QUESTION_OWNER.fullmatch(key):
        db.execute('UPDATE push_devices SET question_owner=? WHERE id=?', (key, device_id))


def member_preferences(db, payload, *, save=False, now=None):
    owner = member_identity(payload)
    now = time.time() if now is None else now
    until = payload.get('accessExpiresAt')
    if not isinstance(until, (float, int)) or isinstance(until, bool) or not math.isfinite(until) or until <= now:
        raise ValueError('expired-membership')
    sub = validate_subscription(payload.get('subscription'))
    device_id = hashlib.sha256(sub['endpoint'].encode()).hexdigest()
    with db:
        db.execute('BEGIN IMMEDIATE' if save else 'BEGIN')
        device = db.execute('SELECT * FROM push_devices WHERE id=?', (device_id,)).fetchone()
        if not device or device['owner_id'] != owner or json.loads(device['subscription']) != sub:
            raise ValueError('not-owned')
        remember_question_owner(db, device_id, payload)
        prefs = write_preferences(db, device, payload.get('preferences')) if save else preference_view(db, device)
        device = db.execute('SELECT * FROM push_devices WHERE id=?', (device_id,)).fetchone()
    return {'preferences': prefs}


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
        # The Sunday-night notebook notice is on unless the device says otherwise.
        weekly = (0 if payload.get('weeklyNotebook') is False else 1) if 'weeklyNotebook' in payload else (existing['weekly_notebook'] if existing else 1)
        db.execute("""INSERT INTO push_devices (id,subscription,tickers,language,since,active,owner_id,access_until,weekly_notebook)
          VALUES(?,?,?,?,?,1,?,?,?) ON CONFLICT(id) DO UPDATE SET tickers=excluded.tickers,
          language=excluded.language,since=excluded.since,active=1,owner_id=excluded.owner_id,access_until=excluded.access_until,
          weekly_notebook=excluded.weekly_notebook""",
          (device,json.dumps(sub),json.dumps(sorted(set(tickers))),lang,now,owner,until,weekly))
        remember_question_owner(db, device, payload)
        if 'preferences' in payload:
            current = db.execute('SELECT * FROM push_devices WHERE id=?', (device,)).fetchone()
            write_preferences(db, current, payload['preferences'])
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
    if row['active'] and not eligible and action in ('status', 'test'):
        # The expiry stored at sign-up is only a cache. The owner's access is one hour long and is renewed on every request, and a
        # member's paid period is extended when they renew, so a lapsed cache is checked against the current membership before
        # the device is reported as switched off (it was turning itself off an hour after being turned on).
        try:
            current = member_expiry(owner)
        except Exception:
            current = 0
        if isinstance(current, (int, float)) and not isinstance(current, bool) and math.isfinite(current) and current > now:
            with db:
                db.execute('UPDATE push_devices SET access_until=? WHERE id=? AND active=1', (current, device))
            eligible = True
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
        db.execute('DELETE FROM push_device_preferences WHERE device_id=?', (device,))
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


# Companies shown by name rather than ticker (owner, Oct 15).
DISPLAY_NAME = {'TSM': 'TSMC'}


def normalize_result(item):
    """An earnings result brief (Oct 15: results are announced to phones as soon as they are read)."""
    ticker = item.get('ticker')
    titles = {lang: item.get(key) for lang, key in (('ja', 'titleJa'), ('en', 'titleEn'))}
    quarter = re.search(r'Q([1-4])', str(item.get('period', '')))
    facts = item.get('facts')
    # An outlook post is not a result: the result already went out, so the outlook adds no second alert.
    if isinstance(facts, list) and facts and all(isinstance(f, dict) and str(f.get('key', '')).startswith('guidance-') for f in facts):
        return None
    if (not isinstance(ticker, str) or not re.fullmatch(r'[A-Z][A-Z0-9.-]{0,14}', ticker) or not quarter
            or any(not isinstance(text, str) or not 1 <= len(text.strip()) <= 240 for text in titles.values())):
        return None
    published = parse_event_time(item.get('publishedAt'))
    observed = parse_event_time(item.get('observedAt'))
    if published is None or observed is None:
        return None
    try:
        observed_timestamp = observed.timestamp()
    except (OverflowError, OSError, ValueError):
        return None
    return {'kind': 'earnings', 'ticker': ticker, 'quarter': 'Q' + quarter[1], 'titles': {k: v.strip() for k, v in titles.items()},
            'published': published, 'observed_timestamp': observed_timestamp}


def normalize_news(item):
    """An approved stock-news article. Approval time is the freshness evidence: a push goes out
    only for a story approved moments ago, never for the backlog."""
    ident, tickers = item.get('id'), item.get('tickers')
    if (not isinstance(ident, (str, int)) or isinstance(ident, bool) or not 1 <= len(str(ident)) <= 128
            or not isinstance(tickers, list) or not 1 <= len(tickers) <= 20
            or any(not isinstance(t, str) or not re.fullmatch(r'[A-Z][A-Z0-9.-]{0,14}', t) for t in tickers)):
        return None
    texts = {}
    for lang, keys in (('ja', ('summaryJa',)), ('en', ('summaryEn', 'title'))):
        value = next((item[k] for k in keys if isinstance(item.get(k), str) and item[k].strip()), None)
        if value is None:
            return None
        texts[lang] = value.strip()[:140]
    approved = parse_event_time(item.get('approvedAt'))
    if approved is None:
        return None
    try:
        timestamp = approved.timestamp()
    except (OverflowError, OSError, ValueError):
        return None
    return {'kind': 'news', 'id': str(ident), 'ticker': tickers[0], 'tickers': sorted(set(tickers)), 'texts': texts,
            'published': approved, 'observed_timestamp': timestamp}


def normalize_event(item):
    """Validate public change data before it can reach a push provider."""
    if not isinstance(item, dict):
        return None
    if item.get('kind') == 'news':
        return normalize_news(item)
    if item.get('kind') == 'earnings':
        return normalize_result(item)
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
    if item.get('kind') == 'news':
        return hashlib.sha256(json.dumps(['news', item['id']]).encode()).hexdigest()
    if item.get('kind') == 'earnings':
        # One result is one notification, whichever account posted it first (Oct 15).
        return hashlib.sha256(json.dumps(['earnings', item['ticker'], item['quarter'],
                                          item['published'].strftime('%Y-%m')]).encode()).hexdigest()
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
            if quiet_blocks(device, now, item['published'].timestamp()):
                continue
            if ('*' not in watched and not watched.intersection(item.get('tickers') or [item['ticker']])) or observed <= device['since'] or not 0 <= now - observed <= 300:
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
            category = {'earnings': 'earnings', 'news': 'news'}.get(item.get('kind'), 'targets')
            if not notification_allowed(db, device['id'], category, item.get('tickers', ())):
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
            if item.get('kind') == 'earnings':
                name = DISPLAY_NAME.get(item['ticker'], item['ticker'])
                payload = {'title': f"{name} · " + ('決算速報' if ja else 'Earnings flash'),
                           'body': item['titles']['ja' if ja else 'en'], 'tag': key, 'url': '/research/news'}
            elif item.get('kind') == 'news':
                payload = {'title': f"{' · '.join(item['tickers'][:3])} · " + ('ニュース' if ja else 'News'),
                           'body': item['texts']['ja' if ja else 'en'], 'tag': key, 'url': '/research/news'}
            else:
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
                    db.execute('DELETE FROM push_device_preferences WHERE device_id=?', (device['id'],))
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


JST = timezone(timedelta(hours=9))
NOTEBOOK_WINDOW_HOURS = (20, 23)


def notebook_week_key(now):
    """Delivery key for the Stock Notebook notice: set only on Sunday 20:00-23:00 JST, one per ISO week."""
    moment = datetime.fromtimestamp(now, JST)
    if moment.weekday() != 6 or not NOTEBOOK_WINDOW_HOURS[0] <= moment.hour < NOTEBOOK_WINDOW_HOURS[1]:
        return None
    year, week, _ = moment.isocalendar()
    return f'notebook-{year}-W{week:02d}'


def deliver_weekly(db, transport=send, now=None, wall_now=time.time, entitlement=member_expiry):
    """Tell PRO members' devices that this week's Stock Notebook is ready (owner, Oct 26).

    Same guarantees as deliver(): the claim is written before the network call, an
    ambiguous failure is never retried, and the current PRO entitlement is checked."""
    if not configuration()['enabled']:
        return {'status': 'disabled', 'attempted': 0}
    now = wall_now() if now is None else now
    key = notebook_week_key(now)
    if key is None:
        return {'status': 'ready', 'attempted': 0, 'accepted': 0}
    attempted = accepted = 0
    for device in db.execute('SELECT * FROM push_devices WHERE active=1 AND owner_id IS NOT NULL AND weekly_notebook=1').fetchall():
        if db.execute('SELECT 1 FROM push_deliveries WHERE device_id=? AND event_key=?', (device['id'], key)).fetchone() or quiet_blocks(device, now):
            continue
        try:
            until = entitlement(device['owner_id'])
        except Exception:
            until = 0
        attempted_at = wall_now()
        if not isinstance(until, (int, float)) or isinstance(until, bool) or not math.isfinite(until) or until <= attempted_at:
            continue
        current = db.execute('SELECT active,owner_id,weekly_notebook FROM push_devices WHERE id=?', (device['id'],)).fetchone()
        if not current or not current['active'] or current['owner_id'] != device['owner_id'] or not current['weekly_notebook']:
            continue
        with db:
            claim = db.execute("""INSERT OR IGNORE INTO push_deliveries
                (device_id,event_key,status,attempted_at,observed_at) VALUES(?,?,?,?,?)""",
                (device['id'], key, 'uncertain', attempted_at, now)).rowcount
        if not claim:
            continue
        ja = device['language'] == 'ja'
        payload = {'title': '銘柄手帳' if ja else 'Stock Notebook',
                   'body': '今週のウォッチリストの動きをまとめました。' if ja else "This week's watchlist moves are ready.",
                   'tag': key, 'url': '/research/notebook'}
        try:
            code = transport(json.loads(device['subscription']), payload)
        except Exception:
            code = 0
        status = 'accepted' if 200 <= code < 300 else 'expired' if code in (404, 410) else 'uncertain'
        with db:
            db.execute('UPDATE push_deliveries SET status=? WHERE device_id=? AND event_key=?', (status, device['id'], key))
            if status == 'expired':
                db.execute('DELETE FROM push_devices WHERE id=?', (device['id'],))
                db.execute('DELETE FROM push_device_preferences WHERE device_id=?', (device['id'],))
        attempted += 1
        accepted += status == 'accepted'
    return {'status': 'ready', 'attempted': attempted, 'accepted': accepted}


NOTE_WINDOW_SECONDS = 3600


def deliver_notes(db, posts, transport=send, now=None, wall_now=time.time, entitlement=member_expiry):
    """Tell PRO members who turned it on that Rizel posted a new "ひとりごと" (owner, Nov 2).

    The notice carries no text of the post. Only a post first published within the last hour is announced, once per device
    (the claim is written before the network call; an ambiguous failure is never retried), so a device that switches this
    on later is not sent old posts, and editing a post does not notify again."""
    if not configuration()['enabled']:
        return {'status': 'disabled', 'attempted': 0}
    now = wall_now() if now is None else now
    fresh = []
    for post in posts:
        try:
            if post.get('kind') != 'notes' or post.get('status') != 'published':
                continue
            published = datetime.fromisoformat(str(post['publishedAt']).replace('Z', '+00:00')).timestamp()
            post_id = post['id']
        except (KeyError, TypeError, ValueError, AttributeError):
            continue
        if isinstance(post_id, str) and 0 <= now - published < NOTE_WINDOW_SECONDS:
            fresh.append((post_id, published))
    attempted = accepted = 0
    for post_id, published in fresh:
        key = f'note-{post_id}'
        for device in db.execute('SELECT * FROM push_devices WHERE active=1 AND owner_id IS NOT NULL AND note_posts=1').fetchall():
            if db.execute('SELECT 1 FROM push_deliveries WHERE device_id=? AND event_key=?', (device['id'], key)).fetchone() or quiet_blocks(device, now, published):
                continue
            try:
                until = entitlement(device['owner_id'])
            except Exception:
                until = 0
            attempted_at = wall_now()
            if not isinstance(until, (int, float)) or isinstance(until, bool) or not math.isfinite(until) or until <= attempted_at:
                continue
            current = db.execute('SELECT active,owner_id,note_posts FROM push_devices WHERE id=?', (device['id'],)).fetchone()
            if not current or not current['active'] or current['owner_id'] != device['owner_id'] or not current['note_posts']:
                continue
            with db:
                claim = db.execute("""INSERT OR IGNORE INTO push_deliveries
                    (device_id,event_key,status,attempted_at,observed_at) VALUES(?,?,?,?,?)""",
                    (device['id'], key, 'uncertain', attempted_at, now)).rowcount
            if not claim:
                continue
            ja = device['language'] == 'ja'
            payload = {'title': 'RIZEL\u2019S DESK' if not ja else 'リゼルのひとりごと',
                       'body': 'リゼルのひとりごとが更新されました' if ja else "RIZEL\u2019s Notes were updated",
                       'tag': key, 'url': '/research/notes'}
            try:
                code = transport(json.loads(device['subscription']), payload)
            except Exception:
                code = 0
            status = 'accepted' if 200 <= code < 300 else 'expired' if code in (404, 410) else 'uncertain'
            with db:
                db.execute('UPDATE push_deliveries SET status=? WHERE device_id=? AND event_key=?', (status, device['id'], key))
                if status == 'expired':
                    db.execute('DELETE FROM push_devices WHERE id=?', (device['id'],))
                    db.execute('DELETE FROM push_device_preferences WHERE device_id=?', (device['id'],))
            attempted += 1
            accepted += status == 'accepted'
    return {'status': 'ready', 'attempted': attempted, 'accepted': accepted}


WEEKLY_DRAFT_WINDOW_SECONDS = 3 * 3600


def deliver_weekly_drafts(db, drafts, transport=send, now=None, wall_now=time.time, entitlement=member_expiry):
    """Tell the devices that turned it on that a draft of 週刊 Tech Phase PRO is ready to read (owner, Nov 2).

    The notice carries no text. A draft is announced once per device, only in the first hours after it was made."""
    if not configuration()['enabled']:
        return {'status': 'disabled', 'attempted': 0}
    now = wall_now() if now is None else now
    fresh = []
    for draft in drafts:
        try:
            made = datetime.fromisoformat(str(draft['createdAt']).replace('Z', '+00:00')).timestamp()
            draft_id = draft['id']
        except (KeyError, TypeError, ValueError, AttributeError):
            continue
        if isinstance(draft_id, str) and 0 <= now - made < WEEKLY_DRAFT_WINDOW_SECONDS:
            fresh.append((draft_id, made))
    attempted = accepted = 0
    for draft_id, made in fresh:
        key = f'weekly-draft-{draft_id}'
        for device in db.execute('SELECT * FROM push_devices WHERE active=1 AND owner_id IS NOT NULL AND weekly_draft=1').fetchall():
            if db.execute('SELECT 1 FROM push_deliveries WHERE device_id=? AND event_key=?', (device['id'], key)).fetchone() or quiet_blocks(device, now, made):
                continue
            try:
                until = entitlement(device['owner_id'])
            except Exception:
                until = 0
            attempted_at = wall_now()
            if not isinstance(until, (int, float)) or isinstance(until, bool) or not math.isfinite(until) or until <= attempted_at:
                continue
            current = db.execute('SELECT active,owner_id,weekly_draft FROM push_devices WHERE id=?', (device['id'],)).fetchone()
            if not current or not current['active'] or current['owner_id'] != device['owner_id'] or not current['weekly_draft']:
                continue
            with db:
                claim = db.execute("""INSERT OR IGNORE INTO push_deliveries
                    (device_id,event_key,status,attempted_at,observed_at) VALUES(?,?,?,?,?)""",
                    (device['id'], key, 'uncertain', attempted_at, now)).rowcount
            if not claim:
                continue
            ja = device['language'] == 'ja'
            payload = {'title': '週刊 Tech Phase PRO' if ja else 'Tech Phase PRO Weekly',
                       'body': '週刊の下書きができました' if ja else 'A draft of the weekly issue is ready',
                       'tag': key, 'url': '/research/weekly'}
            try:
                code = transport(json.loads(device['subscription']), payload)
            except Exception:
                code = 0
            status = 'accepted' if 200 <= code < 300 else 'expired' if code in (404, 410) else 'uncertain'
            with db:
                db.execute('UPDATE push_deliveries SET status=? WHERE device_id=? AND event_key=?', (status, device['id'], key))
                if status == 'expired':
                    db.execute('DELETE FROM push_devices WHERE id=?', (device['id'],))
                    db.execute('DELETE FROM push_device_preferences WHERE device_id=?', (device['id'],))
            attempted += 1
            accepted += status == 'accepted'
    return {'status': 'ready', 'attempted': attempted, 'accepted': accepted}


def announce(db, key, select, args, payload_for, moments, *, accept=None, transport=send, now=None, wall_now=time.time, entitlement=member_expiry):
    """Send one notice, once per device. `select` picks the devices that switched this kind on.

    Same guarantees as the senders above: the claim is written before the network call, an ambiguous failure is never
    retried, PRO is checked again, and a notice that fell in the device's おやすみモード (when it happened or now) is dropped, never held."""
    now = wall_now() if now is None else now
    attempted = accepted = 0
    for device in db.execute(select, args).fetchall():
        if db.execute('SELECT 1 FROM push_deliveries WHERE device_id=? AND event_key=?', (device['id'], key)).fetchone():
            continue
        if quiet_blocks(device, now, *moments) or (accept is not None and not accept(device)):
            continue
        try:
            until = entitlement(device['owner_id'])
        except Exception:
            until = 0
        attempted_at = wall_now()
        if not isinstance(until, (int, float)) or isinstance(until, bool) or not math.isfinite(until) or until <= attempted_at:
            continue
        if not db.execute(select + ' AND id=?', (*args, device['id'])).fetchone():
            continue
        with db:
            claim = db.execute("""INSERT OR IGNORE INTO push_deliveries
                (device_id,event_key,status,attempted_at,observed_at) VALUES(?,?,?,?,?)""",
                (device['id'], key, 'uncertain', attempted_at, now)).rowcount
        if not claim:
            continue
        payload = {**payload_for(device['language'] == 'ja'), 'tag': key}
        try:
            code = transport(json.loads(device['subscription']), payload)
        except Exception:
            code = 0
        status = 'accepted' if 200 <= code < 300 else 'expired' if code in (404, 410) else 'uncertain'
        with db:
            db.execute('UPDATE push_deliveries SET status=? WHERE device_id=? AND event_key=?', (status, device['id'], key))
            if status == 'expired':
                db.execute('DELETE FROM push_devices WHERE id=?', (device['id'],))
                db.execute('DELETE FROM push_device_preferences WHERE device_id=?', (device['id'],))
        attempted += 1
        accepted += status == 'accepted'
    return {'status': 'ready', 'attempted': attempted, 'accepted': accepted}


MEMBERS = 'SELECT * FROM push_devices WHERE active=1 AND owner_id IS NOT NULL'
ISSUE_WINDOW_SECONDS = 3 * 3600
ANSWER_WINDOW_SECONDS = 3 * 3600
ECONOMIC_WINDOW_SECONDS = 3600


def _moment(value):
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def deliver_weekly_issues(db, issues, **options):
    """A new issue of 週刊 Tech Phase PRO was published. `issues`: [{id, number, publishedAt}]."""
    if not configuration()['enabled']:
        return {'status': 'disabled', 'attempted': 0}
    now = options.get('now') or options.get('wall_now', time.time)()
    total = {'attempted': 0, 'accepted': 0}
    for issue in issues:
        made = _moment(issue.get('publishedAt')) if isinstance(issue, dict) else None
        if made is None or not isinstance(issue.get('id'), str) or not 0 <= now - made < ISSUE_WINDOW_SECONDS:
            continue
        number = issue.get('number')
        label = f'第{number}号' if isinstance(number, int) else ''
        result = announce(db, f"weekly-issue-{issue['id']}", MEMBERS + ' AND weekly_issue=1', (),
                          lambda ja: {'title': '週刊 Tech Phase PRO' if ja else 'Tech Phase PRO Weekly',
                                      'body': f'{label}が公開されました' if ja and label else '新しい号が公開されました' if ja else 'A new issue is out',
                                      'url': '/research/weekly'}, (made,), **options)
        total = {k: total[k] + result.get(k, 0) for k in total}
    return {'status': 'ready', **total}


def deliver_answers(db, answers, **options):
    """A question was answered. Only the member who asked is told: `answers` is [{id, ownerKey, answeredAt}], and a device is
    matched by the question key the website stored for it. Nothing of the question or the answer is in the notice."""
    if not configuration()['enabled']:
        return {'status': 'disabled', 'attempted': 0}
    now = options.get('now') or options.get('wall_now', time.time)()
    total = {'attempted': 0, 'accepted': 0}
    for answer in answers:
        made = _moment(answer.get('answeredAt')) if isinstance(answer, dict) else None
        owner = answer.get('ownerKey') if isinstance(answer, dict) else None
        if made is None or not isinstance(answer.get('id'), str) or not isinstance(owner, str) or not QUESTION_OWNER.fullmatch(owner) or not 0 <= now - made < ANSWER_WINDOW_SECONDS:
            continue
        result = announce(db, f"answer-{answer['id']}", MEMBERS + ' AND answer_posts=1 AND question_owner=?', (owner,),
                          lambda ja: {'title': 'リゼルに聞く' if ja else 'Ask Rizel',
                                      'body': 'あなたの質問に回答がつきました' if ja else 'Your question has an answer',
                                      'url': '/research/questions'}, (made,), **options)
        total = {k: total[k] + result.get(k, 0) for k in total}
    return {'status': 'ready', **total}


BLS_PATH = {'jobs': 'empsit', 'cpi': 'cpi'}
MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
NAMES = {'jobs': ('米国雇用統計', 'U.S. employment report'), 'cpi': ('米国CPI', 'U.S. CPI'), 'pce': ('米国PCE', 'U.S. PCE'),
         'adp': ('ADP雇用統計', 'ADP employment report'), 'fomc': ('FOMC政策金利', 'FOMC rate decision'), 'ism': ('ISM製造業景況指数', 'ISM manufacturing PMI'),
         'gdp': ('米国GDP', 'U.S. GDP'), 'retail': ('米国小売売上高', 'U.S. retail sales')}
# Results read by event_results / indicator_results carry an id that starts with the indicator (Nov 5). Jobless claims have no reader.
EVENT_KINDS = ('adp', 'fomc', 'ism', 'gdp', 'retail')


def economic_items(updates, events):
    """Releases with a result already read by the site, as {kind, id, publishedAt, ja, en}.

    Read from the same places the economic calendar uses: BLS (jobs, CPI) and BEA (PCE) official releases, and the ADP
    result read from outlets, FOMC, GDP and retail sales read from the official pages, and ISM from headlines. Jobless claims have no reader
    (the Department of Labor blocks automated reading), so they cannot be sent."""
    items = []
    for update in updates or []:
        try:
            url = urlsplit(update['url'])
            published = update.get('publishedAt')
            ja = (update.get('translationJa') or '').strip()
            if not published or not ja:
                continue
            if update.get('publisher') == 'BLS' and url.hostname == 'www.bls.gov':
                kind = next((k for k, f in BLS_PATH.items() if re.fullmatch(rf'/news\.release/archives/{f}_\d{{8}}\.htm', url.path)), None)
            elif update.get('publisher') == 'BEA' and url.hostname == 'www.bea.gov' and re.fullmatch(r'/news/20\d{2}/personal-income-and-outlays-[a-z]+-20\d{2}', url.path):
                kind = 'pce'
            else:
                continue
            if kind:
                items.append({'kind': kind, 'id': f'{kind}-{url.path}', 'publishedAt': published, 'ja': ja, 'en': str(update.get('title', ''))})
        except (KeyError, TypeError, ValueError, AttributeError):
            continue
    for event in events or []:
        kind = str(event.get('id', '')).split('-', 1)[0] if isinstance(event, dict) else ''
        if kind in EVENT_KINDS and event.get('releasedAt') and event.get('resultJa'):
            items.append({'kind': kind, 'id': event['id'], 'publishedAt': event['releasedAt'], 'ja': str(event['resultJa']), 'en': str(event.get('resultEn', ''))})
    return items


def deliver_economic(db, items, **options):
    """After a release: the indicator's name and its result number, to the devices that switched that indicator on.

    Nothing is sent before a release, and no comparison with the market forecast is included: the site has no forecast source."""
    if not configuration()['enabled']:
        return {'status': 'disabled', 'attempted': 0}
    now = options.get('now') or options.get('wall_now', time.time)()
    total = {'attempted': 0, 'accepted': 0}
    for item in items:
        made = _moment(item.get('publishedAt'))
        kind = item.get('kind')
        if made is None or kind not in NAMES or not 0 <= now - made < ECONOMIC_WINDOW_SECONDS:
            continue
        result = announce(db, f"economic-{item['id']}", MEMBERS + ' AND econ=1', (),
                          lambda ja, item=item: {'title': NAMES[item['kind']][0 if ja else 1],
                                                 'body': (item['ja'] if ja else item['en'] or item['ja'])[:140], 'url': '/research/calendar'},
                          (made,), accept=lambda device, kind=kind: kind in economic_kinds(device), **options)
        total = {k: total[k] + result.get(k, 0) for k in total}
    return {'status': 'ready', **total}
