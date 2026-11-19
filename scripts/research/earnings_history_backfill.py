"""Backfill of the calendar's 「発表済みの結果」 from SEC EDGAR (owner, Nov 18).

The live news feed keeps earnings results for about seven days, so a month picked in the calendar's results view
(October) showed nothing. This reads each tracked company's results filing (8-K item 2.02, or a results 6-K) for the
requested range from SEC EDGAR, runs the same deterministic table parsers as the live flash (issuer_result_flash.PROFILES),
and writes a static history file the site loads for older months.

Nothing is invented: a figure is only kept when the parser reads it from the filing's own table; a filing the parser cannot
read becomes a row with no figures (the SEC link and the filing's acceptance time), with the parser's failure code recorded.

Usage (public data only; ≤ 5 requests a second; generic User-Agent with a contact as SEC requires):
  python3 scripts/research/earnings_history_backfill.py --from 2026-10-01 --to 2026-11-30 \
      --out lib/research/earnings-results-history.json --table docs/EARNINGS-RESULTS-BACKFILL-2026-10-11.md
"""
import argparse
import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import highlight_sentences  # noqa: E402
import issuer_result_flash as flash  # noqa: E402
import market_results  # noqa: E402
import monitor  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
COVERAGE = ROOT / 'lib/research/calendar-coverage.json'
USER_AGENT = os.environ.get('BACKFILL_USER_AGENT', 'research-backfill admin@example.com')
# A filing the parser could not read is listed only when it is a quarter's results release: an 8-K under item 2.02 whose
# exhibit (or, without one, its cover) names the quarter's results, or a 6-K whose own first lines do. Not a 6-K share report,
# not Tesla's deliveries 8-K (Oct 2), not Marvell's merger announcement with preliminary revenue (Nov 2).
SAME_EVENT_SECONDS = 36 * 3600


class Client:
    def __init__(self, per_second=5.0):
        self.gap = 1.0 / per_second
        self.last = 0.0

    def get(self, url, attempts=3):
        for attempt in range(attempts):
            wait = self.last + self.gap - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip'})
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    body = response.read()
                    if response.headers.get('Content-Encoding') == 'gzip':
                        body = gzip.decompress(body)
                    kind = (response.headers.get('Content-Type') or '').split(';')[0].strip().lower()
                break
            except (urllib.error.URLError, TimeoutError) as exc:
                status = getattr(exc, 'code', None)
                if attempt == attempts - 1 or status not in (None, 429, 500, 502, 503, 504):
                    raise
                time.sleep(2 * (attempt + 1))  # SEC asks for a slower pace: back off, then retry
        if url.lower().endswith('.pdf'):
            kind = 'application/pdf'
        elif re.search(r'\.html?$', url, re.I):
            kind = 'text/html'
        return body, kind

    def transport(self, url, _ticker=None, **_options):
        return self.get(url)


def acceptance(value):
    """EDGAR's acceptanceDateTime (UTC; Apple's 16:30 ET release of Oct 30 is accepted at 20:30Z)."""
    return datetime.fromisoformat(value[:19]).replace(tzinfo=timezone.utc)


def filings(client, cik, start, end):
    data = json.loads(client.get(f'https://data.sec.gov/submissions/CIK{int(cik):010d}.json')[0])
    recent = data['filings']['recent']
    for i, form in enumerate(recent['form']):
        if form not in ('8-K', '6-K', '8-K/A', '6-K/A') or not start <= recent['filingDate'][i] <= end:
            continue
        if form.startswith('8-K') and '2.02' not in (recent['items'][i] or ''):
            continue
        yield {'form': form, 'filed': recent['filingDate'][i], 'accepted': acceptance(recent['acceptanceDateTime'][i]),
               'accession': recent['accessionNumber'][i], 'primary': recent['primaryDocument'][i]}


def failure_code(exc):
    text = str(exc)
    return text if isinstance(exc, ValueError) and re.fullmatch(r'[a-z0-9-]{1,40}', text) else type(exc).__name__


