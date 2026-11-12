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


def latest_results_filing(cik):
    data = json.loads(get(f'https://data.sec.gov/submissions/CIK{cik}.json'))['filings']['recent']
    cutoff = datetime.now(timezone.utc) - LOOKBACK
    for i, form in enumerate(data['form']):
        accepted = datetime.fromisoformat(data['acceptanceDateTime'][i].replace('Z', '+00:00'))
        if accepted < cutoff:
            break
        items = data['items'][i] if i < len(data['items']) else ''
        if (form == '8-K' and '2.02' in items) or form == '6-K':
            exhibit = exhibit_text(cik, data['accessionNumber'][i])
            if exhibit and re.search(r'\b(?:results|earnings)\b', exhibit[:3000], re.I) and \
                    re.search(r'\b(?:quarter|fiscal|full[- ]year)\b', exhibit[:3000], re.I):
                return {'form': form, 'accepted': accepted.isoformat(), 'accession': data['accessionNumber'][i], 'text': exhibit}
    return None


def exhibit_text(cik, accession):
    base = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}"
    try:
        index = get(base + '/' + accession + '-index.html')
    except Exception:
        return None
    for href in re.findall(r'href="(/Archives/edgar/data/[^"]+\.(?:htm|html))"', index):
        if re.search(r'(?:ex|exhibit)[-_]?99', href, re.I) or re.search(r'press|earnings|results', href, re.I):
            try:
                content = get('https://www.sec.gov' + href, binary=True)
                return ' '.join(monitor.extract_text(content, 'text/html').split())
            except Exception:
                continue
    return None


def main():
    rows = []
    for ticker in WATCH:
        provider = monitor.PROVIDERS.get(ticker, {})
        ciks = [s.get('cik') for s in provider.get('supplementalSources', []) if s.get('format') == 'sec-json']
        row = {'ticker': ticker, 'routes': 1 + (1 if ciks else 0) if provider else 0}
        if not ciks:
            row.update(filing='no SEC route', exhibit='-', parser='-', hint='-')
            rows.append(row)
            continue
        try:
            filing = latest_results_filing(ciks[0])
        except Exception as exc:
            row.update(filing='error ' + type(exc).__name__, exhibit='-', parser='-', hint='-')
            rows.append(row)
            continue
        if not filing:
            row.update(filing='none in %d days' % LOOKBACK.days, exhibit='-', parser='-', hint='-')
            rows.append(row)
            continue
        text = filing['text']
        row['filing'] = f"{filing['form']} {filing['accepted'][:16]}Z"
        row['exhibit'] = f'{len(text)} chars'
        profile = flash.PROFILES.get(ticker)
        if profile and ticker != 'NBIS':
            try:
                row['parser'] = ', '.join(f'{k} {v}' for k, v in profile['parse'](text)['facts'][:3])
            except Exception as exc:
                row['parser'] = 'FAILED: ' + str(exc)
        else:
            row['parser'] = 'none yet' if not profile else 'PDF route (see NBIS)'
        row['hint'] = ('revenue row' if re.search(r'\bRevenues?\b[^.]{0,40}\$\s*[\d,.]+', text) else 'no revenue row') + \
                      ('; quarter heading' if re.search(r'(?:First|Second|Third|Fourth) Quarter \d{4}|Q[1-4] \d{4}|Fiscal Q[1-4]', text, re.I) else '')
        rows.append(row)
    print('# Earnings flash backtest\n')
    print('Generated', datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%MZ'), '\n')
    print('| Ticker | Latest results filing (SEC) | Exhibit | Parser | Shape of text |')
    print('|---|---|---|---|---|')
    for r in rows:
        print(f"| {r['ticker']} | {r['filing']} | {r['exhibit']} | {r['parser']} | {r['hint']} |")


if __name__ == '__main__':
    sys.exit(main())
