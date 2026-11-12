"""決算速報 straight from the issuer's own results table (owner, Nov 12).

CoreWeave's Nov 10 results (8-K at 21:05 UTC) never reached the site: the only route to the calendar's
released-earnings list was a model-written summary, and that summary kept failing the factual checks.
This is the first step of a two-step publication. Within seconds of the issuer's results release being read, the
headline numbers are copied out of its "financial highlights" table with fixed patterns and published as a result flash.
The model-written article can follow later and does not hold this back.

Nothing is guessed or written by a model:
- a figure is read only from the exact row of the table whose column header names the reported quarter and the quarter
  one year earlier; a row that is missing, wrapped differently, or ambiguous is simply left out;
- without a revenue figure nothing is published; with a layout the patterns do not know, nothing is published;
- the Japanese and English labels are fixed text and every value is the issuer's own number (unit and currency kept);
- a flash is replaced only when a later read of the same release gives different numbers (a correction).
"""
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

import monitor

VERSION = 'issuer-flash-v1'
WINDOW = timedelta(days=7)
# While an unpublished results release is looking for its table (the PDF is linked a little after the page appears),
# retry quickly for the first half hour and slowly afterwards.
RETRY_FAST_SECONDS = 10
RETRY_SLOW_SECONDS = 600
FAST_PERIOD = timedelta(minutes=30)
MAX_PDF_CANDIDATES = 5

NUM = r'\(?-?\d[\d,]*(?:\.\d+)?\)?'
CHANGE = r'(?:-?\d[\d,]*%|n/m)'
MONTH = r'(?:January|February|March|April|May|June|July|August|September|October|November|December)'
QUARTERS = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4}

# key, Japanese label, English label (fixed text; the values are the issuer's)
LABELS = {
    'revenue': ('売上高', 'Revenue'),
    'eps': ('EPS（希薄化後）', 'Diluted EPS'),
    'net-income': ('純損益', 'Net income / (loss)'),
    'operating-income': ('営業損益', 'Operating income / (loss)'),
    'adjusted-ebitda': ('調整後EBITDA', 'Adjusted EBITDA'),
    'adjusted-net-income': ('調整後純損益', 'Adjusted net income / (loss)'),
    'guidance-revenue': ('通期見通し 売上高', 'Full-year guidance Revenue'),
}
ORDER = ['revenue', 'eps', 'net-income', 'operating-income', 'adjusted-ebitda', 'adjusted-net-income', 'guidance-revenue']


def signed(text):
    """'(190.4)' -> -190.4; '3,661' -> 3661. Raises ValueError for anything else."""
    text = text.strip()
    negative = text.startswith('(') and text.endswith(')')
    text = text.strip('()').replace(',', '').replace('−', '-')
    try:
        value = Decimal(text)
    except InvalidOperation:
        raise ValueError('number')
    return -abs(value) if negative else value


def consistent(prior, current, change):
    """The table states the change in percent: it must agree with the two values (to the rounding of the printed figures).
    A digit garbled by PDF text extraction ("(3 7 .5)", "9 80.8") then cannot become a published figure."""
    if not change.endswith('%') or prior <= 0 or current < 0:
        return  # n/m or a sign change: nothing to check
    stated = Decimal(change[:-1].replace(',', ''))
    actual = (current / prior - 1) * 100
    if abs(actual - stated) > Decimal('1.5') + abs(actual) * Decimal('0.01'):
        raise ValueError('change-mismatch')


def money_millions(value):
    """Million-dollar figure -> '$582.3M' / '$3.661B' (exact; the value is never rounded)."""
    if abs(value) >= 1000:
        text, unit = format((value / 1000).normalize(), 'f'), 'B'
    else:
        text, unit = format(value.normalize(), 'f'), 'M'
    return '$' + text + unit


def per_share(value):
    return '$' + format(value.normalize(), 'f')


def clean(text):
    return ' '.join((text or '').split())


# ---- issuer layouts ----------------------------------------------------------------------------------------

def period_from_url(url):
    """'nebius-reports-third-quarter-2026-financial-results' -> (3, 2026); None when the slug says no quarter."""
    match = re.search(r'(first|second|third|fourth)-quarter-(20\d\d)', url or '')
    return (QUARTERS[match[1]], int(match[2])) if match else None