def read_filing(client, ticker, cik, filing):
    """(exhibit url, extracted text) of the filing's results exhibit, or raises ValueError(code)."""
    directory = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{filing['accession'].replace('-', '')}"
    primary = f"{directory}/{filing['primary']}"
    content, _kind = client.get(primary)
    evidence = monitor.sec_exhibit_evidence(content, primary, ticker, client.transport)
    if evidence and 'extractedText' in evidence:
        return evidence['url'], evidence['extractedText']
    # Same rule as the monitor: without a readable exhibit the filing's own document is the evidence (SK hynix's 6-K
    # carries its preliminary results in the cover document).
    text = monitor.extract_text(content, 'text/html')
    if sum(ch.isalnum() for ch in text) >= 80:
        return primary, text
    raise ValueError('sec-exhibit-not-found' if not evidence else 'sec-exhibit-unreadable')


def read_figures(ticker, url, text):
    """(parsed, None) when the company's parser reads figures the site shows, else (None, failure code). The same reading as the live
    flash (issuer_result_flash.parse_with_sentences) and the same display floor as the site."""
    profile = flash.PROFILES.get(ticker)
    parsed, code = None, None
    if profile is None:
        return None, 'no-parser'
    try:
        if profile.get('sentences-only'):
            code = 'no-table-parser'
        parsed = flash.parse_with_sentences(ticker, text, url)
    except Exception as exc:  # noqa: BLE001
        return None, failure_code(exc) if not profile.get('sentences-only') else 'no-table-parser/' + failure_code(exc)
    floor = 1 if parsed.get('method') == highlight_sentences.METHOD else market_results.MIN_DISPLAY_FACTS
    if len([f for f in parsed['facts'] if not f[0].startswith('guidance-')]) < floor:
        return None, 'below-display-floor'  # the site shows no result with fewer figures (owner, Nov 12)
    return parsed, code


def is_results(filing, url, text):
    head = flash.clean(text)[:800]
    if filing['form'].startswith('8-K') and url.endswith('/' + filing['primary']):
        # no readable exhibit: the 8-K's own item 2.02 text says so
        return bool(re.search(r'(?i)Item 2\.02.{0,400}\bresults\b', flash.clean(text)))
    return highlight_sentences.results_head(head)


def backfill(start, end, tickers=None, client=None, log=print):
    client = client or Client()
    coverage = json.loads(COVERAGE.read_text())
    names = {c['ticker']: c['name'] for c in coverage}
    ciks = {v['ticker']: v['cik_str'] for v in json.loads(client.get('https://www.sec.gov/files/company_tickers.json')[0]).values()}
    briefs, companies = [], []
    for ticker in tickers or [c['ticker'] for c in coverage]:
        cik = ciks.get(ticker)
        row = {'ticker': ticker, 'name': names.get(ticker, ticker), 'reportedAt': None, 'form': None, 'period': None,
               'figures': False, 'failure': None, 'url': None}
        companies.append(row)
        if not cik:
            row['failure'] = 'sec-cik-unknown'
            continue
        try:
            candidates = list(filings(client, cik, start, end))
        except Exception as exc:  # noqa: BLE001 - one company's outage never stops the others
            row['failure'] = 'sec-submissions-' + failure_code(exc)
            continue
        candidates.sort(key=lambda f: f['accepted'])
        events = []  # (instant, payload, filing, code) of this company's results in the range
        skipped = None
        for filing in candidates:
            try:
                url, text = read_filing(client, ticker, cik, filing)
            except Exception as exc:  # noqa: BLE001
                log(f'{ticker} {filing["filed"]} {filing["form"]} unreadable {failure_code(exc)}')
                skipped = skipped or failure_code(exc)
                continue
            observed = filing['accepted']
            profile = flash.PROFILES.get(ticker)
            parsed, code = read_figures(ticker, url, text)
            if parsed is None and not is_results(filing, url, text):
                log(f'{ticker} {filing["filed"]} {filing["form"]} skipped: not a results release ({code})')
                skipped = skipped or 'not-a-results-release'
                continue
            if parsed:
                given = parsed.get('givenAt')
                if given is not None and given < observed:
                    observed = given  # a late filing of results given out earlier keeps their own date
                _key, payload = flash.build(ticker, url, parsed, flash.stamp(observed),
                                            profile['publisher'] if profile else None)
            else:
                payload = release_row(ticker, names.get(ticker, ticker), url, highlight_sentences.release_period(text), observed, filing['form'])
            events.append((observed, payload, filing, code))
            log(f'{ticker} {filing["filed"]} {filing["form"]} figures={parsed is not None} {code or ""}')
        # One result is one row: within 36 hours a filing with figures wins over one without (Arm's shareholder letter and its
        # quarterly-report 6-K; an 8-K/A repeating the release).
        kept = []
        for event in sorted(events, key=lambda e: (not e[1]['facts'], e[0])):
            if not any(abs((event[0] - other[0]).total_seconds()) <= SAME_EVENT_SECONDS for other in kept):
                kept.append(event)
        kept.sort(key=lambda e: e[0])
        for observed, payload, filing, code in kept:
            briefs.append(payload)
        if kept:
            observed, payload, filing, code = kept[-1]
            row.update(reportedAt=flash.stamp(observed), form=filing['form'], url=payload['url'], period=payload['period'],
                       figures=bool(payload['facts']), failure=code if not payload['facts'] else None,
                       events=len(kept), method=payload.get('method'))
        else:
            row['failure'] = skipped or 'not-reported-in-range'
    briefs.sort(key=lambda b: b['publishedAt'], reverse=True)
    return briefs, companies


