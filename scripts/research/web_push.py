"""Opt-in private Web Push pilot. Shared source reads; durable per-device dedup.

No delivery until configured. Ambiguous network failures are NOT retried: this
pilot favors avoiding duplicate alerts; its ledger records uncertain delivery.
"""
import base64
from collections import OrderedDict, deque
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import hashlib
import json
import math
import os
import re
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from functools import lru_cache
from urllib.parse import urlsplit, urlencode, urlunsplit
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler

import stock_splits

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


# What the last membership check saw, for /health: no member, no host, no value.
MEMBERSHIP_STATE = {'environment': None, 'result': None, 'at': None}


def _remember_membership(result, environment=None):
    MEMBERSHIP_STATE.update(result=result, at=datetime.now(timezone.utc).isoformat(timespec='seconds'),
                            environment=environment if environment in {'production', 'preview', 'development'} else MEMBERSHIP_STATE['environment'])


def membership_probe(owner):
    """Ask the membership check about the production owner (read-only) so /health shows which deployment answers it."""
    return member_expiry(owner)


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
            _remember_membership('access-over' if until <= time.time() else 'valid', data.get('environment'))
            if until <= time.time():
                # A pro member whose access is already over: nothing failed, yet nothing can be delivered. Say so (it was silent).
                _membership_log('access-over', secondsAgo=round(time.time() - until))
            return until
        _remember_membership('not-pro', data.get('environment'))
        _membership_log('not-pro', ok=data.get('ok'), pro=data.get('pro'), environment=data.get('environment') if data.get('environment') in {'production', 'preview', 'development'} else None)
        return 0
    except HTTPError as error:
        _membership_log('http-error', status=error.code, host=url.hostname)
        return 0
    except Exception as error:
        _membership_log('error', kind=type(error).__name__, host=url.hostname)
        return 0


# The nine indicators a member can switch (Nov 4); the first six start on, the last three off.
ECON_KINDS = ('jobs', 'cpi', 'ppi', 'pce', 'fomc', 'adp', 'ism', 'gdp', 'retail', 'claims')
ECON_DEFAULT_BEFORE_PPI = ['jobs', 'cpi', 'pce', 'fomc', 'adp', 'ism']
ECON_DEFAULT_ON = ['jobs', 'cpi', 'ppi', 'pce', 'fomc', 'adp', 'ism']
QUESTION_OWNER = re.compile(r'[a-f0-9]{64}')
QUESTION_ID = re.compile(r'q-[a-f0-9]{32}')


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
            # The zone those hours are in (owner, Nov 17: the English site shows US Eastern Time). Devices saved before then keep Japan time.
            ('quiet_zone', "TEXT NOT NULL DEFAULT 'Asia/Tokyo'"),
            # The key the question board uses for this member, sent by the website so a reply can be told to its asker only.
            ('question_owner', 'TEXT'),
            # RESOLUTE (Nov 17, owner): the member's choice for this device (on unless turned off), and until when the website last
            # confirmed, on its own server, that the member holds the RESOLUTE alert rights (epoch seconds; NULL: not confirmed).
            ('resolute', 'INTEGER NOT NULL DEFAULT 1'), ('resolute_until', 'REAL'),
            # ウォッチリストの価格通知 (Nov 21): the key the website stores the member's watchlists (and their price alerts) under, sent by the
            # website with each registration, and the device's switch for these notices (on: the member chose each alert).
            ('favorites_owner', 'TEXT'), ('price_alerts', 'INTEGER NOT NULL DEFAULT 1')):
        if column not in columns:
            db.execute(f"ALTER TABLE push_devices ADD COLUMN {column} {definition}")
    db.execute('''CREATE TABLE IF NOT EXISTS push_device_preferences (
      device_id TEXT PRIMARY KEY, targets INTEGER NOT NULL, earnings INTEGER NOT NULL,
      news INTEGER NOT NULL, news_tickers TEXT NOT NULL)''')
    # Nov 23: one earnings event is one phone alert, whatever lane or source found it and whatever quarter label it carried
    # (CRWD: the "announced" line Q0 and the figures Q3 20 seconds later; COHR: three quarters from one new feed in one poll).
    db.execute('''CREATE TABLE IF NOT EXISTS push_earnings_events (
      device_id TEXT NOT NULL, ticker TEXT NOT NULL, attempted_at REAL NOT NULL, event_key TEXT NOT NULL,
      PRIMARY KEY(device_id,ticker,attempted_at))''')
    notice_schema(db)
    return db


# Nov 16 (owner's iPhone, 15:31 and 15:33 JST): Apple answered 201 for two test notices, yet the worker wrote nothing down and a tap
# left the app on the home page (WebKit never delivers notificationclick there). So every notice the push service accepted is also
# written here, per device: a random id, a kind, the page it opens, the short title shown and when it was sent. The app asks for the
# newest one when it comes to the front (POST /api/research/notifications {action:"recent-notice"}) and shows its own banner, or opens
# the page when the app came up right after the send (a tap). Never an endpoint, a key, the body, a member or a provider response.
NOTICE_RETENTION_SECONDS = 7 * 86400
# A notice is offered to the app for this long after it was sent (the same 30 minutes as the worker's banner, PUSH_BANNER_RECENT_MS).
NOTICE_RECENT_SECONDS = 30 * 60
NOTICE_ID = re.compile(r'[a-f0-9]{32}')
NOTICE_KIND = re.compile(r'[a-z-]{1,40}')