def parse_nebius(text, url=None):
    """Nebius' results release (PDF): 'Q3 2026 financial highlights', table columns prior-year, current, change.

    PDF text extraction can split words and digits ("F inancial H ighlights", "In SD millions"), so the heading is matched
    with its spaces removed, the quarter falls back to the one named in the page address, and the table is found by its own
    units line. Each figure still has to come from a clean row whose stated change agrees with its two values."""
    t = clean(text)
    if 'nebius' not in t.lower():
        raise ValueError('issuer-identity-missing')
    despaced = re.sub(r'\s+', '', t)
    head = re.search(r'Q([1-4])(20\d\d)financialhighlights', despaced, re.I)
    period = (int(head[1]), int(head[2])) if head else period_from_url(url)
    if not period:
        raise ValueError('highlights-heading-missing')
    quarter, year = period
    # The highlights table is the first "In USD $ millions" block that is followed by a Revenues row.
    units = next((m for m in re.finditer(r'In\s+U?SD\s*\$?\s*millions', t, re.I)
                  if re.search(r'\bRevenues?\b', t[m.end():m.end() + 900])), None)
    if units:
        window = t[units.start():units.start() + 5000]
    elif re.search(r'\bU?SD\b', t) and re.search(r'\bmillions?\b', t, re.I):
        window = t  # the extraction placed the units line away from the table: the year header below must still match
    else:
        raise ValueError('units-unrecognized')
    first = re.search(r'(?<!Change )\b(' + str(year - 1) + r') (' + str(year) + r') Change\b(?: 20\d\d 20\d\d Change\b)?.{0,40}?\bRevenues? ('
                      + NUM + ') (' + NUM + ') (' + CHANGE + ')', window)
    if not first:
        raise ValueError('revenue-row-unrecognized')
    metrics = {'revenue': (signed(first[4]), signed(first[3]))}
    consistent(metrics['revenue'][1], metrics['revenue'][0], first[5])
    block = window[first.start():first.start() + 1200]
    stop = block.find('Operating expenses')
    block = block[:stop] if stop > 0 else block
    rows = {
        'adjusted-ebitda': r'Adjusted EBITDA(?: / \(loss\))?',
        'net-income': r'Net (?:income|loss)(?: / \((?:loss|income)\))? from continuing operations',
        'adjusted-net-income': r'Adjusted net (?:income|loss)(?: / \((?:loss|income)\))?',
    }
    for key, label in rows.items():
        found = re.findall(label + ' (' + NUM + ') (' + NUM + ') (' + CHANGE + ')', block)
        if len(found) == 1:  # a repeated or missing row is ambiguous: leave it out
            try:
                consistent(signed(found[0][0]), signed(found[0][1]), found[0][2])
            except ValueError:
                continue  # a garbled digit in this row: leave the row out rather than publish it
            metrics[key] = (signed(found[0][1]), signed(found[0][0]))
    if metrics['revenue'][0] <= 0:
        raise ValueError('revenue-not-positive')
    facts = [(key, money_millions(metrics[key][0]), money_millions(metrics[key][1])) for key in ORDER if key in metrics]
    return {'period': f'Q{quarter} {year}', 'facts': facts}


