"""The Stock Comparison's valuation for every comparable company (owner, Nov 26: no 未取得 where it can be avoided).

Treasure Hunt (value_check.py) calculates its 567 companies once a day. The comparison offers about 5,500, so this worker extends the same
calculation, "today against the company's own five-year average", to all of them, in the background only:

- the companies: the SEC's list of listed companies with the comparison's own exclusions (lib/research/comparison-exclusions.ts, the same
  rules), in the SEC's order (largest first); a company a member just compared without a figure goes first (want());
- the figures: the SEC's company facts (free), read once a week. A bank's revenue under its own names (interest income) when the usual
  names give none; shareholders' equity for the P/B fallback;
- the prices: each company's five-year daily history once (two Twelve Data credits: raw and split-adjusted, as Treasure Hunt stores
  them), then the new closes each trading day (one credit). The provider's quarterly statements (100 credits) where the filing has no
  usable figures (a foreign filer whose 20-F is old, no share count, no XBRL), at most one read per STATEMENT_GAP seconds. Every call goes
  through the allocator in the background tier (value_check.td_get) and the pacer (PER_MINUTE of our own a minute);
- the result, per company and close (table compare_values), in the order: P/E and P/S (Treasure Hunt's own calculation), P/S alone, the
  same over a history of at least MIN_SHORT_DAYS trading days for a listing younger than a year, and P/B when there is no revenue.
  A company Treasure Hunt calculates keeps Treasure Hunt's number (value_check.compare_list).

No user request ever calls the provider: the site only reads the list from the monitor's /value-check, and may tell the monitor which
companies were asked for (/value-check/want), which only changes the order of the work."""

import json
import re
import threading
import time
import urllib.request
import gzip

import value_check as vc

DIRECTORY_URL = 'https://www.sec.gov/files/company_tickers_exchange.json'
EXCLUSIONS_FILE = vc.ROOT / 'lib' / 'research' / 'comparison-exclusions.json'
LISTED = {'Nasdaq', 'NYSE', 'CBOE', 'TXSE'}
# A bank or lender reports no "revenue" under the usual names: its interest income stands in (the comparison's own list of names).
BANK_REVENUE = ['InterestAndDividendIncomeOperating', 'InterestIncomeExpenseNet', 'RevenuesNetOfInterestExpense', 'GrossInvestmentIncomeOperating',
                'Revenue', 'RevenueFromContractsWithCustomers', 'RevenueFromSaleOfGoods']
EQUITY = ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
          'ifrs-full:EquityAttributableToOwnersOfParent', 'ifrs-full:Equity']
COMPARE_VERSION = 1
MIN_SHORT_DAYS = 60          # a listing younger than a year is judged over what it has, from this many trading days (owner, Nov 26)
PER_MINUTE = 120             # this worker's own credits a minute (the pacer), under the allocator's background tier
STATEMENT_GAP = 100          # seconds between two 100-credit statement reads: about 60 credits a minute (owner, Nov 26)
FACTS_PER_STEP = 200         # SEC company facts read per step (about four a second)
COMPUTE_PER_STEP = 600       # companies calculated per step
MISS_RETRY = 7 * 86400       # a symbol the provider could not serve is asked again after a week
EMPTY_STATEMENTS_RETRY = 30 * 86400
WANTED = []                  # tickers a member compared without a figure, newest last (want())
_lock = threading.Lock()


# ---- the companies ---------------------------------------------------------------------------------------------------------------------

SUFFIX = [re.compile(r'-P[A-Z]?$'), re.compile(r'-(?:WTA?|WS|W)$'), re.compile(r'-(?:UN|U)$'), re.compile(r'-(?:RI|R)$')]


def excluded(entry, siblings, lists):
    """The comparison's exclusion rule (lib/research/comparison-exclusions.ts comparisonExclusion), for the same SEC rows."""
    ticker, cik = str(entry['ticker']).upper(), str(int(entry['cik']))
    if any(p.search(ticker) for p in SUFFIX):
        return True
    if (re.fullmatch(r'[A-Z]{2,6}', ticker) and ticker[-1] in 'WURPONM' and entry.get('exchange') in (None, 'Nasdaq')
            and any(len(ticker) - n >= 1 and ticker[:-n] in siblings.get(cik, ()) for n in (1, 2))):
        return True
    for kind in ('spac', 'fund'):
        name = lists.get(kind, {}).get(cik)
        if name is not None and name.strip().upper() == str(entry.get('name') or '').strip().upper():
            return True
    issuer = lists.get('etn', {}).get(cik)
    return issuer is not None and ticker not in issuer.get('shares', [])