def release_row(ticker, name, url, period, observed, form):
    """The results filing exists but no figures were read: its link and acceptance time only (same shape as earnings_announce)."""
    import hashlib
    key = hashlib.sha256('\0'.join([ticker, 'release', url]).encode()).hexdigest()
    number = str(int(key[:12], 16))
    at = flash.stamp(observed)
    return {'id': number, 'researchId': 'ir-announce-' + number, 'kind': 'earnings', 'ticker': ticker, 'period': period,
            'titleJa': f'{ticker} 決算を発表しました', 'titleEn': f'{ticker} announced its results', 'facts': [], 'url': url,
            'publisher': f'{name} IR (SEC {form})', 'publishedAt': at, 'observedAt': at, 'method': 'sec-results-filing'}


def table(companies, start, end):
    lines = [f'# 決算カレンダー 発表済みの結果 バックフィル（{start}〜{end}、SEC EDGAR）', '',
             '`scripts/research/earnings_history_backfill.py` が生成。数値は既存の決定的パーサー（issuer_result_flash.PROFILES）が会社の決算資料（SEC 8-K/6-K の EX-99）から読んだものだけです。', '',
             '| 銘柄 | 発表（SEC受付, UTC） | 様式 | 期 | 数値 | 読み方 | 失敗コード |', '|---|---|---|---|---|---|---|']
    for c in companies:
        lines.append(f"| {c['ticker']} | {(c['reportedAt'] or '—')[:16]} | {c['form'] or '—'} | {c['period'] or '—'} | "
                     f"{'あり' if c['figures'] else ('—' if not c['reportedAt'] else 'なし')} | "
                     f"{({'deterministic-issuer-table': '表', 'issuer-highlight-sentences': '本文の要点文'}).get(c.get('method') or '', '')} | {c['failure'] or ''} |")
    read = sum(c['figures'] for c in companies)
    release = sum(1 for c in companies if c['reportedAt'] and not c['figures'])
    lines += ['', f'集計: 数値あり {read}社 / 発表のみ（数値なし） {release}社 / 期間内の発表なし {len(companies) - read - release}社', '']
    return '\n'.join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--from', dest='start', required=True)
    parser.add_argument('--to', dest='end', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--table')
    parser.add_argument('--ticker', action='append')
    args = parser.parse_args(argv)
    briefs, companies = backfill(args.start, args.end, args.ticker)
    document = {'version': 1, 'range': {'from': args.start, 'to': args.end},
                'source': 'SEC EDGAR results filings (8-K item 2.02 / results 6-K), deterministic issuer-table parsers',
                'resultBriefs': briefs, 'companies': companies}
    Path(args.out).write_text(json.dumps(document, ensure_ascii=False, indent=1) + '\n')
    if args.table:
        Path(args.table).write_text(table(companies, args.start, args.end))
    print(json.dumps({'briefs': len(briefs), 'figures': sum(c['figures'] for c in companies)}))


if __name__ == '__main__':
    main()
