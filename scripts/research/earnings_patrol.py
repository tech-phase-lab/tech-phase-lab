"""Earnings patrol for the 監視22銘柄 company pages (owner, Nov 26: 「間違ってないか定期的にパトロールしたほうがいい」).

Every few hours, and a few minutes after each new results flash of a roster company, for each of the 22 companies:
  (a) latest quarter: the newest results release on SEC EDGAR (8-K Item 2.02 Exhibit 99.1, or the 6-K of a foreign issuer) against
      the quarter the production company page shows (GET /api/research/company-earnings; MU: /api/research/watch-earnings);
  (b) figures: the release is read again with the monitor's own parser (issuer_result_flash.PROFILES) and its revenue, EPS and
      next-quarter guidance are compared with the tiles production serves, to the rounding of the printed figure;
  (c) the deep dive: the site's own yes/no answers (the dive covers the shown quarter; its revenue, EPS and guidance agree with the
      section and with the monitor's stored reading of the same release).
  (d) the 10-Q / 10-K: once a company files its quarterly report after the release, the release's figures are reconciled against
      the report's XBRL facts (earnings_reconcile.py) and every difference is logged.

A problem opens an operational incident per company (the monitor's existing owner alert: incident delivery to the owner's phone,
like the daily earnings self-check); it is resolved when the next patrol finds the company clean. Each run prints one JSON line,
and the first run of each Japanese day prints the daily summary line. Only tickers, fixed codes and counts are printed or stored:
never figures, release text, URLs or any environment value.

Read only towards everything outside the monitor: public SEC files (≤ 4 requests a second, the monitor's User-Agent), the public
production API. Twelve Data is never used. Off with EARNINGS_PATROL=false.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import json
import os
import re
import urllib.request
from zoneinfo import ZoneInfo

import earnings_announce
import earnings_backtest as backtest
import issuer_result_flash as flash
import monitor

# The 22 監視銘柄: MU (its own live page) and the 21 with a dive file (lib/research/company-dive.ts DIVE_TICKERS; a test keeps them equal).
ROSTER = ['MU', 'NVDA', 'AMD', 'AVGO', 'CRWV', 'ARM', 'TSM', 'ASML', 'MRVL', 'ANET', 'CRDO', 'SKHY', 'SNDK', 'NBIS', 'VRT', 'GEV', 'BE',
          'LITE', 'MSFT', 'GOOGL', 'ALAB', 'PLTR']
SITE = 'https://techphase.app'
INTERVAL = timedelta(hours=3)
AFTER_RELEASE = timedelta(minutes=4)   # the site reads the monitor once a minute and caches its answer for a minute
GRACE = timedelta(minutes=20)          # a release younger than this is not yet judged missing from the page
LOOKBACK = timedelta(days=130)
SAME_RELEASE = timedelta(days=2)       # one release, filed under a day apart in two time zones
NEWER = timedelta(days=7)              # lib/research/dive-staleness.ts uses the same week
JST = timezone(timedelta(hours=9))
INCIDENT_PREFIX = 'earnings-patrol:'
CATEGORY = 'earnings-patrol'
# Codes that mean a reader may be looking at a wrong or outdated number: critical. The others (a dive not yet rewritten, a release
# the parser could not read, a figure held back) are warnings: the page is not wrong, but the owner has something to do.
CRITICAL = {'section-stale', 'revenue-mismatch', 'eps-mismatch', 'guidance-mismatch', 'dive-mismatch'}
# A results 8-K that states no quarter's figures is skipped (the full release follows). MRVL, Nov 2 2026: the Lumentum merger
# announcement (Item 2.02) says only that fiscal Q3 revenue was "consistent with previously provided guidance"; results on Dec 1.
PRELIMINARY = re.compile(r'\bpreliminary (?:revenue|results|financial results)\b', re.I)


def enabled(env=None):
    return (os.environ if env is None else env).get('EARNINGS_PATROL', 'true').strip().lower() not in {'false', '0', 'no'}


def get_json(url):
    request = urllib.request.Request(url, headers={'User-Agent': backtest.UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read(5_000_000).decode('utf-8'))


# ---- amounts ---------------------------------------------------------------------------------------------------------------

PREFIX = {'$': 'USD', 'NT$': 'TWD', '€': 'EUR', '₩': 'KRW'}
SCALE = {'K': Decimal('0.001'), 'M': Decimal(1), 'B': Decimal(1000), 'T': Decimal(1000000)}
AMOUNT = re.compile(r'^(−|-)?(NT\$|\$|€|₩)(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)([KMBT])$')
PER_SHARE = re.compile(r'^(−|-)?(NT\$|\$|€|₩)(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)$')


def amount(text):
    """'$115.8B' / 'NT$1,494.24B' / '−$190.4M' -> (currency, millions, tolerance: half a unit of the last printed digit); else None."""
    m = AMOUNT.match((text or '').strip())
    if not m:
        return None
    digits = m[3].replace(',', '')
    try:
        value = Decimal(digits)
    except InvalidOperation:
        return None
    places = len(digits.split('.')[1]) if '.' in digits else 0
    scale = SCALE[m[4]]
    return PREFIX[m[2]], (-value if m[1] else value) * scale, Decimal('0.5') * Decimal(10) ** -places * scale


def per_share(text):
    m = PER_SHARE.match((text or '').strip())
    if not m:
        return None
    digits = m[3].replace(',', '')
    places = len(digits.split('.')[1]) if '.' in digits else 0
    value = Decimal(digits)
    return PREFIX[m[2]], -value if m[1] else value, Decimal('0.5') * Decimal(10) ** -places


def guidance(text):
    """'$130.0B ± 3%', '€14.2B-€15.2B', '$60B–$63B', '$65B' -> (currency, low, high) in millions; else None."""
    text = (text or '').strip()
    band = re.match(r'^(\S+)\s*±\s*(\d+(?:\.\d+)?)%$', text)
    if band:
        a = amount(band[1])
        if a:
            p = Decimal(band[2]) / 100
            return a[0], a[1] * (1 - p), a[1] * (1 + p)
        return None
    pair = re.match(r'^(\S+?)\s*[-–〜]\s*(\S+)$', text)
    if pair:
        a, b = amount(pair[1]), amount(pair[2])
        return (a[0], a[1], b[1]) if a and b and a[0] == b[0] else None
    one = amount(text)
    return (one[0], one[1], one[1]) if one else None


def agree(shown, read):
    """Two printed amounts agree when they differ by no more than both roundings together."""
    return shown[0] == read[0] and abs(shown[1] - read[1]) <= shown[2] + read[2]


def near(a, b, relative=Decimal('0.005')):
    return abs(a - b) <= abs(b) * relative


# ---- the release, read again -------------------------------------------------------------------------------------------------

def cik(ticker):
    provider = monitor.PROVIDERS.get(ticker, {})
    for source in [*provider.get('supplementalSources', []), *provider.get('fallbackSources', [])]:
        if source.get('format') == 'sec-json' and source.get('cik'):
            return source['cik']
    return None


def submissions(ticker, fetch_json=None):
    number = cik(ticker)
    if not number:
        return None
    return (fetch_json or get_json)(f'https://data.sec.gov/submissions/CIK{int(number):010d}.json')


def filing_url(ticker, accession, document):
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik(ticker))}/{accession.replace('-', '')}/{document}"


def exhibit_with_url(number, accession, numbers=('1',)):
    """(url, text) of a filing's press-release exhibit (the EX-99.<n> row of its index first), the way earnings_backtest reads it."""
    base = f"https://www.sec.gov/Archives/edgar/data/{int(number)}/{accession.replace('-', '')}"
    try:
        index = backtest.get(base + '/' + accession + '-index.html')
    except Exception:  # noqa: BLE001
        return None, None
    typed = [m[1] for n in numbers for m in re.finditer(
        r'<tr[^>]*>(?:(?!</tr>).)*?href="(/Archives/edgar/data/[^"]+\.(?:htm|html))"(?:(?!</tr>).)*?>\s*EX-99\.' + n + r'\s*<', index, re.S)]
    guessed = [h for h in re.findall(r'href="(/Archives/edgar/data/[^"]+\.(?:htm|html))"', index)
               if re.search(r'(?:ex|exhibit)[-_]?99', h, re.I) or re.search(r'press|earnings|results|pr\.htm', h, re.I)]
    for href in [*typed, *guessed]:
        try:
            content = backtest.get('https://www.sec.gov' + href, binary=True)
            return 'https://www.sec.gov' + href, ' '.join(monitor.extract_text(content, 'text/html').split())
        except Exception:  # noqa: BLE001
            continue
    return None, None


