"""DELL, NVDA and MU results briefs read from their real SEC releases (tests/fixtures/latest-releases and prior-releases), the way the
live flash and the monitor's previous-release backfill read them (issuer_result_flash.build after release_extras.supplement).

  python3 tests/earnings_release_briefs.py > tests/fixtures/earnings-release-briefs.json

tests/test_earnings_prior_backfill.py checks that the committed JSON is exactly what the parsers read today; the Node tests
(tests/earnings-release-briefs.test.mjs) build the calendar card and the X post from it.
"""
import gzip
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
import earnings_history_backfill as backfill  # noqa: E402
import issuer_result_flash as flash  # noqa: E402
import release_extras  # noqa: E402

TICKERS = ['DELL', 'NVDA', 'MU']


def brief(folder, ticker):
    manifest = json.loads((ROOT / 'tests/fixtures' / folder / 'manifest.json').read_text())[ticker]
    text = gzip.decompress((ROOT / 'tests/fixtures' / folder / f'{ticker}.txt.gz').read_bytes()).decode()
    parsed, _code = backfill.read_figures(ticker, manifest['url'], text)
    parsed = release_extras.supplement(text, parsed)
    _key, payload = flash.build(ticker, manifest['url'], parsed, manifest['accepted'].replace('+00:00', 'Z'))
    return {**payload, 'publicAt': payload['publishedAt'], 'processingMs': 0, 'sourceToDetectionMs': None, 'detectionToPublicMs': None}


def briefs():
    return {ticker: {'prior': brief('prior-releases', ticker), 'latest': brief('latest-releases', ticker)} for ticker in TICKERS}


if __name__ == '__main__':
    print(json.dumps(briefs(), ensure_ascii=False, indent=1))