def parse_coreweave(text, url=None):
    """CoreWeave's results release (8-K EX-99.1): 'Third Quarter 2026 Financial Highlights', columns current, prior."""
    t = clean(text)
    if 'coreweave' not in t.lower():
        raise ValueError('issuer-identity-missing')
    head = re.search(r'\b(First|Second|Third|Fourth) Quarter (20\d\d) Financial Highlights\b', t)
    if not head:
        raise ValueError('highlights-heading-missing')
    quarter, year = QUARTERS[head[1].lower()], int(head[2])
    window = t[head.end():head.end() + 4000]
    if not re.search(r'\(In millions', window):
        raise ValueError('units-unrecognized')
    header = re.search(r'Three Months Ended ' + MONTH + r' \d{1,2}, ' + str(year) + ' ' + str(year - 1) + r'\b', window)
    if not header:
        raise ValueError('columns-unrecognized')
    gaap_end = window.find('Non-GAAP', header.end())
    gaap = window[header.end():gaap_end if gaap_end > 0 else header.end() + 1500]
    pair = '(' + NUM + r')\s*\$?\s*(' + NUM + ')'

    def row(label, block):
        found = re.findall(r'(?<![A-Za-z])' + label + r' \$ ' + pair + r'(?= |$)', block)
        return found[0] if len(found) == 1 else None
    metrics = {}
    revenue = row('Revenue', gaap)
    if not revenue:
        raise ValueError('revenue-row-unrecognized')
    metrics['revenue'] = (signed(revenue[0]), signed(revenue[1]))
    for key, label in (('operating-income', 'Operating income'), ('net-income', 'Net (?:loss|income)')):
        found = row(label, gaap)
        if found:
            metrics[key] = (signed(found[0]), signed(found[1]))
    eps = row('Diluted net (?:loss|income) per share', gaap)
    if eps:
        metrics['eps'] = (signed(eps[0]), signed(eps[1]))
    adjusted = window[gaap_end:gaap_end + 1500] if gaap_end > 0 else ''
    found = row('Adjusted EBITDA', adjusted)
    if found:
        metrics['adjusted-ebitda'] = (signed(found[0]), signed(found[1]))
    if metrics['revenue'][0] <= 0:
        raise ValueError('revenue-not-positive')
    fmt = lambda key, value: per_share(value) if key == 'eps' else money_millions(value)
    facts = [(key, fmt(key, metrics[key][0]), fmt(key, metrics[key][1])) for key in ORDER if key in metrics]
    guidance = re.findall(r'full year ' + str(year) + r' revenue guidance to a range of \$(\d+(?:\.\d+)?) billion to \$(\d+(?:\.\d+)?) billion', t)
    if len(guidance) == 1 and Decimal(guidance[0][0]) < Decimal(guidance[0][1]):
        facts.append(('guidance-revenue', f'${guidance[0][0]}B-${guidance[0][1]}B', None))
    return {'period': f'Q{quarter} {year}', 'facts': facts}


NEBIUS_RESULTS_PATH = re.compile(r'^/newsroom/(?=[a-z0-9-]*quarter)(?=[a-z0-9-]*financial-results)(?![a-z0-9-]*date)[a-z0-9-]+/?$')
PDF_LINK = re.compile(r'https://assets\.nebius\.com/assets/[0-9a-f-]{36}/[^"\\\s)<>]*?\.pdf', re.I)


PDF_MAX_BYTES = 20 * 1024 * 1024


class _SameHostRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        if target.scheme != 'https' or target.hostname != 'assets.nebius.com':
            raise ValueError('redirect-off-host')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def direct_pdf(url, ticker=None):
    """Plain bounded download of a results PDF from the issuer's asset host. No conditional requests and no shared fetch
    cache: on Nov 12 the monitor's general fetch kept failing ('empty or oversized') for a PDF that downloads fine."""
    parts = urlsplit(url)
    if parts.scheme != 'https' or parts.hostname != 'assets.nebius.com' or parts.username or parts.password:
        raise ValueError('host-not-allowed')
    request = urllib.request.Request(url, headers={'User-Agent': os.environ.get('RESEARCH_USER_AGENT', 'TechPhaseResearch-SourceCheck/0.1'),
                                                  'Accept': 'application/pdf'})
    with urllib.request.build_opener(_SameHostRedirect()).open(request, timeout=20) as response:
        content = response.read(PDF_MAX_BYTES + 1)
    if not content:
        raise ValueError('fetch-empty')
    if len(content) > PDF_MAX_BYTES:
        raise ValueError('fetch-too-large')
    if not content.startswith(b'%PDF-'):
        raise ValueError('fetch-not-pdf')
    return content, 'application/pdf'


def failure_code(exc):
    text = str(exc).lower()
    if isinstance(exc, ValueError) and re.fullmatch(r'(?:fetch|host|redirect)-[a-z-]{1,30}|host-not-allowed', str(exc)):
        return str(exc)
    if isinstance(exc, urllib.error.HTTPError):
        return 'fetch-http-%d' % exc.code
    if 'timed out' in text:
        return 'extract-timeout' if 'extraction' in text else 'fetch-timeout'
    if 'no extractable' in text:
        return 'extract-no-text'
    if 'oversized' in text:
        return 'fetch-oversized'
    return 'fetch-or-extract-error'