def latest_release(ticker, filings, now, exhibit=None, primary=None):
    """The newest results release in `filings` (SEC submissions' 'recent'): {'accepted', 'accession', 'form', 'period', 'facts'}, or
    {'unreadable': code, ...} when the newest results filing could not be read, or None when there is none in LOOKBACK.
    A preliminary or merger-day notice without the quarter's table is skipped (the full results follow)."""
    exhibit = exhibit or exhibit_with_url
    primary = primary or backtest.primary_text
    numbers = tuple(monitor.sec_exhibit_numbers(ticker))
    recent = filings['filings']['recent']
    for i, form in enumerate(recent['form']):
        accepted = datetime.fromisoformat(recent['acceptanceDateTime'][i].replace('Z', '+00:00'))
        if accepted < now - LOOKBACK:
            break
        items = recent['items'][i] if i < len(recent['items']) else ''
        accession = recent['accessionNumber'][i]
        if not ((form == '8-K' and '2.02' in items) or form == '6-K'):
            continue
        found = exhibit(cik(ticker), accession, numbers)
        url, text = found if isinstance(found, tuple) else (None, found)
        if not text and form == '6-K':
            own = primary(cik(ticker), accession, recent['primaryDocument'][i])
            text = own if own and earnings_announce.PRELIMINARY_RESULTS.search(own) else None
            url = filing_url(ticker, accession, recent['primaryDocument'][i]) if text else None
        if not text or not backtest.is_results_exhibit(text):
            continue
        base = {'accepted': accepted, 'accession': accession, 'form': form, 'url': url, 'text': text}
        try:
            import release_extras  # the monitor's own outlook reader, as the live flash uses it
            parsed = release_extras.supplement(text, flash.PROFILES[ticker]['parse'](text, None))
        except Exception as exc:  # noqa: BLE001 - any refusal is a reason code
            if PRELIMINARY.search(text):
                continue
            code = str(exc) if isinstance(exc, ValueError) and re.fullmatch(r'[a-z0-9-]{1,40}', str(exc)) else 'parser-refused'
            return {**base, 'unreadable': code}
        facts = {}
        for fact in parsed['facts']:
            facts.setdefault(fact[0], {'value': fact[1], 'label': (fact[3] if len(fact) > 3 and fact[3] else flash.LABELS.get(fact[0], ('', '')))[1],
                                       **({'yearAgo': fact[2]} if len(fact) > 2 and fact[2] else {})})
        return {**base, 'period': parsed['period'], 'facts': facts}
    return None


