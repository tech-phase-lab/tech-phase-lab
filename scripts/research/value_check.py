"""割安判別ツール / Value Check (owner, Nov 22): where each stock's P/E and P/S sit within its own past five years.

Mechanical and the same for everyone:
  * P/E and P/S for every trading day of the last five years = market value / trailing-twelve-month net income or revenue.
    Market value = split-adjusted daily close (Twelve Data) x shares outstanding from the SEC cover page, brought to today's share basis.
    The twelve-month figures come from SEC XBRL company facts and are used from the day they were filed.
    Forward (estimate-based) P/E and P/S have no five-year daily history at Twelve Data, so the trailing (実績) values are used.
  * Position = share of the past five years' days on which the value was higher than today (0-100).
  * Value Score = mean of the P/E and P/S positions, rounded; with no positive P/E (a loss) the P/S position alone.
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
MIN_PS_DAYS = 3 * 252         # at least three years of daily P/S (a younger listing uses what it has, from three years)
MIN_PE_DAYS = 252             # fewer profitable days than this: the P/S position alone
MAX_PS = 200                  # a P/S above this means the filed revenue is only a part of the total: left out, not guessed
CHEAP = 70                    # 割安: Value Score of 70 or more
FACTS_MAX_AGE = 7 * 86400     # SEC company facts are read again after a week
RUN_AT = (17, 30)             # weekdays, Eastern, after the close

REVENUE = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenueFromContractWithCustomerIncludingAssessedTax',
           'SalesRevenueNet', 'SalesRevenueGoodsNet', 'RevenuesNetOfInterestExpense', 'RegulatedAndUnregulatedOperatingRevenue']
NET_INCOME = ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss']
FORMS = {'10-K', '10-K/A', '10-Q', '10-Q/A'}

STATUS = {'lastRun': None, 'lastError': None, 'credits': 0}


def enabled(env=None):
    env = os.environ if env is None else env
    return (env.get('VALUE_CHECK_ENABLED') or '').strip().lower() == 'true'


def load_universe(path=UNIVERSE_FILE):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def connect(path):
    db = sqlite3.connect(path, timeout=30)
    schema(db)
    return db


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS value_check_closes(
      ticker TEXT NOT NULL, day TEXT NOT NULL, raw REAL NOT NULL, adj REAL NOT NULL, PRIMARY KEY(ticker, day))''')
    db.execute('''CREATE TABLE IF NOT EXISTS value_check_facts(
      ticker TEXT PRIMARY KEY, fetched_at REAL NOT NULL, payload TEXT NOT NULL)''')
    db.execute('''CREATE TABLE IF NOT EXISTS value_check_state(key TEXT PRIMARY KEY, value TEXT NOT NULL)''')
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
    rows = _rows(facts, 'dei', 'EntityCommonStockSharesOutstanding', 'shares')
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


def fundamentals(facts):
    """The compact per-company record kept in the database (no raw filing data)."""
    if not isinstance(facts, dict):
        return {'error': 'no-sec-data'}
    usd = lambda tags: [_rows(facts, 'us-gaap', tag, 'USD') for tag in tags]  # noqa: E731
    revenue = ttm_points(usd(REVENUE), widest=True)
    income = ttm_points(usd(NET_INCOME))
    shares = share_points(facts)
    return {'revenue': revenue, 'income': income, 'shares': shares}


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

    def __init__(self, transport, sleep=time.sleep, clock=time.monotonic, ceiling=CREDIT_CEILING, own=OWN_PER_MINUTE, max_wait=900):
        self.transport, self.sleep, self.clock = transport, sleep, clock
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
            self.sleep(15)  # each /api_usage read itself costs a credit


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
    return ticker.replace('-', '.')


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


def _known(points, day):
    """The most recent period already filed on `day`."""
    best = None
    for point in points:
        if point['filed'] <= day and (best is None or point['end'] > best['end']):
            best = point
    return best


def daily_ratios(closes, record):
    """[(ordinal day, pe or None, ps or None)] for every stored close. closes: [(day text, raw, adj)] oldest first."""
    shares = record.get('shares') or []
    if not closes or not shares:
        return []
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
        pe = value / inc['value'] if inc and inc['value'] > 0 and ordinal - inc['end'] < 200 else None
        ps = value / rev['value'] if rev and rev['value'] > 0 and ordinal - rev['end'] < 200 else None
        out.append((ordinal, pe, ps))
    return out


def position(history, today):
    """Share (0-100) of the past days on which the value was higher than today."""
    if not history:
        return None
    return 100.0 * sum(1 for value in history if value > today) / len(history)


def score_at(ratios, index):
    """(score, pe position, ps position, pe, ps) on ratios[index], looking back five years; None without enough data."""
    if index < 0 or index >= len(ratios):
        return None
    day, pe, ps = ratios[index]
    if ps is None:
        return None
    window = [r for r in ratios[:index] if day - r[0] <= WINDOW_DAYS]
    ps_history = [r[2] for r in window if r[2] is not None]
    if len(ps_history) < MIN_PS_DAYS:
        return None
    ps_pos = position(ps_history, ps)
    pe_history = [r[1] for r in window if r[1] is not None]
    pe_pos = position(pe_history, pe) if pe is not None and len(pe_history) >= MIN_PE_DAYS else None
    parts = [p for p in (pe_pos, ps_pos) if p is not None]
    return round(sum(parts) / len(parts)), pe_pos, ps_pos, pe, ps


def revenue_growth(record):
    points = sorted(record.get('revenue') or [], key=lambda p: p['end'])
    if not points:
        return None
    latest = points[-1]
    before = next((p for p in reversed(points) if _near(p['end'], latest['end'] - 365, 12)), None)
    if not before or before['value'] <= 0:
        return None
    return (latest['value'] / before['value'] - 1) * 100


def evaluate(ticker, closes, record, as_of):
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
    ratios = daily_ratios(closes, record)
    today = score_at(ratios, len(ratios) - 1)
    if today is None:
        return {'excluded': 'short-history' if ratios and ratios[-1][2] is not None else 'no-current-figures'}
    if today[4] > MAX_PS:
        return {'excluded': 'implausible'}
    growth = revenue_growth(record)
    if growth is None:
        return {'excluded': 'no-growth'}
    if growth < 0:
        return {'excluded': 'revenue-decline'}
    previous = score_at(ratios, len(ratios) - 2)
    score, _, _, pe, ps = today
    return {'ticker': ticker, 'score': score, 'previous': previous[0] if previous else None,
            'pe': round(pe, 1) if pe is not None else None, 'ps': round(ps, 1), 'revenueGrowth': round(growth)}


def rank(rows):
    """Highest score first; ties by ticker so the order never depends on anything else."""
    return sorted(rows, key=lambda r: (-r['score'], r['ticker']))


def changes(rows):
    """IN: below CHEAP yesterday, at or above today; OUT: the reverse. IN first, each by size of the move."""
    ins = [{'ticker': r['ticker'], 'from': r['previous'], 'to': r['score']} for r in rows
           if r['previous'] is not None and r['previous'] < CHEAP <= r['score']]
    outs = [{'ticker': r['ticker'], 'from': r['previous'], 'to': r['score']} for r in rows
            if r['previous'] is not None and r['score'] < CHEAP <= r['previous']]
    ins.sort(key=lambda c: (-(c['to'] - c['from']), c['ticker']))
    outs.sort(key=lambda c: (-(c['from'] - c['to']), c['ticker']))
    return {'in': ins, 'out': outs}


def build_snapshot(universe, closes_by_ticker, records, now=None):
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
        evaluated[ticker] = evaluate(ticker, closes_by_ticker.get(ticker) or [], records.get(ticker) or {'error': 'no-sec-data'}, as_of)
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
        moved = changes(rows)
        entered = {c['ticker'] for c in moved['in']}
        for row in rows:
            row['in'] = row['ticker'] in entered
        lists[name] = {'total': len(universe[name]), 'items': rows, 'changes': moved,
                       'excluded': {reason: sorted(tickers) for reason, tickers in sorted(excluded.items())}}
    return {'ok': True, 'version': 1, 'basis': 'trailing', 'asOf': as_of,
            'computedAt': now.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'universes': lists}


# ---- one run ------------------------------------------------------------------------------------------------------------------------

def _closes(db, ticker):
    return db.execute('SELECT day, raw, adj FROM value_check_closes WHERE ticker=? ORDER BY day', (ticker,)).fetchall()


def run_once(db, *, universe=None, transport=None, sec=None, sec_pause=0.25, now=None, sleep=time.sleep, only=None, should_stop=lambda: False):
    """Backfill what is missing (resumable: what is stored stays), read the latest bars, refresh old SEC facts, store the snapshot."""
    universe = universe or load_universe()
    transport = transport or td_get
    tickers = [t for t in (universe[only] if only else universe['all']) if '.' not in t]
    pacer = Pacer(transport, sleep=sleep)
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

    # Prices: the five-year history once per ticker, then the last bars.
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

    records = {}
    for ticker, payload in db.execute('SELECT ticker, payload FROM value_check_facts'):
        try:
            records[ticker] = json.loads(payload)
        except ValueError:
            continue
    closes = {t: _closes(db, t) for t in universe['all'] if '.' not in t}
    snapshot = build_snapshot(universe, closes, records, now)
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
