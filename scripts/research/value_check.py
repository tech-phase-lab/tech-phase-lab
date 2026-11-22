"""割安判別ツール / Value Check (owner, Nov 22): where each stock's P/E and P/S sit within its own past five years.

Mechanical and the same for everyone:
  * P/E and P/S for every trading day of the last five years = market value / trailing-twelve-month net income or revenue.
    Market value = split-adjusted daily close (Twelve Data) x shares outstanding from the SEC cover page, brought to today's share basis.
    The twelve-month figures come from SEC XBRL company facts and are used from the day they were filed.
    Forward (estimate-based) P/E and P/S have no five-year daily history at Twelve Data, so the trailing (実績) values are used.
  * For each: 1 - today / the five-year mean without the top and bottom 5% of days (loss days have no P/E).
  * Value Score = mean of the two, in percent (P/S alone without a P/E today); at 0% or below a stock is not ranked.
    5年最安 = both below every day of the five years. Owner's revision of Nov 22.
  * Stocks whose trailing revenue is below the year before are left out of the ranking; so are stocks without enough data (recorded).

Credits (Twelve Data plan: 610 a minute shared with the whole site): the job never lets the minute's usage pass CREDIT_CEILING and
spends at most OWN_PER_MINUTE itself. The five-year history is read once per ticker (two credits: raw and split-adjusted closes) and
kept in the monitor's SQLite; afterwards one run a weekday after the close reads the last bars (one credit per ticker).

Off unless VALUE_CHECK_ENABLED=true. CLI (local check, writes only the given database):
  python3 scripts/research/value_check.py run --db .research-private/value-check.sqlite [--universe tech]
"""
import argparse
import gzip
import json
import math
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
UNIVERSE_FILE = ROOT / 'lib' / 'research' / 'value-check-universe.json'
EASTERN = ZoneInfo('America/New_York')

CREDIT_CEILING = 450          # the whole key's usage this minute, ours included, stays at or below this
OWN_PER_MINUTE = 120          # this job's own spending per minute
CHUNK = 8                     # symbols per Twelve Data request
HISTORY_BARS = 1300           # a little over five years of trading days
UPDATE_BARS = 30              # the daily read: enough overlap to notice a split
WINDOW_DAYS = 5 * 365 + 2     # the five-year look-back
MIN_PS_DAYS = 252             # at least a year of daily P/S; a younger listing is calculated over what it has (and says so)
FULL_DAYS = 1150              # fewer days of P/S than this (about 4.6 years): the row says the period was shorter
MIN_PE_DAYS = 252             # fewer profitable days than this: the P/S position alone
MAX_PS = 200                  # a P/S above this means the filed revenue is only a part of the total: left out, not guessed
CHEAP = 30                    # 割安: Value Score of 30% or more (IN / OUT), owner Nov 22
TRIM = 0.05                   # the five-year mean leaves out the top and bottom 5% of days
FACTS_MAX_AGE = 7 * 86400     # SEC company facts are read again after a week
MAX_FIGURE_AGE = 400          # a twelve-month figure older than this (days after its period end) is no longer used
TD_WHEN_OLDER = 300           # SEC figures older than this: the provider's quarterly statements fill in (100 credits a read)
TD_STATEMENT_COST = 100
TD_REREAD = 7 * 86400         # and are read again only when a newer quarter can be out (TD_NEW_QUARTER days after the last)
TD_NEW_QUARTER = 100
RUN_AT = (17, 30)             # weekdays, Eastern, after the close

# "ifrs-full:" names read a foreign filer's IFRS facts (20-F, 40-F, 6-K), as the stock comparison does.
REVENUE = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenueFromContractWithCustomerIncludingAssessedTax',
           'SalesRevenueNet', 'SalesRevenueGoodsNet', 'RevenuesNetOfInterestExpense', 'RegulatedAndUnregulatedOperatingRevenue',
           'ifrs-full:Revenue', 'ifrs-full:RevenueFromContractsWithCustomers']
NET_INCOME = ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss',
              'ifrs-full:ProfitLossAttributableToOwnersOfParent', 'ifrs-full:ProfitLoss']
FORMS = {'10-K', '10-K/A', '10-Q', '10-Q/A', '10-KT', '20-F', '20-F/A', '40-F', '40-F/A', '6-K', '6-K/A'}

STATUS = {'lastRun': None, 'lastError': None, 'credits': 0}


def enabled(env=None):
    env = os.environ if env is None else env
    return (env.get('VALUE_CHECK_ENABLED') or '').strip().lower() == 'true'