# ---- judging one company -----------------------------------------------------------------------------------------------------

def release_day(accepted):
    """The release's New York date (the site files a release under it)."""
    return accepted.astimezone(ZoneInfo('America/New_York')).date()


def judge(ticker, release, section, now):
    """The fixed problem codes for one company ([] when it is clean)."""
    codes = []
    if section is None:
        return ['site-unreadable']
    if release is None:
        return ['source-missing']
    shown_day = datetime.strptime(section['releasedOn'], '%Y-%m-%d').date()
    day = release_day(release['accepted'])
    if 'unreadable' in release:
        if day - shown_day > NEWER and now - release['accepted'] >= GRACE:
            codes.append('source-unreadable')
        return codes
    if day - shown_day > NEWER:
        if now - release['accepted'] >= GRACE:
            codes.append('section-stale')
        return codes
    if abs(day - shown_day) > SAME_RELEASE:
        return codes  # the page shows a release the patrol did not find (e.g. older than LOOKBACK): nothing to compare
    tiles = section.get('tiles') or []
    facts = release['facts']
    revenue = amount(facts.get('revenue', {}).get('value'))
    shown_revenue = amount(tiles[0]['value']) if tiles else None
    if revenue and shown_revenue and shown_revenue[0] == revenue[0] and not agree(shown_revenue, revenue):
        codes.append('revenue-mismatch')
    for tile in tiles[1:]:
        label = tile.get('label', '')
        if re.search(r'\bEPS\b', label):
            key = 'adjusted-eps' if re.search(r'(?i)adjusted|non-?GAAP', label) else 'eps'
            read, shown = per_share(facts.get(key, {}).get('value')), per_share(tile.get('value'))
            if read and shown and read[0] == shown[0] and abs(read[1] - shown[1]) > read[2] + shown[2]:
                codes.append('eps-mismatch')
        elif re.search(r'(?i)guidance|outlook', label):
            fact = facts.get('guidance-revenue')
            read = guidance(fact['value']) if fact and re.search(r'(?i)next[- ]quarter', fact['label']) else None
            shown = guidance(tile.get('value'))
            if read and shown and read[0] == shown[0] and not (near(shown[1], read[1]) and near(shown[2], read[2])):
                codes.append('guidance-mismatch')
    checks = section.get('checks') or {}
    if checks.get('diveCurrent') is False:
        codes.append('dive-stale')
    if any(checks.get(k) is False for k in ('diveRevenue', 'flashRevenue', 'flashEps', 'flashGuidance')):
        codes.append('dive-mismatch')
    if section.get('hold'):
        codes.append('section-held')
    return codes