def nebius_pdf_text(page_url, fetch, fetch_pdf=None):
    """Text of the results release PDF linked from the newsroom page (the page itself carries no numbers)."""
    fetch_pdf = fetch_pdf or direct_pdf
    html, _ = fetch(page_url, 'NBIS')
    seen = []
    for link in PDF_LINK.findall(html.decode('utf-8', 'replace')):
        if link not in seen:
            seen.append(link)
    codes = []
    for link in seen[:MAX_PDF_CANDIDATES]:
        try:
            content, content_type = fetch_pdf(link, 'NBIS')
            if content_type != 'application/pdf':
                codes.append('not-pdf')
                continue
            # The headline table is on the first pages; reading all of an 8 MB release timed out on a busy monitor.
            text = monitor.extract_pdf_text(content, first_pages=3)
        except Exception as exc:
            codes.append(failure_code(exc))
            continue
        if 'financialhighlights' in re.sub(r'\s+', '', text).lower():
            return text
        codes.append('no-heading')
    if not seen:
        raise ValueError('results-pdf-not-linked-yet')
    # /health shows the outcome of the first PDF (the release itself); a later letter's failure must not hide it.
    raise ValueError(codes[0] if codes else 'results-table-not-in-pdf')


PROFILES = {
    'NBIS': {'publisher': 'Nebius IR', 'parse': parse_nebius},
    'CRWV': {'publisher': 'CoreWeave IR (SEC 8-K)', 'parse': parse_coreweave},
}
SOURCE_URL = {
    'NBIS': re.compile(r'^https://nebius\.com/newsroom/[a-z0-9-]+$'),
    'CRWV': re.compile(r'^https://www\.sec\.gov/Archives/edgar/data/\d+/\d+/[A-Za-z0-9_.-]+$'),
}


# ---- storage -----------------------------------------------------------------------------------------------

