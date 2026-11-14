"""Backtest of the earnings flash on each company's most recent real results release (owner, Nov 12).

For every company on the watch list this takes the latest results filing from SEC EDGAR (8-K Item 2.02 or 6-K), reads the
press release exhibit, and records, per company:

  filing      when the SEC accepted it (what a SEC route can detect) and the form
  exhibit     whether the results press release text could be read
  parser      whether a deterministic parser for the company exists and what it read (value / reason code)
  hint        whether the text has the shape such a parser needs (revenue row, quarter heading)

It only reads public filings, writes a markdown table and never publishes anything. Run before each earnings season and
after any company or source change:

    python3 scripts/research/earnings_backtest.py > docs/EARNINGS-BACKTEST-YYYY-MM-DD.md
"""
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

import earnings_announce
import monitor
import issuer_result_flash as flash

WATCH = ["MU", "SKHY", "SNDK", "NBIS", "NVDA", "AMD", "AVGO", "ARM", "TSM", "ASML", "MRVL", "ANET", "CRDO", "CRWV",
         "VRT", "GEV", "DELL", "PLTR", "MSFT", "AMZN", "GOOGL", "ORCL"]
UA = 'TechPhaseResearch research@example.com'  # SEC asks for a contact in the User-Agent; the monitor uses RESEARCH_SEC_USER_AGENT
LOOKBACK = timedelta(days=130)


def get(url, binary=False):
    request = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'identity'})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(15_000_000)
    time.sleep(0.25)  # well under the SEC's request-rate limit
    return data if binary else data.decode('utf-8', 'replace')


def is_results_exhibit(text):
    """A results press release: 'results'/'earnings' and a period word near the top. Q1-Q4 counts ("Oracle Announces Q1 Results"): requiring
    the word quarter/fiscal made Oracle look as if it published nothing (Nov 13)."""
    head = text[:3000]
    return bool(re.search(r'\b(?:results|earnings)\b', head, re.I) and re.search(r'\b(?:quarter|fiscal|full[- ]year|Q[1-4])\b', head, re.I))


def latest_results_filing(cik, numbers=('1',)):
    data = json.loads(get(f'https://data.sec.gov/submissions/CIK{cik}.json'))['filings']['recent']
    cutoff = datetime.now(timezone.utc) - LOOKBACK
    for i, form in enumerate(data['form']):
        accepted = datetime.fromisoformat(data['acceptanceDateTime'][i].replace('Z', '+00:00'))
        if accepted < cutoff:
            break
        items = data['items'][i] if i < len(data['items']) else ''
        if (form == '8-K' and '2.02' in items) or form == '6-K':
            exhibit = exhibit_text(cik, data['accessionNumber'][i], numbers)
            if not exhibit and form == '6-K':
                # SK hynix files its results table in the 6-K itself, with no exhibit (its other 6-Ks are dividends, buybacks...)
                own = primary_text(cik, data['accessionNumber'][i], data['primaryDocument'][i] if i < len(data.get('primaryDocument', [])) else '')
                exhibit = own if own and earnings_announce.PRELIMINARY_RESULTS.search(own) else None
            if exhibit and is_results_exhibit(exhibit):
                return {'form': form, 'accepted': accepted.isoformat(), 'accession': data['accessionNumber'][i], 'text': exhibit}
    return None


def primary_text(cik, accession, document):
    """Text of a filing's own main document (a 6-K that carries its results directly)."""
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,200}', document or ''):
        return None
    try:
        raw = get(f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{document}", binary=True)
        return ' '.join(monitor.extract_text(raw, 'text/html').split())
    except Exception:
        return None


def exhibit_text(cik, accession, numbers=('1',)):
    base = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}"
    try:
        index = get(base + '/' + accession + '-index.html')
    except Exception:
        return None
    # The index table names each document's type: take the EX-99.1 row first (press release), then guess by file name.
    # (the same exhibit numbers, in the same order, as the monitor reads for this company: providers.json "secExhibits", EX-99.1 by default)
    typed = [m[1] for number in numbers
             for m in re.finditer(r'<tr[^>]*>(?:(?!</tr>).)*?href="(/Archives/edgar/data/[^"]+\.(?:htm|html))"(?:(?!</tr>).)*?>\s*EX-99\.' + number + r'\s*<', index, re.S)]
    guessed = [h for h in re.findall(r'href="(/Archives/edgar/data/[^"]+\.(?:htm|html))"', index)
               if re.search(r'(?:ex|exhibit)[-_]?99', h, re.I) or re.search(r'press|earnings|results|pr\.htm', h, re.I)]
    for href in [*typed, *guessed]:
        if True:
            try:
                content = get('https://www.sec.gov' + href, binary=True)
                return ' '.join(monitor.extract_text(content, 'text/html').split())
            except Exception:
                continue
    return None