# ---- the production pages ----------------------------------------------------------------------------------------------------

ROUTE_DOWN = '_route-down'
SITE_SUBJECT = 'SITE'


def production_sections(site=None, fetch_json=None):
    """{ticker: section} as production serves it; a company missing from the answer is None (site-unreadable). When the route itself does
    not answer (not deployed yet, or down), the key ROUTE_DOWN is set: one problem for the site, not one per company."""
    fetch_json = fetch_json or get_json
    site = (site or os.environ.get('EARNINGS_SITE_URL') or SITE).rstrip('/')
    sections = {}
    try:
        answer = fetch_json(site + '/api/research/company-earnings')
        for company in answer.get('companies', []):
            if company.get('section'):
                sections[company['ticker']] = {**company['section'], 'checks': company.get('checks'), 'hold': company.get('hold')}
    except Exception:  # noqa: BLE001
        sections[ROUTE_DOWN] = True
    try:
        mu = (fetch_json(site + '/api/research/watch-earnings') or {}).get('snapshot')
        if mu:
            sections['MU'] = {'from': 'live', 'period': mu['period'], 'releasedOn': mu['releasedOn'], 'checks': None, 'hold': None,
                              'tiles': [{'label': t['label']['en'], 'value': t['value']['en']} for t in mu.get('tiles', [])]}
    except Exception:  # noqa: BLE001
        pass
    return sections


# ---- one patrol --------------------------------------------------------------------------------------------------------------

