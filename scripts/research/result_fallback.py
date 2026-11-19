"""Figures for an earnings row whose results table could not be read (owner, Nov 17).

NVIDIA's Q3 FY27 release (Nov 17 21:22 UTC) changed its table layout; the deterministic parser refused it and the calendar showed
only "NVDA 決算を発表しました" while the PRO deep analysis of the same release, published three minutes later, already stated the
figures. This module closes that gap without a person and without any extra model call:

- when a roster company's earnings deep analysis is published and no deterministic results flash exists for that release, the
  figures the analysis states (English copy) are read with fixed patterns: revenue, diluted EPS (GAAP and adjusted), net income,
  operating income and next-quarter revenue guidance;
- a figure is kept only if the release text the monitor stored for that analysis supports it, with the same number check the
  deep analysis uses (factual_validation.validate_numbers against the release and its table figures written out in the unit the
  table header declares) AND the number appears in the release right after the matching label, in the same unit and on the same
  GAAP / non-GAAP side. A figure whose unit cannot be read from the release next to it, or that the release prints under two
  different units, is dropped. Nothing is calculated or converted beyond writing $115.8 billion as $115.8B;
- the deterministic flash always wins: once it exists for the company's release the fallback is no longer served and is marked
  replaced.

Each results release's reading state (published / unreadable / fallback) is kept in issuer_result_attempts with short codes, so
/health still shows why after a restart, and every change of state writes one JSON log line (codes and tickers only).
"""
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import monitor

VERSION = 'fallback-v1'
WINDOW = timedelta(days=7)
SAME_RELEASE = timedelta(days=2)
LABEL_WINDOW = 300
NEXT_QUARTER = ('次四半期見通し 売上高', 'Next-quarter guidance Revenue')


# ---- persistent reading state ------------------------------------------------------------------------------

