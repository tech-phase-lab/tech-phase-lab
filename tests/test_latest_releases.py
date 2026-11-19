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
# The full standard set (売上高・EPS（希薄化後）・調整後EPS・純利益・営業利益) for every company whose release states it, with the line a release
# genuinely lacks named per company (owner, Nov 19: IBM and IREN showed revenue only, Vistra net income only, Tesla two rounded figures).
FULL = ['revenue', 'eps', 'adjusted-eps', 'net-income', 'operating-income']
LACKS = {
    'IBM': {'operating-income': 'IBM prints no operating income line: its statement goes from gross profit to pre-tax income'},
    'IREN': {'eps': 'no per-share figure anywhere in the release', 'adjusted-eps': 'no per-share figure anywhere in the release'},
    'VST': {'eps': 'no per-share figure anywhere in the release', 'adjusted-eps': 'no per-share figure anywhere in the release'},
    'TSLA': {},
}
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

    def test_the_full_set_where_the_release_states_it(self):
        for ticker, lacks in LACKS.items():
            with self.subTest(ticker=ticker):
                parsed, code = backfill.read_figures(ticker, MANIFEST[ticker]['url'], text(ticker))
                self.assertIsNone(code)
                self.assertEqual(parsed.get('method', 'deterministic-issuer-table'), 'deterministic-issuer-table')
                self.assertEqual([f[0] for f in parsed['facts']], [k for k in FULL if k not in lacks])
                self.assertEqual(MANIFEST[ticker]['facts'], [k for k in FULL if k not in lacks])
                for key in lacks:  # the release has no such line (checked against the SEC document, Nov 19)
                    self.assertNotIn(key, [f[0] for f in parsed['facts']])

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

    def test_earlier_quarters_of_ibm_iren_vistra_tesla(self):
        # the three releases before the latest one, read in full; each figure checked against the SEC document (Nov 19)
        expected = {
            'IBM-q425': ('Q4 2025', [('revenue', '$19.686B', '$17.553B'), ('eps', '$5.86', '$3.11'), ('adjusted-eps', '$4.52', '$3.92'),
                                     ('net-income', '$5.6B', '$2.915B')]),
            'IBM-q126': ('Q1 2026', [('revenue', '$15.917B', '$14.541B'), ('eps', '$1.28', '$1.12'), ('adjusted-eps', '$1.91', '$1.60'),
                                     ('net-income', '$1.216B', '$1.055B')]),
            'IBM-q226': ('Q2 2026', [('revenue', '$17.162B', '$16.977B'), ('eps', '$2.27', '$2.31'), ('adjusted-eps', '$2.93', '$2.80'),
                                     ('net-income', '$2.165B', '$2.194B')]),
            # IREN's statement compares with the previous quarter, not a year earlier: no year-ago value
            'IREN-q2fy26': ('Q2 FY2026', [('revenue', '$184.7M', None), ('net-income', '$-155.4M', None), ('operating-income', '$-116.4M', None)]),
            'IREN-q3fy26': ('Q3 FY2026', [('revenue', '$144.8M', None), ('net-income', '$-247.8M', None), ('operating-income', '$-233.5M', None)]),
            'IREN-q4fy26': ('Q4 FY2026', [('revenue', '$137.2M', None), ('net-income', '$-684M', None), ('operating-income', '$-620.4M', None)]),
            'VST-q325': ('Q3 2025', [('revenue', '$4.971B', '$6.288B'), ('net-income', '$652M', '$1.888B'), ('operating-income', '$1.037B', '$2.588B')]),
            'VST-q126': ('Q1 2026', [('revenue', '$5.64B', '$3.933B'), ('net-income', '$1.029B', '$-268M'), ('operating-income', '$1.499B', '$-120M')]),
            'VST-q226': ('Q2 2026', [('revenue', '$4.017B', '$4.25B'), ('net-income', '$305M', '$327M'), ('operating-income', '$553M', '$515M')]),
            'TSLA-q425': ('Q4 2025', [('revenue', '$24.901B', '$25.707B'), ('eps', '$0.24', '$0.60'), ('adjusted-eps', '$0.50', '$0.60'),
                                      ('net-income', '$840M', '$2.128B'), ('operating-income', '$1.409B', '$1.583B')]),
            'TSLA-q126': ('Q1 2026', [('revenue', '$22.387B', '$19.335B'), ('eps', '$0.13', '$0.12'), ('adjusted-eps', '$0.41', '$0.27'),
                                      ('net-income', '$477M', '$409M'), ('operating-income', '$941M', '$399M')]),
            'TSLA-q226': ('Q2 2026', [('revenue', '$28.236B', '$22.496B'), ('eps', '$0.32', '$0.33'), ('adjusted-eps', '$0.33', '$0.40'),
                                      ('net-income', '$1.114B', '$1.172B'), ('operating-income', '$398M', '$923M')]),
        }
        for name, (period, facts) in expected.items():
            with self.subTest(release=name):
                release = gzip.decompress((ROOT / 'tests/fixtures/earlier-releases' / f'{name}.txt.gz').read_bytes()).decode()
                parsed, code = backfill.read_figures(name.split('-')[0], None, release)
                self.assertIsNone(code)
                self.assertEqual((parsed['period'], [f[:3] for f in parsed['facts']]), (period, facts))

    def test_vistra_fourth_quarter_release_has_no_quarterly_statement(self):
        # Vistra's Q4 2025 release prints the full year's statement only (the quarter's net income appears in a summary table alone):
        # the table parser reads nothing and no full-year figure is taken for the quarter
        release = gzip.decompress((ROOT / 'tests/fixtures/earlier-releases/VST-q425.txt.gz').read_bytes()).decode()
        with self.assertRaisesRegex(ValueError, 'period-unrecognized'):
            flash.parse_vistra(release)
        self.assertEqual(backfill.read_figures('VST', None, release), (None, 'period-unrecognized'))

    def test_the_roster_is_unchanged(self):
        self.assertEqual(deep_analysis.ROSTER, ROSTER)


if __name__ == '__main__':
    unittest.main()
