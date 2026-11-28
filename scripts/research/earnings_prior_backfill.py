"""The previous quarterly results release of each tracked company, stored in the background (Nov 28).

The calendar's 「会社予想」 under this quarter's revenue is the outlook the company gave one release earlier, and 「従来予想を上方修正」 is
read against that release's full-year outlook (lib/research/earnings-guidance.ts). Production stores results only from October 2026,
so DELL's (Sep 1), NVDA's (Aug 26) and MU's (Jun 24) previous releases were missing and nothing could be shown.

This reads, for each tracked company (lib/research/calendar-coverage.json), its results filings on SEC EDGAR from the last LOOKBACK
days up to a week ago (younger releases belong to the live flash), with the same code as the live flash: the monitor's SEC exhibit
reader, the company's table parser (issuer_result_flash.PROFILES) and the same extra figures (release_extras.supplement). Each
release is stored once in its own table, `earnings_prior_releases`, which only the calendar's results history reads
(earnings_history.py): nothing here reaches the news feed, a push, an alert or X.

Nothing is invented: a figure is kept only when the parser reads it from the filing; a results filing it cannot read is kept as
the "announced" line (its SEC link and acceptance time). A release the live store already holds is left to it. Each filing is
read once per VERSION (bumped when the parsers change); a network failure is retried on the next run.

Background only: public SEC files (≤ 4 requests a second, the monitor's SEC User-Agent), first run ten minutes after start, then
every six hours. Off with EARNINGS_PRIOR_BACKFILL=false. Prints one JSON line per run (tickers and counts only).
"""
import contextlib
import json
import os
import urllib.error
from datetime import datetime, timedelta, timezone

import earnings_history_backfill as backfill
import issuer_result_flash as flash
import monitor
import release_extras

VERSION = 'prior-release-v2'  # v2 (Nov 28): Jul/Aug layouts read, next-quarter outlooks, no outlook range taken as an EPS
INTERVAL = timedelta(hours=6)
FIRST_DELAY_SECONDS = 600
LOOKBACK = timedelta(days=200)   # two quarters: the previous release of the latest one, also while the next is not yet out
LIVE = timedelta(days=7)         # issuer_result_flash.WINDOW: a younger release is the live flash's
SAME_EVENT = timedelta(seconds=backfill.SAME_EVENT_SECONDS)