def notice_schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS push_notices (
      id TEXT PRIMARY KEY, device_id TEXT NOT NULL, kind TEXT NOT NULL, page TEXT NOT NULL, title TEXT NOT NULL,
      sent_at REAL NOT NULL, opened_at REAL, dismissed_at REAL)''')
    db.execute('CREATE INDEX IF NOT EXISTS push_notices_device ON push_notices(device_id, sent_at)')


def notice_kind(payload, page):
    if payload.get('tag') == 'tech-phase-test':
        return 'test'
    if page in RESOLUTE_PAGES:
        return RESOLUTE_PAGES[page]
    name = page.split('#', 1)[0].split('?', 1)[0].rsplit('/', 1)[-1]
    return name if name != 'research' and NOTICE_KIND.fullmatch(name) else 'research'


def remember_notice(db, subscription, payload, code, now=None):
    """Write down a notice the push service accepted (2xx) for this device; returns its id, or None when nothing was written.
    Never raises: a notice that was sent must not be reported as failed because this note could not be written."""
    if not isinstance(code, int) or isinstance(code, bool) or not 200 <= code < 300 or not isinstance(payload, dict):
        return None
    try:
        endpoint = subscription.get('endpoint') if isinstance(subscription, dict) else None
        if not isinstance(endpoint, str) or not endpoint:
            return None
        device = hashlib.sha256(endpoint.encode()).hexdigest()
        page = payload.get('url')
        page = page if isinstance(page, str) and SEND_PAGE.fullmatch(page) else '/research'
        title = payload.get('title')
        # The same short title the worker shows (public/research-sw.js: the first 100 characters), without control characters.
        title = re.sub(r'[\x00-\x1f\x7f]+', ' ', title).strip()[:100] if isinstance(title, str) else ''
        if not title:
            return None
        now = time.time() if now is None else now
        notice = secrets.token_hex(16)
        with db:
            notice_schema(db)
            db.execute('INSERT INTO push_notices (id,device_id,kind,page,title,sent_at) VALUES(?,?,?,?,?,?)',
                       (notice, device, notice_kind(payload, page), page, title, now))
            db.execute('DELETE FROM push_notices WHERE sent_at<?', (now - NOTICE_RETENTION_SECONDS,))
        return notice
    except Exception as exc:
        print(json.dumps({'event': 'push-notice-not-recorded', 'error': type(exc).__name__}), flush=True)
        return None


def noting(db, transport, now=None):
    """The same transport, writing each accepted notice down for its device (remember_notice)."""
    def send_and_note(subscription, payload):
        code = transport(subscription, payload)
        remember_notice(db, subscription, payload, code, now)
        return code
    return send_and_note


def notice_view(row, now):
    if row is None:
        return None
    state = 'opened' if row['opened_at'] is not None else 'dismissed' if row['dismissed_at'] is not None else 'new'
    return {'id': row['id'], 'kind': row['kind'], 'page': row['page'], 'title': row['title'], 'sentAt': row['sent_at'],
            # How long ago it was sent, by this server's clock, so the app can place it on its own clock.
            'ageMs': max(0, round((now - row['sent_at']) * 1000)), 'state': state,
            'openedAt': row['opened_at'], 'dismissedAt': row['dismissed_at']}


def recent_notice(db, device, now):
    """The newest notice for this device sent within NOTICE_RECENT_SECONDS that was neither opened nor dismissed, or None."""
    notice_schema(db)
    newest = db.execute('''SELECT * FROM push_notices WHERE device_id=? AND sent_at>=? AND sent_at<=?
      ORDER BY sent_at DESC, rowid DESC LIMIT 1''', (device, now - NOTICE_RECENT_SECONDS, now + 60)).fetchone()
    if newest is None or newest['opened_at'] is not None or newest['dismissed_at'] is not None:
        return None
    return notice_view(newest, now)


def latest_notice(db, device, now):
    """The newest notice for this device within the retention period, whatever its state (the owner's panel)."""
    notice_schema(db)
    return notice_view(db.execute('SELECT * FROM push_notices WHERE device_id=? ORDER BY sent_at DESC, rowid DESC LIMIT 1',
                                  (device,)).fetchone(), now)


def mark_notice(db, device, notice, state, now):
    if not isinstance(notice, str) or not NOTICE_ID.fullmatch(notice):
        raise ValueError('invalid-notice')
    column = {'opened': 'opened_at', 'dismissed': 'dismissed_at'}[state]
    notice_schema(db)
    with db:
        # Only this device's own notice, and only once: a notice already opened or dismissed keeps its first answer.
        changed = db.execute(f'UPDATE push_notices SET {column}=? WHERE id=? AND device_id=? AND opened_at IS NULL AND dismissed_at IS NULL',
                             (now, notice, device)).rowcount
    return {'marked': bool(changed)}


NOTICE_ACTIONS = ('recent-notice', 'notice-opened', 'notice-dismissed', 'notice-status')


def notice_action(db, payload, action, now=None):
    """The member's own current device only (the subscription must match the one stored for this member); no PRO check, since it
    only reads or closes notices this device was already sent."""
    owner = member_identity(payload)
    now = time.time() if now is None else now
    sub = validate_subscription(payload.get('subscription'))
    device = hashlib.sha256(sub['endpoint'].encode()).hexdigest()
    row = db.execute('SELECT owner_id,subscription FROM push_devices WHERE id=?', (device,)).fetchone()
    if not row or row['owner_id'] != owner or json.loads(row['subscription']) != sub:
        if action in ('recent-notice', 'notice-status'):
            return {'notice': None, 'registered': False}
        raise ValueError('not-owned')
    if action == 'recent-notice':
        return {'notice': recent_notice(db, device, now), 'registered': True}
    if action == 'notice-status':
        return {'notice': latest_notice(db, device, now), 'registered': True}
    return mark_notice(db, device, payload.get('noticeId'), 'opened' if action == 'notice-opened' else 'dismissed', now)


@lru_cache(maxsize=1)
def monitored_news_tickers():
    registry = json.loads((Path(__file__).resolve().parents[2] / 'lib/research/providers.json').read_text())
    return tuple(p['ticker'] for p in registry if p.get('scope') != 'earnings')


def validate_preferences(value):
    flags = ('targets', 'earnings', 'news', 'weeklyNotebook', 'rizelNote', 'weeklyDraft', 'economic', 'weeklyIssue', 'rizelAnswer', 'resolute', 'priceAlerts')
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
        if (not isinstance(quiet, dict) or set(quiet) - {'zone'} != {'on', 'start', 'end'} or type(quiet['on']) is not bool
                or any(type(quiet[k]) is not int or not 0 <= quiet[k] <= 23 for k in ('start', 'end')) or quiet['start'] == quiet['end']
                or quiet.get('zone', QUIET_DEFAULT_ZONE) not in QUIET_ZONES):
            raise ValueError('invalid-preferences')
        # A screen that sends no zone is the Japanese one (or one from before Nov 17): its hours are Japan time.
        value = {**value, 'quiet': {**quiet, 'zone': quiet.get('zone', QUIET_DEFAULT_ZONE)}}
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
            'rizelAnswer': bool(device['answer_posts']), 'resolute': bool(device['resolute']), 'priceAlerts': bool(device['price_alerts']),
            'quiet': {'on': bool(device['quiet_on']), 'start': device['quiet_start'], 'end': device['quiet_end'], 'zone': quiet_zone(device)}}


def economic_kinds(device):
    try:
        kinds = json.loads(device['econ_kinds'])
        if kinds == ECON_DEFAULT_BEFORE_PPI:
            kinds = ECON_DEFAULT_ON  # Nov 13: a device that never changed the list also gets the PPI notice
        return [k for k in ECON_KINDS if k in kinds]
    except (TypeError, ValueError):
        return list(ECON_DEFAULT_ON)


# おやすみモード hours are kept in one of these zones: Japan time from the Japanese site, US Eastern Time from the English one.
QUIET_ZONES = ('Asia/Tokyo', 'America/New_York')
QUIET_DEFAULT_ZONE = 'Asia/Tokyo'


def quiet_zone(device):
    zone = device['quiet_zone'] if 'quiet_zone' in device.keys() else None
    return zone if zone in QUIET_ZONES else QUIET_DEFAULT_ZONE


def quiet_zone_for(language):
    """The zone a new device's おやすみモード starts in: ET when it was turned on from the English site."""
    return 'America/New_York' if language == 'en' else QUIET_DEFAULT_ZONE


def in_quiet_hours(device, *moments):
    """おやすみモード: true when the device is asleep at any of `moments`. Hours are wall-clock hours in the device's zone
    (Japan time or US Eastern Time, with daylight saving time); 23 to 7 spans midnight.
    Nov 20 (owner): おやすみモード never holds a notice back. A notice sent while the device is asleep (senders pass the send
    time only, never the time of the news: a 6:30 item sent at 7:05 is an ordinary notice) goes out at once with its usual
    content, quietly (quietly(): no sound or vibration) and marked 「おやすみモード」 / "Quiet mode"."""
    if not device['quiet_on']:
        return False
    start, end = device['quiet_start'], device['quiet_end']
    zone = ZoneInfo(quiet_zone(device))
    for moment in moments:
        hour = datetime.fromtimestamp(moment, zone).hour
        if (start <= hour < end) if start < end else (hour >= start or hour < end):
            return True
    return False


QUIET_MARK = {True: 'おやすみモード・', False: 'Quiet mode · '}
QUIET_SENDS = {'sent': 0}  # notices sent quietly since start (one per device and notice), for /health


def quietly(payload, ja):
    """The same notice, marked 「おやすみモード」 in front of its usual title, with `silent` for the service worker
    (public/research-sw.js shows it with silent: true and no vibration). The page it opens is unchanged."""
    QUIET_SENDS['sent'] += 1
    return {**payload, 'title': QUIET_MARK[bool(ja)] + payload['title'], 'silent': True}


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
      quiet_on=?, quiet_start=?, quiet_end=?, quiet_zone=?, resolute=?, price_alerts=? WHERE id=?''', (int(prefs['weeklyNotebook']), int(prefs['rizelNote']), int(prefs['weeklyDraft']),
      int(prefs['economic']), json.dumps(prefs['economicKinds']), int(prefs['weeklyIssue']), int(prefs['rizelAnswer']),
      int(prefs['quiet']['on']), prefs['quiet']['start'], prefs['quiet']['end'], prefs['quiet']['zone'], int(prefs['resolute']), int(prefs['priceAlerts']), device['id']))
    return prefs


def remember_question_owner(db, device_id, payload):
    key = payload.get('questionOwner')
    if isinstance(key, str) and QUESTION_OWNER.fullmatch(key):
        db.execute('UPDATE push_devices SET question_owner=? WHERE id=?', (key, device_id))
    # The member's watchlist key (price alerts, price_alerts.py), sent by the website on the same requests as the question key.
    key = payload.get('favoritesOwner')
    if isinstance(key, str) and QUESTION_OWNER.fullmatch(key):
        db.execute('UPDATE push_devices SET favorites_owner=? WHERE id=?', (key, device_id))


