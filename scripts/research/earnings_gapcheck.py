"""Gap check (owner, Nov 13): a company filed its results with the SEC, but the site says nothing. Read-only.

For every company whose earnings the calendar covers (lib/research/calendar-coverage.json, plus the watch list) this asks the SEC for
8-K filings that list Item 2.02 (results of operations) accepted in the last GAP_WINDOW and at least GRACE ago, then asks the PUBLIC
production site (GET /api/research/news, no login, no secret) whether it carries an earnings result for that ticker published since the
filing. A company with the filing but without a result on the site is a GAP. The caller turns any gap into a failed run.

It returns and prints only ticker symbols, counts and true/false: never filing text, figures or any environment value. It writes nothing.
6-K filers (no item list on the SEC index) are not covered by this check.
"""
import json
import os
import re
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

GAP_WINDOW = timedelta(hours=48)   # the site keeps results for about this long; older filings cannot be judged from it
GRACE = timedelta(minutes=10)      # a filing needs a moment to be detected and published (the target is seconds)
SITE = 'https://techphase.app'
ROOT = Path(__file__).resolve().parents[2]


def coverage_tickers():
    try:
        return [row['ticker'] for row in json.loads((ROOT / 'lib/research/calendar-coverage.json').read_text())]
    except (OSError, ValueError, KeyError, TypeError):
        return []


def http_get(url, agent):
    request = urllib.request.Request(url, headers={'User-Agent': agent, 'Accept-Encoding': 'identity'})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(5_000_000)
    time.sleep(0.25)  # well under the SEC's request-rate limit
    return data.decode('utf-8', 'replace')


def moment(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def results_filings(recent, now):
    """Acceptance times of 8-Ks that list Item 2.02 inside the window and older than the grace period (newest first)."""
    found = []
    forms, accepted, items = recent.get('form', []), recent.get('acceptanceDateTime', []), recent.get('items', [])
    for index, form in enumerate(forms):
        at = moment(accepted[index]) if index < len(accepted) else None
        if at is None or now - at > GAP_WINDOW:
            continue
        listed = items[index] if index < len(items) and isinstance(items[index], str) else ''
        if form == '8-K' and '2.02' in [part.strip() for part in listed.split(',')] and now - at >= GRACE:
            found.append(at)
    return found


def site_results(news):
    """{ticker: [published times]} of the earnings results (figures or the 'announced' line) the public feed carries."""
    seen = {}
    for brief in (news or {}).get('resultBriefs') or []:
        if not isinstance(brief, dict) or brief.get('kind') != 'earnings' or not isinstance(brief.get('ticker'), str):
            continue
        at = moment(brief.get('publishedAt') or brief.get('observedAt'))
        if at is not None:
            seen.setdefault(brief['ticker'], []).append(at)
    return seen


def find_gaps(tickers, recent_for, news, now):
    """Tickers with a recent Item 2.02 8-K and no result on the site published since (an hour of slack before the filing)."""
    shown = site_results(news)
    gaps, checked = [], 0
    for ticker in tickers:
        recent = recent_for(ticker)
        if recent is None:
            continue
        checked += 1
        for filed in results_filings(recent, now):
            if not any(at >= filed - timedelta(hours=1) for at in shown.get(ticker, [])):
                gaps.append(ticker)
                break
    return {'gaps': gaps, 'checked': checked}


def run(agent, now=None, fetch=None, tickers=None, providers=None):
    """The summary dict. `siteChecked` is False when the public feed could not be read: nothing can then be judged, which is a failure."""
    fetch = fetch or (lambda url: http_get(url, agent))
    now = now or datetime.now(timezone.utc)
    if providers is None:
        import monitor
        providers = monitor.PROVIDERS
    wanted = []
    for ticker in tickers if tickers is not None else coverage_tickers():
        if ticker not in wanted:
            wanted.append(ticker)

    def cik_of(ticker):
        provider = providers.get(ticker, {})
        for source in [*provider.get('supplementalSources', []), *provider.get('fallbackSources', [])]:
            if source.get('format') == 'sec-json' and re.fullmatch(r'\d{10}', str(source.get('cik', ''))):
                return source['cik']
        return None

    def recent_for(ticker):
        cik = cik_of(ticker)
        if not cik:
            return None
        try:
            return json.loads(fetch(f'https://data.sec.gov/submissions/CIK{cik}.json'))['filings']['recent']
        except Exception:
            return None
    try:
        news = json.loads(fetch(os.environ.get('EARNINGS_SITE_URL', SITE).rstrip('/') + '/api/research/news'))
        site_ok = isinstance(news, dict) and news.get('ok') is not False
    except Exception:
        news, site_ok = None, False
    if not site_ok:
        return {'siteChecked': False, 'gaps': [], 'checked': 0}
    result = find_gaps(wanted, recent_for, news, now)
    return {'siteChecked': True, **result}
