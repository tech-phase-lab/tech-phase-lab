"""「決算を発表しました」: the first stage of an earnings flash (owner, Nov 13).

When a company publishes its own results release on its official site, this puts one line on the site at once — "<ticker> announced
its results" with the link to the company's own page — before any figure is read. No figure, no model, no social post: only the
fact that the company's own page with a results title exists, and where. The figures follow from the second stage
(issuer_result_flash) and replace this line for that company.

A release counts only when the monitor's own record of the company's page (title, address, first-seen time) says so:
  * the title names results/earnings together with a quarter or fiscal period, and is not a date notice or call invitation
    (release_watch.NOT_RELEASE);
  * the address is https, has no query, and its host is one of the company's configured official hosts.
"""
import hashlib
import json
import re
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import monitor
import release_watch

WINDOW = timedelta(days=3)
RESULT = re.compile(r'\b(?:results|earnings)\b', re.I)
QUARTER = re.compile(r'\b(?:Q([1-4])|(first|second|third|fourth)\s+quarter)\b', re.I)
ORDINAL = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4}
FISCAL = re.compile(r'\b(?:fiscal|full[- ]year)\b', re.I)
MEETING = re.compile(r'\b(?:general meeting|shareholder meeting|AGM|voting results|results of (?:the )?(?:annual|special))\b', re.I)


def period_of(title):
    quarter = QUARTER.search(title)
    year = re.search(r'\b(20\d\d)\b', title)
    if quarter:
        number = quarter[1] or ORDINAL[quarter[2].lower()]
        return f'Q{number} {year[1]}' if year else f'Q{number}'
    return None


def is_results_release(title):
    """Title of a company's results release (not a date notice, not a call invitation)."""
    return bool(isinstance(title, str) and RESULT.search(title) and (period_of(title) or FISCAL.search(title))
                and not release_watch.NOT_RELEASE.search(title) and not MEETING.search(title))


# An SEC 8-K is titled "8-K · 8-K" (the filing index carries no headline), so a company whose results reach us only as a filing never
# matched the title rule above (Applied Materials, Nov 12). Its Item 2.02 line is the company's own statement that results follow.
RESULTS_ITEM = re.compile(r'\bItem\s+2\.02\b.{0,40}\bResults of Operations\b', re.I)


def is_results_filing(db, row):
    """An 8-K whose stored text (the page the monitor already fetched) declares Item 2.02. Reads one stored revision, only for 8-Ks."""
    if row['sec_form'] != '8-K' or not row['sha256']:
        return False
    revision = db.execute('SELECT extracted_text FROM source_revisions WHERE url=? AND sha256=?', (row['url'], row['sha256'])).fetchone()
    return bool(revision and RESULTS_ITEM.search((revision['extracted_text'] or '')[:8000]))


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS earnings_announcements(
      key TEXT PRIMARY KEY, ticker TEXT NOT NULL, url TEXT NOT NULL, period TEXT NOT NULL,
      observed_at TEXT NOT NULL, published_at TEXT NOT NULL, processing_ms INTEGER NOT NULL)''')


def instant(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def official(ticker, url):
    parts = urlsplit(url)
    return (parts.scheme == 'https' and not parts.query and not parts.fragment and not parts.username
            and parts.hostname in monitor.HOSTS.get(ticker, set()) and len(url) <= 240)


def run_once(path, reference=None):
    """Record every new results release found on a company's official site. No network. Returns the number added."""
    reference = reference or datetime.now(timezone.utc)
    cutoff = (reference - WINDOW).isoformat()
    added = 0
    with monitor.connect(path) as db:
        schema(db)
        started = time.monotonic()
        rows = db.execute('''SELECT s.url,s.ticker,s.title,s.sec_form,s.sha256,COALESCE(e.detected_at,s.discovered_at) AS detected
            FROM sources s LEFT JOIN release_events e ON e.url=s.url
            WHERE s.title IS NOT NULL AND s.status NOT IN ('held','rejected')
              AND julianday(COALESCE(e.detected_at,s.discovered_at))>=julianday(?)''', (cutoff,)).fetchall()
        for row in rows:
            if row['ticker'] not in monitor.PROVIDERS or not official(row['ticker'], row['url']):
                continue
            if not is_results_release(row['title']) and not is_results_filing(db, row):
                continue
            observed = instant(row['detected'])
            if observed is None or observed > reference:
                continue
            period = period_of(row['title']) or 'Latest'
            key = hashlib.sha256('\0'.join([row['ticker'], row['url']]).encode()).hexdigest()
            with db:
                added += db.execute('INSERT OR IGNORE INTO earnings_announcements VALUES(?,?,?,?,?,?,?)',
                    (key, row['ticker'], row['url'], period, observed.isoformat(timespec='milliseconds'),
                     datetime.now(timezone.utc).isoformat(timespec='milliseconds'), round((time.monotonic() - started) * 1000))).rowcount
    return added


def public_feed(db, cutoff):
    """Stored announcements still inside the window, in the shape of the other result briefs (no figures)."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='earnings_announcements'").fetchone():
        return []
    items = []
    for row in db.execute('SELECT * FROM earnings_announcements WHERE julianday(observed_at)>=julianday(?) '
                          'ORDER BY julianday(observed_at) DESC', (cutoff,)):
        number = str(int(row['key'][:12], 16))
        name = monitor.PROVIDERS[row['ticker']]['name']
        items.append({
            'id': number, 'researchId': 'ir-announce-' + number, 'kind': 'earnings', 'ticker': row['ticker'], 'period': row['period'],
            'titleJa': f"{row['ticker']} 決算を発表しました", 'titleEn': f"{row['ticker']} announced its results",
            'facts': [], 'url': row['url'], 'publisher': f'{name} IR',
            'publishedAt': row['observed_at'], 'observedAt': row['observed_at'], 'method': 'official-page-announcement',
            'publicAt': row['published_at'], 'processingMs': row['processing_ms'], 'sourceToDetectionMs': None,
            'detectionToPublicMs': monitor.stored_latency_ms(row['observed_at'], row['published_at'])})
    return items


def diagnostics(db):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='earnings_announcements'").fetchone():
        return {'status': 'running', 'announced': 0, 'latest': []}
    return {'status': 'running', 'announced': db.execute('SELECT count(*) FROM earnings_announcements').fetchone()[0],
            'latest': [{'ticker': r['ticker'], 'period': r['period'], 'observedAt': r['observed_at'], 'publicAt': r['published_at'],
                        'detectionToPublicMs': monitor.stored_latency_ms(r['observed_at'], r['published_at'])}
                       for r in db.execute('SELECT * FROM earnings_announcements ORDER BY julianday(observed_at) DESC LIMIT 5')]}