def member_preferences(db, payload, *, save=False, now=None):
    owner = member_identity(payload)
    now = time.time() if now is None else now
    pro, _resolute = member_access(payload, now)
    if save and not pro and set(validate_preferences(payload.get('preferences'))) - RESOLUTE_ONLY_PREFERENCES:
        # A RESOLUTE buyer without PRO chooses only the RESOLUTE notices (the PRO kinds are refused, never silently stored).
        raise ValueError('invalid-preferences')
    sub = validate_subscription(payload.get('subscription'))
    device_id = hashlib.sha256(sub['endpoint'].encode()).hexdigest()
    with db:
        # Nov 16: always IMMEDIATE. A read also writes (the question-board key below), and a deferred BEGIN that reads first and then
        # writes fails at once with "database is locked" (SQLITE_BUSY_SNAPSHOT in WAL mode, which the busy timeout never waits out)
        # whenever another connection commits in between: a second check of the same page, the push sender or any monitor worker.
        # That was the 503 the settings page showed as 「設定を読み込めませんでした」. IMMEDIATE takes the write lock first and waits for it.
        db.execute('BEGIN IMMEDIATE')
        device = db.execute('SELECT * FROM push_devices WHERE id=?', (device_id,)).fetchone()
        if not device or device['owner_id'] != owner or json.loads(device['subscription']) != sub:
            raise ValueError('not-owned')
        remember_question_owner(db, device_id, payload)
        remember_resolute(db, device_id, payload, now)
        device = db.execute('SELECT * FROM push_devices WHERE id=?', (device_id,)).fetchone()
        prefs = write_preferences(db, device, payload.get('preferences')) if save else preference_view(db, device)
        device = db.execute('SELECT * FROM push_devices WHERE id=?', (device_id,)).fetchone()
    return {'preferences': prefs}


def _future(value, now):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) and value > now


def member_access(payload, now):
    """(PRO, RESOLUTE) for a member request. Both come from the website's server, never from the browser: accessExpiresAt is the PRO
    membership's expiry, resoluteUntil the end of the member's RESOLUTE alert rights (app/api/research/notifications). A member with
    neither is refused. RESOLUTE without PRO lets the member turn notifications on for the RESOLUTE notices only (owner, Nov 17): every
    PRO sender checks PRO again before each send (member_expiry), so such a device never receives a PRO notice."""
    pro = _future(payload.get('accessExpiresAt'), now)
    resolute = payload.get('resoluteUntil') if _future(payload.get('resoluteUntil'), now) else None
    if not pro and resolute is None:
        raise ValueError('expired-membership')
    return pro, resolute


def remember_resolute(db, device_id, payload, now):
    """Keep the RESOLUTE rights the website just confirmed for this device's member. A request without the field (the website could not
    check) leaves what is stored; a request with it and no rights (0) clears it."""
    if 'resoluteUntil' in payload:
        until = payload['resoluteUntil']
        db.execute('UPDATE push_devices SET resolute_until=? WHERE id=?', (until if _future(until, now) else None, device_id))


def resolute_entitled(device, now):
    """The member holds RESOLUTE alert rights as last confirmed by the website, or is one of the owner accounts (every feature, every
    environment: AGENTS.md)."""
    keys = device.keys()
    if 'owner_id' in keys and device['owner_id'] in DEMO_OWNER_ACCOUNT_IDS:
        return True
    until = device['resolute_until'] if 'resolute_until' in keys else None
    return _future(until, now)


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
        # A new device starts its おやすみモード in the site's zone; an existing one keeps the zone it has.
        db.execute('''INSERT INTO push_devices (id,subscription,tickers,language,since,active,quiet_zone) VALUES(?,?,?,?,?,1,?)
            ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,
            tickers=excluded.tickers,language=excluded.language,since=excluded.since,active=1''',
            (device, json.dumps(subscription), json.dumps(sorted(set(tickers))), lang, now, quiet_zone_for(lang)))
    return {'registered': True}


def member_identity(payload):
    owner = payload.get('memberId')
    if not isinstance(owner, str) or not re.fullmatch(r'user_[A-Za-z0-9]{1,128}', owner):
        raise ValueError('invalid-member')
    return owner


def register_member(db, payload, allowed, now=None):
    owner = member_identity(payload)
    now = time.time() if now is None else now
    pro, resolute = member_access(payload, now)
    until = payload['accessExpiresAt'] if pro else 0
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
        resolute_until = resolute if 'resoluteUntil' in payload else (existing['resolute_until'] if existing else None)
        # A new device starts its おやすみモード (23:00 to 07:00) in the site's zone: ET from the English site, Japan time from the
        # Japanese one. An existing device keeps the zone it has, whichever language it registers in again.
        db.execute("""INSERT INTO push_devices (id,subscription,tickers,language,since,active,owner_id,access_until,weekly_notebook,quiet_zone,resolute_until)
          VALUES(?,?,?,?,?,1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET tickers=excluded.tickers,
          language=excluded.language,since=excluded.since,active=1,owner_id=excluded.owner_id,access_until=excluded.access_until,
          weekly_notebook=excluded.weekly_notebook,resolute_until=excluded.resolute_until""",
          (device,json.dumps(sub),json.dumps(sorted(set(tickers))),lang,now,owner,until,weekly,quiet_zone_for(lang),resolute_until))
        remember_question_owner(db, device, payload)
        if 'preferences' in payload:
            if not pro and set(validate_preferences(payload['preferences'])) - RESOLUTE_ONLY_PREFERENCES:
                raise ValueError('invalid-preferences')
            current = db.execute('SELECT * FROM push_devices WHERE id=?', (device,)).fetchone()
            write_preferences(db, current, payload['preferences'])
    return {'registered': True}


# Reasons a push request can be refused that are safe to show (no device, no member, no text from the provider).
REFUSAL_REASONS = frozenset({'not-owned', 'expired-membership', 'not-registered', 'disabled', 'invalid-member', 'invalid-subscription',
                             'subscription-mismatch', 'device-owned-by-another-member', 'member-device-limit', 'invalid-preferences',
                             'invalid-notice'})


def refusal_reason(exc):
    reason = str(exc)
    return reason if reason in REFUSAL_REASONS else 'invalid-registration'


def member_action(db, payload, action, transport=None, now=None):
    if action in NOTICE_ACTIONS:
        return notice_action(db, payload, action, now)
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
    if row['active']:
        with db:
            remember_resolute(db, device, payload, now)
            # A device registered before Nov 21 learns its member's watchlist key (price alerts) on its next status check.
            remember_question_owner(db, device, payload)
        row = db.execute('SELECT * FROM push_devices WHERE id=?', (device,)).fetchone()
    resolute_ok = bool(row['active'] and resolute_entitled(row, now))
    if row['active'] and not eligible and not resolute_ok and action in ('status', 'test'):
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
        return {'registered': eligible or resolute_ok}
    if action != 'test' or not (eligible or resolute_ok):
        raise ValueError('expired-membership')
    if not resolute_ok and member_expiry(owner) <= now:
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
        notice_schema(db)
        db.execute('DELETE FROM push_notices WHERE device_id=?', (device,))
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
    # Nov 16 (owner): plain words for members; the notice itself never asks anyone to press a button.
    message = {'title': 'テスト通知' if ja else 'Test notification',
               'body': '通知は正しく届いています。' if ja else 'Notifications are working.',
               'tag': 'tech-phase-test', 'url': '/research/notifications'}
    failure_kind = None
    try:
        code = (transport or send)(subscription, message)
        remember_notice(db, subscription, message, code, now)
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


def price_target_payload(ticker, firm, previous, latest, ja, tag, earlier=()):
    """The phone notice for one price-target change. The real notices (deliver) and the owner's demo notice (scheduled_demo_target) are
    both built here, so the demo always looks exactly like a real one."""
    # Nov 15: a price-target notice opens the price-target page (it opened the dashboard's #what-changed view).
    # Nov 21 (SNDK 8-for-1): an old target that the same firm set before the split (found in `earlier`, the feed's other items) is put on
    # today's basis, so "$1400 → $180" is not read as a cut. The size of the change alone never decides it.
    body = f"{firm}: ${previous:g} → ${latest:g}"
    ratio = stock_splits.pre_split_previous(ticker, firm, previous, latest, earlier)
    if ratio:
        body = f"{firm}: ${round(previous / ratio, 2):g} → ${latest:g}" + (f"（旧目標${previous:g}は{ratio:g}:1分割前）" if ja else f" (old ${previous:g} was before the {ratio:g}:1 split)")
    return {'title': f"{ticker} · " + ('目標株価の変更' if ja else 'Price target update'),
            'body': body,
            'tag': tag, 'url': '/research/price-targets'}


