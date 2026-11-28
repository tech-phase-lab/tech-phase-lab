"""Every tracked company's latest results release, read the way the site reads it (owner, Nov 19).

QCOM and CEG reached the calendar's 「発表済みの結果」 with no figures (Qualcomm's quarter only in tables; Constellation's exhibit under its
co-registrant's directory). This finds, for each tracked company (lib/research/calendar-coverage.json), its latest results filing on
SEC EDGAR, reads the exhibit with the monitor's own SEC code, and runs the same parsers as the live flash and the backfill. It writes
each release's extracted text as a test fixture (tests/fixtures/latest-releases/<TICKER>.txt.gz) and a manifest of what was read, so
tests/test_latest_releases.py fails whenever a tracked company's latest release would show only 「決算を発表しました」 without a
documented reason.

Usage (public data only; ≤ 5 requests a second; generic User-Agent):
  python3 scripts/research/earnings_release_sweep.py --from 2026-06-01 --to 2026-11-19 --out tests/fixtures/latest-releases
  python3 scripts/research/earnings_release_sweep.py --from 2026-05-01 --to 2026-11-28 --previous --out tests/fixtures/prior-releases
"""
import argparse
import gzip
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import earnings_history_backfill as backfill  # noqa: E402


class CachedClient(backfill.Client):
    """The backfill client with an optional on-disk cache (a second run reads nothing from SEC)."""

    def __init__(self, cache=None):
        super().__init__()
        self.cache = Path(cache) if cache else None

    def get(self, url, attempts=3):
        path = self.cache / hashlib.sha256(url.encode()).hexdigest() if self.cache else None
        if path and path.exists():
            kind, body = path.read_bytes().split(b'\0', 1)
            return body, kind.decode()
        body, kind = super().get(url, attempts)
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(kind.encode() + b'\0' + body)
        return body, kind


def latest(client, ticker, cik, start, end, log=print, previous=False):
    """(filing, url, text, parsed, code) of the company's latest results release in the range (`previous`: the one before it, the
    previous quarter's release that the calendar's 会社予想 and 上方修正 are read from), or None."""
    found, before = None, None
    for filing in sorted(backfill.filings(client, cik, start, end), key=lambda f: f['accepted']):
        try:
            url, text = backfill.read_filing(client, ticker, cik, filing)
        except Exception as exc:  # noqa: BLE001
            log(f'{ticker} {filing["filed"]} unreadable {backfill.failure_code(exc)}')
            continue
        parsed, code = backfill.read_figures(ticker, url, text)
        if parsed is None and not backfill.is_results(filing, url, text):
            continue
        if found and parsed is None and found[3] is not None \
                and (filing['accepted'] - found[0]['accepted']).total_seconds() <= backfill.SAME_EVENT_SECONDS:
            continue  # the same results again without figures (an 8-K/A, a shareholder letter): the read filing stays
        if found and (filing['accepted'] - found[0]['accepted']).total_seconds() > backfill.SAME_EVENT_SECONDS:
            before = found
        found = (filing, url, text, parsed, code)
    return before if previous else found


def sweep(start, end, out, cache=None, tickers=None, log=print, previous=False):
    client = CachedClient(cache)
    coverage = json.loads(backfill.COVERAGE.read_text())
    ciks = {v['ticker']: v['cik_str'] for v in json.loads(client.get('https://www.sec.gov/files/company_tickers.json')[0]).values()}
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for ticker in tickers or [c['ticker'] for c in coverage]:
        old = manifest.get(ticker, {})
        found = latest(client, ticker, ciks[ticker], start, end, log, previous) if ticker in ciks else None
        if not found:
            manifest[ticker] = {'status': 'no-release', **({'reason': old['reason']} if old.get('reason') else {})}
            log(f'{ticker} no results release in range')
            continue
        filing, url, text, parsed, code = found
        (out / f'{ticker}.txt.gz').write_bytes(gzip.compress(text.encode(), mtime=0))
        manifest[ticker] = {
            'url': url, 'form': filing['form'], 'accepted': filing['accepted'].isoformat(),
            'status': 'figures' if parsed else 'announced-only', 'period': parsed['period'] if parsed else None,
            'facts': [f[0] for f in parsed['facts']] if parsed else [], 'failure': None if parsed else code,
            **({'reason': old['reason']} if old.get('reason') and not parsed else {}),
        }
        log(f'{ticker} {filing["filed"]} {manifest[ticker]["status"]} {manifest[ticker]["facts"] or code}')
    manifest_path.write_text(json.dumps(dict(sorted(manifest.items())), ensure_ascii=False, indent=1) + '\n')
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--from', dest='start', required=True)
    parser.add_argument('--to', dest='end', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--cache')
    parser.add_argument('--ticker', action='append')
    parser.add_argument('--previous', action='store_true', help="the release before each company's latest (tests/fixtures/prior-releases)")
    args = parser.parse_args(argv)
    manifest = sweep(args.start, args.end, args.out, args.cache, args.ticker, previous=args.previous)
    counts = {}
    for entry in manifest.values():
        counts[entry['status']] = counts.get(entry['status'], 0) + 1
    print(json.dumps(counts))


if __name__ == '__main__':
    main()