def load_universe(path=UNIVERSE_FILE):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def connect(path):
    """Its own file (value-check.sqlite), never the monitor database. Every write is committed before the next provider call;
    busy_timeout 30 s; WAL so the /value-check reader runs while the daily job writes."""
    if str(path) != ':memory:':
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=30)
    db.execute('PRAGMA busy_timeout = 30000')
    if str(path) != ':memory:':
        db.execute('PRAGMA journal_mode = WAL')
    schema(db)
    return db


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS value_check_closes(
      ticker TEXT NOT NULL, day TEXT NOT NULL, raw REAL NOT NULL, adj REAL NOT NULL, PRIMARY KEY(ticker, day))''')
    db.execute('''CREATE TABLE IF NOT EXISTS value_check_facts(
      ticker TEXT PRIMARY KEY, fetched_at REAL NOT NULL, payload TEXT NOT NULL)''')
    db.execute('''CREATE TABLE IF NOT EXISTS value_check_state(key TEXT PRIMARY KEY, value TEXT NOT NULL)''')
    db.execute('''CREATE TABLE IF NOT EXISTS value_check_statements(
      ticker TEXT PRIMARY KEY, fetched_at REAL NOT NULL, payload TEXT NOT NULL)''')
    db.commit()


# ---- SEC company facts -> trailing twelve months ---------------------------------------------------------------------------------------

def _day(text):
    return date.fromisoformat(text).toordinal()


def _rows(facts, taxonomy, tag, unit):
    rows = (((facts.get('facts') or {}).get(taxonomy) or {}).get(tag) or {}).get('units', {}).get(unit)
    out = []
    for row in rows if isinstance(rows, list) else []:
        try:
            if row.get('form') not in FORMS or not isinstance(row.get('val'), (int, float)) or not math.isfinite(row['val']):
                continue
            out.append({'val': float(row['val']), 'end': _day(row['end']), 'start': _day(row['start']) if row.get('start') else None,
                        'filed': _day(row['filed']), 'accn': row.get('accn')})
        except (TypeError, ValueError, KeyError):
            continue
    return out


def _pick(rows, accept):
    best = None
    for row in rows:
        if accept(row) and (best is None or row['filed'] > best['filed']):
            best = row
    return best


def _dur(row):
    return row['end'] - row['start'] + 1 if row['start'] is not None else -1


def _near(a, b, within):
    return abs(a - b) <= within


def twelve_months(rows_by_tag, end, widest=False):
    """One flow for the twelve months ending around `end` (same rule as the Financial Radar, lib/research/radar-facts.ts):
    the fiscal year when one ends there, else the year to date + the previous fiscal year - the same period a year earlier.
    The first name of the list that has it wins; with `widest` (revenue) the largest of the names, since a company can file its
    total under one name and a part (contract revenue without lease income, at a landlord) under another.
    Returns (value, first filed day) or None."""
    if widest:
        found = [twelve_months([rows], end) for rows in rows_by_tag]
        found = [item for item in found if item]
        return max(found, key=lambda item: item[0]) if found else twelve_months(rows_by_tag, end)
    partial = []
    for rows in rows_by_tag:
        year = _pick(rows, lambda r: _near(r['end'], end, 9) and 350 <= _dur(r) <= 380)
        if year:
            return year['val'], _first_filed(rows, year)
        ytd = None
        for row in rows:
            if not _near(row['end'], end, 4) or _dur(row) < 80 or _dur(row) > 290:
                continue
            if ytd is None or row['filed'] > ytd['filed'] or (row['filed'] == ytd['filed'] and _dur(row) > _dur(ytd) + 20):
                ytd = row
        if not ytd:
            continue
        prior_ytd = _pick(rows, lambda r: r['start'] is not None and _near(r['end'], end - 365, 8)
                          and _near(r['start'], ytd['start'] - 365, 8) and abs(_dur(r) - _dur(ytd)) <= 8)
        prior_year = _pick(rows, lambda r: _near(r['end'], ytd['start'] - 1, 8) and 350 <= _dur(r) <= 380)
        if prior_ytd and prior_year:
            return prior_year['val'] + ytd['val'] - prior_ytd['val'], _first_filed(rows, ytd)
        if prior_ytd:
            partial.append((ytd, prior_ytd, rows))
    for ytd, prior_ytd, rows in partial:
        for other in rows_by_tag:
            prior_year = _pick(other, lambda r: _near(r['end'], ytd['start'] - 1, 8) and 350 <= _dur(r) <= 380)
            if prior_year:
                return prior_year['val'] + ytd['val'] - prior_ytd['val'], _first_filed(rows, ytd)
    return None


def _first_filed(rows, chosen):
    """The day the period was first reported (a later restatement replaces the number, not the day it became known)."""
    return min((r['filed'] for r in rows if r['end'] == chosen['end'] and r['start'] == chosen['start']), default=chosen['filed'])


def ttm_points(rows_by_tag, widest=False):
    ends = sorted({r['end'] for rows in rows_by_tag for r in rows if 80 <= _dur(r) <= 380})
    points, seen = [], set()
    for end in ends:
        if any(_near(end, other, 9) for other in seen):
            continue
        found = twelve_months(rows_by_tag, end, widest)
        if found:
            seen.add(end)
            points.append({'end': end, 'filed': found[1], 'value': found[0]})
    return points


def share_points(facts):
    """Shares outstanding by cover date: every share class of one filing added together (dei). Before the first cover count (a
    company with several share classes files them only by class, which the SEC's company facts leave out), the diluted weighted
    average share count of each period as first reported (a later filing restates it for a split; the closes are matched to the
    count as it was then)."""
    rows = _rows(facts, 'dei', 'EntityCommonStockSharesOutstanding', 'shares') or _rows(facts, 'ifrs-full', 'NumberOfSharesOutstanding', 'shares')
    first_cover = min((row['end'] for row in rows), default=None)
    weighted = {}
    for row in _rows(facts, 'us-gaap', 'WeightedAverageNumberOfDilutedSharesOutstanding', 'shares'):
        if row['val'] <= 0 or (first_cover is not None and row['end'] >= first_cover):
            continue
        best = weighted.get(row['end'])
        if best is None or (row['filed'], _dur(row)) < (best['filed'], _dur(best)):
            weighted[row['end']] = row
    by_filing = {}
    for row in rows:
        key = (row['accn'], row['end'])
        by_filing[key] = by_filing.get(key, 0.0) + row['val']
    latest = {}
    for (accn, end), value in by_filing.items():
        if value > 0:
            latest[end] = value
    for end, row in weighted.items():
        latest[end] = row['val']
    return [{'end': end, 'value': value} for end, value in sorted(latest.items())]


def _name(tag):
    return tuple(tag.split(':', 1)) if ':' in tag else ('us-gaap', tag)


def reporting_currency(facts):
    """The currency of the latest revenue facts (TWD for TSMC, EUR for ASML; USD for most; Nebius reports in dollars now, in
    roubles before), and of those the one with the most facts, so a few years translated for convenience do not decide it."""
    seen = {}
    for tag in REVENUE:
        taxonomy, name = _name(tag)
        units = (((facts.get('facts') or {}).get(taxonomy) or {}).get(name) or {}).get('units') or {}
        for unit, rows in units.items():
            if len(unit) == 3 and unit.isalpha() and unit.isupper() and isinstance(rows, list):
                ends = [str(row.get('end')) for row in rows if isinstance(row, dict) and row.get('form') in FORMS]
                if ends:
                    latest, count = seen.get(unit, ('', 0))
                    seen[unit] = (max(latest, max(ends)), count + len(ends))
    return max(sorted(seen), key=lambda unit: (seen[unit][0][:4], seen[unit][1], unit == 'USD')) if seen else 'USD'


def fundamentals(facts):
    """The compact per-company record kept in the database (no raw filing data). Figures stay in the filing's currency;
    they are turned into dollars day by day with that day's exchange rate."""
    if not isinstance(facts, dict) or not facts.get('facts'):
        return {'error': 'no-sec-data'}
    currency = reporting_currency(facts)
    flows = lambda tags: [_rows(facts, *_name(tag), currency) for tag in tags]  # noqa: E731
    revenue = ttm_points(flows(REVENUE), widest=True)
    income = ttm_points(flows(NET_INCOME))
    shares = share_points(facts)
    return {'revenue': revenue, 'income': income, 'shares': shares, 'currency': currency, 'source': 'sec'}


# ---- the provider's quarterly statements, where the SEC's figures are missing or old -------------------------------------------------

def statement_quarters(body):
    """Twelve Data income_statement (quarterly) -> (currency, [{end, sales, income, shares}] oldest first)."""
    if not isinstance(body, dict) or not isinstance(body.get('income_statement'), list):
        return None, []
    currency = str((body.get('meta') or {}).get('currency') or 'USD').upper()
    out = []
    for row in body['income_statement']:
        try:
            end = _day(str(row['fiscal_date'])[:10])
        except (KeyError, TypeError, ValueError):
            continue
        number = lambda key: row.get(key) if isinstance(row.get(key), (int, float)) and math.isfinite(row.get(key)) else None  # noqa: E731
        out.append({'end': end, 'sales': number('sales'), 'income': number('net_income'), 'shares': number('diluted_shares_outstanding')})
    return currency, sorted(out, key=lambda q: q['end'])


def supplement(record, body):
    """Adds the provider's quarters after the last SEC period: trailing twelve months from four quarters in a row (counted as known
    30 days after the quarter), the share count, and the quarters themselves for the year-over-year revenue. A depositary share
    stands for a fixed number of ordinary shares; when the provider counts depositary shares (TSMC: one for five), the SEC counts
    are brought to the same basis."""
    currency, quarters = statement_quarters(body)
    if not quarters:
        return record
    record = dict(record) if record and not record.get('error') else {'revenue': [], 'income': [], 'shares': [], 'currency': currency}
    if record.get('revenue') and record.get('currency') != currency:
        return record  # never mix two currencies in one series
    record['currency'] = currency
    record['source'] = 'sec+twelvedata' if record.get('revenue') else 'twelvedata'
    for key, field in (('revenue', 'sales'), ('income', 'income')):
        points = list(record.get(key) or [])
        last = max((p['end'] for p in points), default=0)
        for i in range(3, len(quarters)):
            run = quarters[i - 3:i + 1]
            if any(not 75 <= b['end'] - a['end'] <= 105 for a, b in zip(run, run[1:])) or any(q[field] is None for q in run):
                continue
            if run[-1]['end'] > last + 9:
                points.append({'end': run[-1]['end'], 'filed': run[-1]['end'] + 30, 'value': float(sum(q[field] for q in run))})
        record[key] = sorted(points, key=lambda p: p['end'])
    provider_shares = [{'end': q['end'] + 30, 'value': float(q['shares'])} for q in quarters if q['shares'] and q['shares'] > 0]
    shares = list(record.get('shares') or [])
    if provider_shares and shares:
        latest = provider_shares[-1]
        nearest = min(shares, key=lambda p: abs(p['end'] - latest['end']))
        factor = latest['value'] / nearest['value'] if nearest['value'] > 0 else 1.0
        if not 0.67 <= factor <= 1.5:
            shares = [{**p, 'value': p['value'] * factor} for p in shares]
    last_share = max((p['end'] for p in shares), default=0)
    shares += [p for p in provider_shares if p['end'] > last_share]
    record['shares'] = sorted(shares, key=lambda p: p['end'])
    record['quarters'] = [{'end': q['end'], 'value': float(q['sales'])} for q in quarters if q['sales'] is not None]
    return record


def needs_statements(record, today):
    """True when the SEC's latest twelve-month revenue is missing or more than TD_WHEN_OLDER days old."""
    if not record or record.get('error') or not record.get('revenue'):
        return True
    return today - max(p['end'] for p in record['revenue']) > TD_WHEN_OLDER


def sec_fetch(cik, user_agent, opener=urllib.request.urlopen):
    url = f'https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json'
    request = urllib.request.Request(url, headers={'User-Agent': user_agent, 'Accept-Encoding': 'gzip'})
    try:
        with opener(request, timeout=60) as response:
            body = response.read(200_000_000)
            if response.headers.get('Content-Encoding') == 'gzip':
                body = gzip.decompress(body)
        return json.loads(body)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise RuntimeError(f'sec-http-{error.code}') from None


# ---- Twelve Data ------------------------------------------------------------------------------------------------------------------

def td_get(path, params, env=None, timeout=60):
    env = os.environ if env is None else env
    base = (env.get('TWELVE_DATA_BASE_URL') or 'https://api.twelvedata.com').rstrip('/')
    query = dict(params)
    key = (env.get('TWELVE_DATA_API_KEY') or '').strip()
    if key:
        query['apikey'] = key
    request = urllib.request.Request(f'{base}/{path}?{urllib.parse.urlencode(query)}', headers={'User-Agent': 'tech-phase-value-check/1'})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read(50_000_000).decode('utf-8'))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'twelve-data-{path}-http-{error.code}') from None
    except Exception as error:  # the message can carry the URL and the key: never print it
        raise RuntimeError(f'twelve-data-{path}-{type(error).__name__}') from None


class Pacer:
    """Spends credits only while the key's usage this minute leaves room, and never more than OWN_PER_MINUTE of its own."""

    def __init__(self, transport, sleep=time.sleep, clock=time.monotonic, ceiling=CREDIT_CEILING, own=OWN_PER_MINUTE, max_wait=900,
                 wall=time.time):
        self.transport, self.sleep, self.clock, self.wall = transport, sleep, clock, wall
        self.ceiling, self.own, self.max_wait = ceiling, own, max_wait
        self.spent = []  # (time, credits)
        self.total = 0

    def used(self):
        try:
            body = self.transport('api_usage', {})
            value = body.get('current_usage') if isinstance(body, dict) else None
            return value if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0 else None
        except Exception:
            return None

    def wait_for(self, cost):
        started = self.clock()
        while True:
            now = self.clock()
            self.spent = [(at, c) for at, c in self.spent if now - at < 60]
            mine = sum(c for _, c in self.spent)
            used = self.used()
            # An unreadable meter is treated as a full minute of our own budget: go on, but only at a third of the pace.
            limit_ok = (used + cost <= self.ceiling) if used is not None else (mine + cost <= self.own // 3)
            if mine + cost <= self.own and limit_ok:
                self.spent.append((now, cost))
                self.total += cost
                return True
            if now - started > self.max_wait:
                return False
            # The provider counts per clock minute: a busy minute is waited out to just after the next one starts, when the
            # usage is lowest (each /api_usage read itself costs a credit, so it is not polled meanwhile).
            self.sleep(max(5.0, 62 - self.wall() % 60))


def parse_series(body, symbols):
    """Twelve Data time_series (one symbol unwrapped, several keyed by symbol) -> {ticker: [(day, close)]} oldest first."""
    if not isinstance(body, dict):
        return {}
    if len(symbols) == 1 and 'values' in body:
        body = {symbols[0]: body}
    out = {}
    for symbol in symbols:
        entry = body.get(symbol)
        if not isinstance(entry, dict) or entry.get('status') not in (None, 'ok') or not isinstance(entry.get('values'), list):
            continue
        bars = []
        for bar in entry['values']:
            try:
                close = float(bar['close'])
                day = str(bar['datetime'])[:10]
                date.fromisoformat(day)
            except (KeyError, TypeError, ValueError):
                continue
            if math.isfinite(close) and close > 0:
                bars.append((day, close))
        if bars:
            out[symbol] = sorted(bars)
    return out


def provider_symbol(ticker):
    """FX:TWD is the dollar's rate in Taiwan dollars (USD/TWD); a share class dash becomes a dot."""
    return f'USD/{ticker[3:]}' if ticker.startswith('FX:') else ticker.replace('-', '.')


def read_series(tickers, bars, adjust, pacer, transport):
    """{ticker: [(day, close)]}; a chunk the pacer cannot fit is left for the next run."""
    out = {}
    for i in range(0, len(tickers), CHUNK):
        chunk = tickers[i:i + CHUNK]
        if not pacer.wait_for(len(chunk)):
            break
        symbols = [provider_symbol(t) for t in chunk]
        try:
            body = transport('time_series', {'symbol': ','.join(symbols), 'interval': '1day', 'outputsize': str(bars),
                                             'adjust': adjust, 'order': 'ASC'})
        except Exception as error:
            print(json.dumps({'event': 'value-check-series-failed', 'error': str(error)[:80]}), flush=True)
            continue
        got = parse_series(body, symbols)
        for ticker, symbol in zip(chunk, symbols):
            if symbol in got:
                out[ticker] = got[symbol]
    return out


def store_history(db, ticker, raw, adj):
    raw_by_day = dict(raw)
    rows = [(ticker, day, raw_by_day[day], close) for day, close in adj if day in raw_by_day]
    db.executemany('INSERT OR REPLACE INTO value_check_closes(ticker,day,raw,adj) VALUES(?,?,?,?)', rows)
    return len(rows)


def store_update(db, ticker, adj):
    """New bars from the daily read (raw = adjusted on the day it is read). When the overlap shows the provider re-based the
    adjusted closes (a split), every stored adjusted close is rescaled the same way; the raw closes stay as they were."""
    stored = dict(db.execute('SELECT day, adj FROM value_check_closes WHERE ticker=? AND day>=?', (ticker, adj[0][0])).fetchall())
    ratios = sorted(close / stored[day] for day, close in adj if day in stored and stored[day] > 0)
    if ratios:
        ratio = ratios[len(ratios) // 2]
        if abs(ratio - 1) > 0.02:
            db.execute('UPDATE value_check_closes SET adj = adj * ? WHERE ticker=?', (ratio, ticker))
            print(json.dumps({'event': 'value-check-rebased', 'ticker': ticker, 'ratio': round(ratio, 6)}), flush=True)
    for day, close in adj:
        db.execute('INSERT INTO value_check_closes(ticker,day,raw,adj) VALUES(?,?,?,?) ON CONFLICT(ticker,day) DO UPDATE SET adj=excluded.adj',
                   (ticker, day, close, close))


# ---- the calculation ----------------------------------------------------------------------------------------------------------------

def _latest(points, day, key):
    """The latest point whose `key` day is on or before `day` (points sorted by that key)."""
    lo, hi = 0, len(points)
    while lo < hi:
        mid = (lo + hi) // 2
        if points[mid][key] <= day:
            lo = mid + 1
        else:
            hi = mid
    return points[lo - 1] if lo else None


def _latest_index(days, day):
    lo, hi = 0, len(days)
    while lo < hi:
        mid = (lo + hi) // 2
        if days[mid] <= day:
            lo = mid + 1
        else:
            hi = mid
    return lo - 1


def _known(points, day):
    """The most recent period already filed on `day`."""
    best = None
    for point in points:
        if point['filed'] <= day and (best is None or point['end'] > best['end']):
            best = point
    return best


def clean_shares(points):
    """Leaves out a cover count that is more than five times off both its neighbours (Packaging Corp's 10-K of Feb 2026 gives
    89 billion shares for 89 million): a typing slip in one filing, not a change in the company."""
    out = []
    for i, point in enumerate(points):
        before = points[i - 1]['value'] if i else None
        after = points[i + 1]['value'] if i + 1 < len(points) else None
        off = lambda other: other is not None and other > 0 and not 0.2 <= point['value'] / other <= 5  # noqa: E731
        if off(before) and (after is None or off(after)):
            continue
        out.append(point)
    return out


def daily_ratios(closes, record, fx=None):
    """[(ordinal day, pe or None, ps or None)] for every stored close. closes: [(day text, raw, adj)] oldest first.
    fx: [(day text, units of the filing currency per dollar)] when the figures are not in dollars."""
    shares = clean_shares(record.get('shares') or [])
    if not closes or not shares:
        return []
    if (record.get('currency') or 'USD') != 'USD' and not fx:
        return []
    fx_days = [_day(day) for day, _ in fx] if fx else []
    days = [_day(day) for day, _, _ in closes]
    factors = [raw / adj if adj > 0 else 1.0 for _, raw, adj in closes]

    def factor_at(ordinal):
        lo, hi = 0, len(days)
        while lo < hi:
            mid = (lo + hi) // 2
            if days[mid] <= ordinal:
                lo = mid + 1
            else:
                hi = mid
        return factors[max(lo - 1, 0)]

    revenue = sorted(record.get('revenue') or [], key=lambda p: p['filed'])
    income = sorted(record.get('income') or [], key=lambda p: p['filed'])
    out, r_i, i_i, rev, inc = [], 0, 0, None, None
    for ordinal, (_, _, adj) in zip(days, closes):
        while r_i < len(revenue) and revenue[r_i]['filed'] <= ordinal:
            if rev is None or revenue[r_i]['end'] >= rev['end']:
                rev = revenue[r_i]
            r_i += 1
        while i_i < len(income) and income[i_i]['filed'] <= ordinal:
            if inc is None or income[i_i]['end'] >= inc['end']:
                inc = income[i_i]
            i_i += 1
        point = _latest(shares, ordinal, 'end')
        if point is None:
            out.append((ordinal, None, None))
            continue
        value = adj * point['value'] * factor_at(point['end'])
        if fx_days:
            at = _latest_index(fx_days, ordinal)
            value *= fx[max(at, 0)][1]  # the market value in the filing's currency
        pe = value / inc['value'] if inc and inc['value'] > 0 and ordinal - inc['end'] < MAX_FIGURE_AGE else None
        ps = value / rev['value'] if rev and rev['value'] > 0 and ordinal - rev['end'] < MAX_FIGURE_AGE else None
        out.append((ordinal, pe, ps))
    return out


def trimmed_mean(values, cut=TRIM):
    """The mean without the highest and the lowest `cut` share of the values (5% each), so a few extreme days do not decide it."""
    ordered = sorted(values)
    drop = int(len(ordered) * cut)
    kept = ordered[drop:len(ordered) - drop] if drop else ordered
    return sum(kept) / len(kept)


def score_at(ratios, index):
    """The Value Score on ratios[index] (owner, Nov 22 revision): for P/E and P/S each, 1 - today / the five-year trimmed mean
    (loss days have no P/E and are left out of its mean); the mean of the two, or P/S alone without a P/E today. In percent,
    unrounded. Also whether both are below every day of the period (5年最安). None without enough data."""
    if index < 0 or index >= len(ratios):
        return None
    day, pe, ps = ratios[index]
    if ps is None:
        return None
    window = [r for r in ratios[:index] if day - r[0] <= WINDOW_DAYS]
    ps_history = [r[2] for r in window if r[2] is not None]
    if len(ps_history) < MIN_PS_DAYS:
        return None
    pe_history = [r[1] for r in window if r[1] is not None]
    use_pe = pe is not None and len(pe_history) >= MIN_PE_DAYS
    parts = [1 - ps / trimmed_mean(ps_history)]
    low = ps < min(ps_history)
    if use_pe:
        parts.insert(0, 1 - pe / trimmed_mean(pe_history))
        low = low and pe < min(pe_history)
    return {'exact': 100 * sum(parts) / len(parts), 'pe': pe, 'ps': ps, 'low': low, 'days': len(ps_history)}


def revenue_growth(record):
    """Trailing twelve months against the twelve months a year earlier; without that, the latest quarter against the same quarter a
    year earlier (the provider's quarters)."""
    points = sorted(record.get('revenue') or [], key=lambda p: p['end'])
    if points:
        latest = points[-1]
        before = next((p for p in reversed(points) if _near(p['end'], latest['end'] - 365, 12)), None)
        if before and before['value'] > 0:
            return (latest['value'] / before['value'] - 1) * 100
    quarters = sorted(record.get('quarters') or [], key=lambda q: q['end'])
    if quarters:
        latest = quarters[-1]
        before = next((q for q in quarters if _near(q['end'], latest['end'] - 365, 12)), None)
        if before and before['value'] > 0:
            return (latest['value'] / before['value'] - 1) * 100
    return None


def evaluate(ticker, closes, record, as_of, fx=None):
    """One ticker: a ranked row, or an exclusion reason."""
    if record.get('error'):
        return {'excluded': record['error']}
    if not record.get('revenue'):
        return {'excluded': 'no-revenue'}
    if not record.get('shares'):
        return {'excluded': 'no-shares'}
    if not closes:
        return {'excluded': 'no-price'}
    if closes[-1][0] != as_of:
        return {'excluded': 'stale-price'}
    if (record.get('currency') or 'USD') != 'USD' and not fx:
        return {'excluded': 'no-exchange-rate'}
    ratios = daily_ratios(closes, record, fx)
    today = score_at(ratios, len(ratios) - 1)
    if today is None:
        return {'excluded': 'short-history' if ratios and ratios[-1][2] is not None else 'no-current-figures'}
    if today['ps'] > MAX_PS:
        return {'excluded': 'implausible'}
    growth = revenue_growth(record)
    if growth is None:
        return {'excluded': 'no-growth'}
    if growth < 0:
        return {'excluded': 'revenue-decline'}
    if today['exact'] <= 0 or round(today['exact']) <= 0:
        return {'excluded': 'above-average'}  # at or above its five-year mean: not in the ranking (owner, Nov 22)
    previous = score_at(ratios, len(ratios) - 2)
    pe, ps = today['pe'], today['ps']
    # The note says why the period is shorter than five years: a recent listing, or filings that start later.
    note = None
    if today['days'] < FULL_DAYS:
        note = 'listed' if _day(closes[0][0]) > _day(as_of) - WINDOW_DAYS + 60 else 'data'
    return {'ticker': ticker, 'score': round(today['exact']), 'exact': today['exact'],
            'previous': round(previous['exact']) if previous else None, 'low': today['low'],
            'pe': round(pe, 1) if pe is not None else None, 'ps': round(ps, 1), 'revenueGrowth': round(growth),
            'period': note, 'source': record.get('source') or 'sec'}


def rank(rows):
    """Highest Value Score first, by the unrounded value (two stocks shown at the same % still have an order), then by ticker."""
    return sorted(rows, key=lambda r: (-r.get('exact', r['score']), r['ticker']))


def changes(rows):
    """IN: below CHEAP yesterday, at or above today; OUT: the reverse. IN first, each by size of the move."""
    ins = [{'ticker': r['ticker'], 'from': r['previous'], 'to': r['score']} for r in rows
           if r['previous'] is not None and r['previous'] < CHEAP <= r['score']]
    outs = [{'ticker': r['ticker'], 'from': r['previous'], 'to': r['score']} for r in rows
            if r['previous'] is not None and r['score'] < CHEAP <= r['previous']]
    ins.sort(key=lambda c: (-(c['to'] - c['from']), c['ticker']))
    outs.sort(key=lambda c: (-(c['from'] - c['to']), c['ticker']))
    return {'in': ins, 'out': outs}


def build_snapshot(universe, closes_by_ticker, records, now=None, fx=None):
    now = now or datetime.now(timezone.utc)
    last_days = sorted(c[-1][0] for c in closes_by_ticker.values() if c)
    as_of = max(set(last_days), key=last_days.count) if last_days else None  # the day most tickers closed on
    if as_of and last_days and last_days[-1] > as_of:
        as_of = last_days[-1] if last_days.count(last_days[-1]) * 2 >= len(last_days) else as_of
    evaluated = {}
    for ticker in universe['all']:
        if '.' in ticker:
            evaluated[ticker] = {'excluded': 'share-class'}
            continue
        record = records.get(ticker) or {'error': 'no-sec-data'}
        evaluated[ticker] = evaluate(ticker, closes_by_ticker.get(ticker) or [], record, as_of, (fx or {}).get(record.get('currency')))
    companies = universe['companies']
    lists = {}
    for name in ('tech', 'all'):
        rows, excluded = [], {}
        for ticker in universe[name]:
            result = evaluated[ticker]
            if 'excluded' in result:
                excluded.setdefault(result['excluded'], []).append(ticker)
                continue
            info = companies.get(ticker) or {}
            rows.append({**result, 'ja': info.get('ja') or info.get('en') or ticker, 'en': info.get('en') or ticker})
        rows = rank(rows)
        for row in rows:
            row.pop('exact', None)
            row.pop('source', None)
        moved = changes(rows)
        entered = {c['ticker'] for c in moved['in']}
        for row in rows:
            row['in'] = row['ticker'] in entered
        lists[name] = {'total': len(universe[name]), 'items': rows, 'changes': moved,
                       'excluded': {reason: sorted(tickers) for reason, tickers in sorted(excluded.items())}}
    sources = {t: r.get('source') for t, r in evaluated.items() if r.get('source') and r['source'] != 'sec'}
    return {'ok': True, 'version': 3, 'basis': 'trailing', 'asOf': as_of, 'sources': dict(sorted(sources.items())),
            'computedAt': now.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'universes': lists}


# ---- one run ------------------------------------------------------------------------------------------------------------------------

def _closes(db, ticker):
    return db.execute('SELECT day, raw, adj FROM value_check_closes WHERE ticker=? ORDER BY day', (ticker,)).fetchall()


def load_records(db):
    records = {}
    for ticker, payload in db.execute('SELECT ticker, payload FROM value_check_facts'):
        try:
            records[ticker] = json.loads(payload)
        except ValueError:
            continue
    return records


def merged_records(db):
    """SEC facts with the provider's quarters added where they were read."""
    records = load_records(db)
    for ticker, payload in db.execute('SELECT ticker, payload FROM value_check_statements'):
        try:
            records[ticker] = supplement(records.get(ticker), json.loads(payload))
        except ValueError:
            continue
    return records


def compute(db, universe, now=None):
    """The snapshot from what is stored (no provider call)."""
    records = merged_records(db)
    closes = {t: _closes(db, t) for t in universe['all'] if '.' not in t}
    fx = {}
    for currency in {r.get('currency') for r in records.values() if r.get('currency') not in (None, 'USD')}:
        rows = _closes(db, f'FX:{currency}')
        if rows:
            fx[currency] = [(day, adj) for day, _, adj in rows]
    return build_snapshot(universe, closes, records, now, fx)


def run_once(db, *, universe=None, transport=None, sec=None, sec_pause=0.25, now=None, sleep=time.sleep, only=None, should_stop=lambda: False):
    """Backfill what is missing (resumable: what is stored stays), read the latest bars, refresh old SEC facts, store the snapshot."""
    universe = universe or load_universe()
    transport = transport or td_get
    tickers = [t for t in (universe[only] if only else universe['all']) if '.' not in t]
    pacer = Pacer(transport, sleep=sleep)
    priced = list(tickers)
    stamp = time.time() if now is None else now.timestamp()

    # SEC facts: free, about four requests a second.
    if sec is None:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import monitor  # noqa: E402
        agent = monitor.sec_user_agent()
        sec = lambda cik: sec_fetch(cik, agent)  # noqa: E731
    stored = {row[0]: row[1] for row in db.execute('SELECT ticker, fetched_at FROM value_check_facts')}
    for ticker in tickers:
        if should_stop():
            break
        if stamp - stored.get(ticker, 0) < FACTS_MAX_AGE:
            continue
        cik = (universe['companies'].get(ticker) or {}).get('cik')
        try:
            record = fundamentals(sec(cik)) if cik else {'error': 'no-cik'}
        except Exception as error:
            print(json.dumps({'event': 'value-check-sec-failed', 'ticker': ticker, 'error': str(error)[:60]}), flush=True)
            continue
        db.execute('INSERT OR REPLACE INTO value_check_facts(ticker,fetched_at,payload) VALUES(?,?,?)', (ticker, stamp, json.dumps(record)))
        db.commit()
        sleep(sec_pause)

    # The provider's quarterly statements where the SEC's figures are missing or old (foreign filers mostly): 100 credits a read,
    # read again only once a newer quarter can be out.
    today = (now or datetime.now(timezone.utc)).astimezone(EASTERN).date().toordinal()
    records = load_records(db)
    statements = {row[0]: (row[1], row[2]) for row in db.execute('SELECT ticker, fetched_at, payload FROM value_check_statements')}
    # High-tech names first, so a busy day still fills the ones most looked at.
    for ticker in sorted(tickers, key=lambda t: t not in set(universe['tech'])):
        if should_stop() or not needs_statements(records.get(ticker), today):
            continue
        if ticker in statements:
            fetched_at, payload = statements[ticker]
            _, quarters = statement_quarters(json.loads(payload))
            newest = max((q['end'] for q in quarters), default=0)
            if stamp - fetched_at < TD_REREAD or today - newest < TD_NEW_QUARTER:
                continue
        if not pacer.wait_for(TD_STATEMENT_COST):
            break
        try:
            body = transport('income_statement', {'symbol': provider_symbol(ticker), 'period': 'quarterly'})
        except Exception as error:
            print(json.dumps({'event': 'value-check-statement-failed', 'ticker': ticker, 'error': str(error)[:80]}), flush=True)
            continue
        kept = body if isinstance(body, dict) and isinstance(body.get('income_statement'), list) else {'income_statement': []}
        db.execute('INSERT OR REPLACE INTO value_check_statements(ticker,fetched_at,payload) VALUES(?,?,?)', (ticker, stamp, json.dumps(kept)))
        db.commit()

    # Prices: the five-year history once per ticker, then the last bars; the exchange rates of the filings' currencies too.
    currencies = {r.get('currency') for r in merged_records(db).values() if r.get('currency') not in (None, 'USD')}
    tickers = priced + [f'FX:{c}' for c in sorted(currencies)]
    have = {row[0] for row in db.execute('SELECT DISTINCT ticker FROM value_check_closes')}
    missing = [t for t in tickers if t not in have]
    for i in range(0, len(missing), CHUNK * 4):
        if should_stop():
            break
        part = missing[i:i + CHUNK * 4]
        raw = read_series(part, HISTORY_BARS, 'none', pacer, transport)
        adj = read_series([t for t in part if t in raw], HISTORY_BARS, 'splits', pacer, transport)
        for ticker in adj:
            store_history(db, ticker, raw[ticker], adj[ticker])
        db.commit()
    backfilled = set(missing)
    current = [t for t in tickers if t not in backfilled]
    if current and not should_stop():
        latest = read_series(current, UPDATE_BARS, 'splits', pacer, transport)
        for ticker, bars in latest.items():
            store_update(db, ticker, bars)
        db.commit()

    snapshot = compute(db, universe, now)
    snapshot['credits'] = pacer.total
    db.execute('INSERT OR REPLACE INTO value_check_state(key,value) VALUES(?,?)', ('snapshot', json.dumps(snapshot, ensure_ascii=False)))
    db.commit()
    STATUS.update(lastRun=snapshot['computedAt'], lastError=None, credits=pacer.total)
    return snapshot


def snapshot(db):
    row = db.execute("SELECT value FROM value_check_state WHERE key='snapshot'").fetchone()
    return json.loads(row[0]) if row else None


def public_payload(db):
    """What the site's server reads (it checks PRO first). No credits, no provider call."""
    data = snapshot(db)
    if not data:
        return {'ok': False, 'error': 'not-ready'}
    data = dict(data)
    data.pop('credits', None)
    return data


def due(now, last_day):
    """The run of a weekday after RUN_AT Eastern, once per day; Saturday and Sunday have no new close."""
    local = now.astimezone(EASTERN)
    if local.weekday() >= 5 or (local.hour, local.minute) < RUN_AT:
        return None
    today = local.date().isoformat()
    return today if today != last_day else None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('command', choices=['run', 'show'])
    parser.add_argument('--db', required=True)
    parser.add_argument('--universe', choices=['tech', 'all'])
    args = parser.parse_args(argv)
    db = connect(args.db)
    try:
        data = run_once(db, only=args.universe) if args.command == 'run' else snapshot(db)
    finally:
        db.close()
    if not data:
        print('no snapshot')
        return 1
    summary = {name: {'ranked': len(u['items']), 'total': u['total'], 'excluded': {k: len(v) for k, v in u['excluded'].items()},
                      'in': len(u['changes']['in']), 'out': len(u['changes']['out'])} for name, u in data['universes'].items()}
    print(json.dumps({'asOf': data['asOf'], 'credits': data.get('credits'), 'universes': summary}, ensure_ascii=False, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