# Nov 17 (owner): a sample price-target notice for filming the PRO video. Nothing appears on any page: the coordinator sets the Railway
# variable PUSH_DEMO_TARGET_AT on the monitor to "<RFC3339 time> <ja|en>" (e.g. "2026-11-17T05:30:00Z ja"); the monitor's demo clock
# (service.py run_push_demo) sends ONE notice at that time to every active device registered to the owner accounts, read fresh at that
# moment, so a phone turned on just before still gets it. Each distinct value is handled once (push_demo_schedule), also across
# restarts; more than DEMO_LATE_SECONDS late, it is skipped. Fictional firm and numbers; never a real firm name.
DEMO_TARGET_VARIABLE = 'PUSH_DEMO_TARGET_AT'
DEMO_TARGET = {'ticker': 'NVDA', 'firm': 'Sample Securities', 'previous': 295, 'latest': 340}
# Nov 17 (owner): the demo notice (only it; real notices keep '/research/price-targets') opens the price-target page with the sample
# row on top. The page shows that row from this query alone, in the browser, and removes the query from the address bar.
DEMO_TARGET_URL = '/research/price-targets?demo=nvda'
# OWNER_ACCOUNT_ID and PRODUCTION_OWNER_ACCOUNT_ID in lib/membership/entitlements.ts (a test checks they match).
DEMO_OWNER_ACCOUNT_IDS = ('user_3JulL4D07KtVl5Eg2zdY1iczKbC', 'user_3LHR1K8f8zwyDcVzMg7ud6KB9Wb')
DEMO_LATE_SECONDS = 600


def parse_demo_target(value):
    """(send time as epoch seconds, language) from "<RFC3339 time with zone> <ja|en>", or None."""
    parts = value.split() if isinstance(value, str) else []
    if len(parts) != 2 or parts[1] not in ('ja', 'en') or len(parts[0]) > 40:
        return None
    try:
        at = datetime.fromisoformat(parts[0].replace('Z', '+00:00').replace('z', '+00:00'))
    except ValueError:
        return None
    if at.tzinfo is None:
        return None
    return at.timestamp(), parts[1]


def scheduled_demo_target(db, value, transport=None, now=None):
    """Send the demo notice for this variable value once it is due. Returns None (no value), 'waiting', 'done' (this value was already
    handled), or the outcome recorded now: 'sent', 'no-device', 'late', 'invalid'.
    One log line per outcome, never a device or text. A device in its おやすみモード gets the notice exactly as for a real price-target
    notice (Nov 20: sent quietly and marked; in_quiet_hours at the send time, as deliver calls it); 'quiet' in the log line counts
    those devices."""
    value = (value or '').strip()
    if not value:
        return None
    now = time.time() if now is None else now
    parsed = parse_demo_target(value)
    if parsed and now < parsed[0]:
        return 'waiting'
    language = parsed[1] if parsed else None
    outcome = 'invalid' if not parsed else 'late' if now - parsed[0] > DEMO_LATE_SECONDS else None
    # Claim the value before any send: a restart (or a second caller) can never send it twice.
    with db:
        db.execute('CREATE TABLE IF NOT EXISTS push_demo_schedule (value TEXT PRIMARY KEY, handled_at REAL NOT NULL, outcome TEXT)')
        if not db.execute('INSERT OR IGNORE INTO push_demo_schedule VALUES(?,?,NULL)', (value, now)).rowcount:
            return 'done'
    devices = accepted = quiet = 0
    if outcome is None:
        marks = ','.join('?' * len(DEMO_OWNER_ACCOUNT_IDS))
        # Read at the moment of sending, so a device turned on just before the time is included.
        rows = db.execute(f'SELECT * FROM push_devices WHERE active=1 AND owner_id IN ({marks}) ORDER BY id',
                          DEMO_OWNER_ACCOUNT_IDS).fetchall()
        for row in rows:
            devices += 1
            # A fresh tag of the same shape as a real one (a sha256 hex), so each send is shown as its own notice.
            tag = hashlib.sha256(json.dumps(['demo-target', secrets.token_hex(16)]).encode()).hexdigest()
            message = price_target_payload(DEMO_TARGET['ticker'], DEMO_TARGET['firm'], DEMO_TARGET['previous'], DEMO_TARGET['latest'],
                                           language == 'ja', tag)
            message['url'] = DEMO_TARGET_URL
            if in_quiet_hours(row, now):
                quiet += 1
                message = quietly(message, language == 'ja')
            try:
                # Through noting(): written down in push_notices as a real price-target notice (the in-app banner behaves as for one).
                code = noting(db, transport or send, now)(json.loads(row['subscription']), message)
            except Exception:
                code = 0
            code = code if isinstance(code, int) and not isinstance(code, bool) else 0
            accepted += 200 <= code < 300
            if code in (404, 410):
                with db:
                    db.execute('DELETE FROM push_devices WHERE id=?', (row['id'],))
                    db.execute('DELETE FROM push_device_preferences WHERE device_id=?', (row['id'],))
        outcome = 'no-device' if not devices else 'sent'
    with db:
        db.execute('UPDATE push_demo_schedule SET outcome=? WHERE value=?', (outcome, value))
    # Language and counts only: never the device, endpoint, keys, the text or the provider's response.
    print(json.dumps({'event': 'push-demo-target', 'language': language, 'devices': devices, 'quiet': quiet,
                      'accepted': accepted, 'outcome': outcome}), flush=True)
    return outcome


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
    if quarter is None and str(item.get('researchId', '')).startswith('ir-announce-'):
        quarter = re.search(r'(0)', '0')  # "announced" line of a release whose title names no quarter: Q0, one alert per month
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
    titles = {k: v.strip() for k, v in titles.items()}
    figures = figure_titles(ticker, item.get('period'), facts)
    if figures:
        titles = figures
    return {'kind': 'earnings', 'ticker': ticker, 'quarter': 'Q' + quarter[1], 'titles': titles,
            'published': published, 'observed_timestamp': observed_timestamp,
            # the company's results page exists but no figure was read yet (「決算を発表しました」): held, see deliver()
            'announce': isinstance(facts, list) and not facts}


# Nov 23 (owner: "unusable"): one alert per earnings event, the one with the figures, written the same way for every company:
# 「CRWD Q3 FY2027決算：売上高$1.58B（+22%）、調整後EPS$0.34、次期売上予想$1.52B〜$1.53B」. Only the brief's own figures.
_AMOUNT = re.compile(r'^\$(-?\d+(?:\.\d+)?)([BM]?)$')


def _compact(value):
    """'$1.470897B' -> '$1.47B', '$115.8B' -> '$115.8B', '$0.31' -> '$0.31'; None for anything else (another currency, a range)."""
    m = _AMOUNT.match(value or '')
    if not m:
        return None
    number = float(m[1])
    if not m[2]:
        return f'${number:.2f}'
    digits = 2 if abs(number) < 10 else 1 if abs(number) < 1000 else 0
    text = f'{number:.{digits}f}'
    if '.' in text:
        text = text.rstrip('0').rstrip('.')
    return f'${text}{m[2]}'


def _growth(fact):
    comparisons = fact.get('comparisons') if isinstance(fact.get('comparisons'), dict) else {}
    stated = comparisons.get('growth')
    if isinstance(stated, str) and re.fullmatch(r'[+-]\d+(?:\.\d+)?%', stated):
        return stated
    now, before = _AMOUNT.match(str(fact.get('value', ''))), _AMOUNT.match(str(comparisons.get('yearAgo', '')))
    if not now or not before or now[2] != before[2]:
        return None
    a, b = float(now[1]), float(before[1])
    if b <= 0 or a < 0:
        return None
    return f'{round((a / b - 1) * 100):+d}%'


def _guidance(value):
    parts = (value or '').split('-$')
    if len(parts) == 2:
        lo, hi = _compact(parts[0]), _compact('$' + parts[1])
        return f'{lo}〜{hi}' if lo and hi else None
    band = re.fullmatch(r'(\$[\d.]+[BM]) ± (\d+(?:\.\d+)?%)', value or '')
    if band and _compact(band[1]):
        return f'{_compact(band[1])}±{band[2]}'
    return _compact(value)


