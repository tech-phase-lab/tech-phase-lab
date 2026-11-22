"""大口の動き (owner, Nov 22): collection only, no screen. Four public datasets into the monitor's SQLite.

1. Institutional ownership: SEC Form 13F Data Sets (quarterly ZIP). Per ticker only, never per institution (owner, Nov 22 v2: the
   institution lists belong to Capital Map). Same counting rules as Capital Map's 13F import: SH rows only, puts and calls excluded,
   shares summed per CUSIP. Ratio = shares held by all 13F filers / shares outstanding (10-Q/10-K cover, else XBRL dei).
2. Short interest: FINRA Equity Short Interest (twice a month, public API without registration). Days to cover uses the 20-day
   average volume from Twelve Data /quote (a few credits a minute, shared plan), and FINRA's own figure is kept beside it.
3. Insider trades: SEC Form 4 XML. Open-market buys (P) and sells (S) are 'open-market'; every other code is stored as 'other'.
   10b5-1: the form's Rule 10b5-1 checkbox, else a footnote that names the plan.
4. Buybacks: XBRL cash paid (PaymentsForRepurchaseOfCommonStock and kin) per quarter, the monthly issuer-purchases table of each
   10-Q/10-K, and new authorizations announced in 8-K exhibits (EDGAR full-text search).

SEC: User-Agent with the owner's contact, at most 8 requests a second across threads. A ticker that fails is recorded in
ownership_issues and skipped; the run continues. Off unless OWNERSHIP_DATA_ENABLED=true (service.py).

Usage:
  python3 scripts/research/ownership_data.py run --db .research-private/ownership.sqlite [--job 13f|short|form4|buyback] [--tickers NVDA,MU]
  python3 scripts/research/ownership_data.py report --db .research-private/ownership.sqlite [--tickers NVDA,MU]
"""
from datetime import date, datetime, timedelta, timezone
from html import unescape
from html.parser import HTMLParser
import argparse
import csv
import gzip
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
VALUE_CHECK_FILE = ROOT / 'lib' / 'research' / 'value-check-universe.json'
PROVIDERS_FILE = ROOT / 'lib' / 'research' / 'providers.json'
UNIVERSE_FILE = HERE / 'ownership_universe.json'

SEC_USER_AGENT = 'TechPhaseResearch/1.0 support@techphase.app'
SEC_MIN_INTERVAL = 0.125  # 8 requests a second; SEC allows 10
DATASETS_PAGE = 'https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets'
FINRA_SHORT = 'https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest'
FTS_URL = 'https://efts.sec.gov/LATEST/search-index'
TWELVE_BATCH = 20          # symbols per /quote call (1 credit each)
TWELVE_MAX_USED = 500      # shared 610/min plan: add our TWELVE_BATCH only while this minute stays under 610
FORM4_LOOKBACK_DAYS = 120
FORM4_MAX_PER_RUN = 4000
FILINGS_PER_TICKER = 2     # 10-Q/10-K documents read per ticker the first time
FTS_LOOKBACK_DAYS = 730
INTERVALS = {'form4': 3600, 'short': 6 * 3600, '13f': 24 * 3600, 'buyback': 24 * 3600}
ADS_TITLES = re.compile(r'\bADS\b|\bADR\b|DEPOSITARY|SPONSORED', re.I)

_sec_lock = threading.Lock()
_sec_last = [0.0]


def enabled(env=None):
    env = os.environ if env is None else env
    return (env.get('OWNERSHIP_DATA_ENABLED') or '').strip().lower() == 'true'


def utc_now():
    return datetime.now(timezone.utc)


def iso(moment=None):
    return (moment or utc_now()).isoformat().replace('+00:00', 'Z')


# ---- HTTP -----------------------------------------------------------------------------------------------------------------

def sec_user_agent(env=None):
    env = os.environ if env is None else env
    return (env.get('OWNERSHIP_SEC_USER_AGENT') or '').strip() or SEC_USER_AGENT


def _throttle():
    with _sec_lock:
        wait = _sec_last[0] + SEC_MIN_INTERVAL - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _sec_last[0] = time.monotonic()


def sec_get(url, limit=60_000_000, timeout=60):
    """One SEC request (www.sec.gov, data.sec.gov, efts.sec.gov). Raises RuntimeError('sec-http-<code>') without the URL."""
    for attempt in range(3):
        _throttle()
        request = urllib.request.Request(url, headers={'User-Agent': sec_user_agent(), 'Accept-Encoding': 'gzip'})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read(limit + 1)
                if response.headers.get('Content-Encoding') == 'gzip':
                    body = gzip.decompress(body)
        except urllib.error.HTTPError as error:
            if error.code in (429, 503) and attempt < 2:
                time.sleep(2 + attempt * 3)
                continue
            raise RuntimeError(f'sec-http-{error.code}') from None
        except Exception as error:
            if attempt < 2:
                time.sleep(1)
                continue
            raise RuntimeError(f'sec-{type(error).__name__}') from None
        if len(body) > limit:
            raise RuntimeError('sec-too-large')
        return body
    raise RuntimeError('sec-retries')


def sec_json(url):
    return json.loads(sec_get(url).decode('utf-8'))


def sec_download(url, path):
    _throttle()
    request = urllib.request.Request(url, headers={'User-Agent': sec_user_agent()})
    try:
        with urllib.request.urlopen(request, timeout=600) as response, open(path, 'wb') as out:
            while True:
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'sec-http-{error.code}') from None
    except Exception as error:
        raise RuntimeError(f'sec-{type(error).__name__}') from None