def comparable(directory, lists):
    """[(ticker, cik)] in the SEC's order: listed on a US exchange, not excluded (funds, SPACs, ETNs, preferreds, warrants, units)."""
    fields = directory.get('fields') or []
    rows = [dict(zip(fields, row)) for row in directory.get('data') or []]
    siblings = {}
    for row in rows:
        if row.get('ticker') and row.get('cik') is not None:
            siblings.setdefault(str(int(row['cik'])), set()).add(row['ticker'])
    out, seen = [], set()
    for row in rows:
        ticker = row.get('ticker')
        if (not ticker or row.get('exchange') not in LISTED or not re.fullmatch(r'[A-Z0-9.\-]{1,15}', ticker) or ticker in seen
                or excluded(row, siblings, lists)):
            continue
        seen.add(ticker)
        out.append((ticker, int(row['cik'])))
    return out


def want(tickers):
    """The site says a member compared these companies without a figure: they go first (only the order of the work changes)."""
    with _lock:
        for ticker in tickers:
            if isinstance(ticker, str) and re.fullmatch(r'[A-Z0-9.\-]{1,15}', ticker) and ticker not in WANTED:
                WANTED.append(ticker)
        del WANTED[:-500]


def ordered(universe):
    with _lock:
        first = [t for t in reversed(WANTED) if t in universe]
    rest = [t for t in universe if t not in set(first)]
    return first + rest


# ---- the figures -----------------------------------------------------------------------------------------------------------------------

def equity_points(facts):
    """Shareholders' equity at each balance-sheet date, as first filed: [{end, filed, value}] (negative values kept; daily_ratios
    then gives no P/B for those days)."""
    currency = vc.reporting_currency(facts)
    for tag in EQUITY:
        rows = [r for r in vc._rows(facts, *vc._name(tag), currency) if r['start'] is None]
        if not rows:
            continue
        first = {}
        for row in rows:
            best = first.get(row['end'])
            if best is None or row['filed'] < best['filed']:
                first[row['end']] = row
        return [{'end': end, 'filed': row['filed'], 'value': row['val']} for end, row in sorted(first.items())]
    return []


def compare_fundamentals(facts):
    """value_check.fundamentals, plus a bank's interest income when the usual revenue names give nothing, and equity for P/B."""
    record = vc.fundamentals(facts)
    if record.get('error'):
        return record
    if not record.get('revenue'):
        currency = record.get('currency') or 'USD'
        record['revenue'] = vc.ttm_points([vc._rows(facts, *vc._name(tag), currency) for tag in BANK_REVENUE], widest=True)
        if record['revenue']:
            record['revenueBasis'] = 'bank'
    record['equity'] = equity_points(facts)
    record['cv'] = COMPARE_VERSION
    return record


def with_statements(db, ticker, record):
    row = db.execute('SELECT payload FROM value_check_statements WHERE ticker=?', (ticker,)).fetchone()
    if not row:
        return record
    try:
        merged = vc.supplement(record, json.loads(row[0]))
    except ValueError:
        return record
    if record and record.get('equity') and not merged.get('equity'):
        merged = {**merged, 'equity': record['equity']}
    return merged


def needs_statements(record, today):
    """The filing gives no usable figures: no facts at all (a trust, no XBRL), no share count, or twelve-month revenue older than
    value_check.TD_WHEN_OLDER days (a foreign filer between its 20-Fs). A company with facts and no revenue (before its first sale)
    is judged on P/B instead: the provider would have no sales either."""
    if not record or record.get('error'):
        return True
    if not record.get('shares'):
        return True
    return bool(record.get('revenue')) and today - max(p['end'] for p in record['revenue']) > vc.TD_WHEN_OLDER


# ---- the calculation ---------------------------------------------------------------------------------------------------------------