def figure_titles(ticker, period, facts):
    """The alert text from the figures, or None when the brief has no revenue or EPS it can write."""
    if not isinstance(facts, list):
        return None
    by_key = {f.get('key'): f for f in facts if isinstance(f, dict) and isinstance(f.get('value'), str)}
    ja, en = [], []
    revenue = by_key.get('revenue')
    if revenue and _compact(revenue['value']):
        growth = _growth(revenue)
        ja.append(f"売上高{_compact(revenue['value'])}" + (f'（{growth}）' if growth else ''))
        en.append(f"revenue {_compact(revenue['value'])}" + (f' ({growth} y/y)' if growth else ''))
    eps_key = 'adjusted-eps' if 'adjusted-eps' in by_key else 'eps' if 'eps' in by_key else None
    if eps_key and _compact(by_key[eps_key]['value']):
        ja.append(('調整後EPS' if eps_key == 'adjusted-eps' else 'EPS') + _compact(by_key[eps_key]['value']))
        en.append(('adj. EPS ' if eps_key == 'adjusted-eps' else 'EPS ') + _compact(by_key[eps_key]['value']))
    if not ja:
        return None
    outlook = by_key.get('guidance-revenue')
    if outlook and _guidance(outlook['value']):
        ja.append(f"次期売上予想{_guidance(outlook['value'])}")
        en.append(f"next-quarter revenue guide {_guidance(outlook['value']).replace('〜', '–')}")
    name = DISPLAY_NAME.get(ticker, ticker)
    label = str(period or '').strip()
    return {'ja': f"{name} {label}決算：" + '、'.join(ja), 'en': f"{name} {label} results: " + ', '.join(en)}


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


def is_busy(exc):
    """True for SQLite's "database is locked" / "busy": another connection held the lock, so the same request may be tried again."""
    if not isinstance(exc, sqlite3.OperationalError):
        return False
    text = str(exc).lower()
    return 'locked' in text or 'busy' in text


# Nov 16 (owner's iPhone: a test notice after 「通知の仕組みを入れ直す」 never arrived and nothing said why): the last sends, newest last,
# for the owner's panel and one log line each. Only a short hash of the device id, the push service's host name, the HTTP status the
# push service answered, the page the notice opens, the duration and the exception class are kept: never an endpoint, a key, the text,
# a member or the push service's response body. Process memory only (a restart starts empty; the log lines stay).
SEND_LOG_SIZE = 10
SEND_LOG = deque(maxlen=SEND_LOG_SIZE)
SEND_LOG_LOCK = threading.Lock()
# Nov 17: the owner's filming notice opens the price-target page with ?demo=nvda (DEMO_TARGET_URL; the only listed query in
# lib/research/push-targets.json).
SEND_PAGE = re.compile(r'/research(/[a-z-]{1,40})?(#[a-z0-9-]{1,40})?|/research/price-targets\?demo=nvda|/resolute/alerts/latest|/resolute/morning')
SEND_FAILURE_KINDS = frozenset({'ImportError', 'ModuleNotFoundError', 'TypeError', 'ValueError', 'KeyError', 'ConnectionError',
                                'ConnectTimeout', 'ReadTimeout', 'Timeout', 'SSLError', 'WebPushException'})


def device_ref(device_id):
    """The first 12 characters of a device id (itself a SHA-256 of the endpoint): enough to tell devices apart, nothing to reach one."""
    return str(device_id)[:12]


def record_send(subscription, payload, status, duration_ms=None, failure=None, wall_now=time.time):
    endpoint = subscription.get('endpoint', '') if isinstance(subscription, dict) else ''
    device_id = hashlib.sha256(str(endpoint).encode()).hexdigest()
    try:
        host = urlsplit(str(endpoint)).hostname or '?'
    except ValueError:
        host = '?'
    if host not in {'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'}:
        host = 'other'
    payload = payload if isinstance(payload, dict) else {}
    page = payload.get('url')
    status = status if isinstance(status, int) and not isinstance(status, bool) and 0 <= status <= 999 else 0
    entry = {'at': round(wall_now(), 3), 'device': device_ref(device_id), 'host': host, 'status': status,
             'kind': 'test' if payload.get('tag') == 'tech-phase-test' else 'notice',
             'page': page if isinstance(page, str) and SEND_PAGE.fullmatch(page) else None,
             'ms': round(duration_ms) if isinstance(duration_ms, (int, float)) and math.isfinite(duration_ms) and duration_ms >= 0 else None,
             'failure': failure if failure in SEND_FAILURE_KINDS else ('other' if failure else None),
             # Every sender removes the device when the push service answers 404 or 410 (the subscription is gone for good).
             'gone': status in (404, 410)}
    with SEND_LOG_LOCK:
        SEND_LOG.append({**entry, '_device_id': device_id})
    print(json.dumps({'event': 'push-send', **entry}), flush=True)
    return entry


def send_log(db):
    """The last sends, newest first, each with whether its device is still registered now (False: it was removed)."""
    with SEND_LOG_LOCK:
        entries = list(SEND_LOG)
    items = []
    for entry in reversed(entries):
        try:
            row = db.execute('SELECT active FROM push_devices WHERE id=?', (entry['_device_id'],)).fetchone()
            registered = bool(row and row['active'])
        except sqlite3.Error:
            registered = None
        items.append({k: v for k, v in entry.items() if not k.startswith('_')} | {'registered': registered})
    return items


def send(subscription, payload):
    import requests
    from pywebpush import webpush, WebPushException
    class NoRedirectSession(requests.Session):
        def request(self, method, url, **kwargs):
            kwargs['allow_redirects'] = False
            return super().request(method, url, **kwargs)
    started = time.monotonic()
    try:
        with NoRedirectSession() as session:
            response = webpush(subscription_info=subscription, data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=os.environ['WEB_PUSH_PRIVATE_KEY'],
                vapid_claims={'sub': vapid_subject(os.environ['WEB_PUSH_SUBJECT'])},
                ttl=300, timeout=10, requests_session=session, headers={'Urgency': 'high'})
        code = response.status_code
    except WebPushException as exc:
        code = exc.response.status_code if exc.response is not None else 0
        record_send(subscription, payload, code, (time.monotonic() - started) * 1000, None if code else 'WebPushException')
        return code
    except Exception as exc:
        record_send(subscription, payload, 0, (time.monotonic() - started) * 1000, type(exc).__name__)
        raise
    record_send(subscription, payload, code, (time.monotonic() - started) * 1000)
    return code


def vapid_subject(value):
    """py_vapid requires an HTTPS origin or mailto contact, without a URL path."""
    if value.startswith('mailto:'):
        return value
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('invalid-vapid-subject')
    return urlunsplit((parsed.scheme, parsed.netloc, '', '', ''))


# Why an earnings flash did not reach a device (owner, Nov 12: NBIS was published and nobody was told, and nothing said why).
# Counts since the process started, per reason; never the device, the member or the text.
SKIPS = {}


_LOGGED_SKIPS = set()
RELEASE_SKIPS = {}  # (ticker, quarter) -> {reason: count} since start; only for the one-line push-result log
QUIET_SKIP_REASONS = frozenset({'published-not-fresh', 'already-delivered', 'invalid-item', 'waiting-for-figures'})
# Nov 23 (owner): the 「決算を発表しました」 line (no figures yet) is not an alert of its own. It waits this long for the figures; when they
# come, the alert with the figures is the only one. When they do not, this one alert goes out then (headline and link).
ANNOUNCE_HOLD_SECONDS = 600
# One company's results are one event for this long (the calendar's SAME_EVENT_MS): a second earnings alert for the same company
# inside it is never sent, whichever lane, source or quarter label it came with (Nov 23).
EARNINGS_EVENT_SECONDS = 36 * 3600


# Nov 20 (owner: "the latest MRVL price-target notice did not arrive"): skips were logged for earnings flashes only, so a price-target
# change that reached no phone left no trace. The same once-per-change log line, and counts by reason, for price-target changes.
TARGET_SKIPS = {}  # reason -> count since start (price-target changes only)
TARGET_CHANGE_SKIPS = {}  # (ticker, firm, previous, latest, date) -> {reason: devices} since start; only for the push-target-result line
# Nov 20: every poll passes the whole backlog again, so counting each pass put 86,592 'published-not-fresh' on /health minutes after a
# deploy. A change is counted once per reason (TARGET_SKIPS) and once per reason and device (TARGET_CHANGE_SKIPS); these remember
# what was already counted, the oldest forgotten first beyond TARGET_SKIP_MEMORY.
TARGET_SKIP_MEMORY = 20000
_COUNTED_TARGET_SKIPS = OrderedDict()
_COUNTED_TARGET_DEVICE_SKIPS = OrderedDict()


def _first_time(seen, key):
    """True the first time `key` is seen (and remembers it); False when it was already counted."""
    if key in seen:
        seen.move_to_end(key)
        return False
    seen[key] = True
    while len(seen) > TARGET_SKIP_MEMORY:
        seen.popitem(last=False)
    return True


