"""Scheduled-release watch: faster acquisition and owner alerts.

Owner request (Oct 8): the Oct 1 Micron results and the Oct 2 employment
report reached the site late and nobody was told. For every timed calendar
event (release_schedule.json, generated from lib/research/calendar.ts):

* burst: the X routes that carry the result are polled every few seconds from
  one minute before until fifteen minutes after a scheduled release;
* alert: the owner's phone gets a push when the result is not public three
  minutes after the release (or by the start of an earnings call), and again
  when it is published, with the delay from the scheduled time.

Matching reads the same public payload the site renders. No model call and no
source text is used; a notification names the event and a delay only.
"""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re

SCHEDULE_PATH = Path(__file__).with_name('release_schedule.json')
# Clerk user id of the approved owner account (also in lib/membership); an
# identifier, not a credential. Only this account's devices get alerts.
OWNER_MEMBER_ID = 'user_3JulL4D07KtVl5Eg2zdY1iczKbC'
BURST_BEFORE = timedelta(minutes=1)
BURST_AFTER = timedelta(minutes=15)
BURST_INTERVAL_SECONDS = 10
ALERT_AFTER = timedelta(minutes=3)
RELEASE_LOOKBACK = timedelta(minutes=5)
# Oct 14: ASML's call is 8 hours after its release; a 6-hour window missed the already
# published result and sent a false "not published" alert at the call.
CALL_LOOKBACK = timedelta(hours=12)
WATCH_FOR = timedelta(hours=6)
# X routes that post U.S. indicator results and earnings flashes.
# Official release page polled in the same window as the social routes.
OFFICIAL_CPI_ROUTE = 'bls-cpi'
BURST_ROUTES = {'economic': ('x-wallstengine',), 'earnings': ('x-wallstengine', 'x-tipranks', 'x-tradethenews')}
INDICATORS = {
    'jobs': r'payroll|非農業|雇用統計|unemployment rate|失業率',
    'cpi': r'\bCPI\b|消費者物価',
    'ppi': r'\bPPI\b|生産者物価',
    'pce': r'\bPCE\b',
}


