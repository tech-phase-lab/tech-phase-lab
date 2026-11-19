"""Every tracked company's latest real results release must reach the calendar with figures (owner, Nov 19).

QCOM (Nov 4) and CEG (Nov 9) showed only 「決算を発表しました」 for two weeks. tests/fixtures/latest-releases holds the extracted text of
each tracked company's latest results release on SEC EDGAR, written by scripts/research/earnings_release_sweep.py with the monitor's
own SEC exhibit code. Each one is read here exactly as the live flash and the backfill read it; the test fails when a release yields
no figures (or fewer kinds of figures than were read when the fixture was taken) unless DOCUMENTED below says why.
"""
import gzip
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
import deep_analysis  # noqa: E402
import earnings_history_backfill as backfill  # noqa: E402
import issuer_result_flash as flash  # noqa: E402

FX = ROOT / 'tests/fixtures/latest-releases'
MANIFEST = json.loads((FX / 'manifest.json').read_text())
TRACKED = [c['ticker'] for c in json.loads((ROOT / 'lib/research/calendar-coverage.json').read_text())]
# A latest release that may stay without figures, with the reason. Empty: every tracked company's latest release is read.
DOCUMENTED = {}
ROSTER = ['MU', 'SKHY', 'SNDK', 'NBIS', 'NVDA', 'AMD', 'AVGO', 'ARM', 'TSM', 'ASML', 'MRVL', 'ANET', 'CRDO', 'CRWV', 'VRT', 'GEV', 'DELL', 'PLTR',
          'MSFT', 'AMZN', 'GOOGL', 'ORCL']


def text(ticker):
    return gzip.decompress((FX / f'{ticker}.txt.gz').read_bytes()).decode()


class LatestReleases(unittest.TestCase):
    def test_every_tracked_company_has_its_latest_release(self):
        self.assertEqual(len(TRACKED), 50)
        self.assertEqual(sorted(MANIFEST), sorted(TRACKED))
        for ticker in TRACKED:
            with self.subTest(ticker=ticker):
                entry = MANIFEST[ticker]
                if entry['status'] == 'no-release':
                    self.assertIn(ticker, DOCUMENTED, 'no results release found: document why or refresh the sweep')
                    continue
                self.assertTrue((FX / f'{ticker}.txt.gz').exists())
                self.assertTrue(entry['url'].startswith('https://www.sec.gov/Archives/edgar/data/'))

    def test_every_latest_release_yields_figures(self):
        for ticker in TRACKED:
            entry = MANIFEST[ticker]
            if entry['status'] == 'no-release':
                continue
            with self.subTest(ticker=ticker):
                parsed, code = backfill.read_figures(ticker, entry['url'], text(ticker))
                if parsed is None:
                    self.assertIn(ticker, DOCUMENTED, f'{ticker} latest release would show only 「決算を発表しました」 ({code})')
                    continue
                self.assertEqual(entry['status'], 'figures')
                self.assertEqual(parsed['period'], entry['period'])
                # no kind of figure read when the fixture was taken may disappear
                self.assertEqual(sorted(set(entry['facts']) - {f[0] for f in parsed['facts']}), [])

    def test_every_tracked_company_is_tried_by_the_live_flash(self):
        # the live flash only reads companies with a profile: a tracked company without one never gets figures
        self.assertEqual([t for t in TRACKED if t not in flash.PROFILES], [])

    def test_earlier_quarters_of_the_new_parsers(self):
        # Qualcomm and Constellation change their tables from quarter to quarter (footnote marks, one-column first quarters, the
        # fourth quarter's full-year reconciliation): every release of the last year is read in full
        expected = {
            'QCOM-q1fy26': ('Q1 FY2026', '$12.252B'), 'QCOM-q2fy26': ('Q2 FY2026', '$10.599B'), 'QCOM-q3fy26': ('Q3 FY2026', '$9.947B'),
            'CEG-q425': ('Q4 2025', '$6.074B'), 'CEG-q126': ('Q1 2026', '$11.122B'), 'CEG-q226': ('Q2 2026', '$7.504B'),
        }
        for name, (period, revenue) in expected.items():
            with self.subTest(release=name):
                release = gzip.decompress((ROOT / 'tests/fixtures/earlier-releases' / f'{name}.txt.gz').read_bytes()).decode()
                parsed, _code = backfill.read_figures(name.split('-')[0], None, release)
                self.assertEqual(parsed['period'], period)
                self.assertEqual([f[0] for f in parsed['facts']], ['revenue', 'eps', 'adjusted-eps', 'net-income', 'operating-income'])
                self.assertEqual(parsed['facts'][0][1], revenue)

    def test_the_roster_is_unchanged(self):
        self.assertEqual(deep_analysis.ROSTER, ROSTER)


if __name__ == '__main__':
    unittest.main()