def target_change(item):
    """The one change a price-target notice is about (the same facts as event_key), or None for anything else."""
    if item.get('kind') is not None or not isinstance(item.get('published'), datetime):
        return None
    return (item.get('ticker'), item.get('firm'), item.get('previous'), item.get('latest'), item['published'].date().isoformat())


def skip(item, reason, device=None):
    change = target_change(item)
    if change is not None:
        if _first_time(_COUNTED_TARGET_SKIPS, (reason, *change)):
            TARGET_SKIPS[reason] = TARGET_SKIPS.get(reason, 0) + 1
        if (_first_time(_COUNTED_TARGET_DEVICE_SKIPS, (reason, device, *change))
                and (len(TARGET_CHANGE_SKIPS) < 500 or change in TARGET_CHANGE_SKIPS)):
            counts = TARGET_CHANGE_SKIPS.setdefault(change, {})
            counts[reason] = counts.get(reason, 0) + 1
        key = (reason, *change)
        if reason not in QUIET_SKIP_REASONS and key not in _LOGGED_SKIPS and len(_LOGGED_SKIPS) < 500:
            _LOGGED_SKIPS.add(key)
            print(json.dumps({'event': 'push-target-skip', 'reason': reason, 'ticker': change[0], 'firm': change[1],
                              'latest': change[3], 'publishedAt': item['published'].isoformat()}), flush=True)
        return
    if item.get('kind') == 'earnings':
        SKIPS[reason] = SKIPS.get(reason, 0) + 1
        if len(RELEASE_SKIPS) < 500 or (item.get('ticker'), item.get('quarter')) in RELEASE_SKIPS:
            counts = RELEASE_SKIPS.setdefault((item.get('ticker'), item.get('quarter')), {})
            counts[reason] = counts.get(reason, 0) + 1
        # One line per reason and release in the service log, which (unlike the counters) survives a restart. No device or member.
        key = (reason, item.get('ticker'), item.get('quarter'))
        if reason not in QUIET_SKIP_REASONS and key not in _LOGGED_SKIPS and len(_LOGGED_SKIPS) < 500:
            _LOGGED_SKIPS.add(key)
            print(json.dumps({'event': 'push-skip', 'reason': reason, 'ticker': item.get('ticker'), 'quarter': item.get('quarter')}), flush=True)