def _judge(ratios, closes, as_of, basis_when_ps):
    """The first calculation that works: the full history, then a short one (MIN_SHORT_DAYS)."""
    for days in (vc.MIN_PS_DAYS, MIN_SHORT_DAYS):
        parts = vc.value_parts(ratios, len(ratios) - 1, min_ps_days=days, min_pe_days=days)
        if parts is None or parts['ps'] > vc.MAX_PS:
            continue
        pe_used = basis_when_ps != 'pb' and parts['pe_part'] is not None and parts['pe'] <= vc.PE_CAP
        halves = [parts['pe_part'], parts['ps_part']] if pe_used else [parts['ps_part']]
        exact = 100 * sum(halves) / len(halves)
        history = len(parts['ps_history'])
        period = vc._period_note(closes, as_of, history)
        return {'score': round(exact), 'exact': round(exact, 2), 'basis': 'pe-ps' if pe_used else basis_when_ps, 'period': period,
                'days': history}
    return None


def compare_value(closes, record, as_of, fx=None):
    """(value or None, reason). P/E and P/S as Treasure Hunt; P/S alone; a short history; P/B when there is no revenue."""
    if not closes:
        return None, 'no-price'
    if closes[-1][0] != as_of:
        return None, 'stale-price'
    if not record or record.get('error'):
        return None, (record or {}).get('error') or 'no-sec-data'
    if not record.get('shares'):
        return None, 'no-shares'
    if (record.get('currency') or 'USD') != 'USD' and not fx:
        return None, 'no-exchange-rate'
    if record.get('revenue'):
        value = _judge(vc.daily_ratios(closes, record, fx), closes, as_of, 'ps')
        if value:
            return value, None
    equity = record.get('equity') or []
    if equity:
        book = vc.daily_ratios(closes, {**record, 'revenue': equity, 'income': []}, fx)
        value = _judge(book, closes, as_of, 'pb')
        if value:
            return value, None
        if book and book[-1][2] is None:
            return None, 'negative-equity' if equity and equity[-1]['value'] <= 0 else 'no-current-figures'
    if not record.get('revenue') and not equity:
        return None, 'no-revenue-or-equity'
    return None, 'short-history' if len(closes) < MIN_SHORT_DAYS + 1 else 'no-current-figures'


# ---- one step of the worker ------------------------------------------------------------------------------------------------------------

def _state(db, key):
    row = db.execute('SELECT value FROM value_check_state WHERE key=?', (key,)).fetchone()
    return json.loads(row[0]) if row else None


def _set_state(db, key, value):
    db.execute('INSERT OR REPLACE INTO value_check_state(key,value) VALUES(?,?)', (key, json.dumps(value)))


def _dirty(db, tickers):
    db.executemany('INSERT OR IGNORE INTO compare_dirty(ticker) VALUES(?)', [(t,) for t in tickers])


def _missed(db, ticker, kind, stamp):
    row = db.execute('SELECT at FROM compare_misses WHERE ticker=? AND kind=?', (ticker, kind)).fetchone()
    return row is not None and stamp - row[0] < MISS_RETRY


def directory_fetch(user_agent, opener=urllib.request.urlopen):
    request = urllib.request.Request(DIRECTORY_URL, headers={'User-Agent': user_agent, 'Accept-Encoding': 'gzip'})
    with opener(request, timeout=60) as response:
        body = response.read(20_000_000)
        if response.headers.get('Content-Encoding') == 'gzip':
            body = gzip.decompress(body)
    return json.loads(body)