def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS issuer_result_publications(
      key TEXT PRIMARY KEY, ticker TEXT NOT NULL, url TEXT NOT NULL, period TEXT NOT NULL,
      payload TEXT NOT NULL, observed_at TEXT NOT NULL, published_at TEXT NOT NULL,
      processing_ms INTEGER NOT NULL, version TEXT NOT NULL)''')


def instant(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def stamp(value=None):
    return (value or datetime.now(timezone.utc)).isoformat(timespec='milliseconds')


def build(ticker, url, parsed, observed_at):
    key = hashlib.sha256('\0'.join([ticker, parsed['period'], url]).encode()).hexdigest()
    number = str(int(key[:12], 16))
    # comparisons.yearAgo is the same quarter one year earlier, read from the table's prior-year column (same format as value).
    facts = [{'key': k, 'ja': LABELS[k][0], 'en': LABELS[k][1], 'value': v, **({'comparisons': {'yearAgo': y}} if y else {})}
             for k, v, y in parsed['facts']]
    first = facts[:2]
    period = parsed['period']
    return key, {
        'id': number, 'researchId': 'ir-flash-' + number, 'kind': 'earnings', 'ticker': ticker, 'period': period,
        'titleJa': f'{ticker} {period}決算：' + '、'.join(f['ja'] + f['value'] for f in first),
        'titleEn': f'{ticker} {period} earnings: ' + ', '.join(f['en'] + ' ' + f['value'] for f in first),
        'facts': facts, 'url': url, 'publisher': PROFILES[ticker]['publisher'],
        'publishedAt': observed_at, 'observedAt': observed_at, 'method': 'deterministic-issuer-table',
    }


_attempts = {}
# Last outcome per release (short codes only), so /health shows why a results table was not published.
STATUS = {}


def due(url, detected, now):
    """Rate limit for sources that are still waiting for their table."""
    last = _attempts.get(url)
    wait = RETRY_FAST_SECONDS if now - detected <= FAST_PERIOD else RETRY_SLOW_SECONDS
    if last is not None and time.monotonic() - last < wait:
        return False
    _attempts[url] = time.monotonic()
    return True


def candidates(db, reference):
    cutoff = (reference - WINDOW).isoformat()
    for row in db.execute('''SELECT s.url,s.ticker,COALESCE(e.detected_at,s.discovered_at) AS detected
        FROM sources s LEFT JOIN release_events e ON e.url=s.url
        WHERE s.ticker='NBIS' AND s.status NOT IN ('held','rejected')
          AND julianday(COALESCE(e.detected_at,s.discovered_at))>=julianday(?)''', (cutoff,)):
        parts = urlsplit(row['url'])
        if (parts.scheme == 'https' and parts.hostname == 'nebius.com' and not parts.query
                and NEBIUS_RESULTS_PATH.match(parts.path) and SOURCE_URL['NBIS'].match(row['url'])):
            yield row['ticker'], row['url'], row['detected'], None
    # Never filter on the revision text in SQL: the planner then scans every stored revision (a whole database of
    # page text) every few seconds and starves the monitor (Nov 12). Pick the few recent CoreWeave sources first,
    # then read only their current revision.
    for row in db.execute('''SELECT s.url,s.ticker,s.sha256,COALESCE(e.detected_at,s.discovered_at) AS detected
        FROM sources s LEFT JOIN release_events e ON e.url=s.url
        WHERE s.ticker='CRWV' AND s.status NOT IN ('held','rejected')
          AND julianday(COALESCE(e.detected_at,s.discovered_at))>=julianday(?)''', (cutoff,)).fetchall():
        if not SOURCE_URL['CRWV'].match(row['url']):
            continue
        revision = db.execute('SELECT extracted_text FROM source_revisions WHERE url=? AND sha256=?',
                              (row['url'], row['sha256'])).fetchone()
        if revision and 'Financial Highlights' in (revision['extracted_text'] or ''):
            yield row['ticker'], row['url'], row['detected'], revision['extracted_text']


def run_once(path, reference=None, fetch=None, fetch_pdf=None):
    """Publish every unpublished (or corrected) results table found. Returns the number of changes."""
    reference = reference or datetime.now(timezone.utc)
    fetch = fetch or monitor.fetch
    changed = 0
    with monitor.connect(path) as db:
        schema(db)
        for ticker, url, detected, body in list(candidates(db, reference)):
            observed = instant(detected)
            if observed is None or observed > reference:
                continue
            existing = {r['key']: r for r in db.execute(
                'SELECT key,payload FROM issuer_result_publications WHERE ticker=? AND url=?', (ticker, url))}
            if body is None:
                if existing or not due(url, observed, reference):
                    continue
            started = time.monotonic()
            try:
                text = body if body is not None else nebius_pdf_text(url, fetch, fetch_pdf or (fetch if fetch is not monitor.fetch else None))
                parsed = PROFILES[ticker]['parse'](text, url)
            except Exception as exc:
                code = str(exc) if isinstance(exc, ValueError) and re.fullmatch(r'[a-z0-9-]{1,40}', str(exc)) else type(exc).__name__
                STATUS[url] = {'ticker': ticker, 'state': 'unreadable', 'reason': code, 'at': stamp()}
                continue
            STATUS[url] = {'ticker': ticker, 'state': 'published', 'reason': None, 'at': stamp()}
            key, payload = build(ticker, url, parsed, stamp(observed))
            old = existing.get(key)
            if old and json.loads(old['payload'])['facts'] == payload['facts']:
                continue
            with db:
                db.execute('''INSERT INTO issuer_result_publications VALUES(?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,published_at=excluded.published_at,
                  processing_ms=excluded.processing_ms,version=excluded.version''',
                           (key, ticker, url, parsed['period'], json.dumps(payload, ensure_ascii=False),
                            stamp(observed), stamp(), round((time.monotonic() - started) * 1000), VERSION))
            changed += 1
    return changed


def public_feed(db, cutoff):
    """Stored flashes still inside the window, in the same shape as market_results items."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='issuer_result_publications'").fetchone():
        return []
    items = []
    for row in db.execute('SELECT payload,observed_at,published_at,processing_ms FROM issuer_result_publications '
                          'WHERE julianday(observed_at)>=julianday(?) ORDER BY julianday(observed_at) DESC', (cutoff,)):
        item = json.loads(row['payload'])
        item['publicAt'] = row['published_at']
        item['processingMs'] = row['processing_ms']
        item['sourceToDetectionMs'] = None
        item['detectionToPublicMs'] = monitor.stored_latency_ms(row['observed_at'], row['published_at'])
        items.append(item)
    return items


def diagnostics(db):
    """Read-only summary for /health: what was found, what is waiting, and why nothing was published."""
    stored = 0
    latest = []
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='issuer_result_publications'").fetchone():
        stored = db.execute('SELECT count(*) FROM issuer_result_publications').fetchone()[0]
        latest = [{'ticker': r['ticker'], 'period': r['period'], 'observedAt': r['observed_at'], 'publicAt': r['published_at'],
                   'detectionToPublicMs': monitor.stored_latency_ms(r['observed_at'], r['published_at'])}
                  for r in db.execute('SELECT ticker,period,observed_at,published_at FROM issuer_result_publications '
                                      'ORDER BY julianday(observed_at) DESC LIMIT 5')]
    return {'status': 'running', 'published': stored, 'latest': latest,
            'waiting': [{k: v[k] for k in ('ticker', 'state', 'reason', 'at')}
                        for v in sorted(STATUS.values(), key=lambda v: v['at'], reverse=True)[:10] if v['state'] != 'published']}