def enabled(env=None):
    return (os.environ if env is None else env).get('EARNINGS_PRIOR_BACKFILL', 'true').strip().lower() not in {'false', '0', 'no'}


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS earnings_prior_releases(
      key TEXT PRIMARY KEY, ticker TEXT NOT NULL, period TEXT, url TEXT NOT NULL, accession TEXT NOT NULL,
      payload TEXT NOT NULL, observed_at TEXT NOT NULL, stored_at TEXT NOT NULL, version TEXT NOT NULL)''')
    db.execute('''CREATE TABLE IF NOT EXISTS earnings_prior_attempts(
      accession TEXT PRIMARY KEY, ticker TEXT NOT NULL, state TEXT NOT NULL, reason TEXT, version TEXT NOT NULL, at TEXT NOT NULL)''')


def read_release(client, ticker, cik, filing):
    """(payload, state, reason) of one results filing, read as the live flash reads it; payload None when it is not a results release."""
    url, text = backfill.read_filing(client, ticker, cik, filing)
    parsed, code = backfill.read_figures(ticker, url, text)
    if parsed is None and not backfill.is_results(filing, url, text):
        return None, 'not-results', code
    observed = filing['accepted']
    if parsed:
        parsed = release_extras.supplement(text, parsed)  # the same extra figures as the live flash (issuer_result_flash.run_once)
        given = parsed.get('givenAt')
        if given is not None and given < observed:
            observed = given
        profile = flash.PROFILES.get(ticker)
        _key, payload = flash.build(ticker, url, parsed, flash.stamp(observed), profile['publisher'] if profile else None)
        return payload, 'stored', code
    from highlight_sentences import release_period
    name = next((c['name'] for c in json.loads(backfill.COVERAGE.read_text()) if c['ticker'] == ticker), ticker)
    return backfill.release_row(ticker, name, url, release_period(text), observed, filing['form']), 'stored', code


def live_holds(db, ticker, period, at):
    """The live store already has this release (same quarter, or a flash within 36 hours of it)."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='issuer_result_publications'").fetchone():
        return False
    for row in db.execute('SELECT period,observed_at FROM issuer_result_publications WHERE ticker=?', (ticker,)):
        other = flash.instant(row['observed_at'])
        if (period and row['period'] == period) or (other and abs(other - at) <= SAME_EVENT):
            return True
    return False


def store(db, ticker, accession, payload, now):
    """Insert one release; within 36 hours of a stored one of the same company, the row with more figures stays."""
    at = flash.instant(payload['publishedAt'])
    for row in db.execute('SELECT key,payload,observed_at,accession FROM earnings_prior_releases WHERE ticker=?', (ticker,)).fetchall():
        other = flash.instant(row['observed_at'])
        if row['accession'] == accession:  # the same filing read again by a newer parser version: its new reading replaces it
            db.execute('DELETE FROM earnings_prior_releases WHERE key=?', (row['key'],))
        elif other and abs(other - at) <= SAME_EVENT:
            if len(json.loads(row['payload'])['facts']) >= len(payload['facts']):
                return False
            db.execute('DELETE FROM earnings_prior_releases WHERE key=?', (row['key'],))
    db.execute('INSERT OR REPLACE INTO earnings_prior_releases VALUES(?,?,?,?,?,?,?,?,?)',
               (payload['researchId'], ticker, payload.get('period'), payload['url'], accession, json.dumps(payload, ensure_ascii=False),
                payload['publishedAt'], flash.stamp(now), VERSION))
    return True


@contextlib.contextmanager
def opened(path, guard):
    """The monitor's database under its lock, committed and closed after."""
    with guard:
        db = monitor.connect(path)
        try:
            with db:
                schema(db)
                yield db
        finally:
            db.close()


def run_once(path, now=None, client=None, tickers=None, lock=None, log=print):
    """One pass over the tracked companies. Returns counts; never raises for one company's failure."""
    now = now or datetime.now(timezone.utc)
    client = client or backfill.Client(per_second=4.0, user_agent=monitor.sec_user_agent())
    guard = lock or contextlib.nullcontext()
    coverage = json.loads(backfill.COVERAGE.read_text())
    ciks = {v['ticker']: v['cik_str'] for v in json.loads(client.get('https://www.sec.gov/files/company_tickers.json')[0]).values()}
    start, end = (now - LOOKBACK).date().isoformat(), (now - LIVE).date().isoformat()
    counts = {'stored': 0, 'held-live': 0, 'not-results': 0, 'unreadable': 0, 'failed': 0}
    with opened(path, guard) as db:
        done = {r['accession'] for r in db.execute('SELECT accession FROM earnings_prior_attempts WHERE version=?', (VERSION,))}
    for ticker in tickers or [c['ticker'] for c in coverage]:
        cik = ciks.get(ticker)
        if not cik:
            continue
        try:
            found = sorted(backfill.filings(client, cik, start, end), key=lambda f: f['accepted'])
        except Exception:  # noqa: BLE001 - one company's outage never stops the others
            counts['failed'] += 1
            continue
        for filing in found:
            if filing['accession'] in done:
                continue
            try:
                payload, state, reason = read_release(client, ticker, cik, filing)
            except (urllib.error.URLError, TimeoutError, OSError):
                counts['failed'] += 1
                continue  # the network: tried again on the next run
            except Exception as exc:  # noqa: BLE001
                payload, state, reason = None, 'unreadable', backfill.failure_code(exc)
            with opened(path, guard) as db:
                if payload is not None and live_holds(db, ticker, payload.get('period'), flash.instant(payload['publishedAt'])):
                    state = 'held-live'
                elif payload is not None and not store(db, ticker, filing['accession'], payload, now):
                    state = 'same-release'
                db.execute('INSERT OR REPLACE INTO earnings_prior_attempts VALUES(?,?,?,?,?,?)',
                           (filing['accession'], ticker, state, reason, VERSION, flash.stamp(now)))
            counts[state] = counts.get(state, 0) + 1
    log(json.dumps({'event': 'earnings-prior-backfill', **counts}))
    return counts


def public_feed(db, since, until=None):
    """Stored previous releases observed in [since, until), in the shape of the news feed's resultBriefs (the calendar's history only)."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='earnings_prior_releases'").fetchone():
        return []
    items = []
    for row in db.execute('SELECT payload,stored_at FROM earnings_prior_releases WHERE julianday(observed_at)>=julianday(?) '
                          'AND julianday(observed_at)<julianday(?) ORDER BY julianday(observed_at) DESC',
                          (since, until or '9999-12-31T00:00:00+00:00')):
        item = json.loads(row['payload'])
        item.update(publicAt=row['stored_at'], processingMs=0, sourceToDetectionMs=None, detectionToPublicMs=None)
        items.append(item)
    return items