def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS earnings_patrol_runs(
      at TEXT NOT NULL, trigger TEXT NOT NULL, checked INTEGER NOT NULL, clean INTEGER NOT NULL, problems TEXT NOT NULL)''')
    db.execute('CREATE TABLE IF NOT EXISTS earnings_patrol_days(day TEXT PRIMARY KEY, summary TEXT NOT NULL)')


def patrol(now=None, tickers=None, fetch_json=None, read_release=None, sections=None):
    """{ticker: [codes]} for the roster (read only). `read_release(ticker, filings, now)` and `sections` are for tests."""
    now = now or datetime.now(timezone.utc)
    agent = os.environ.get('RESEARCH_USER_AGENT', '').strip()
    if agent:
        backtest.UA = agent
    sections = production_sections(fetch_json=fetch_json) if sections is None else sections
    read_release = read_release or latest_release
    results, filings_by_ticker = {}, {}
    for ticker in tickers or ROSTER:
        try:
            filings = submissions(ticker, fetch_json)
            filings_by_ticker[ticker] = filings
            release = read_release(ticker, filings, now) if filings else None
        except Exception:  # noqa: BLE001 - one company's fetch error never stops the others
            results[ticker] = ['source-fetch-failed']
            continue
        section = sections.get(ticker)
        if section is None and sections.get(ROUTE_DOWN) and ticker != 'MU':
            results[ticker] = []  # nothing to compare: reported once below, never as 21 separate problems
        else:
            results[ticker] = judge(ticker, release, section, now)
        results[ticker + ':release'] = release
    # Nov 26: the patrol reached production before the site's route did; 21 "site-unreadable" alerts for one missing route was noise.
    results[SITE_SUBJECT] = ['site-route-unavailable'] if sections.get(ROUTE_DOWN) else []
    return results, filings_by_ticker


def record(db, results, now, trigger):
    """Incidents (one per company: opened, kept, resolved), the run row, and the day's summary line once per JST day."""
    schema(db)
    at = now.isoformat(timespec='seconds')
    problems = {t: codes for t, codes in results.items() if not t.endswith(':release') and codes}
    subjects = [t for t in results if not t.endswith(':release')]
    checked = [t for t in subjects if t != SITE_SUBJECT]  # the companies; the site route is its own subject
    clean = len([t for t in checked if not results[t]])
    for ticker in subjects:
        key = INCIDENT_PREFIX + ticker
        codes = results[ticker]
        if codes:
            severity = 'critical' if CRITICAL & set(codes) else 'warning'
            monitor.record_operational_incident(db, key, CATEGORY, ticker, severity, '.'.join(sorted(codes))[:120], seen_at=at)
        else:
            monitor.resolve_operational_incident(db, key, resolved_at=at)
    with db:
        db.execute('INSERT INTO earnings_patrol_runs VALUES(?,?,?,?,?)',
                   (at, trigger, len(checked), clean, json.dumps(problems, sort_keys=True)))
    line = {'event': 'earnings-patrol', 'trigger': trigger, 'checked': len(checked), 'clean': clean,
            'problems': problems, 'at': at}
    day = now.astimezone(JST).date().isoformat()
    daily = None
    if not db.execute('SELECT 1 FROM earnings_patrol_days WHERE day=?', (day,)).fetchone():
        runs = db.execute('SELECT count(*) FROM earnings_patrol_runs WHERE julianday(at)>=julianday(?)',
                          ((now - timedelta(days=1)).isoformat(),)).fetchone()[0]
        daily = {'event': 'earnings-patrol-daily', 'day': day, 'companies': len(checked), 'clean': clean,
                 'stale': sorted(t for t, c in problems.items() if {'section-stale', 'dive-stale'} & set(c)),
                 'mismatch': sorted(t for t, c in problems.items() if CRITICAL & set(c) - {'section-stale'}),
                 'other': sorted(t for t, c in problems.items() if not (CRITICAL | {'dive-stale'}) & set(c)), 'runsLast24h': runs}
        with db:
            db.execute('INSERT OR IGNORE INTO earnings_patrol_days VALUES(?,?)', (day, json.dumps(daily, sort_keys=True)))
    return line, daily


def run_once(path, now=None, trigger='schedule', lock=None, **kwargs):
    """One patrol, its incidents and its log lines (printed). Returns the run line. The network reads run outside `lock` (the
    service's database lock); only the writes take it."""
    import contextlib
    import earnings_reconcile
    now = now or datetime.now(timezone.utc)
    results, filings = patrol(now, **kwargs)
    extras = prefetch_filings(results, filings)
    with (lock or contextlib.nullcontext()), monitor.connect(path) as db:
        line, daily = record(db, results, now, trigger)
        try:
            for entry in earnings_reconcile.run(db, results, filings, now, fetch_json=kwargs.get('fetch_json')):
                print(json.dumps({'event': 'earnings-reconcile', **entry}, separators=(',', ':')), flush=True)
        except Exception as exc:  # noqa: BLE001 - reconciliation never stops the patrol's own result
            print('earnings-reconcile-failed ' + type(exc).__name__, flush=True)
        draft_dives(db, results, now, extras=extras)
    print(json.dumps(line, separators=(',', ':'), sort_keys=True), flush=True)
    if daily:
        print(json.dumps(daily, separators=(',', ':'), sort_keys=True), flush=True)
    return line


REPORT_MAX_CHARS = 3_000_000


def report_text(content):
    """Plain text of a 10-Q / 10-K, whole (bounded at REPORT_MAX_CHARS), in the form check_dives compares quotes in."""
    import check_dives
    return check_dives.html_text(content[:REPORT_MAX_CHARS * 4].decode('utf-8', 'replace'))[:REPORT_MAX_CHARS]


def quarter_filings(ticker, filings, release, previous, fetch=None, exhibit=None):
    """The filings a dive is deepened with: the quarter's 10-Q / 10-K once filed after the release (its main document), and the 8-Ks with
    a deal (Item 1.01 / 2.01) or a preliminary result (Item 2.02, not the release itself) filed since the previous dive's release."""
    import earnings_reconcile
    # The whole 10-Q, not the monitor's 160,000-character article cut: a customer-concentration note can sit far into the document.
    fetch = fetch or (lambda url: report_text(backtest.get(url, binary=True)))
    exhibit = exhibit or exhibit_with_url
    recent = filings['filings']['recent']
    report = None
    found = earnings_reconcile.report_after(filings, release)
    if found:
        form, accession, _ = found
        i = recent['accessionNumber'].index(accession)
        url = filing_url(ticker, accession, recent['primaryDocument'][i])
        try:
            report = {'url': url, 'text': fetch(url), 'accession': accession, 'form': form}
        except Exception:  # noqa: BLE001 - the 10-Q is read again at the next patrol
            report = None
    since = datetime.strptime(previous['releasedOn'], '%Y-%m-%d').replace(tzinfo=timezone.utc) + timedelta(days=1) if previous else release['accepted']
    events = []
    for i, form in enumerate(recent['form']):
        accession = recent['accessionNumber'][i]
        accepted = datetime.fromisoformat(recent['acceptanceDateTime'][i].replace('Z', '+00:00'))
        items = recent['items'][i] if i < len(recent['items']) else ''
        if form != '8-K' or accession == release['accession'] or accepted < since:
            continue
        if not re.search(r'\b(?:1\.01|2\.01|2\.02)\b', items):
            continue
        url, text = exhibit(cik(ticker), accession, ('1',))
        if url and text:
            events.append({'url': url, 'text': text, 'accepted': accepted, 'accession': accession})
    return report, sorted(events, key=lambda e: e['accepted'])


def filing_exhibits(ticker, accession, skip_url=None, numbers=('2', '3')):
    """(url, text) of the other press exhibits of the results filing (EX-99.2, EX-99.3: a presentation, financial statements), for the
    companies whose dive figures sit there (dive_figures.DOC_SPECS)."""
    base = f"https://www.sec.gov/Archives/edgar/data/{int(cik(ticker))}/{accession.replace('-', '')}"
    index = backtest.get(base + '/' + accession + '-index.html')
    out = []
    for n in numbers:
        for m in re.finditer(r'<tr[^>]*>(?:(?!</tr>).)*?href="(/Archives/edgar/data/[^"]+\.(?:htm|html))"(?:(?!</tr>).)*?>\s*EX-99\.' + n + r'\s*<', index, re.S):
            url = 'https://www.sec.gov' + m[1]
            if url != skip_url:
                out.append((url, ' '.join(monitor.extract_text(backtest.get(url, binary=True), 'text/html').split())))
            break
    return out


def prefetch_filings(results, filings_by_ticker, env=None):
    """The 10-Q and the deal 8-Ks of each company a dive is due for, read before the database is locked (network only)."""
    import earnings_dive_generate as dives
    if not dives.enabled(env):
        return {}
    out = {}
    for ticker in dives.due(results, None):
        release, filings = results.get(ticker + ':release'), (filings_by_ticker or {}).get(ticker)
        if release and filings:
            try:
                out[ticker] = quarter_filings(ticker, filings, release, dives.previous_dive(ticker))
            except Exception:  # noqa: BLE001 - the dive is still built from the release; the filings are read again next time
                out[ticker] = (None, [])
            import dive_figures
            if ticker in dive_figures.DOC_SPECS:
                try:
                    exhibits = [{'url': u, 'text': t} for u, t in filing_exhibits(ticker, release['accession'], release.get('url'))]
                except Exception:  # noqa: BLE001
                    exhibits = []
                out[ticker] = out[ticker] + (exhibits,)
            if ticker in dive_figures.PRIOR:  # the previous quarter's release, for the figures this release prints without that quarter
                out[ticker] = out[ticker] + (None,) * (3 - len(out[ticker])) + (prior_release(dives.previous_dive(ticker)),)
    return out


def prior_release(previous):
    """{'url', 'text'} of the release the previous dive was built from (its first source, on sec.gov), or None."""
    url = (((previous or {}).get('sources') or [{}])[0]).get('url') or ''
    if not url.startswith('https://www.sec.gov/'):
        return None
    try:
        return {'url': url, 'text': ' '.join(monitor.extract_text(backtest.get(url, binary=True), 'text/html').split())}
    except Exception:  # noqa: BLE001 - the dive then holds (a figure is missing) and is tried again at the next patrol
        return None


def draft_dives(db, results, now, env=None, extras=None):
    """The next quarter's 決算の深掘り for each company whose page now shows a newer release than its dive (earnings_dive_generate.py):
    built from the release's parsed figures, the previous dive and the release's existing deep analysis. Never a model call: the AI
    spent on a release stays the one approved deep analysis. Off with EARNINGS_DIVE_AUTO=false."""
    import earnings_dive_generate as dives
    if not dives.enabled(env):
        return []
    done = []
    for ticker in dives.due(results, db):
        release = dict(results[ticker + ':release'])
        if not release.get('url') or not release.get('text'):
            continue
        release['releasedOn'] = release_day(release['accepted']).isoformat()
        try:
            if extras and ticker in extras:
                release['report'], release['events'] = extras[ticker][:2]
                if len(extras[ticker]) > 2 and extras[ticker][2] is not None:
                    release['exhibits'] = extras[ticker][2]
                if len(extras[ticker]) > 3 and extras[ticker][3]:
                    release['prior'] = extras[ticker][3]
            state = dives.generate(db, ticker, release, now)
        except Exception as exc:  # noqa: BLE001 - one company's failure never stops the others
            state = 'error-' + type(exc).__name__
        print(json.dumps({'event': 'earnings-dive', 'ticker': ticker, 'state': state}, separators=(',', ':')), flush=True)
        done.append((ticker, state))
    return done


def newest_flash(db):
    """The newest stored results flash of a roster company (its published time), to start a patrol right after a release."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='issuer_result_publications'").fetchone():
        return None
    row = db.execute('SELECT max(published_at) FROM issuer_result_publications WHERE ticker IN (%s)' % ','.join('?' for _ in ROSTER),
                     tuple(ROSTER)).fetchone()
    return row[0] if row else None


class Schedule:
    """When to patrol: at start, every INTERVAL, and AFTER_RELEASE after a roster company's newest flash changed (a new release)."""

    def __init__(self):
        self.last_run = None
        self.patrolled = None   # the newest flash time at the last run
        self.changed_at = None  # when a newer flash was first seen

    def tick(self, newest, now):
        if self.last_run is None:
            return self._ran(newest, now, 'schedule')
        if newest != self.patrolled:
            self.changed_at = self.changed_at or now
            if now - self.changed_at >= AFTER_RELEASE:
                return self._ran(newest, now, 'release')
        if now - self.last_run >= INTERVAL:
            return self._ran(newest, now, 'schedule')
        return None

    def _ran(self, newest, now, trigger):
        self.last_run, self.patrolled, self.changed_at = now, newest, None
        return trigger


def diagnostics(db):
    """Read-only summary for /health: the last run and the last daily line (codes and tickers only)."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='earnings_patrol_runs'").fetchone():
        return {'status': 'not-run'}
    last = db.execute('SELECT at,trigger,checked,clean,problems FROM earnings_patrol_runs ORDER BY rowid DESC LIMIT 1').fetchone()
    day = db.execute('SELECT summary FROM earnings_patrol_days ORDER BY day DESC LIMIT 1').fetchone()
    run = None
    if last:
        run = {'at': last[0], 'trigger': last[1], 'checked': last[2], 'clean': last[3], 'problems': json.loads(last[4])}
    return {'status': 'running', 'lastRun': run, 'lastDaily': json.loads(day[0]) if day else None}


if __name__ == '__main__':
    # Read-only dry run from a workstation: prints {ticker: codes} for the roster against production (no database, no incident).
    results, _ = patrol()
    print(json.dumps({t: c for t, c in results.items() if not t.endswith(':release')}, sort_keys=True))