def step(db, *, transport=None, sec=None, directory=None, now=None, sleep=time.sleep, should_stop=lambda: False, pacer=None,
         last_statement=None, treasure=None):
    """One pass (the service calls it about once a minute): the list of companies (daily), SEC figures, new closes, histories,
    statements, then the calculation. Returns counts for the log."""
    stamp = time.time() if now is None else now.timestamp()
    report = {'universe': 0, 'facts': 0, 'updated': 0, 'backfilled': 0, 'statements': 0, 'computed': 0}
    snapshot = vc.snapshot(db)
    as_of = (snapshot or {}).get('asOf')
    if not as_of:
        return report  # Treasure Hunt's first run sets the close every figure is judged at
    treasure = set(treasure if treasure is not None else vc.load_universe()['all'])

    # The companies, once a day (the SEC's list is free).
    saved = _state(db, 'compare_universe')
    if not saved or stamp - saved.get('at', 0) > 86400:
        try:
            listing = comparable(directory() if directory else directory_fetch(_agent()), json.loads(EXCLUSIONS_FILE.read_text(encoding='utf-8')))
            if listing:
                saved = {'at': stamp, 'companies': listing}
                _set_state(db, 'compare_universe', saved)
                db.commit()
        except Exception as error:
            print(json.dumps({'event': 'compare-values-directory-failed', 'error': type(error).__name__}), flush=True)
    if not saved:
        return report
    ciks = {ticker: cik for ticker, cik in saved['companies']}
    universe = ordered(list(ciks))
    report['universe'] = len(universe)

    # SEC figures: missing or a week old, a few hundred a step.
    records, fetched = {}, {}
    for ticker, fetched_at, payload in db.execute('SELECT ticker, fetched_at, payload FROM compare_facts'):
        try:
            records[ticker], fetched[ticker] = json.loads(payload), fetched_at
        except ValueError:
            continue
    stale = [t for t in universe if t not in fetched or stamp - fetched[t] >= vc.FACTS_MAX_AGE
             or (records[t].get('cv') != COMPARE_VERSION and not records[t].get('error'))][:FACTS_PER_STEP]
    if stale:
        sec = sec or (lambda cik: vc.sec_fetch(cik, _agent()))
        for ticker in stale:
            if should_stop():
                break
            try:
                facts = sec(ciks[ticker])
            except Exception as error:
                print(json.dumps({'event': 'compare-values-sec-failed', 'ticker': ticker, 'error': str(error)[:60]}), flush=True)
                continue
            record = compare_fundamentals(facts) if facts else {'error': 'no-sec-data'}
            records[ticker] = record
            db.execute('INSERT OR REPLACE INTO compare_facts(ticker,fetched_at,payload) VALUES(?,?,?)', (ticker, stamp, json.dumps(record)))
            _dirty(db, [ticker])
            report['facts'] += 1
            sleep(0.25)
        db.commit()

    transport = transport or vc.td_get
    pacer = pacer or vc.Pacer(transport, sleep=sleep, own=PER_MINUTE, max_wait=55)
    have = {row[0]: row[1] for row in db.execute('SELECT ticker, max(day) FROM value_check_closes GROUP BY ticker')}
    today = (now or vc.datetime.now(vc.timezone.utc)).astimezone(vc.EASTERN).date().toordinal()

    # 1. New closes for the companies that already have a history (Treasure Hunt's own run keeps its companies and currencies current).
    currencies = {r.get('currency') for r in records.values() if r.get('currency') not in (None, 'USD')}
    fx = [f'FX:{c}' for c in sorted(currencies)]
    behind = [t for t in universe + fx if t not in treasure and t in have and have[t] < as_of]
    for i in range(0, len(behind), vc.CHUNK * 4):
        if should_stop():
            break
        part = behind[i:i + vc.CHUNK * 4]
        latest = vc.read_series(part, vc.UPDATE_BARS, 'splits', pacer, transport)
        for ticker, bars in latest.items():
            if bars:
                vc.store_update(db, ticker, bars)
        _dirty(db, list(latest))
        db.commit()
        report['updated'] += len(latest)
        if len(latest) < len(part):
            break  # the pacer had no room: next step

    # 2. The provider's statements where the filing gives no usable figures, about one read per STATEMENT_GAP seconds.
    stored = {row[0]: (row[1], row[2]) for row in db.execute('SELECT ticker, fetched_at, payload FROM value_check_statements')}
    clock = last_statement if last_statement is not None else {'at': 0}
    if stamp - clock['at'] >= STATEMENT_GAP:
        for ticker in universe:
            if ticker in treasure or not needs_statements(records.get(ticker), today):
                continue
            if ticker in stored:
                fetched_at, payload = stored[ticker]
                _, quarters = vc.statement_quarters(json.loads(payload))
                newest = max((q['end'] for q in quarters), default=0)
                if stamp - fetched_at < (EMPTY_STATEMENTS_RETRY if not quarters else vc.TD_REREAD) or (quarters and today - newest < vc.TD_NEW_QUARTER):
                    continue
            if not pacer.wait_for(vc.TD_STATEMENT_COST):
                break
            clock['at'] = stamp
            try:
                body = transport('income_statement', {'symbol': vc.provider_symbol(ticker), 'period': 'quarterly'})
            except Exception as error:
                print(json.dumps({'event': 'compare-values-statement-failed', 'ticker': ticker, 'error': str(error)[:80]}), flush=True)
                break
            kept = body if isinstance(body, dict) and isinstance(body.get('income_statement'), list) else {'income_statement': []}
            db.execute('INSERT OR REPLACE INTO value_check_statements(ticker,fetched_at,payload) VALUES(?,?,?)', (ticker, stamp, json.dumps(kept)))
            _dirty(db, [ticker])
            db.commit()
            report['statements'] += 1
            break

    # 3. Five-year histories, largest companies (or the ones asked for) first, for every company with figures to judge.
    def usable(ticker):
        """Worth a history: SEC figures, or provider statements that hold quarters (an empty answer is not)."""
        record = records.get(ticker)
        if record and not record.get('error'):
            return True
        return ticker in stored and bool(vc.statement_quarters(json.loads(stored[ticker][1]))[1])
    missing = [t for t in universe if t not in have and t not in treasure and usable(t) and not _missed(db, t, 'history', stamp)]
    missing += [c for c in fx if c not in have and not _missed(db, c, 'history', stamp)]
    for i in range(0, len(missing), vc.CHUNK):
        if should_stop():
            break
        part = missing[i:i + vc.CHUNK]
        raw = vc.read_series(part, vc.HISTORY_BARS, 'none', pacer, transport)
        adj = vc.read_series([t for t in part if t in raw], vc.HISTORY_BARS, 'splits', pacer, transport)
        if not raw and not adj:
            break  # the pacer had no room
        for ticker in part:
            if ticker in adj and adj[ticker]:
                vc.store_history(db, ticker, raw[ticker], adj[ticker])
                report['backfilled'] += 1
            else:
                db.execute('INSERT OR REPLACE INTO compare_misses(ticker,kind,at) VALUES(?,?,?)', (ticker, 'history', stamp))
        _dirty(db, part)
        db.commit()

    # 4. The calculation, for the companies whose inputs changed or whose figure is of an older close.
    if _state(db, 'compare_as_of') != as_of:
        _dirty(db, universe)
        _set_state(db, 'compare_as_of', as_of)
        db.commit()
    todo = [row[0] for row in db.execute('SELECT ticker FROM compare_dirty LIMIT ?', (COMPUTE_PER_STEP,))]
    rates = {}
    for currency in currencies:
        rows = vc._closes(db, f'FX:{currency}')
        if rows:
            rates[currency] = [(day, adj) for day, _, adj in rows]
    reasons = _state(db, 'compare_reasons') or {}
    for ticker in todo:
        if ticker in ciks:
            record = with_statements(db, ticker, records.get(ticker))
            value, reason = compare_value(vc._closes(db, ticker), record, as_of, rates.get((record or {}).get('currency')))
            if value:
                db.execute('INSERT OR REPLACE INTO compare_values(ticker,as_of,payload) VALUES(?,?,?)', (ticker, as_of, json.dumps(value)))
                reasons.pop(ticker, None)
                report['computed'] += 1
            else:
                db.execute('DELETE FROM compare_values WHERE ticker=?', (ticker,))
                reasons[ticker] = reason
        db.execute('DELETE FROM compare_dirty WHERE ticker=?', (ticker,))
    _set_state(db, 'compare_reasons', reasons)
    db.commit()
    return report


def coverage(db):
    """How many comparable companies have a figure for the current close, and why the others have none (for the log and the report)."""
    snapshot = vc.snapshot(db) or {}
    saved = _state(db, 'compare_universe') or {'companies': []}
    listed = [t for t, _ in saved['companies']]
    values = set(vc.compare_list(db, snapshot))
    reasons = _state(db, 'compare_reasons') or {}
    missing = [t for t in listed if t not in values]
    by_reason = {}
    for ticker in missing:
        by_reason.setdefault(reasons.get(ticker, 'not-yet-calculated'), []).append(ticker)
    return {'asOf': snapshot.get('asOf'), 'companies': len(listed), 'withValue': len(listed) - len(missing),
            'missing': {reason: len(tickers) for reason, tickers in sorted(by_reason.items())}}


def _agent():
    import monitor  # noqa: E402 (the monitor's SEC user agent)
    return monitor.sec_user_agent()
