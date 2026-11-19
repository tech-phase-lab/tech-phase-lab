"""Latest results release of tracked companies, kept as test fixtures and read by the live parsers (Nov 19).

Each company's newest results filing on SEC EDGAR (8-K item 2.02 or a results 6-K) is read the same way as the calendar backfill
(earnings_history_backfill.read_filing: the exhibit's extracted text), stored gzip-compressed in tests/fixtures/latest-releases/<TICKER>.txt.gz,
and run through issuer_result_flash.parse_with_sentences. tests/fixtures/latest-releases/manifest.json records where each text came from
(SEC URLs, acceptance time, SHA-256 of the text) and the figures the parsers read from it, so a parser change that alters a published
figure shows up as a manifest diff and a failing test.

Usage:
  # fetch the newest results release of these companies from SEC EDGAR (public data; generic User-Agent; <= 5 requests a second)
  python3 scripts/research/earnings_release_sweep.py --ticker IBM --ticker IREN --ticker TSLA --ticker VST
  # re-read the stored fixtures with the current parsers and rewrite the manifest's facts (no network)
  python3 scripts/research/earnings_release_sweep.py --cache
"""
import argparse
import gzip
import hashlib
import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import earnings_history_backfill as backfill  # noqa: E402
import issuer_result_flash as flash  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'tests/fixtures/latest-releases'
MANIFEST = FIXTURES / 'manifest.json'


def load_manifest():
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {'version': 1, 'source': 'SEC EDGAR results filings (8-K item 2.02 / results 6-K), exhibit text as read by earnings_history_backfill',
            'releases': []}


def read_text(ticker):
    return gzip.decompress((FIXTURES / f'{ticker}.txt.gz').read_bytes()).decode('utf-8')


def write_text(ticker, text):
    FIXTURES.mkdir(parents=True, exist_ok=True)
    (FIXTURES / f'{ticker}.txt.gz').write_bytes(gzip.compress(text.encode('utf-8'), mtime=0))


def reading(ticker, text, url):
    """The parsers' reading of one release, in the manifest's shape (the same call the live flash and the backfill make)."""
    try:
        parsed = flash.parse_with_sentences(ticker, text, url)
    except Exception as exc:  # noqa: BLE001
        return {'period': None, 'method': None, 'facts': [], 'failure': backfill.failure_code(exc)}
    return {'period': parsed['period'], 'method': parsed.get('method', 'deterministic-issuer-table'),
            'facts': [{'key': f[0], 'value': f[1], 'yearAgo': f[2]} for f in parsed['facts']], 'failure': None}


def latest(client, ticker, cik, since, until, log=print):
    """(filing, exhibit url, text) of the company's newest results release in the range, or None."""
    for filing in sorted(backfill.filings(client, cik, since, until), key=lambda f: f['accepted'], reverse=True):
        try:
            url, text = backfill.read_filing(client, ticker, cik, filing)
        except Exception as exc:  # noqa: BLE001
            log(f'{ticker} {filing["filed"]} unreadable {backfill.failure_code(exc)}')
            continue
        if backfill.is_results(filing, url, text):
            return filing, url, text
        log(f'{ticker} {filing["filed"]} skipped: not a results release')
    return None


def sweep(tickers, since, until, client=None, log=print):
    client = client or backfill.Client()
    ciks = {v['ticker']: v['cik_str'] for v in json.loads(client.get('https://www.sec.gov/files/company_tickers.json')[0]).values()}
    manifest = load_manifest()
    entries = {e['ticker']: e for e in manifest['releases']}
    for ticker in tickers:
        cik = ciks.get(ticker)
        found = latest(client, ticker, cik, since, until, log) if cik else None
        if not found:
            log(f'{ticker}: no results release found')
            continue
        filing, url, text = found
        write_text(ticker, text)
        directory = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{filing['accession'].replace('-', '')}"
        entries[ticker] = {'ticker': ticker, 'form': filing['form'], 'acceptedAt': flash.stamp(filing['accepted']),
                           'filingUrl': f"{directory}/{filing['primary']}", 'url': url,
                           'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(), **reading(ticker, text, url)}
        log(f"{ticker} {filing['filed']} {entries[ticker]['method']} {len(entries[ticker]['facts'])} facts")
    manifest['releases'] = [entries[t] for t in sorted(entries)]
    return manifest


def reread(tickers=None, log=print):
    """--cache: the stored texts read again with the current parsers; only period, method, facts and failure change."""
    manifest = load_manifest()
    for entry in manifest['releases']:
        if tickers and entry['ticker'] not in tickers:
            continue
        text = read_text(entry['ticker'])
        if hashlib.sha256(text.encode('utf-8')).hexdigest() != entry['sha256']:
            raise SystemExit(f"{entry['ticker']}: fixture text does not match the manifest's sha256")
        entry.update(reading(entry['ticker'], text, entry['url']))
        log(f"{entry['ticker']} {entry['period']} {entry['method']} {[f['key'] for f in entry['facts']]}")
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--ticker', action='append')
    parser.add_argument('--cache', action='store_true', help='re-read the stored fixtures; no network')
    parser.add_argument('--since', default=(date.today() - timedelta(days=120)).isoformat())
    parser.add_argument('--until', default=date.today().isoformat())
    args = parser.parse_args(argv)
    if args.cache:
        manifest = reread(args.ticker)
    else:
        if not args.ticker:
            parser.error('--ticker is required without --cache')
        manifest = sweep(args.ticker, args.since, args.until)
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