def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS issuer_result_attempts(
      key TEXT PRIMARY KEY, ticker TEXT NOT NULL, url TEXT NOT NULL, period TEXT,
      state TEXT NOT NULL, reason TEXT, parse_reason TEXT,
      first_seen_at TEXT NOT NULL, changed_at TEXT NOT NULL)''')
    db.execute('''CREATE TABLE IF NOT EXISTS issuer_result_fallbacks(
      source_ref TEXT PRIMARY KEY, ticker TEXT NOT NULL, url TEXT NOT NULL, period TEXT NOT NULL,
      state TEXT NOT NULL, figures INTEGER NOT NULL, payload TEXT, observed_at TEXT NOT NULL,
      published_at TEXT NOT NULL, version TEXT NOT NULL)''')


def stamp(value=None):
    return (value or datetime.now(timezone.utc)).isoformat(timespec='milliseconds')


def attempt_key(ticker, url):
    return hashlib.sha256('\0'.join([ticker, url]).encode()).hexdigest()


def log_state(ticker, key, state, reason, period):
    print(json.dumps({'event': 'issuer-result-state', 'ticker': ticker, 'ref': key[:12], 'state': state, 'reason': reason,
                      'period': period}, ensure_ascii=False), flush=True)


def record(db, ticker, url, state, reason=None, period=None, now=None):
    """Store the reading state of one results release; writes (and logs) only when the state or its reason changes.
    The parser's own failure code is kept in parse_reason, so a later fallback does not hide why the table was unreadable."""
    schema(db)
    key = attempt_key(ticker, url)
    at = stamp(now)
    old = db.execute('SELECT state,reason,period,parse_reason FROM issuer_result_attempts WHERE key=?', (key,)).fetchone()
    parse_reason = reason if state == 'unreadable' else (old['parse_reason'] if old else None)
    period = period or (old['period'] if old else None)
    if old and old['state'] == state and old['reason'] == reason and old['period'] == period:
        return False
    if old:
        db.execute('UPDATE issuer_result_attempts SET state=?,reason=?,parse_reason=?,period=?,changed_at=? WHERE key=?',
                   (state, reason, parse_reason, period, at, key))
    else:
        db.execute('INSERT INTO issuer_result_attempts VALUES(?,?,?,?,?,?,?,?,?)',
                   (key, ticker, url, period, state, reason, parse_reason, at, at))
    log_state(ticker, key, state, reason, period)
    return True


# ---- figures stated by the analysis ------------------------------------------------------------------------

AMOUNT = re.compile(r'(?<![A-Za-z$])\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(billion|million|bn|mn|B|M)\b)?')
SCALE = {'billion': 'billion', 'bn': 'billion', 'b': 'billion', 'million': 'million', 'mn': 'million', 'm': 'million'}
LABEL = {
    'revenue': re.compile(r'\brevenues?\b', re.I),
    'eps': re.compile(r'\b(?:earnings|income) per (?:diluted )?share\b|\bper diluted share\b|\beps\b', re.I),
    'net-income': re.compile(r'\bnet income\b', re.I),
    'operating-income': re.compile(r'\boperating income\b', re.I),
}
# A label stands for the company's total only when the word in front of it is one of these (never "Data Center revenue").
BEFORE = {'', 'total', 'quarterly', 'record', 'its', 'the', 'of', 'and', 'with', 'gaap', 'non-gaap', 'adjusted', 'diluted', 'overall',
          'consolidated', 'reported', 'company', 'net', 'fiscal', 'q1', 'q2', 'q3', 'q4', 'first-quarter', 'second-quarter',
          'third-quarter', 'fourth-quarter', 'quarter', 'while', 'but', 'as', 'where'}
# What may stand between a label and its figure ("revenue for the third quarter ended October 26, 2026, of $115.8 billion").
CONNECT = {'was', 'were', 'is', 'of', 'reached', 'rose', 'grew', 'increased', 'jumped', 'climbed', 'surged', 'to', 'at', 'a', 'an',
           'record', 'came', 'in', 'totaled', 'totalled', 'hit', 'the', 'quarter', 'first', 'second', 'third', 'fourth', 'for',
           'ended', 'up', 'year', 'over', 'from', 'earlier', 'ago', 'on', 'basis', 'quarterly', 'fiscal', 'and', 'new', 'high',
           'expected', 'be', 'expects', 'guided', 'outlook', 'q1', 'q2', 'q3', 'q4', 'its', 'this', 'last', 'gaap', 'non-gaap',
           'adjusted', 'diluted', 'per', 'share', 'stood', 'came', 'amounted', 'january', 'february', 'march', 'april', 'may',
           'june', 'july', 'august', 'september', 'october', 'november', 'december', 'y/y', 'yoy', 'q/q', 'sequentially'}
VAGUE = re.compile(r'\b(?:approximately|about|roughly|nearly|almost|more than|less than|at least|up to|around|some)\b', re.I)
EARLIER = re.compile(r'\b(?:earlier|ago|prior|previous|last)\b', re.I)
OUTLOOK = re.compile(r'\b(?:expect(?:s|ed)?|outlook|guidance|guided?|forecasts?|projects?|projected|anticipat\w*)\b', re.I)
NEXT_PERIOD = re.compile(r'\b(?:next|following|first|second|third|fourth)[- ]quarter\b|\bQ[1-4]\b', re.I)
FULL_YEAR = re.compile(r'\b(?:full[- ]year|annual|fiscal[- ]year|for the year)\b', re.I)
ADJUSTED = re.compile(r'\bnon-?gaap\b|\badjusted\b', re.I)
GAAP = re.compile(r'(?<![-\w])gaap\b', re.I)


def side(text):
    """'adjusted', 'gaap', 'both' (GAAP and non-GAAP named together) or None for the GAAP side a phrase names."""
    adjusted = bool(ADJUSTED.search(text))
    gaap = bool(GAAP.search(re.sub(r'(?i)non-?gaap', '', text)))
    return 'both' if adjusted and gaap else 'adjusted' if adjusted else 'gaap' if gaap else None


def sentences(text):
    return [s for s in re.split(r'(?<=[.;!?])\s+(?=[A-Z(])|\n+', text or '') if s.strip()]


def connector_ok(between):
    if VAGUE.search(between):
        return False
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z/'-]*|\d[\d,.]*%?", between.lower()) if w]
    for word in words:
        if word[0].isdigit():
            continue  # a date or a stated change ("26, 2026", "103%")
        if word not in CONNECT:
            return False
    if words and words[-1] in ('from', 'versus', 'vs', 'compared'):
        return False  # "rose from $57.0 billion": the earlier figure
    if EARLIER.search(between) and (not words or words[-1] != 'to'):
        return False  # "a year earlier was $57.0 billion"
    return True


def stated(note, names=()):
    """{key: (value text, scale or None, plus-or-minus or None)} the analysis states unambiguously in its English copy.
    `names` are the company's own name words and ticker ("NVIDIA revenue was ..." is the company's total)."""
    names = {n.lower() for n in names}
    parts = [note.get('headline') or {}, *(note.get('points') or []), note.get('watch') or {}]
    found = {}
    clash = set()
    for part in parts:
        text = part.get('en') if isinstance(part, dict) else None
        if not isinstance(text, str):
            continue
        for sentence in sentences(text):
            outlook = bool(OUTLOOK.search(sentence))
            previous = 0
            for m in AMOUNT.finditer(sentence):
                prefix = sentence[previous:m.start()]
                previous = m.end()
                hits = [(lm, key) for key, pattern in LABEL.items() for lm in pattern.finditer(prefix)]
                if not hits:
                    continue
                label, key = max(hits, key=lambda hit: hit[0].end())
                before = re.findall(r"[A-Za-z0-9'’-]+", prefix[:label.start()])
                word = before[-1].lower() if before else ''
                if word not in BEFORE and word not in names and not re.search(r"['’]s$", word):
                    continue
                if not connector_ok(prefix[label.end():]):
                    continue
                scale = SCALE.get((m.group(2) or '').lower())
                if key == 'eps':
                    if scale or outlook:
                        continue
                    named = side(prefix[max(0, label.start() - 40):label.end()])
                    key = 'adjusted-eps' if named == 'adjusted' else 'eps'
                else:
                    if not scale:
                        continue  # an amount without its unit is never read
                    named = side(prefix[max(0, label.start() - 40):label.start()])
                    if outlook:
                        if key != 'revenue' or FULL_YEAR.search(sentence) or not NEXT_PERIOD.search(sentence):
                            continue
                        key = 'guidance-revenue'
                    elif key == 'net-income' and named == 'adjusted':
                        key = 'adjusted-net-income'
                    elif named == 'adjusted':
                        continue  # non-GAAP revenue / operating income: no label for it
                band = re.match(r'\s*,?\s*plus or minus (\d+(?:\.\d+)?)%', sentence[m.end():]) if key == 'guidance-revenue' else None
                value = (m.group(1).replace(',', ''), scale, band[1] if band else None)
                if key in found and found[key] != value:
                    clash.add(key)
                found.setdefault(key, value)
    return {key: value for key, value in found.items() if key not in clash}


# ---- verification against the stored release ----------------------------------------------------------------

SOURCE_LABEL = {
    'revenue': re.compile(r'\b(?:revenues?|net sales|total sales)\b', re.I),
    'guidance-revenue': re.compile(r'\b(?:revenues?|net sales)\b', re.I),
    'eps': LABEL['eps'], 'adjusted-eps': LABEL['eps'],
    'net-income': LABEL['net-income'], 'adjusted-net-income': LABEL['net-income'],
    'operating-income': LABEL['operating-income'],
}


def number_supported(canonical, release):
    """The deep analysis' own number check: the figure as written must be a quantity of the release (its table figures written out
    in the unit their table header declares; a figure printed under two units is not admitted)."""
    import deep_analysis
    import factual_validation
    tables = re.sub(r'\$\s?(?=\d)', '', release)  # "$115.8" in a "$ in billions" table reads as a table figure
    try:
        factual_validation.validate_numbers(canonical, deep_analysis.table_scaled_figures(tables) + '\n' + release, check_dates=False)
    except ValueError:
        return False
    return True


def unit_at(release, start, end):
    """The unit printed with the figure ("$115.8 billion"), else the unit of the table it sits in ("($ in billions ...)"), else None."""
    import deep_analysis
    after = re.match(r'\s?(billion|million|bn|mn|B|M)\b', release[end:end + 12])
    if after:
        return SCALE[after[1].lower()]
    headers = [m for m in deep_analysis.UNIT_HEADER.finditer(release[max(0, start - deep_analysis.TABLE_WINDOW):start])]
    if not headers:
        return None
    unit = (headers[-1].group(1) or headers[-1].group(2)).lower()
    return {'billions': 'billion', 'millions': 'million'}.get(unit)  # "thousands": no figure of ours is printed so


def side_at(release, position):
    """GAAP side of the table or sentence a label sits in: the nearest GAAP / non-GAAP marker before it."""
    head = release[max(0, position - 3000):position]
    marks = [(m.start(), 'adjusted') for m in ADJUSTED.finditer(head)]
    marks += [(m.start(), 'gaap') for m in GAAP.finditer(head)]
    if not marks:
        return None
    last = max(marks)
    near = {kind for at, kind in marks if at >= last[0] - 40}
    return 'both' if len(near) > 1 else last[1]


def located(release, key, number, scale):
    """The number appears in the release as the first amount after the label of `key`, in the unit `scale`, on the right GAAP side."""
    pattern = re.compile(r'(?<![\d.,])\$?\s?' + re.escape(number) + r'(?![\d,]|\.\d)')
    for m in pattern.finditer(release):
        offset = max(0, m.start() - LABEL_WINDOW)
        labels = list(SOURCE_LABEL[key].finditer(release, offset, m.start()))
        if not labels:
            continue
        label = labels[-1]
        if re.search(r'\$\s?\d', release[label.end():m.start()]):
            continue  # another amount sits between the label and this number (this is a prior-period column)
        if key in ('eps', 'adjusted-eps'):
            if re.match(r'\s?(billion|million|bn|mn|B|M)\b', release[m.end():m.end() + 12]):
                continue
        elif unit_at(release, m.start(), m.end()) != scale:
            continue
        where = side_at(release, label.start())
        if key.startswith('adjusted-') and where not in ('adjusted', 'both'):
            continue
        if key in ('eps', 'net-income', 'operating-income') and where == 'adjusted':
            continue
        if key == 'guidance-revenue' and not OUTLOOK.search(release[max(0, m.start() - LABEL_WINDOW):m.start()]):
            continue
        if key == 'revenue' and OUTLOOK.search(release[max(0, label.start() - 120):m.start()]):
            continue  # the outlook sentence, not the result
        return True
    return False


def money(number, scale):
    """'115.8', 'billion' -> '$115.8B' (the figure as printed, unit as a letter)."""
    return '$' + number + ('B' if scale == 'billion' else 'M')


def company_names(ticker):
    name = monitor.PROVIDERS.get(ticker, {}).get('name', '')
    return {ticker, *re.findall(r"[A-Za-z0-9-]+", name)} - {'Inc', 'Corp', 'Corporation', 'Co', 'Ltd', 'Group', 'Holdings', 'Technologies'}


def verified_facts(note, release, ticker=''):
    """Facts (issuer_result_flash shape) for every figure of the analysis the release supports; the rest is dropped."""
    import issuer_result_flash as flash
    facts = []
    for key, (number, scale, band) in stated(note, company_names(ticker)).items():
        canonical = '$' + number + (' ' + scale if scale else '')
        if not number_supported(canonical, release) or not located(release, key, number, scale):
            continue
        if key in ('eps', 'adjusted-eps'):
            value = flash.per_share(Decimal(number))
        else:
            value = money(number, scale)
        if band and re.search(re.escape(number) + r'\s?(?:billion|million)?,?\s*plus or minus ' + re.escape(band) + '%', release):
            value += ' ± ' + band + '%'
        labels = NEXT_QUARTER if key == 'guidance-revenue' else flash.LABELS[key]
        facts.append({'key': key, 'ja': labels[0], 'en': labels[1], 'value': value})
    order = {key: n for n, key in enumerate(flash.ORDER)}
    return sorted(facts, key=lambda fact: order[fact['key']])


# ---- the fallback row ----------------------------------------------------------------------------------------

def instant(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def release_text(db, row):
    """The release text the analysis was checked against: the revision with the analysed sha, else the stored story body of the
    analysed event, else the page's current revision."""
    found = db.execute('SELECT extracted_text FROM source_revisions WHERE url=? AND sha256=?', (row['source_url'], row['source_sha'])).fetchone()
    if found and found[0]:
        return found[0]
    parts = row['source_ref'].split(':')
    if parts[0] == 'event' and len(parts) == 3 and parts[1].isdigit() and db.execute(
            "SELECT 1 FROM sqlite_master WHERE name='official_story_bodies'").fetchone():
        found = db.execute('SELECT body FROM official_story_bodies WHERE event_id=? AND sha=?', (int(parts[1]), parts[2])).fetchone()
        if found and found[0]:
            return found[0]
    found = db.execute('SELECT r.extracted_text FROM sources s JOIN source_revisions r ON r.url=s.url AND r.sha256=s.sha256 WHERE s.url=?',
                       (row['source_url'],)).fetchone()
    return found[0] if found else None


def flashed(db, ticker, at):
    """A deterministic results flash of the company within SAME_RELEASE of `at` (the parser's figures win)."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='issuer_result_publications'").fetchone():
        return False
    for row in db.execute('SELECT observed_at FROM issuer_result_publications WHERE ticker=?', (ticker,)):
        seen = instant(row[0])
        if seen and at and abs(seen - at) <= SAME_RELEASE:
            return True
    return False


def announced(db, ticker, at):
    """The 'announced' line of the same release (its detection time and quarter), if any."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='earnings_announcements'").fetchone():
        return None
    best = None
    for row in db.execute('SELECT observed_at,period FROM earnings_announcements WHERE ticker=?', (ticker,)):
        seen = instant(row['observed_at'])
        if seen and at and abs(seen - at) <= SAME_RELEASE and (best is None or seen < best[0]):
            best = (seen, row['period'])
    return best


def payload_for(ticker, row, facts, observed, period):
    import issuer_result_flash as flash
    import market_results
    number = str(int(hashlib.sha256(row['source_ref'].encode()).hexdigest()[:12], 16))
    figures = [f for f in facts if not f['key'].startswith('guidance-')]
    if len(figures) >= market_results.MIN_DISPLAY_FACTS:
        title_ja = f'{ticker} {period}決算：' + '、'.join(f['ja'] + f['value'] for f in facts[:2])
        title_en = f'{ticker} {period} earnings: ' + ', '.join(f['en'] + ' ' + f['value'] for f in facts[:2])
    else:  # too few figures for the result headline: the row keeps its announced line and lists the figures
        title_ja, title_en = f'{ticker} 決算を発表しました', f'{ticker} announced its results'
    name = monitor.PROVIDERS.get(ticker, {}).get('name', ticker)
    publisher = flash.PROFILES[ticker]['publisher'] if ticker in flash.PROFILES else f'{name} IR'
    return {'id': number, 'researchId': 'ir-fallback-' + number, 'kind': 'earnings', 'ticker': ticker, 'period': period,
            'titleJa': title_ja, 'titleEn': title_en, 'facts': facts, 'url': row['source_url'], 'publisher': publisher,
            'publishedAt': stamp(observed), 'observedAt': stamp(observed), 'method': 'deep-analysis-verified-figures', 'fallback': True}


def run_once(path, reference=None):
    """Fill the result row of every recently analysed release that has no deterministic flash. No network, no model. Returns changes."""
    import earnings_announce
    reference = reference or datetime.now(timezone.utc)
    cutoff = (reference - WINDOW).isoformat()
    changed = 0
    with monitor.connect(path) as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='deep_analyses'").fetchone():
            return 0
        schema(db)
        done = {r['source_ref']: r for r in db.execute('SELECT source_ref,state,version FROM issuer_result_fallbacks')}
        for row in db.execute("SELECT source_ref,subject,source_url,source_title,source_sha,payload,created_at FROM deep_analyses "
                              "WHERE kind='earnings' AND state='done' AND julianday(created_at)>=julianday(?)", (cutoff,)).fetchall():
            ticker, at = row['subject'], instant(row['created_at'])
            old = done.get(row['source_ref'])
            if flashed(db, ticker, at):
                if old and old['state'] == 'shown':
                    db.execute("UPDATE issuer_result_fallbacks SET state='replaced' WHERE source_ref=?", (row['source_ref'],))
                    record(db, ticker, row['source_url'], 'published', None, now=reference)
                    changed += 1
                continue
            if old and old['version'] == VERSION:
                continue
            try:
                note = json.loads(row['payload'])
            except (TypeError, ValueError):
                continue
            text = release_text(db, row) or ''
            facts = verified_facts(note, text, ticker) if text else []
            seen = announced(db, ticker, at)
            observed = seen[0] if seen else at
            period = (seen[1] if seen and seen[1] != 'Latest' else None) or earnings_announce.period_of(row['source_title'] or '') \
                or earnings_announce.period_of(text[:600]) or 'Latest'
            payload = payload_for(ticker, row, facts, observed, period) if facts else None
            state = 'shown' if payload else ('no-source' if not text else 'no-verified-figures')
            with db:
                db.execute('''INSERT INTO issuer_result_fallbacks VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_ref) DO UPDATE SET
                  state=excluded.state,figures=excluded.figures,payload=excluded.payload,period=excluded.period,
                  observed_at=excluded.observed_at,published_at=excluded.published_at,version=excluded.version''',
                           (row['source_ref'], ticker, row['source_url'], period, state, len(facts),
                            json.dumps(payload, ensure_ascii=False) if payload else None, stamp(observed), stamp(reference), VERSION))
                record(db, ticker, row['source_url'], 'fallback' if payload else 'unreadable',
                       'deep-analysis-figures' if payload else 'fallback-' + state, period, now=reference)
            changed += 1
    return changed


def replace_with_flash(db, ticker, observed):
    """The parser read the table: every fallback of that release stops being served."""
    schema(db)
    for row in db.execute("SELECT source_ref,url,observed_at FROM issuer_result_fallbacks WHERE ticker=? AND state='shown'", (ticker,)).fetchall():
        seen = instant(row['observed_at'])
        if seen and observed and abs(seen - observed) <= SAME_RELEASE:
            db.execute("UPDATE issuer_result_fallbacks SET state='replaced' WHERE source_ref=?", (row['source_ref'],))
            record(db, ticker, row['url'], 'published', None)


def public_feed(db, cutoff, until=None):
    """Shown fallbacks inside the window, in the shape of the other result briefs; never one whose release has a parser flash."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='issuer_result_fallbacks'").fetchone():
        return []
    items = []
    for row in db.execute("SELECT payload,observed_at,published_at FROM issuer_result_fallbacks WHERE state='shown' AND payload IS NOT NULL "
                          'AND julianday(observed_at)>=julianday(?) AND julianday(observed_at)<julianday(?) '
                          'ORDER BY julianday(observed_at) DESC', (cutoff, until or '9999-12-31T00:00:00+00:00')):
        item = json.loads(row['payload'])
        if flashed(db, item['ticker'], instant(row['observed_at'])):
            continue
        item.update({'publicAt': row['published_at'], 'processingMs': None, 'sourceToDetectionMs': None,
                     'detectionToPublicMs': monitor.stored_latency_ms(row['observed_at'], row['published_at'])})
        items.append(item)
    return items


def diagnostics(db):
    """Persisted reading states (codes only) and fallback counts for /health."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='issuer_result_attempts'").fetchone():
        return {'attempts': [], 'fallbacks': {}}
    attempts = [{'ticker': r['ticker'], 'period': r['period'], 'state': r['state'], 'reason': r['reason'], 'parseReason': r['parse_reason'],
                 'firstSeenAt': r['first_seen_at'], 'changedAt': r['changed_at']}
                for r in db.execute('SELECT * FROM issuer_result_attempts ORDER BY changed_at DESC LIMIT 15')]
    fallbacks = dict(db.execute('SELECT state,count(*) FROM issuer_result_fallbacks GROUP BY state').fetchall()) \
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='issuer_result_fallbacks'").fetchone() else {}
    return {'attempts': attempts, 'fallbacks': fallbacks}