def device_breakdown(db, now):
    """Aggregate counts that explain which devices can receive an earnings flash. Counts only."""
    row = db.execute('''SELECT COUNT(*) AS total,
        sum(CASE WHEN owner_id IS NOT NULL AND owner_id<>'' THEN 1 ELSE 0 END) AS with_owner,
        sum(CASE WHEN owner_id IS NOT NULL AND owner_id<>'' AND access_until>? THEN 1 ELSE 0 END) AS access_valid,
        sum(CASE WHEN quiet_on=1 THEN 1 ELSE 0 END) AS quiet_on,
        sum(CASE WHEN id IN (SELECT device_id FROM push_device_preferences WHERE earnings=0) THEN 1 ELSE 0 END) AS earnings_off,
        sum(CASE WHEN id IN (SELECT device_id FROM push_device_preferences) THEN 1 ELSE 0 END) AS with_preferences,
        max(since) AS newest_since
      FROM push_devices WHERE active=1''', (now,)).fetchone()
    return {'active': row['total'] or 0, 'withOwner': row['with_owner'] or 0, 'accessValid': row['access_valid'] or 0,
            'quietOn': row['quiet_on'] or 0, 'earningsOff': row['earnings_off'] or 0, 'withPreferences': row['with_preferences'] or 0,
            'newestRegistrationAt': datetime.fromtimestamp(row['newest_since'], timezone.utc).isoformat(timespec='seconds') if row['newest_since'] else None}


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
        'deviceBreakdown': device_breakdown(db, now),
        'earningsSkipsSinceStart': dict(SKIPS),
        'priceTargetSkipsSinceStart': dict(TARGET_SKIPS),
        'quietSendsSinceStart': QUIET_SENDS['sent'],
        'membershipCheck': dict(MEMBERSHIP_STATE),
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
    attempted = accepted = uncertain = quiet_sent = 0
    sent = {}  # (ticker, quarter) -> {status: count} for earnings flashes attempted in this call
    target_sent = {}  # target_change -> {status: count} for price-target notices attempted in this call
    figures = [one for one in (normalize_event(raw) for raw in items)
               if one is not None and one.get('kind') == 'earnings' and not one.get('announce')]
    for device in db.execute('SELECT * FROM push_devices WHERE active=1').fetchall():
        if not device['owner_id'] and os.environ.get('WEB_PUSH_ALLOW_PILOT', '').lower() != 'true':
            for raw_item in items:
                skip(raw_item if isinstance(raw_item, dict) else {}, 'device-without-member')
            continue
        verified_until = None
        watched = set(json.loads(device['tickers']))
        for raw_item in items:
            item = normalize_event(raw_item)
            if item is None:
                skip(raw_item if isinstance(raw_item, dict) else {}, 'invalid-item')
                continue
            observed = item['observed_timestamp']
            hold = 0
            if item.get('kind') == 'earnings' and item.get('announce'):
                if any(other['ticker'] == item['ticker'] and abs(other['observed_timestamp'] - observed) <= EARNINGS_EVENT_SECONDS
                       for other in figures):
                    skip(item, 'figures-preferred', device['id'])
                    continue
                if now - observed < ANNOUNCE_HOLD_SECONDS:
                    skip(item, 'waiting-for-figures', device['id'])
                    continue
                hold = ANNOUNCE_HOLD_SECONDS
            # Late discoveries belong in history, never in a fresh-news push.
            if not 0 <= now - item['published'].timestamp() <= 900 + hold:
                # A price-target post found only now, more than 15 minutes after it was posted, is named apart from the backlog
                # (which every poll passes over) so that it is logged.
                late = target_change(item) is not None and 0 <= now - observed <= 300
                skip(item, 'detected-late' if late else 'published-not-fresh', device['id'])
                continue
            # Nov 20 (owner): never held for おやすみモード; sent now, quietly and marked (below) when the device is asleep now.
            quiet = in_quiet_hours(device, now)
            if '*' not in watched and not watched.intersection(item.get('tickers') or [item['ticker']]):
                skip(item, 'ticker-not-watched', device['id'])
                continue
            if observed <= device['since']:
                skip(item, 'seen-before-registration', device['id'])
                continue
            if not 0 <= now - observed <= 300 + hold:
                skip(item, 'observed-not-fresh', device['id'])
                continue
            key = event_key(item)
            # Record each network attempt when it actually starts. Reusing the
            # batch timestamp understates queueing for later devices.
            if db.execute('SELECT 1 FROM push_deliveries WHERE device_id=? AND event_key=?', (device['id'], key)).fetchone():
                skip(item, 'already-delivered', device['id'])
                continue
            if item.get('kind') == 'earnings' and db.execute(
                    'SELECT 1 FROM push_earnings_events WHERE device_id=? AND ticker=? AND attempted_at>=?',
                    (device['id'], item['ticker'], now - EARNINGS_EVENT_SECONDS)).fetchone():
                skip(item, 'same-earnings-event', device['id'])
                continue
            if device['owner_id'] and verified_until is None:
                try:
                    verified_until = entitlement(device['owner_id'])
                except Exception:
                    verified_until = 0
            attempted_at = wall_now()
            if device['owner_id'] and (not isinstance(verified_until, (int, float)) or isinstance(verified_until, bool)
                    or not math.isfinite(verified_until) or verified_until <= attempted_at):
                skip(item, 'membership-check-failed', device['id'])
                continue
            current = db.execute('SELECT active,owner_id FROM push_devices WHERE id=?', (device['id'],)).fetchone()
            if not current or not current['active'] or current['owner_id'] != device['owner_id']:
                continue
            category = {'earnings': 'earnings', 'news': 'news'}.get(item.get('kind'), 'targets')
            if not notification_allowed(db, device['id'], category, item.get('tickers', ())):
                skip(item, 'preference-off', device['id'])
                continue
            # Reserve before network; a restart cannot silently send it twice.
            with db:
                claim = db.execute('''INSERT OR IGNORE INTO push_deliveries
                    (device_id,event_key,status,attempted_at,observed_at) VALUES(?,?,?,?,?)''',
                    (device['id'], key, 'uncertain', attempted_at, observed)).rowcount
                if claim and item.get('kind') == 'earnings':
                    db.execute('INSERT OR IGNORE INTO push_earnings_events(device_id,ticker,attempted_at,event_key) VALUES(?,?,?,?)',
                               (device['id'], item['ticker'], attempted_at, key))
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
                payload = price_target_payload(item['ticker'], item['firm'], item['previous'], item['latest'], ja, key, items)
            if quiet:
                payload = quietly(payload, ja)
            provider_started = monotonic_now()
            try:
                code = noting(db, transport, attempted_at)(json.loads(device['subscription']), payload)
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
            quiet_sent += quiet
            if item.get('kind') == 'earnings':
                counts = sent.setdefault((item.get('ticker'), item.get('quarter')), {})
                counts[status] = counts.get(status, 0) + 1
                counts['quiet'] = counts.get('quiet', 0) + quiet
            elif target_change(item) is not None:
                counts = target_sent.setdefault(target_change(item), {})
                counts[status] = counts.get(status, 0) + 1
                counts['quiet'] = counts.get('quiet', 0) + quiet
            if status == 'expired':
                break
    # One line per earnings flash attempted in this call: company, quarter, how many devices, and why others were skipped
    # (counts since start). Never the device, member, endpoint or text. This is the line to read after an earnings night.
    for (ticker, quarter), counts in sent.items():
        print(json.dumps({'event': 'push-result', 'ticker': ticker, 'quarter': quarter,
                          'sent': sum(v for k, v in counts.items() if k != 'quiet'), 'accepted': counts.get('accepted', 0),
                          'uncertain': counts.get('uncertain', 0), 'expired': counts.get('expired', 0), 'quiet': counts.get('quiet', 0),
                          'skips': dict(RELEASE_SKIPS.get((ticker, quarter), {}))}), flush=True)
    # The same line for each price-target change attempted in this call, with the reasons other devices were skipped (since start).
    for change, counts in target_sent.items():
        print(json.dumps({'event': 'push-target-result', 'ticker': change[0], 'firm': change[1], 'latest': change[3],
                          'sent': sum(v for k, v in counts.items() if k != 'quiet'), 'accepted': counts.get('accepted', 0),
                          'uncertain': counts.get('uncertain', 0), 'expired': counts.get('expired', 0), 'quiet': counts.get('quiet', 0), 'skips': dict(TARGET_CHANGE_SKIPS.get(change, {}))}), flush=True)
    with db:
        db.execute('DELETE FROM push_deliveries WHERE attempted_at<?',
                   (now - DELIVERY_RETENTION_SECONDS,))
    return {'status': 'ready', 'attempted': attempted, 'accepted': accepted,
            'uncertain': uncertain, 'quiet': quiet_sent, **public_status(db, status_now)}


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
        if db.execute('SELECT 1 FROM push_deliveries WHERE device_id=? AND event_key=?', (device['id'], key)).fetchone():
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
        if in_quiet_hours(device, now):
            payload = quietly(payload, ja)
        try:
            code = noting(db, transport, attempted_at)(json.loads(device['subscription']), payload)
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
            if db.execute('SELECT 1 FROM push_deliveries WHERE device_id=? AND event_key=?', (device['id'], key)).fetchone():
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
            if in_quiet_hours(device, now):
                payload = quietly(payload, ja)
            try:
                code = noting(db, transport, attempted_at)(json.loads(device['subscription']), payload)
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
            if db.execute('SELECT 1 FROM push_deliveries WHERE device_id=? AND event_key=?', (device['id'], key)).fetchone():
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
            if in_quiet_hours(device, now):
                payload = quietly(payload, ja)
            try:
                code = noting(db, transport, attempted_at)(json.loads(device['subscription']), payload)
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
    retried, PRO is checked again, and a notice sent while the device is in its おやすみモード (the send time decides; `moments`,
    the time of the news, no longer does) goes out at once, quietly and marked (quietly(); Nov 20, owner: it used to be dropped)."""
    now = wall_now() if now is None else now
    attempted = accepted = 0
    for device in db.execute(select, args).fetchall():
        if db.execute('SELECT 1 FROM push_deliveries WHERE device_id=? AND event_key=?', (device['id'], key)).fetchone():
            continue
        if accept is not None and not accept(device):
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
        ja = device['language'] == 'ja'
        payload = {**payload_for(ja), 'tag': key}
        if in_quiet_hours(device, now):
            payload = quietly(payload, ja)
        try:
            code = noting(db, transport, attempted_at)(json.loads(device['subscription']), payload)
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
        # Nov 15: the asker's page is リゼルに聞く (/research/qa), scrolled to the question; /research/questions is the owner's inbox.
        url = '/research/qa#' + answer['id'] if QUESTION_ID.fullmatch(answer['id']) else '/research/qa'
        result = announce(db, f"answer-{answer['id']}", MEMBERS + ' AND answer_posts=1 AND question_owner=?', (owner,),
                          lambda ja, url=url: {'title': 'リゼルに聞く' if ja else 'Ask Rizel',
                                               'body': 'あなたの質問に回答がつきました' if ja else 'Your question has an answer',
                                               'url': url}, (made,), **options)
        total = {k: total[k] + result.get(k, 0) for k in total}
    return {'status': 'ready', **total}


BLS_PATH = {'jobs': 'empsit', 'cpi': 'cpi', 'ppi': 'ppi'}
MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
NAMES = {'jobs': ('米国雇用統計', 'U.S. employment report'), 'cpi': ('米国CPI', 'U.S. CPI'), 'ppi': ('米国PPI', 'U.S. PPI'), 'pce': ('米国PCE', 'U.S. PCE'),
         'adp': ('ADP雇用統計', 'ADP employment report'), 'fomc': ('FOMC政策金利', 'FOMC rate decision'), 'ism': ('ISM製造業景況指数', 'ISM manufacturing PMI'),
         'gdp': ('米国GDP', 'U.S. GDP'), 'retail': ('米国小売売上高', 'U.S. retail sales'),
         'claims': ('米国新規失業保険申請件数', 'U.S. jobless claims')}
# Results read by event_results / indicator_results carry an id that starts with the indicator (Nov 5). Jobless claims: DOL's weekly PDF (Nov 21).
EVENT_KINDS = ('adp', 'fomc', 'ism', 'gdp', 'retail', 'claims')


def economic_items(updates, events, route_errors=None):
    """Releases with a result already read by the site, as {kind, id, publishedAt, ja, en}.

    Read from the same places the economic calendar uses: BLS (jobs, CPI) and BEA (PCE) official releases, and the ADP
    result read from outlets, FOMC, GDP, retail sales and jobless claims (DOL's weekly release PDF) read from the official pages, and ISM
    from headlines."""
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
    return items + ppi_announcements(updates, route_errors)


PPI_PAGE = 'https://www.bls.gov/news.release/ppi.nr0.htm'
# BLS gets this long to show the numbers before a PPI notice without them is sent (Nov 13).
ANNOUNCE_GRACE_SECONDS = 120
ET = ZoneInfo('America/New_York')
PPI_TEXT = re.compile(r'\bPPI\b|生産者物価')
PERCENT = re.compile(r'\d\s*[%％]')


def ppi_announcements(updates, route_errors):
    """The PPI came out but BLS's own page could not be read (Nov 13): a notice that carries NO number.

    Only the fact is used from other sources (a post after the scheduled release time that names PPI with a figure):
    never its numbers. One item per release day, carrying the reason code the owner is warned with."""
    try:
        import release_watch
        schedule = [e for e in release_watch.load_schedule() if e.get('indicator') == 'ppi']
    except Exception:
        return []
    found = {}
    for update in updates or []:
        try:
            if update.get('publisher') in ('BLS', 'BEA') or not PPI_TEXT.search(f"{update.get('title', '')} {update.get('translationJa', '')}"):
                continue
            if not PERCENT.search(f"{update.get('title', '')} {update.get('translationJa', '')}"):
                continue
            published = datetime.fromisoformat(str(update['publishedAt']).replace('Z', '+00:00'))
            if not any(e['at'] - timedelta(seconds=60) <= published <= e['at'] + timedelta(hours=6) for e in schedule):
                continue
            day = published.astimezone(ET).strftime('%m%d%Y')
            if day not in found or published < found[day][0]:
                found[day] = (published, update)
        except (KeyError, TypeError, ValueError, AttributeError):
            continue
    code = (route_errors or {}).get('bls-ppi') or 'bls-ppi-not-read'
    return [{'kind': 'ppi', 'id': f'ppi-notice-{day}', 'date': day, 'publishedAt': published.isoformat(), 'ja': '', 'en': '',
             'announceOnly': True, 'reason': code} for day, (published, _u) in sorted(found.items())]


def owner_ids():
    import release_watch
    owners = {release_watch.OWNER_MEMBER_ID, release_watch.PRODUCTION_OWNER_MEMBER_ID}
    configured = os.environ.get('RESEARCH_OWNER_MEMBER_ID', '').strip()
    if configured:
        owners.add(configured)
    return sorted(owners)


def deliver_economic(db, items, **options):
    """After a release: the indicator's name and its result number, to the devices that switched that indicator on.

    Nothing is sent before a release, and no comparison with the market forecast is included: the site has no forecast source.
    A PPI whose numbers BLS's page did not give (`announceOnly`) is still announced, without any number and with the official
    link, after a short grace; the owner's devices (never members) are then warned with the reason code."""
    if not configuration()['enabled']:
        return {'status': 'disabled', 'attempted': 0}
    now = options.get('now') or options.get('wall_now', time.time)()
    total = {'attempted': 0, 'accepted': 0}
    for item in items:
        made = _moment(item.get('publishedAt'))
        kind = item.get('kind')
        if made is None or kind not in NAMES or not 0 <= now - made < ECONOMIC_WINDOW_SECONDS:
            continue
        announce_only = bool(item.get('announceOnly'))
        if announce_only:
            if now - made < ANNOUNCE_GRACE_SECONDS or any(
                    other.get('kind') == 'ppi' and not other.get('announceOnly') and str(other.get('id', '')).endswith(f"ppi_{item.get('date')}.htm") for other in items):
                continue
            payload_for = lambda ja, item=item: {
                'title': NAMES['ppi'][0 if ja else 1],
                'body': (f'米国PPIが発表されました。公式発表で結果をご確認ください（{PPI_PAGE}）' if ja
                         else f'The U.S. PPI has been released. Check the official release for the result ({PPI_PAGE})'),
                'url': '/research/calendar'}
        else:
            payload_for = lambda ja, item=item: {'title': NAMES[item['kind']][0 if ja else 1],
                                                 'body': (item['ja'] if ja else item['en'] or item['ja'])[:140], 'url': '/research/calendar'}
        result = announce(db, f"economic-{item['id']}", MEMBERS + ' AND econ=1', (), payload_for,
                          (made,), accept=lambda device, kind=kind: kind in economic_kinds(device), **options)
        total = {k: total[k] + result.get(k, 0) for k in total}
        if announce_only:
            owners = owner_ids()
            announce(db, f"economic-warning-{item['id']}",
                     f"SELECT * FROM push_devices WHERE active=1 AND owner_id IN ({','.join('?' for _ in owners)})", tuple(owners),
                     lambda ja, item=item: {'title': '⚠ PPI 数字なしで送信' if ja else '⚠ PPI sent without numbers',
                                            'body': f"理由：{item.get('reason')}" if ja else f"Reason: {item.get('reason')}", 'url': '/research/calendar'},
                     (made,), **options)
    return {'status': 'ready', **total}


# RESOLUTE (owner, Nov 17): the closing-price alert (③) and the next-morning note (④) reach the member's phone with the same Web Push
# as Tech Phase. RESOLUTE decides who gets what and when (its own database, the same checks as its emails), then asks this monitor to
# send the notice to the member's devices (POST /internal/resolute/push with its own token, RESOLUTE_PUSH_TOKEN). This monitor sends
# only to a device that (1) belongs to that member, (2) kept its RESOLUTE switch on, and (3) whose member the website confirmed, on its
# own server, holds the RESOLUTE alert rights (resolute_until), or is an owner account. Tech Phase PRO plays no part. When no device
# accepts the notice, RESOLUTE sends its email instead. Notices are never held for おやすみモード: the member chose the delivery hour.
# Both pages are on the service worker's list (lib/research/push-targets.json).
RESOLUTE_PAGES = {'/resolute/alerts/latest': 'resolute-alert', '/resolute/morning': 'resolute-morning'}
RESOLUTE_TITLE = 'RESOLUTE'
RESOLUTE_EVENT = re.compile(r'[a-f0-9]{32}')
RESOLUTE_BODY_LIMIT = 120
# What a RESOLUTE buyer without PRO may switch on the settings page: the RESOLUTE row only.
RESOLUTE_ONLY_PREFERENCES = frozenset({'resolute'})


def resolute_token_ok(supplied):
    """The dedicated RESOLUTE sender token: at least 32 characters and never one of the monitor's other tokens."""
    import hmac
    token = os.environ.get('RESOLUTE_PUSH_TOKEN', '')
    privileged = [os.environ.get(k, '') for k in ('RESEARCH_API_TOKEN', 'RESEARCH_EDITOR_TOKEN', 'RESOLUTE_NEWS_READ_TOKEN')]
    return len(token) >= 32 and token not in privileged and isinstance(supplied, str) and hmac.compare_digest(supplied, 'Bearer ' + token)


def resolute_message(payload):
    """The notice as RESOLUTE built it: title RESOLUTE, one short line, one of the two RESOLUTE pages. Anything else is refused."""
    title, body, url = payload.get('title'), payload.get('body'), payload.get('url')
    if (title != RESOLUTE_TITLE or not isinstance(body, str) or not 1 <= len(body) <= RESOLUTE_BODY_LIMIT
            or re.search(r'[\x00-\x1f\x7f]', body) or url not in RESOLUTE_PAGES):
        raise ValueError('invalid-notice')
    return dict(title=title, body=body, url=url)


def resolute_push(db, payload, transport=send, now=None):
    """Send one RESOLUTE notice to the member's eligible devices, once per device (the claim is written before the network call; an
    ambiguous failure is never retried). mode "lookup" only counts the devices that already accepted it (RESOLUTE's reconciliation).
    Returns counts only: never a device, an endpoint or the text."""
    if not configuration()['enabled']:
        raise ValueError('disabled')
    owner = member_identity(payload)
    event = payload.get('event')
    if not isinstance(event, str) or not RESOLUTE_EVENT.fullmatch(event):
        raise ValueError('invalid-notice')
    key = 'resolute:' + event
    now = time.time() if now is None else now
    if payload.get('mode') == 'lookup':
        accepted = db.execute('''SELECT COUNT(*) FROM push_deliveries d JOIN push_devices v ON v.id=d.device_id
          WHERE v.owner_id=? AND d.event_key=? AND d.status='accepted' ''', (owner, key)).fetchone()[0]
        return {'devices': accepted, 'accepted': accepted, 'failed': 0}
    message = resolute_message(payload)
    devices = accepted = failed = 0
    for device in db.execute('SELECT * FROM push_devices WHERE active=1 AND owner_id=?', (owner,)).fetchall():
        if not device['resolute'] or not resolute_entitled(device, now):
            continue
        devices += 1
        with db:
            claim = db.execute('''INSERT OR IGNORE INTO push_deliveries (device_id,event_key,status,attempted_at,observed_at)
                VALUES(?,?,?,?,?)''', (device['id'], key, 'uncertain', now, now)).rowcount
        if not claim:
            prior = db.execute('SELECT status FROM push_deliveries WHERE device_id=? AND event_key=?', (device['id'], key)).fetchone()
            if prior and prior['status'] == 'accepted':
                accepted += 1
            else:
                failed += 1
            continue
        notice = {**message, 'tag': 'resolute-' + event[:16]}
        try:
            code = noting(db, transport, now)(json.loads(device['subscription']), notice)
        except Exception:
            code = 0
        status = 'accepted' if isinstance(code, int) and 200 <= code < 300 else 'expired' if code in (404, 410) else 'uncertain'
        with db:
            db.execute('UPDATE push_deliveries SET status=? WHERE device_id=? AND event_key=?', (status, device['id'], key))
            if status == 'expired':
                db.execute('DELETE FROM push_devices WHERE id=?', (device['id'],))
                db.execute('DELETE FROM push_device_preferences WHERE device_id=?', (device['id'],))
        accepted += status == 'accepted'
        failed += status != 'accepted'
    print(json.dumps({'event': 'resolute-push', 'kind': RESOLUTE_PAGES[message['url']], 'devices': devices,
                      'accepted': accepted, 'failed': failed}), flush=True)
    return {'devices': devices, 'accepted': accepted, 'failed': failed}