def check_company(ticker):
    """One company's pass/fail against the acceptance criteria (docs/EARNINGS-ACCEPTANCE-2026-11-12.md), from its latest real release."""
    provider = monitor.PROVIDERS.get(ticker, {})
    ciks = [s.get('cik') for s in [*provider.get('supplementalSources', []), *provider.get('fallbackSources', [])] if s.get('format') == 'sec-json']
    result = {'ticker': ticker, 'detection': 'no route', 'figures': 0, 'verdict': 'FAIL', 'reason': ''}
    if not provider:
        result['reason'] = 'company not configured in providers.json'
        return result
    profile = flash.PROFILES.get(ticker)
    text, source = None, None
    try:
        if ticker == 'NBIS':
            # Nebius' table is in the release PDF linked from its newsroom page, not in the SEC 6-K.
            page = latest_nebius_results_page()
            if page:
                result['detection'] = 'newsroom page'
                text, source = flash.nebius_pdf_text(page, monitor.fetch), page
        elif ciks:
            filing = latest_results_filing(ciks[0], tuple(monitor.sec_exhibit_numbers(ticker)))
            if filing:
                result['detection'] = f"SEC {filing['form']} {filing['accepted'][:16]}Z"
                text, source = filing['text'], filing['accession']
            else:
                result['detection'] = 'none in %d days' % LOOKBACK.days
    except Exception as exc:
        result['reason'] = 'fetch error: ' + type(exc).__name__
        return result
    if text is None:
        result['reason'] = result['reason'] or 'no release text found'
        return result
    if not profile:
        result['reason'] = 'no parser for this company yet'
        return result
    try:
        parsed = profile['parse'](text, source if ticker == 'NBIS' else None)
    except Exception as exc:
        result['reason'] = 'parser refused: ' + str(exc)
        return result
    reported = [f for f in parsed['facts'] if not f[0].startswith('guidance-')]
    result['figures'] = len(reported)
    result['period'] = parsed['period']
    if len(reported) >= 3:
        result.update(verdict='PASS', reason='%d figures, e.g. revenue %s' % (len(reported), reported[0][1]))
    else:
        result['reason'] = 'fewer than 3 reported figures'
    return result


def latest_nebius_results_page():
    index = get('https://nebius.com/newsroom')
    slugs = re.findall(r'/newsroom/(nebius-(?:group-)?(?:n-v-)?(?:reports|announces)-(?:first|second|third|fourth)-quarter[a-z0-9-]*financial-results)', index)
    return 'https://nebius.com/newsroom/' + slugs[0] if slugs else None


def main():
    results = [check_company(t) for t in WATCH]
    if '--json' in sys.argv:
        print(json.dumps({'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'companies': results}, ensure_ascii=False))
        return 0
    passed = sum(r['verdict'] == 'PASS' for r in results)
    print('# Earnings flash pass/fail (latest real release of each watch-list company)\n')
    print('Generated', datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%MZ'), f'· PASS {passed} / {len(results)}\n')
    print('| Ticker | Verdict | Detection source | Figures | Reason |')
    print('|---|---|---|---|---|')
    for r in results:
        print(f"| {r['ticker']} | {r['verdict']} | {r['detection']} | {r['figures']} | {r['reason']} |")
    return 0


if __name__ == '__main__':
    sys.exit(main())