def instant(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


_cache = {}


def load_schedule(path=SCHEDULE_PATH):
    try:
        stat = Path(path).stat()
        key = (str(path), stat.st_mtime_ns, stat.st_size)
        if key not in _cache:
            _cache.clear()
            _cache[key] = json.loads(Path(path).read_text())['events']
        events = _cache[key]
    except (OSError, ValueError, KeyError, TypeError):
        return []
    result = []
    for event in events:
        at = instant(event.get('at')) if isinstance(event, dict) else None
        if (at and event.get('kind') in BURST_ROUTES and event.get('phase') in {'release', 'call'}
                and isinstance(event.get('id'), str) and isinstance(event.get('titleJa'), str)
                and (event['kind'] != 'economic' or event.get('indicator') in INDICATORS)
                and (event['kind'] != 'earnings' or isinstance(event.get('ticker'), str))):
            result.append({**event, 'at': at})
    return result


# Oct 11: most tracked companies have no timed calendar entry. When a tracked
# company's own earnings release is detected, poll the earnings X routes as if
# it had been scheduled at that moment. Only the IR title decides; no date is
# guessed and nothing is published from this signal.
RESULT_WORDS = r'(?:results|earnings|EPS|revenue|net sales|net income)'
PERIOD_WORDS = r'(?:Q[1-4]|first|second|third|fourth|quarter(?:ly)?|fiscal)'
EARNINGS_TITLE = re.compile(r'\b' + PERIOD_WORDS + r'\b.{0,80}\b' + RESULT_WORDS + r'\b|\b' + RESULT_WORDS
                            + r'\b.{0,80}\b' + PERIOD_WORDS + r'\b|決算', re.I)
# A date announcement or call invitation is not the release itself.
NOT_RELEASE = re.compile(r'\b(?:will|to)\s+(?:report|announce|release|host|hold|publish)\b|conference call|webcast|'
                         r'\bdate\b|\bschedule[ds]?\b|\binvit', re.I)
DETECTED = {}


def note_detection(ticker, title, detected_at):
    """Remember a detected earnings release (ticker -> detection instant)."""
    at = instant(detected_at)
    if (at and isinstance(ticker, str) and isinstance(title, str) and EARNINGS_TITLE.search(title)
            and not NOT_RELEASE.search(title)):
        if ticker not in DETECTED or DETECTED[ticker] < at:
            DETECTED[ticker] = at
        return True
    return False


def detected_events(now):
    return [{'id': 'detected-' + ticker, 'kind': 'earnings', 'phase': 'release', 'at': at, 'ticker': ticker}
            for ticker, at in list(DETECTED.items()) if at <= now <= at + BURST_AFTER]


def burst_routes(now, events=None):
    """X route ids to poll every BURST_INTERVAL_SECONDS at `now`."""
    routes = set()
    for event in [*(load_schedule() if events is None else events), *detected_events(now)]:
        if event['phase'] == 'release' and event['at'] - BURST_BEFORE <= now <= event['at'] + BURST_AFTER:
            routes.update(BURST_ROUTES[event['kind']])
            # Oct 14: the CPI result is also read straight from the BLS release page.
            if event['kind'] == 'economic' and event.get('indicator') == 'cpi':
                routes.add(OFFICIAL_CPI_ROUTE)
    return routes


def refresh_detections(db, now):
    """Read earnings releases detected in the last burst window."""
    since = (now - BURST_AFTER).isoformat()
    try:
        rows = db.execute("""SELECT r.ticker,s.title,r.detected_at FROM release_events r JOIN sources s ON s.url=r.url
          WHERE julianday(r.detected_at)>=julianday(?) AND s.title IS NOT NULL""", (since,)).fetchall()
    except Exception:
        return 0
    return sum(1 for ticker, title, detected_at in rows if note_detection(ticker, title, detected_at))


def window(event):
    """(earliest matching publication, alert due time) for one event."""
    if event['phase'] == 'call':
        return event['at'] - CALL_LOOKBACK, event['at']
    return event['at'] - RELEASE_LOOKBACK, event['at'] + ALERT_AFTER


def active(now, events=None):
    return [event for event in (load_schedule() if events is None else events)
            if window(event)[0] <= now <= event['at'] + WATCH_FOR]


def match(event, payload):
    """Earliest public item that reports this event's result, with its time."""
    since = window(event)[0]
    found = []
    for item in payload.get('resultBriefs') or []:
        public = instant(item.get('publicAt') or item.get('observedAt'))
        if not public or not instant(item.get('publishedAt')) or instant(item['publishedAt']) < since:
            continue
        if event['kind'] == 'earnings' and item.get('kind') == 'earnings' and item.get('ticker') == event['ticker']:
            found.append(public)
        elif (event['kind'] == 'economic' and item.get('kind') == 'economic'
              and re.search(INDICATORS[event['indicator']], f"{item.get('titleEn', '')} {item.get('titleJa', '')}", re.I)):
            found.append(public)
    for item in payload.get('officialUpdates') or []:
        published = instant(item.get('publishedAt') or item.get('observedAt'))
        public = instant(item.get('observedAt')) or published
        if not published or published < since:
            continue
        text = f"{item.get('title', '')} {item.get('translationJa', '')}"
        if (event['kind'] == 'earnings' and event['ticker'] in (item.get('tickers') or [])
                and str(item.get('researchId', '')).startswith('ir-result-')):
            found.append(max(public, published))
        elif (event['kind'] == 'economic' and re.search(INDICATORS[event['indicator']], text, re.I)
              and (item.get('newsCategory') == 'economic'
                   # The exact BLS release, read straight from bls.gov (Oct 14).
                   or (item.get('publisher') == 'BLS' and str(item.get('url', '')).startswith('https://www.bls.gov/news.release/archives/')))):
            found.append(max(public, published))
    return min(found) if found else None


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS release_watch_alerts(
      event_id TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL,
      delay_seconds INTEGER, delivered INTEGER NOT NULL, PRIMARY KEY(event_id, kind))''')


def owner_devices(db):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='push_devices'").fetchone():
        return []
    columns = {row[1] for row in db.execute('PRAGMA table_info(push_devices)')}
    if 'owner_id' not in columns:
        return []
    owner = os.environ.get('RESEARCH_OWNER_MEMBER_ID', OWNER_MEMBER_ID)
    return [row['subscription'] for row in db.execute(
        'SELECT subscription FROM push_devices WHERE active=1 AND owner_id=?', (owner,))]


def delay_text(seconds):
    minutes, rest = divmod(max(0, int(seconds)), 60)
    return f"{minutes}分{rest:02d}秒" if minutes else f"{rest}秒"


def notification(event, kind, delay):
    if kind == 'missing':
        due = '開始時刻' if event['phase'] == 'call' else '予定時刻から3分'
        return {'title': f"⚠ 未掲載：{event['titleJa']}",
                'body': f"{due}を過ぎても結果がサイトに出ていません。",
                'tag': f"release-watch-missing-{event['id']}", 'url': '/research/calendar'}
    timing = (f"予定時刻から{delay_text(delay)}" if delay >= 0 else f"予定時刻の{delay_text(-delay)}前")
    return {'title': f"✅ 掲載：{event['titleJa']}", 'body': f"結果を掲載しました（{timing}）。",
            'tag': f"release-watch-published-{event['id']}", 'url': '/research/calendar'}


def check(db, payload, now, transport=None, events=None):
    """Record and push due alerts once per event and kind; returns new alerts."""
    schema(db)
    sent = []
    for event in active(now, events):
        recorded = {row[0] for row in db.execute(
            'SELECT kind FROM release_watch_alerts WHERE event_id=?', (event['id'],))}
        public = match(event, payload)
        due = window(event)[1]
        kind = delay = None
        if public and 'published' not in recorded:
            kind, delay = 'published', round((public - event['at']).total_seconds())
        elif not public and now >= due and 'missing' not in recorded:
            kind = 'missing'
        if not kind:
            continue
        delivered = 0
        if transport is not None:
            message = notification(event, kind, delay)
            for subscription in owner_devices(db):
                try:
                    code = transport(json.loads(subscription), message)
                except Exception:
                    code = 0  # Never log endpoints, keys or provider responses.
                delivered += 200 <= code < 300
        with db:
            db.execute('INSERT OR IGNORE INTO release_watch_alerts VALUES(?,?,?,?,?)',
                       (event['id'], kind, now.isoformat(), delay, delivered))
        sent.append({'event': event['id'], 'kind': kind, 'delaySeconds': delay, 'delivered': delivered})
    return sent


def persisted_error_code(value):
    """Only a short error code is public; never a message that could carry a link."""
    return value if isinstance(value, str) and re.fullmatch(r'[a-z0-9-]{1,60}', value) else ('error' if value else None)


def diagnostics(db, now, events=None):
    """Read-only summary for public health (never creates tables)."""
    events = load_schedule() if events is None else events
    upcoming = [e for e in events if e['at'] >= now][:3]
    recent = [dict(zip(('event', 'kind', 'at', 'delaySeconds', 'delivered'), row)) for row in db.execute(
        'SELECT event_id,kind,at,delay_seconds,delivered FROM release_watch_alerts ORDER BY at DESC LIMIT 5')
    ] if db.execute("SELECT 1 FROM sqlite_master WHERE name='release_watch_alerts'").fetchone() else []
    official = []
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='signal_routes'").fetchone():
        for row in db.execute('SELECT id,checked_at,succeeded_at,next_check_at,failures,error FROM signal_routes WHERE id=?',
                              (OFFICIAL_CPI_ROUTE,)):
            official.append({'id': row['id'], 'checkedAt': row['checked_at'], 'succeededAt': row['succeeded_at'],
                             'nextCheckAt': row['next_check_at'], 'failures': row['failures'],
                             'error': persisted_error_code(row['error'])})
    return {'scheduled': len(events), 'ownerDevices': len(owner_devices(db)), 'officialRoutes': official,
            'burstRoutes': sorted(burst_routes(now, events)),
            'next': [{'event': e['id'], 'at': e['at'].isoformat(), 'phase': e['phase']} for e in upcoming],
            'recentAlerts': recent}