def finra_post(payload, timeout=60):
    request = urllib.request.Request(FINRA_SHORT, data=json.dumps(payload).encode(), method='POST',
                                     headers={'Content-Type': 'application/json', 'Accept': 'application/json',
                                              'User-Agent': 'TechPhaseResearch/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(20_000_001)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'finra-http-{error.code}') from None
    except Exception as error:
        raise RuntimeError(f'finra-{type(error).__name__}') from None
    return json.loads(body.decode('utf-8')) if body.strip() else []


def twelve_get(path, params):
    import price_alerts  # shared Twelve Data client (base URL, key handling, error text without the key)
    return price_alerts._get(path, params)


def twelve_credits_used():
    import price_alerts
    return price_alerts.credits_used(twelve_get)


# ---- universe ------------------------------------------------------------------------------------------------------------

def load_config(path=UNIVERSE_FILE):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def universe(config=None, value_check=VALUE_CHECK_FILE, providers=PROVIDERS_FILE):
    """Value Check ハイテク (its own file when present, else the snapshot here) plus the 22 watched companies."""
    config = config or load_config()
    tech = list(config['tech'])
    try:
        tech = list(json.loads(Path(value_check).read_text(encoding='utf-8'))['tech'])
    except (OSError, ValueError, KeyError, TypeError):
        pass
    watched = [p['ticker'] for p in json.loads(Path(providers).read_text(encoding='utf-8')) if p.get('scope') != 'earnings']
    return sorted(set(tech) | set(watched))


def cik_map(config=None, value_check=VALUE_CHECK_FILE):
    config = config or load_config()
    ciks = {t: int(c) for t, c in config.get('cik', {}).items()}
    try:
        for t, row in json.loads(Path(value_check).read_text(encoding='utf-8'))['companies'].items():
            ciks.setdefault(t, int(row['cik']))
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return ciks


def resolve_ciks(tickers, config=None):
    ciks = cik_map(config)
    missing = [t for t in tickers if t not in ciks]
    if missing:
        try:
            for row in sec_json('https://www.sec.gov/files/company_tickers_exchange.json')['data']:
                ciks.setdefault(row[2], int(row[0]))
        except Exception:
            pass
    return ciks


# ---- storage ---------------------------------------------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS ownership_runs(job TEXT, started_at TEXT, finished_at TEXT, status TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS ownership_issues(job TEXT, ticker TEXT, reason TEXT, recorded_at TEXT, PRIMARY KEY(job, ticker, reason));
CREATE TABLE IF NOT EXISTS ownership_13f_files(name TEXT PRIMARY KEY, period TEXT, processed_at TEXT, filings INTEGER);
CREATE TABLE IF NOT EXISTS ownership_institutional(ticker TEXT, period TEXT, shares_held REAL, holders INTEGER,
  shares_outstanding REAL, outstanding_as_of TEXT, pct REAL, pct_change_pts REAL, holders_change INTEGER,
  source TEXT, computed_at TEXT, PRIMARY KEY(ticker, period));
CREATE TABLE IF NOT EXISTS ownership_shares(ticker TEXT, as_of TEXT, shares REAL, source TEXT, accession TEXT,
  PRIMARY KEY(ticker, as_of, source));
CREATE TABLE IF NOT EXISTS ownership_short(ticker TEXT, settlement_date TEXT, short_shares REAL, previous_short_shares REAL,
  change_shares REAL, change_pct REAL, finra_avg_volume REAL, finra_days_to_cover REAL, avg_volume_20d REAL, days_to_cover REAL,
  shares_outstanding REAL, pct_outstanding REAL, fetched_at TEXT, PRIMARY KEY(ticker, settlement_date));
CREATE TABLE IF NOT EXISTS ownership_form4_seen(accession TEXT PRIMARY KEY, ticker TEXT, filed TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS ownership_insider_trades(accession TEXT, line INTEGER, ticker TEXT, filed TEXT, trade_date TEXT,
  owner_name TEXT, owner_role TEXT, code TEXT, side TEXT, category TEXT, shares REAL, price REAL, value REAL,
  plan_10b5_1 INTEGER, plan_basis TEXT, PRIMARY KEY(accession, line));
CREATE TABLE IF NOT EXISTS ownership_filings(accession TEXT PRIMARY KEY, ticker TEXT, form TEXT, filed TEXT, report_date TEXT,
  document TEXT, parsed_at TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS ownership_buyback_quarters(ticker TEXT, concept TEXT, period_start TEXT, period_end TEXT, value REAL,
  derived INTEGER, form TEXT, filed TEXT, PRIMARY KEY(ticker, concept, period_start, period_end));
CREATE TABLE IF NOT EXISTS ownership_buyback_months(ticker TEXT, accession TEXT, line INTEGER, label TEXT, shares REAL,
  avg_price REAL, program_shares REAL, remaining_usd REAL, is_total INTEGER, PRIMARY KEY(accession, line));
CREATE TABLE IF NOT EXISTS ownership_buyback_remaining(ticker TEXT, as_of TEXT, amount_usd REAL, source TEXT,
  PRIMARY KEY(ticker, as_of, source));
CREATE TABLE IF NOT EXISTS ownership_buyback_authorizations(ticker TEXT, accession TEXT, filed TEXT, amount_usd REAL,
  sentence TEXT, document TEXT, PRIMARY KEY(accession, amount_usd));
CREATE TABLE IF NOT EXISTS ownership_fts_seen(ticker TEXT, document_id TEXT, PRIMARY KEY(ticker, document_id));
"""


def connect(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=30)
    db.executescript(SCHEMA)
    columns = {r[1] for r in db.execute('PRAGMA table_info(ownership_buyback_authorizations)')}
    for name, kind in (('check_status', 'TEXT'), ('market_cap', 'REAL'), ('checked_at', 'TEXT')):
        if name not in columns:  # added Nov 22 (owner: hide an amount above 20% of the market value, keep it for audit)
            db.execute(f'ALTER TABLE ownership_buyback_authorizations ADD COLUMN {name} {kind}')
    return db


def issue(db, job, ticker, reason):
    db.execute('INSERT OR REPLACE INTO ownership_issues VALUES(?,?,?,?)', (job, ticker, str(reason)[:120], iso()))


def clear_issues(db, job, ticker):
    db.execute('DELETE FROM ownership_issues WHERE job=? AND ticker=?', (job, ticker))


def last_success(db, job):
    row = db.execute("SELECT max(finished_at) FROM ownership_runs WHERE job=? AND status='ok'", (job,)).fetchone()
    return row[0] if row else None


# ---- shares outstanding ---------------------------------------------------------------------------------------------------

def cover_shares(html):
    """Sum of dei:EntityCommonStockSharesOutstanding on an inline-XBRL cover (every class), with its date. None when absent."""
    contexts = {m.group(1): m.group(2) for m in re.finditer(
        r'<xbrli:context[^>]*\bid="([^"]+)"[^>]*>.*?<xbrli:instant>\s*(\d{4}-\d{2}-\d{2})\s*</xbrli:instant>', html, re.S | re.I)}
    total, dates, seen = 0.0, set(), set()
    for m in re.finditer(r'<ix:nonFraction\b([^>]*\bname="dei:EntityCommonStockSharesOutstanding"[^>]*)>(.*?)</ix:nonFraction>',
                         html, re.S | re.I):
        attrs, text = m.group(1), re.sub(r'<[^>]+>', '', m.group(2))
        context = re.search(r'contextRef="([^"]+)"', attrs)
        digits = re.sub(r'[^0-9.]', '', text)
        if not digits or not context or context.group(1) in seen:
            continue
        seen.add(context.group(1))
        scale = re.search(r'\bscale="(-?\d+)"', attrs)
        value = float(digits) * 10 ** int(scale.group(1) if scale else 0)
        total += value
        if context.group(1) in contexts:
            dates.add(contexts[context.group(1)])
    if not total:
        return None
    return total, max(dates) if dates else None


def dei_shares(cik):
    """[(as_of, shares, accession)] from XBRL dei (non-dimensional facts only: single-class companies, 20-F/40-F filers)."""
    data = sec_json(f'https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/dei/EntityCommonStockSharesOutstanding.json')
    by_end = {}
    for row in data.get('units', {}).get('shares', []):
        if row.get('end') and isinstance(row.get('val'), (int, float)):
            current = by_end.get(row['end'])
            if current is None or row.get('filed', '') > current[2]:
                by_end[row['end']] = (row['val'], row.get('accn'), row.get('filed', ''))
    return [(end, v[0], v[1]) for end, v in sorted(by_end.items())]


def shares_for(db, ticker, on):
    """Shares outstanding near a date: a cover dated on or after it (within 100 days), else the latest in the 200 days before it.
    None otherwise: a count from another quarter can be on the other side of a stock split."""
    rows = db.execute('SELECT as_of, shares FROM ownership_shares WHERE ticker=? ORDER BY as_of', (ticker,)).fetchall()
    if not rows:
        return None
    target = date.fromisoformat(on)
    after = [r for r in rows if target <= date.fromisoformat(r[0]) <= target + timedelta(days=100)]
    before = [r for r in rows if target - timedelta(days=200) <= date.fromisoformat(r[0]) < target]  # 20-F filers: once a year
    if after and before and not 1 / 1.5 < after[0][1] / before[-1][1] < 1.5:
        # A stock split between the two covers (e.g. CRWD 4-for-1 in July 2026): the cover nearer the date is on its side.
        nearest = min((after[0], before[-1]), key=lambda r: abs((date.fromisoformat(r[0]) - target).days))
        return nearest[1], nearest[0]
    if after:
        return after[0][1], after[0][0]
    return (before[-1][1], before[-1][0]) if before else None


def refresh_dei_shares(db, ticker, cik):
    try:
        points = dei_shares(cik)
    except RuntimeError as error:
        if str(error) != 'sec-http-404':
            raise
        points = []
    for as_of, shares, accession in points[-12:]:
        db.execute('INSERT OR REPLACE INTO ownership_shares VALUES(?,?,?,?,?)', (ticker, as_of, shares, 'dei', accession))
    return len(points)


# ---- 1. institutional ownership (13F data sets) ------------------------------------------------------------------------

def dataset_links(html):
    links = []
    for path in re.findall(r'href="(/files/[^"]*?_form13f\.zip)"', html):
        if path not in links:
            links.append(path)
    return links


def _period(text):
    return datetime.strptime(text.strip(), '%d-%b-%Y').date().isoformat()


def _tsv(zf, name):
    handle = io.TextIOWrapper(zf.open(name), encoding='utf-8', errors='replace', newline='')
    reader = csv.reader(handle, delimiter='\t', quoting=csv.QUOTE_NONE)
    header = next(reader)
    index = {k: i for i, k in enumerate(header)}
    for row in reader:
        if len(row) >= len(header):
            yield {k: row[i] for k, i in index.items()}


def select_filings(zf):
    """Holdings reports for the data set's main quarter: per filer, the latest original 13F-HR (or the latest restatement),
    plus 'new holdings' amendments filed after it. Notices (13F-NT) carry no table."""
    submissions = {}
    periods = {}
    for row in _tsv(zf, 'SUBMISSION.tsv'):
        if not row['SUBMISSIONTYPE'].startswith('13F-HR'):
            continue
        try:
            period = _period(row['PERIODOFREPORT'])
            filed = datetime.strptime(row['FILING_DATE'].strip(), '%d-%b-%Y').date().isoformat()
        except ValueError:
            continue
        submissions[row['ACCESSION_NUMBER']] = (row['CIK'].lstrip('0'), period, filed)
        periods[period] = periods.get(period, 0) + 1
    if not periods:
        return None, set()
    main = max(periods, key=periods.get)
    cover = {}
    for row in _tsv(zf, 'COVERPAGE.tsv'):
        if row['ACCESSION_NUMBER'] in submissions:
            cover[row['ACCESSION_NUMBER']] = (row['ISAMENDMENT'].strip().upper() in ('Y', 'TRUE', '1'),
                                              row['AMENDMENTTYPE'].strip().upper(), row['REPORTTYPE'].strip().upper())
    by_filer = {}
    for accession, (cik, period, filed) in submissions.items():
        if period != main or accession not in cover or 'NOTICE' in cover[accession][2]:
            continue
        by_filer.setdefault(cik, []).append((filed, accession) + cover[accession][:2])
    chosen = set()
    for cik, rows in by_filer.items():
        rows.sort()
        restatements = [r for r in rows if r[2] and 'RESTATEMENT' in r[3]]
        originals = [r for r in rows if not r[2]]
        base = (restatements or originals or [None])[-1]
        if base is None:
            continue
        chosen.add(base[1])
        chosen.update(r[1] for r in rows if r[2] and 'NEW HOLDINGS' in r[3] and r[0] >= base[0])
    return main, {a: submissions[a][0] for a in chosen}


def aggregate_holdings(zf, accessions, cusips):
    """{ticker: (shares, holders)}; SH rows only, puts/calls excluded (Capital Map's 13F rules)."""
    ticker_of = {c.upper(): t for t, values in cusips.items() for c in values}
    shares, holders = {}, {}
    for row in _tsv(zf, 'INFOTABLE.tsv'):
        ticker = ticker_of.get(row['CUSIP'].strip().upper())
        if ticker is None or row['SSHPRNAMTTYPE'].strip() != 'SH' or row['PUTCALL'].strip():
            continue
        cik = accessions.get(row['ACCESSION_NUMBER'])
        if cik is None:
            continue
        try:
            amount = float(row['SSHPRNAMT'])
        except ValueError:
            continue
        if amount <= 0:
            continue
        shares[ticker] = shares.get(ticker, 0) + amount
        holders.setdefault(ticker, set()).add(cik)
    return {t: (shares[t], len(holders[t])) for t in shares}


def store_institutional(db, period, totals, tickers, config, source):
    ads = config.get('adsShares', {})
    for ticker in tickers:
        if ticker not in config['cusips']:
            issue(db, '13f', ticker, 'no-13f-cusip')
            continue
        if ticker not in totals:
            issue(db, '13f', ticker, f'no-13f-rows-{period}')
            continue
        held, count = totals[ticker]
        outstanding = shares_for(db, ticker, period)
        pct = None
        if outstanding:
            pct = round(held * ads.get(ticker, 1) / outstanding[0] * 100, 2)
        else:
            issue(db, '13f', ticker, 'no-shares-outstanding')
        previous = db.execute('SELECT pct, holders FROM ownership_institutional WHERE ticker=? AND period<? ORDER BY period DESC LIMIT 1',
                              (ticker, period)).fetchone()
        change = round(pct - previous[0], 2) if previous and previous[0] is not None and pct is not None else None
        db.execute('INSERT OR REPLACE INTO ownership_institutional VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                   (ticker, period, held, count, outstanding[0] if outstanding else None, outstanding[1] if outstanding else None,
                    pct, change, count - previous[1] if previous else None, source, iso()))
        later = db.execute('SELECT period, pct, holders FROM ownership_institutional WHERE ticker=? AND period>? ORDER BY period LIMIT 1',
                           (ticker, period)).fetchone()
        if later:  # an older quarter filled in after the newer one: refresh the newer one's change
            db.execute('UPDATE ownership_institutional SET pct_change_pts=?, holders_change=? WHERE ticker=? AND period=?',
                       (round(later[1] - pct, 2) if later[1] is not None and pct is not None else None, later[2] - count, ticker, later[0]))


def period_cover(db, ticker, cik, period):
    end = (date.fromisoformat(period) + timedelta(days=100)).isoformat()
    row = db.execute("SELECT accession, document FROM ownership_filings WHERE ticker=? AND form IN ('10-Q','10-K') AND filed>? AND filed<=? "
                     "ORDER BY filed LIMIT 1", (ticker, period, end)).fetchone()
    if not row:
        return None
    html = sec_get(f'https://www.sec.gov/Archives/edgar/data/{cik}/{row[0].replace("-", "")}/{row[1]}', limit=40_000_000).decode('utf-8', 'replace')
    cover = cover_shares(html)
    if cover and cover[1]:
        db.execute('INSERT OR REPLACE INTO ownership_shares VALUES(?,?,?,?,?)', (ticker, cover[1], cover[0], 'cover', row[0]))
    return cover


def run_13f(db, tickers, config, ciks, files=2, stop_event=None):
    links = dataset_links(sec_get(DATASETS_PAGE).decode('utf-8', 'replace'))
    if not links:
        raise RuntimeError('13f-no-dataset-links')
    ensure_shares(db, tickers, ciks, stop_event=stop_event)
    done = []
    for path in reversed(links[:files]):  # older first, so each quarter's change finds its predecessor
        name = path.rsplit('/', 1)[-1]
        if db.execute('SELECT 1 FROM ownership_13f_files WHERE name=?', (name,)).fetchone():
            continue
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / name
            sec_download('https://www.sec.gov' + path, target)
            with zipfile.ZipFile(target) as zf:
                period, accessions = select_filings(zf)
                if period is None:
                    raise RuntimeError('13f-empty-dataset')
                totals = aggregate_holdings(zf, accessions, config['cusips'])
        for ticker in tickers:  # an older quarter needs its own share count (XBRL dei history)
            if ticker in ciks and shares_for(db, ticker, period) is None:
                try:
                    refresh_dei_shares(db, ticker, ciks[ticker])
                    if shares_for(db, ticker, period) is None:  # several share classes: read the next 10-Q/10-K cover
                        period_cover(db, ticker, ciks[ticker], period)
                except Exception as error:
                    issue(db, 'shares', ticker, str(error))
        store_institutional(db, period, totals, tickers, config, name)
        db.execute('INSERT OR REPLACE INTO ownership_13f_files VALUES(?,?,?,?)', (name, period, iso(), len(accessions)))
        db.commit()
        done.append(f'{name}:{period}:{len(accessions)}')
    return ','.join(done) or 'no-new-dataset'


def ensure_shares(db, tickers, ciks, stop_event=None, max_age_days=7):
    """dei shares for tickers without a recent cover value (10-Q/10-K covers are added by the buyback job)."""
    for ticker in tickers:
        if stop_event is not None and stop_event.is_set():
            return
        recent = db.execute('SELECT max(as_of) FROM ownership_shares WHERE ticker=?', (ticker,)).fetchone()[0]
        if recent and date.fromisoformat(recent) >= date.today() - timedelta(days=max_age_days + 100):
            continue
        if ticker not in ciks:
            issue(db, 'shares', ticker, 'no-cik')
            continue
        try:
            if not refresh_dei_shares(db, ticker, ciks[ticker]):
                issue(db, 'shares', ticker, 'no-dei-shares')
        except Exception as error:
            issue(db, 'shares', ticker, str(error))
    db.commit()


# ---- 2. short interest (FINRA) -----------------------------------------------------------------------------------------

def latest_settlement(probe='NVDA', today=None):
    today = today or date.today()
    rows = finra_post({'limit': 20, 'fields': ['settlementDate'],
                       'compareFilters': [{'compareType': 'equal', 'fieldName': 'symbolCode', 'fieldValue': probe}],
                       'dateRangeFilters': [{'fieldName': 'settlementDate', 'startDate': (today - timedelta(days=75)).isoformat(),
                                             'endDate': today.isoformat()}]})
    dates = sorted(r['settlementDate'] for r in rows if r.get('settlementDate'))
    return dates[-1] if dates else None


def short_rows(tickers, settlement):
    found = {}
    for start in range(0, len(tickers), 100):
        chunk = tickers[start:start + 100]
        rows = finra_post({'limit': 1000, 'domainFilters': [{'fieldName': 'symbolCode', 'values': chunk}],
                           'compareFilters': [{'compareType': 'equal', 'fieldName': 'settlementDate', 'fieldValue': settlement}]})
        for row in rows:
            found[row.get('symbolCode')] = row
    return found


def average_volumes(tickers, settlement, stop_event=None, wait=60):
    """20-day average volume per ticker from Twelve Data /quote, TWELVE_BATCH symbols a minute; split-adjusted back to the
    settlement date's share count (Twelve Data restates history after a split)."""
    import stock_splits
    splits = stock_splits.known_splits()
    volumes = {}
    for start in range(0, len(tickers), TWELVE_BATCH):
        if start:
            if stop_event is not None:
                if stop_event.wait(wait):
                    break
            else:
                time.sleep(wait)
        for _ in range(5):  # the plan is shared: wait for a quieter minute, then leave the rest to the next run
            used = twelve_credits_used()
            if used is None or used <= TWELVE_MAX_USED:
                break
            if stop_event.wait(wait) if stop_event is not None else time.sleep(wait):
                return volumes
        else:
            continue
        chunk = tickers[start:start + TWELVE_BATCH]
        body = twelve_get('quote', {'symbol': ','.join(chunk), 'volume_time_period': 20})
        if len(chunk) == 1 and isinstance(body, dict) and 'symbol' in body:
            body = {chunk[0]: body}
        for ticker in chunk:
            raw = body.get(ticker) if isinstance(body, dict) else None
            try:
                value = float(raw['average_volume'])
            except (TypeError, KeyError, ValueError):
                continue
            for split_ticker, split_day, ratio in splits:
                if split_ticker == ticker and settlement < split_day.isoformat() <= date.today().isoformat():
                    value /= ratio
            if value > 0:
                volumes[ticker] = value
    return volumes


def fill_volumes(db, settlement, stop_event=None):
    """Days to cover for rows stored while the shared Twelve Data plan was busy."""
    missing = [r[0] for r in db.execute('SELECT ticker FROM ownership_short WHERE settlement_date=? AND avg_volume_20d IS NULL',
                                        (settlement,))]
    if not missing:
        return 'volume=complete'
    filled = 0
    for start in range(0, len(missing), TWELVE_BATCH):
        if start and (stop_event.wait(60) if stop_event is not None else time.sleep(60)):
            break
        volumes = average_volumes(missing[start:start + TWELVE_BATCH], settlement, stop_event=stop_event)
        for ticker, volume in volumes.items():
            db.execute('UPDATE ownership_short SET avg_volume_20d=?, days_to_cover=round(short_shares/?, 2) WHERE ticker=? AND settlement_date=?',
                       (volume, volume, ticker, settlement))
            db.execute("DELETE FROM ownership_issues WHERE job='short' AND ticker=? AND reason='no-twelve-average-volume'", (ticker,))
        db.commit()  # each batch is kept even if a later one waits out a busy plan
        filled += len(volumes)
    return f'volume+={filled}/{len(missing)}'


def run_short(db, tickers, config, ciks, stop_event=None, twelve=True):
    settlement = latest_settlement()
    if settlement is None:
        raise RuntimeError('finra-no-settlement')
    have = db.execute('SELECT count(*) FROM ownership_short WHERE settlement_date=?', (settlement,)).fetchone()[0]
    if have and have >= len(tickers) - 10:
        return f'{settlement}:already:' + fill_volumes(db, settlement, stop_event=stop_event) if twelve else f'{settlement}:already'
    ensure_shares(db, tickers, ciks, stop_event=stop_event)
    rows = short_rows(tickers, settlement)
    volumes = {}
    if twelve:
        try:
            volumes = average_volumes(sorted(rows), settlement, stop_event=stop_event)
        except Exception as error:
            issue(db, 'short', '*', f'twelve-data-{type(error).__name__}')
    for ticker in tickers:
        row = rows.get(ticker)
        if row is None:
            issue(db, 'short', ticker, 'not-in-finra')
            continue
        clear_issues(db, 'short', ticker)
        short, previous = row.get('currentShortPositionQuantity'), row.get('previousShortPositionQuantity')
        outstanding = shares_for(db, ticker, settlement)
        ads = config.get('adsShares', {}).get(ticker, 1)
        volume = volumes.get(ticker)
        db.execute('INSERT OR REPLACE INTO ownership_short VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                   (ticker, settlement, short, previous, row.get('changePreviousNumber'), row.get('changePercent'),
                    row.get('averageDailyVolumeQuantity'), row.get('daysToCoverQuantity'), volume,
                    round(short / volume, 2) if short is not None and volume else None,
                    outstanding[0] if outstanding else None,
                    round(short * ads / outstanding[0] * 100, 2) if short is not None and outstanding else None, iso()))
        if twelve and not volume:
            issue(db, 'short', ticker, 'no-twelve-average-volume')
    db.commit()
    return f'{settlement}:{len(rows)}/{len(tickers)}:volume={len(volumes)}'


# ---- 3. insider trades (Form 4) ----------------------------------------------------------------------------------------

def _text(node, path):
    found = node.find(path)
    if found is None:
        return None
    value = (found.findtext('value') if found.find('value') is not None else found.text) or ''
    return value.strip() or None


def _number(text):
    try:
        return float(text) if text is not None else None
    except ValueError:
        return None


def parse_form4(xml_bytes):
    """[{...}] transaction rows (non-derivative table only: shares of the stock itself)."""
    root = ET.fromstring(xml_bytes)
    footnotes = {f.get('id'): ' '.join(''.join(f.itertext()).split()) for f in root.iter('footnote')}
    plan_flag = (root.findtext('aff10b5One') or '').strip().lower()
    names, roles = [], []
    for owner in root.findall('reportingOwner'):
        names.append((owner.findtext('reportingOwnerId/rptOwnerName') or '').strip())
        rel = owner.find('reportingOwnerRelationship')
        if rel is None:
            continue
        flag = lambda key: (rel.findtext(key) or '').strip().lower() in ('1', 'true')
        if flag('isOfficer'):
            roles.append((rel.findtext('officerTitle') or 'Officer').strip())
        if flag('isDirector'):
            roles.append('Director')
        if flag('isTenPercentOwner'):
            roles.append('10% Owner')
        if flag('isOther'):
            roles.append((rel.findtext('otherText') or 'Other').strip())
    rows = []
    for line, tx in enumerate(root.findall('nonDerivativeTable/nonDerivativeTransaction')):
        code = _text(tx, 'transactionCoding/transactionCode')
        shares = _number(_text(tx, 'transactionAmounts/transactionShares'))
        price = _number(_text(tx, 'transactionAmounts/transactionPricePerShare'))
        notes = ' '.join(footnotes.get(f.get('id'), '') for f in tx.iter('footnoteId'))
        if plan_flag in ('1', 'true'):
            plan, basis = 1, 'checkbox'
        elif re.search(r'10b5-?1', notes, re.I):
            plan, basis = 1, 'footnote'
        elif plan_flag in ('0', 'false'):
            plan, basis = 0, 'checkbox'
        else:
            plan, basis = None, None
        rows.append({'line': line, 'trade_date': (_text(tx, 'transactionDate') or '')[:10] or None, 'code': code,
                     'side': {'A': 'buy', 'D': 'sell'}.get(_text(tx, 'transactionAmounts/transactionAcquiredDisposedCode') or ''),
                     'category': 'open-market' if code in ('P', 'S') else 'other', 'shares': shares, 'price': price,
                     'value': round(shares * price, 2) if shares is not None and price else None,
                     'owner_name': ' / '.join(n for n in names if n), 'owner_role': ', '.join(dict.fromkeys(roles)),
                     'plan_10b5_1': plan, 'plan_basis': basis,
                     'issuer_symbol': (root.findtext('issuer/issuerTradingSymbol') or '').strip().upper()})
    return rows


def recent_filings(submissions):
    recent = submissions.get('filings', {}).get('recent', {})
    keys = ('form', 'accessionNumber', 'filingDate', 'reportDate', 'primaryDocument')
    return [dict(zip(keys, values)) for values in zip(*(recent.get(k, []) for k in keys))]


def run_form4(db, tickers, config, ciks, stop_event=None, lookback_days=FORM4_LOOKBACK_DAYS, max_fetch=FORM4_MAX_PER_RUN):
    since = (date.today() - timedelta(days=lookback_days)).isoformat()
    fetched = stored = 0
    for ticker in tickers:
        if stop_event is not None and stop_event.is_set():
            break
        cik = ciks.get(ticker)
        if cik is None:
            issue(db, 'form4', ticker, 'no-cik')
            continue
        try:
            filings = recent_filings(sec_json(f'https://data.sec.gov/submissions/CIK{cik:010d}.json'))
        except Exception as error:
            issue(db, 'form4', ticker, f'submissions-{error}')
            continue
        clear_issues(db, 'form4', ticker)
        for f in filings:  # periodic reports for the buyback job
            if f['form'] in ('10-Q', '10-K', '20-F', '40-F', '10-K/A') and f['primaryDocument']:
                db.execute('INSERT OR IGNORE INTO ownership_filings VALUES(?,?,?,?,?,?,NULL,NULL)',
                           (f['accessionNumber'], ticker, f['form'], f['filingDate'], f['reportDate'], f['primaryDocument']))
        for f in filings:
            if f['form'] not in ('4', '4/A') or f['filingDate'] < since or fetched >= max_fetch:
                continue
            if db.execute('SELECT 1 FROM ownership_form4_seen WHERE accession=?', (f['accessionNumber'],)).fetchone():
                continue
            document = f['primaryDocument'].rsplit('/', 1)[-1]
            url = f'https://www.sec.gov/Archives/edgar/data/{cik}/{f["accessionNumber"].replace("-", "")}/{document}'
            fetched += 1
            try:
                rows = parse_form4(sec_get(url, limit=5_000_000))
                status = 'ok'
            except Exception as error:
                rows, status = [], f'failed-{str(error)[:40]}'
            for row in rows:
                if row['issuer_symbol'] and row['issuer_symbol'] != ticker and ticker not in row['issuer_symbol'].split():
                    continue  # another issuer's form filed under a related CIK
                db.execute('INSERT OR REPLACE INTO ownership_insider_trades VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (f['accessionNumber'], row['line'], ticker, f['filingDate'], row['trade_date'], row['owner_name'],
                            row['owner_role'], row['code'], row['side'], row['category'], row['shares'], row['price'],
                            row['value'], row['plan_10b5_1'], row['plan_basis']))
                stored += 1
            db.execute('INSERT OR REPLACE INTO ownership_form4_seen VALUES(?,?,?,?)', (f['accessionNumber'], ticker, f['filingDate'], status))
        db.commit()
    return f'fetched={fetched}:rows={stored}'


# ---- 4. buybacks -------------------------------------------------------------------------------------------------------

CONCEPTS = (('us-gaap', 'PaymentsForRepurchaseOfCommonStock', 'USD'), ('us-gaap', 'PaymentsForRepurchaseOfEquity', 'USD'),
            ('us-gaap', 'StockRepurchasedDuringPeriodShares', 'shares'), ('us-gaap', 'TreasuryStockSharesAcquired', 'shares'),
            ('us-gaap', 'StockRepurchaseProgramRemainingAuthorizedRepurchaseAmount1', 'USD'),
            ('ifrs-full', 'PaymentsToAcquireOrRedeemEntitysShares', None))


def quarterly(facts):
    """Quarterly values from XBRL duration facts: 3-month facts as given, others by differencing year-to-date facts that share a start."""
    latest = {}
    for f in facts:
        if not f.get('start') or not f.get('end') or not isinstance(f.get('val'), (int, float)):
            continue
        key = (f['start'], f['end'])
        if key not in latest or f.get('filed', '') > latest[key].get('filed', ''):
            latest[key] = f
    out = {}
    for (start, end), f in latest.items():
        days = (date.fromisoformat(end) - date.fromisoformat(start)).days
        if 80 <= days <= 100:
            out[(start, end)] = (f['val'], 0, f.get('form'), f.get('filed'))
    by_start = {}
    for (start, end), f in latest.items():
        by_start.setdefault(start, []).append((end, f))
    for start, rows in by_start.items():
        rows.sort()
        for (end_a, a), (end_b, b) in zip(rows, rows[1:]):
            days = (date.fromisoformat(end_b) - date.fromisoformat(end_a)).days
            q_start = (date.fromisoformat(end_a) + timedelta(days=1)).isoformat()
            if 80 <= days <= 100 and not any(k[1] == end_b and 80 <= (date.fromisoformat(end_b) - date.fromisoformat(k[0])).days <= 100 for k in out):
                out[(q_start, end_b)] = (b['val'] - a['val'], 1, b.get('form'), b.get('filed'))
    return out


def run_xbrl_buybacks(db, ticker, cik):
    found = 0
    for taxonomy, concept, unit in CONCEPTS:
        try:
            data = sec_json(f'https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/{taxonomy}/{concept}.json')
        except RuntimeError as error:
            if str(error) == 'sec-http-404':
                continue
            raise
        units = data.get('units', {})
        facts = units.get(unit) if unit else next(iter(units.values()), [])
        if not facts:
            continue
        found += 1
        if concept.startswith('StockRepurchaseProgramRemaining'):
            for f in facts[-8:]:
                if f.get('end') and isinstance(f.get('val'), (int, float)):
                    db.execute('INSERT OR REPLACE INTO ownership_buyback_remaining VALUES(?,?,?,?)', (ticker, f['end'], f['val'], 'xbrl'))
            continue
        for (start, end), (value, derived, form, filed) in quarterly(facts).items():
            if end >= (date.today() - timedelta(days=3 * 366)).isoformat():
                db.execute('INSERT OR REPLACE INTO ownership_buyback_quarters VALUES(?,?,?,?,?,?,?,?)',
                           (ticker, concept, start, end, value, derived, form, filed))
    return found


class _Rows(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = []
        elif tag == 'br' and self.cell is not None:
            self.cell.append(' ')

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.row is not None and self.cell is not None:
            self.row.append(' '.join(''.join(self.cell).split()))
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


MONTHS = r'(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?'
HEADING = re.compile(r'issuer\s+purchases\s+of\s+equity\s+securities|purchases\s+of\s+equity\s+securities\s+by\s+the\s+issuer|'
                     r'repurchases?\s+of\s+(?:our\s+)?(?:common\s+stock|equity\s+securities)|'
                     r'unregistered\s+sales\s+of\s+equity\s+securities(?:\s+and\s+use\s+of\s+proceeds)?|'
                     r'(?:stock|share)\s+repurchase\s+program', re.I)


def _cell_value(text):
    text = re.sub(r'\(\s*\d\s*\)|\$|\s', '', text)
    if text in ('—', '–', '-', '—', '-0-'):
        return 0.0
    if re.fullmatch(r'\(?\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?|\d+(?:\.\d+)?', text):
        return float(text.strip('()').replace(',', ''))
    return None


def _scale(cells, words, avoid=None):
    """Unit of one column from its own header cell ('(In millions)'), never from a neighbouring column's."""
    for cell in cells:
        if re.search(words, cell, re.I) and not (avoid and re.search(avoid, cell, re.I)):
            unit = re.search(r'\bin (thousands|millions|billions)\b', cell, re.I)
            if unit:
                return {'thousands': 1e3, 'millions': 1e6, 'billions': 1e9}[unit.group(1).lower()]
    return None


def parse_purchase_table(html):
    """Monthly rows of the 'Issuer Purchases of Equity Securities' table: [(label, shares, avg_price, program_shares, remaining, total)]."""
    for heading in HEADING.finditer(html):
        start = html.find('<table', heading.end())
        if start < 0 or start - heading.end() > 20000:
            continue
        end = html.find('</table>', start)
        parser = _Rows()
        parser.feed(html[start:end + 8])
        header, rows = [], []
        for cells in parser.rows:
            texts = [c for c in cells if c]
            if not texts:
                continue
            label = texts[0]
            values = [v for v in (_cell_value(c) for c in texts[1:]) if v is not None]
            is_month = re.search(rf'\b{MONTHS}\b|\d{{1,2}}/\d{{1,2}}/\d{{2,4}}|month\s*#?\d|period\s*\d', label, re.I)
            is_total = re.match(r'total', label, re.I)
            if (is_month or is_total) and len(values) >= 2 and _cell_value(label) is None:
                rows.append((label, values, bool(is_total)))
            elif rows and not rows[-1][2] and _cell_value(label) is not None:  # an unlabeled total row under the months
                rows.append(('Total', [v for v in (_cell_value(c) for c in texts) if v is not None], True))
            elif not rows:
                header.extend(texts)
        if not rows or not re.search(r'average\s+price|price\s+paid', html_text(html[heading.start():end]), re.I):
            continue  # only the issuer-purchases table states an average price paid per share
        overall = 1e6 if re.search(r'in millions, except per', ' '.join(header), re.I) else 1
        shares_scale = _scale(header, r'shares\s+purchased|number\s+of\s+shares', r'may\s+yet|dollar\s+value') or overall
        remaining_scale = _scale(header, r'may\s+yet|dollar\s+value|remaining') or overall
        out = []
        for label, values, total in rows:
            shares = round(values[0] * shares_scale)
            if total:  # the total row leaves the average price blank: keep shares and the program column only
                remaining = values[3] * remaining_scale if len(values) > 3 else None
                out.append((label[:80], shares, None, round(values[2] * shares_scale) if len(values) > 2 else None, remaining, True))
                continue
            price = values[1]
            program = round(values[2] * shares_scale) if len(values) > 2 else None
            remaining = values[3] * remaining_scale if len(values) > 3 else None
            if not 0 < price < 100000 and shares:
                break
            out.append((label[:80], shares, price if shares else None, program, remaining, False))
        else:
            if out:
                return out
    return []


def run_tables(db, ticker, cik, per_ticker=FILINGS_PER_TICKER):
    pending = db.execute("SELECT accession, form, filed, document, report_date FROM ownership_filings WHERE ticker=? AND parsed_at IS NULL "
                         "ORDER BY filed DESC LIMIT ?", (ticker, per_ticker)).fetchall()
    parsed = 0
    for accession, form, filed, document, report_date in pending:
        url = f'https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace("-", "")}/{document}'
        status = 'ok'
        try:
            html = sec_get(url, limit=40_000_000).decode('utf-8', 'replace')
            cover = cover_shares(html)
            if cover:
                db.execute('INSERT OR REPLACE INTO ownership_shares VALUES(?,?,?,?,?)',
                           (ticker, cover[1] or filed, cover[0], 'cover', accession))
            rows = parse_purchase_table(html) if form in ('10-Q', '10-K', '10-K/A') else []
            if not rows:
                status = 'no-purchase-table'
            for line, (label, shares, price, program, remaining, total) in enumerate(rows):
                db.execute('INSERT OR REPLACE INTO ownership_buyback_months VALUES(?,?,?,?,?,?,?,?,?)',
                           (ticker, accession, line, label, shares, price, program, remaining, int(total)))
            table_remaining = [r[4] for r in rows if r[4] is not None]
            prose = remaining_from_text(html_text(html)) if form in ('10-Q', '10-K', '10-K/A') else None
            if report_date and (table_remaining or prose):
                db.execute('INSERT OR REPLACE INTO ownership_buyback_remaining VALUES(?,?,?,?)',
                           (ticker, report_date, table_remaining[-1] if table_remaining else prose, 'table' if table_remaining else 'text'))
            parsed += bool(rows)
        except Exception as error:
            status = f'failed-{str(error)[:40]}'
        db.execute('UPDATE ownership_filings SET parsed_at=?, status=? WHERE accession=?', (iso(), status, accession))
    # older unparsed filings are not read later: mark them so the queue stays at the newest documents
    db.execute("UPDATE ownership_filings SET parsed_at=?, status='skipped-old' WHERE ticker=? AND parsed_at IS NULL", (iso(), ticker))
    return parsed, len(pending)


def remaining_from_text(text):
    """'$2.16 billion of the 2018 authorization remained available' style sentences in a 10-Q/10-K; the last one wins."""
    found = None
    for m in re.finditer(r'\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(billion|million)\b[^.$]{0,120}?\b(?:remained|remains|remaining)\s+'
                         r'(?:available|authorized|for\s+(?:future\s+)?repurchase)', text, re.I):
        context = text[max(0, m.start() - 300):m.end()]
        if REPURCHASE.search(context):
            found = float(m.group(1).replace(',', '')) * (1e9 if m.group(2).lower() == 'billion' else 1e6)
    return found


REPURCHASE = re.compile(r'repurchase|buy[- ]?back', re.I)
NOT_NEW = re.compile(r'\bremain(?:ing|ed|s)?\b|\bavailable\b|\bleft\b|\bunused\b|\bcompleted\b|\bexhausted\b', re.I)
AMOUNT = re.compile(r'\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(billion|million)\b', re.I)


def html_text(html):
    html = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', html)
    return ' '.join(unescape(re.sub(r'<[^>]+>', ' ', html)).split())


EVENT_DATE = re.compile(r'\b(?:on|in|as of)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)'
                        r'(?:\s+\d{1,2},)?\s+20\d{2})', re.I)
AUTH_THEN_AMOUNT = re.compile(r'\b(?:authoriz|approv)\w*\b[^.]{0,200}?\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(billion|million)\b', re.I)
NOT_AUTHORIZATION = re.compile(r'\bextension\b|\bextend(?:ed|s)?\b|\bexecuted\b|\breturned\b|\bsince\s+(?:inception|20\d{2})', re.I)


def _event_date(sentence):
    m = EVENT_DATE.search(sentence)
    if not m:
        return None
    for layout in ('%B %d, %Y', '%B %Y'):
        try:
            return datetime.strptime(' '.join(m.group(1).split()), layout).date()
        except ValueError:
            continue
    return None


def authorization_sentences(text, filed=None):
    """(amount, sentence) for a board authorizing or approving a repurchase amount; the amount must follow the verb. A sentence
    that dates its approval more than 120 days before the filing is an old program restated, not a new one."""
    out = []
    filed_day = date.fromisoformat(filed) if filed else None
    for sentence in re.split(r'(?<=[.;])\s+(?=[A-Z“"])|\s[•●▪]\s', text):
        if len(sentence) > 600 or not REPURCHASE.search(sentence) or NOT_NEW.search(sentence) or NOT_AUTHORIZATION.search(sentence):
            continue
        if not re.search(r'\bboard\b|\bdirectors\b', sentence, re.I):
            continue
        amount = AUTH_THEN_AMOUNT.search(sentence)
        if not amount:
            continue
        when = _event_date(sentence)
        if filed_day and when and (filed_day - when).days > 120:
            continue
        value = float(amount.group(1).replace(',', '')) * (1e9 if amount.group(2).lower() == 'billion' else 1e6)
        out.append((value, sentence.strip()))
    return out


def run_authorizations(db, ticker, cik, lookback_days=FTS_LOOKBACK_DAYS, max_docs=12):
    start = (date.today() - timedelta(days=lookback_days)).isoformat()
    query = urllib.parse.urlencode({'q': 'repurchase', 'forms': '8-K', 'ciks': f'{cik:010d}',
                                    'dateRange': 'custom', 'startdt': start, 'enddt': date.today().isoformat()})
    hits = sec_json(f'{FTS_URL}?{query}').get('hits', {}).get('hits', [])
    found = 0
    for hit in hits[:max_docs]:
        doc_id = hit.get('_id', '')
        source = hit.get('_source', {})
        if ':' not in doc_id or db.execute('SELECT 1 FROM ownership_fts_seen WHERE ticker=? AND document_id=?', (ticker, doc_id)).fetchone():
            continue
        accession, filename = doc_id.split(':', 1)
        url = f'https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace("-", "")}/{filename}'
        text = html_text(sec_get(url, limit=10_000_000).decode('utf-8', 'replace'))
        for amount, sentence in authorization_sentences(text, source.get('file_date')):
            db.execute('INSERT OR REPLACE INTO ownership_buyback_authorizations(ticker, accession, filed, amount_usd, sentence, document) VALUES(?,?,?,?,?,?)',
                       (ticker, accession, source.get('file_date'), amount, sentence[:600], url))
            found += 1
        db.execute('INSERT OR IGNORE INTO ownership_fts_seen VALUES(?,?)', (ticker, doc_id))
    return found


SUSPECT_SHARE = 0.20  # owner, Nov 22: a "new authorization" above 20% of the market value is not shown (kept, flagged)


def value_check_closes(db):
    """{ticker: (day, close)} from the 割安判別ツール's own closes (value-check.sqlite beside this database); no provider call."""
    main = next((r[2] for r in db.execute('PRAGMA database_list') if r[1] == 'main'), '')
    path = Path(main).with_name('value-check.sqlite') if main else None
    if not path or not path.exists():
        return {}
    other = sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=30)
    try:
        rows = other.execute('SELECT c.ticker, c.day, c.raw FROM value_check_closes c JOIN (SELECT ticker, max(day) AS day FROM value_check_closes '
                             'GROUP BY ticker) m ON c.ticker=m.ticker AND c.day=m.day').fetchall()
    except sqlite3.Error:
        rows = []
    finally:
        other.close()
    return {t: (d, p) for t, d, p in rows if p and p > 0}


def quote_closes(tickers, stop_event=None):
    """Fallback for tickers the value check has no close for: one batched Twelve Data /quote per TWELVE_BATCH tickers (1 credit each)."""
    closes = {}
    for start in range(0, len(tickers), TWELVE_BATCH):
        if start and (stop_event.wait(60) if stop_event is not None else time.sleep(60)):
            break
        used = twelve_credits_used()
        if used is not None and used > TWELVE_MAX_USED:
            continue
        chunk = tickers[start:start + TWELVE_BATCH]
        body = twelve_get('quote', {'symbol': ','.join(chunk)})
        if len(chunk) == 1 and isinstance(body, dict) and 'symbol' in body:
            body = {chunk[0]: body}
        for ticker in chunk:
            raw = body.get(ticker) if isinstance(body, dict) else None
            try:
                price = float(raw['close'])
            except (TypeError, KeyError, ValueError):
                continue
            if price > 0:
                closes[ticker] = (str(raw.get('datetime') or '')[:10], price)
    return closes


def check_authorizations(db, config, stop_event=None, closes=None, allow_quotes=True):
    """Market value = shares outstanding (10-Q/10-K cover or XBRL dei) × latest close. An amount above SUSPECT_SHARE of it is
    marked 'suspect-amount' and not shown; 'unchecked' when the market value cannot be formed (shown, as before)."""
    pending = [r[0] for r in db.execute('SELECT DISTINCT ticker FROM ownership_buyback_authorizations WHERE check_status IS NULL')]
    if not pending:
        return 0
    closes = dict(closes if closes is not None else value_check_closes(db))
    missing = [t for t in pending if t not in closes]
    if missing and allow_quotes:
        try:
            closes.update(quote_closes(missing, stop_event=stop_event))
        except Exception as error:
            issue(db, 'buyback', '*', f'quote-{type(error).__name__}')
    ads = config.get('adsShares', {})
    flagged = 0
    for ticker in pending:
        shares = shares_for(db, ticker, date.today().isoformat())
        close = closes.get(ticker)
        cap = shares[0] * close[1] / ads.get(ticker, 1) if shares and close else None
        if cap is not None:  # a split between the share count and the close (SNDK 8-for-1 on 2026-11-20): count in post-split shares
            import stock_splits
            for split_ticker, split_day, ratio in stock_splits.known_splits():
                if split_ticker == ticker and shares[1] < split_day.isoformat() <= (close[0] or date.today().isoformat()):
                    cap *= ratio
        for rowid, amount in db.execute('SELECT rowid, amount_usd FROM ownership_buyback_authorizations WHERE ticker=? AND check_status IS NULL',
                                        (ticker,)).fetchall():
            status = 'unchecked' if cap is None else 'suspect-amount' if amount > SUSPECT_SHARE * cap else 'ok'
            flagged += status == 'suspect-amount'
            db.execute('UPDATE ownership_buyback_authorizations SET check_status=?, market_cap=?, checked_at=? WHERE rowid=?',
                       (status, cap, iso(), rowid))
    db.commit()
    return flagged


def run_buyback(db, tickers, config, ciks, stop_event=None):
    counts = {'xbrl': 0, 'tables': 0, 'authorizations': 0}
    for ticker in tickers:
        if stop_event is not None and stop_event.is_set():
            break
        cik = ciks.get(ticker)
        if cik is None:
            issue(db, 'buyback', ticker, 'no-cik')
            continue
        for part, work in (('xbrl', lambda: run_xbrl_buybacks(db, ticker, cik)),
                           ('tables', lambda: run_tables(db, ticker, cik)[0]),
                           ('authorizations', lambda: run_authorizations(db, ticker, cik))):
            try:
                value = work()
                counts[part] += 1 if value else 0
                if not value:
                    issue(db, 'buyback', ticker, f'{part}-none')
                else:
                    db.execute('DELETE FROM ownership_issues WHERE job=? AND ticker=? AND reason=?', ('buyback', ticker, f'{part}-none'))
            except Exception as error:
                issue(db, 'buyback', ticker, f'{part}-{error}')
        db.commit()
    try:
        counts['suspect'] = check_authorizations(db, config, stop_event=stop_event)
    except Exception as error:
        issue(db, 'buyback', '*', f'check-{type(error).__name__}')
    return ','.join(f'{k}={v}' for k, v in counts.items())


# ---- orchestration --------------------------------------------------------------------------------------------------------

JOBS = {'form4': run_form4, 'buyback': run_buyback, 'short': run_short, '13f': run_13f}


def run_job(db, job, tickers=None, stop_event=None, **options):
    config = load_config()
    tickers = tickers or universe(config)
    ciks = resolve_ciks(tickers, config)
    started = iso()
    try:
        detail = JOBS[job](db, tickers, config, ciks, stop_event=stop_event, **options)
        status = 'ok'
    except Exception as error:
        detail, status = str(error)[:200], 'failed'
    db.execute('INSERT INTO ownership_runs VALUES(?,?,?,?,?)', (job, started, iso(), status, detail))
    db.commit()
    print(json.dumps({'event': 'ownership-data', 'job': job, 'status': status, 'detail': detail}), flush=True)
    return status, detail


def run_due(db_path, stop_event=None, now=None):
    """One pass of every job whose interval has passed since its last success (Form 4 first: it also queues 10-Q/10-K)."""
    now = now or utc_now()
    db = connect(db_path)
    try:
        for job in ('form4', 'buyback', 'short', '13f'):
            if stop_event is not None and stop_event.is_set():
                return
            last = last_success(db, job)
            if last and (now - datetime.fromisoformat(last.replace('Z', '+00:00'))).total_seconds() < INTERVALS[job]:
                continue
            run_job(db, job, stop_event=stop_event)
    finally:
        db.close()


def page_companies(config=None, value_check=VALUE_CHECK_FILE):
    """{ticker: (ja, en)} for the page: the Value Check ハイテク list (owner, Nov 22: クジラの足あと uses the same stocks)."""
    config = config or load_config()
    try:
        data = json.loads(Path(value_check).read_text(encoding='utf-8'))
        names = data.get('companies', {})
        tech = data['tech']
    except (OSError, ValueError, KeyError, TypeError):
        names, tech = {}, config['tech']
    return {t: ((names.get(t) or {}).get('ja') or t, (names.get(t) or {}).get('en') or t) for t in tech}


def _rows(db, sql, args=()):
    cursor = db.execute(sql, args)
    names = [d[0] for d in cursor.description]
    return [dict(zip(names, r)) for r in cursor.fetchall()]


def public_payload(db, companies=None, today=None):
    """The four tabs of クジラの足あと, per ticker only (never per institution). Read by the site's server for PRO members."""
    companies = companies or page_companies()
    today = today or date.today()
    named = lambda ticker, row: {'ticker': ticker, 'ja': companies[ticker][0], 'en': companies[ticker][1], **row}

    period = (db.execute('SELECT max(period) FROM ownership_institutional').fetchone() or [None])[0]
    institutional = []
    for r in _rows(db, 'SELECT ticker, pct, pct_change_pts, holders, holders_change FROM ownership_institutional WHERE period=? AND pct IS NOT NULL',
                   (period,)) if period else []:
        if r['ticker'] in companies:
            institutional.append(named(r['ticker'], {'pct': r['pct'], 'change': r['pct_change_pts'], 'holders': r['holders'],
                                                       'holdersChange': r['holders_change']}))

    settlement = (db.execute('SELECT max(settlement_date) FROM ownership_short').fetchone() or [None])[0]
    short = []
    for r in _rows(db, 'SELECT ticker, short_shares, previous_short_shares, shares_outstanding, pct_outstanding, days_to_cover, '
                       'finra_days_to_cover FROM ownership_short WHERE settlement_date=? AND pct_outstanding IS NOT NULL', (settlement,)) if settlement else []:
        if r['ticker'] not in companies:
            continue
        ratio = r['pct_outstanding'] / r['short_shares'] if r['short_shares'] else None
        previous = round(r['previous_short_shares'] * ratio, 2) if ratio and r['previous_short_shares'] is not None else None
        short.append(named(r['ticker'], {'pct': r['pct_outstanding'], 'change': round(r['pct_outstanding'] - previous, 2) if previous is not None else None,
                                         'days': r['days_to_cover'] if r['days_to_cover'] is not None else r['finra_days_to_cover']}))

    since = (today - timedelta(days=FORM4_LOOKBACK_DAYS)).isoformat()
    trades = []
    for r in _rows(db, "SELECT accession, ticker, filed, max(trade_date) AS day, owner_name, owner_role, code, sum(value) AS value, "
                       "max(plan_10b5_1) AS planned FROM ownership_insider_trades WHERE category='open-market' AND trade_date>=? AND value>0 "
                       "GROUP BY accession, code ORDER BY day DESC, value DESC LIMIT 400", (since,)):
        if r['ticker'] in companies:
            trades.append(named(r['ticker'], {'date': r['day'], 'filed': r['filed'], 'role': r['owner_role'] or '',
                                              'side': 'buy' if r['code'] == 'P' else 'sell', 'planned': r['planned'] == 1,
                                              'value': round(r['value'], 2)}))

    buybacks, seen = [], set()
    for r in _rows(db, "SELECT ticker, min(filed) AS filed, amount_usd FROM ownership_buyback_authorizations WHERE filed>=? "
                       "AND coalesce(check_status, '')!='suspect-amount' "
                       "GROUP BY ticker, amount_usd ORDER BY filed DESC",((today - timedelta(days=365)).isoformat(),)):
        if r['ticker'] in companies:
            buybacks.append(named(r['ticker'], {'kind': 'authorization', 'date': r['filed'], 'amount': r['amount_usd']}))
    for r in _rows(db, "SELECT ticker, concept, period_start, period_end, value, filed FROM ownership_buyback_quarters "
                       "WHERE concept IN ('PaymentsForRepurchaseOfCommonStock','PaymentsForRepurchaseOfEquity','PaymentsToAcquireOrRedeemEntitysShares') "
                       "AND value>0 AND period_end>=? ORDER BY period_end DESC", ((today - timedelta(days=200)).isoformat(),)):
        if r['ticker'] in companies and r['ticker'] not in seen:
            seen.add(r['ticker'])
            buybacks.append(named(r['ticker'], {'kind': 'quarter', 'date': r['filed'] or r['period_end'], 'start': r['period_start'],
                                                'end': r['period_end'], 'amount': r['value']}))
    buybacks.sort(key=lambda b: b['date'] or '', reverse=True)
    return {'ok': bool(institutional or short or trades or buybacks), 'institutionalAsOf': period, 'shortAsOf': settlement,
            'institutional': institutional, 'short': short, 'insiders': trades, 'buybacks': buybacks}


def report(db, tickers):
    out = {}
    for ticker in tickers:
        def q(sql):
            cursor = db.execute(sql, (ticker,))
            names = [d[0] for d in cursor.description]
            return [dict(zip(names, r)) for r in cursor.fetchall()]
        out[ticker] = {
            'institutional': q('SELECT period, pct, pct_change_pts, holders, holders_change, shares_held, shares_outstanding, outstanding_as_of '
                               'FROM ownership_institutional WHERE ticker=? ORDER BY period DESC LIMIT 2'),
            'short': q('SELECT settlement_date, short_shares, change_shares, pct_outstanding, avg_volume_20d, days_to_cover, '
                       'finra_days_to_cover FROM ownership_short WHERE ticker=? ORDER BY settlement_date DESC LIMIT 2'),
            'insider_open_market': q("SELECT trade_date, owner_name, owner_role, side, code, shares, price, value, plan_10b5_1 "
                                     "FROM ownership_insider_trades WHERE ticker=? AND category='open-market' ORDER BY trade_date DESC LIMIT 8"),
            'buyback_quarters': q('SELECT concept, period_start, period_end, value, derived FROM ownership_buyback_quarters '
                                  'WHERE ticker=? ORDER BY period_end DESC LIMIT 8'),
            'buyback_months': q('SELECT b.label, b.shares, b.avg_price, b.remaining_usd, f.report_date FROM ownership_buyback_months b '
                                'JOIN ownership_filings f USING(accession) WHERE b.ticker=? ORDER BY f.report_date DESC, b.line LIMIT 8'),
            'remaining': q('SELECT as_of, amount_usd, source FROM ownership_buyback_remaining WHERE ticker=? ORDER BY as_of DESC LIMIT 3'),
            'authorizations': q('SELECT filed, amount_usd, sentence FROM ownership_buyback_authorizations WHERE ticker=? ORDER BY filed DESC LIMIT 3'),
            'issues': q('SELECT job, reason FROM ownership_issues WHERE ticker=?'),
        }
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('command', choices=('run', 'report'))
    parser.add_argument('--db', required=True)
    parser.add_argument('--job', choices=sorted(JOBS))
    parser.add_argument('--tickers')
    args = parser.parse_args(argv)
    db = connect(args.db)
    tickers = [t.strip().upper() for t in args.tickers.split(',')] if args.tickers else None
    if args.command == 'report':
        print(json.dumps(report(db, tickers or universe()), ensure_ascii=False, indent=1))
        return 0
    for job in [args.job] if args.job else ['form4', 'buyback', 'short', '13f']:
        run_job(db, job, tickers=tickers)
    return 0


if __name__ == '__main__':
    sys.path.insert(0, str(HERE))
    sys.exit(main())
