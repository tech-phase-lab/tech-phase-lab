"""IBM, IREN, Vistra and Tesla: their latest real releases read by their own table parsers (Nov 19).

The fixtures are the SEC 8-K EX-99.1 texts in tests/fixtures/latest-releases (see manifest.json for the URLs). Every figure below was
checked by hand against the release; a changed digit anywhere in a cross-checked chain must drop the figure, never publish a wrong one.
"""
import gzip
import hashlib
import json
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'research'))
import issuer_result_flash as flash  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / 'fixtures'
LATEST = FIXTURES / 'latest-releases'
PARSERS = {'IBM': flash.parse_ibm, 'IREN': flash.parse_iren, 'TSLA': flash.parse_tesla, 'VST': flash.parse_vistra}
EXPECTED = {
    'IBM': ('Q3 2026', [('revenue', '$17.103B', '$16.331B'), ('eps', '$2.30', '$1.84'), ('adjusted-eps', '$2.95', '$2.65'),
                        ('net-income', '$2.19B', '$1.744B')]),
    # IREN compares with the previous quarter (June 30, 2026), not the year-ago quarter: no year-ago values are published.
    'IREN': ('Q1 FY2027', [('revenue', '$228M', None), ('net-income', '$-263M', None), ('operating-income', '$-186M', None)]),
    'TSLA': ('Q3 2026', [('revenue', '$28.046B', '$28.095B'), ('eps', '$0.22', '$0.39'), ('adjusted-eps', '$0.48', '$0.50'),
                         ('net-income', '$787M', '$1.373B'), ('operating-income', '$718M', '$1.624B')]),
    'VST': ('Q3 2026', [('revenue', '$6.347B', '$4.971B'), ('net-income', '$1.14B', '$652M'), ('operating-income', '$1.706B', '$1.037B')]),
}


def text(ticker):
    return gzip.decompress((LATEST / f'{ticker}.txt.gz').read_bytes()).decode('utf-8')


def keys(parsed):
    return [f[0] for f in parsed['facts']]


class LatestReleases(unittest.TestCase):
    def test_each_release_is_read_from_its_table(self):
        for ticker, (period, facts) in EXPECTED.items():
            with self.subTest(ticker=ticker):
                parsed = flash.parse_with_sentences(ticker, text(ticker), 'https://www.sec.gov/x')
                self.assertNotIn('method', parsed)  # the table parser, not the sentence fallback
                self.assertEqual(parsed['period'], period)
                self.assertEqual(parsed['facts'], facts)

    def test_manifest_matches_fixtures_and_parsers(self):
        manifest = json.loads((LATEST / 'manifest.json').read_text())
        self.assertEqual({e['ticker'] for e in manifest['releases']}, set(EXPECTED))
        for entry in manifest['releases']:
            with self.subTest(ticker=entry['ticker']):
                body = text(entry['ticker'])
                self.assertEqual(hashlib.sha256(body.encode('utf-8')).hexdigest(), entry['sha256'])
                self.assertTrue(entry['url'].startswith('https://www.sec.gov/Archives/edgar/data/'))
                parsed = flash.parse_with_sentences(entry['ticker'], body, entry['url'])
                self.assertEqual(entry['period'], parsed['period'])
                self.assertEqual(entry['method'], 'deterministic-issuer-table')
                self.assertEqual([(f['key'], f['value'], f['yearAgo']) for f in entry['facts']], parsed['facts'])

    def test_profiles_keep_the_sentence_pickup_and_fallback(self):
        for ticker, parser in PARSERS.items():
            profile = flash.PROFILES[ticker]
            self.assertIs(profile['parse'], parser)
            self.assertTrue(profile.get('sentences-fallback'))
            self.assertNotIn('marker', profile)  # picked up like the sentence-only companies
            self.assertNotIn('sentences-only', profile)

    def test_head_only_text_falls_back_to_the_sentences(self):
        for ticker, name in (('IBM', 'ibm-results-q326-head.txt'), ('IREN', 'iren-results-q1fy27-head.txt'),
                             ('VST', 'vistra-results-q326-head.txt'), ('TSLA', 'tesla-update-q326-head.txt')):
            with self.subTest(ticker=ticker):
                head = (FIXTURES / name).read_text()
                with self.assertRaises(ValueError):
                    PARSERS[ticker](head)
                parsed = flash.parse_with_sentences(ticker, head, 'https://www.sec.gov/x')
                self.assertEqual(parsed['method'], 'issuer-highlight-sentences')

    def test_full_text_sentence_reading_is_still_available(self):
        # the fallback reader is unchanged: it still reads the same release's highlight sentences
        self.assertEqual([f[:2] for f in flash.sentences(text('IBM'))['facts']], [('revenue', '$17.1B')])

    # ---- a changed digit drops the figure (or the whole table reading), never publishes it ---------------------------------------

    def tampered(self, ticker, old, new, count=1):
        """The release with its first occurrence of `old` (which occurs `count` times: the statement comes first) changed."""
        body = flash.clean(text(ticker))
        self.assertEqual(body.count(old), count, old)
        return body.replace(old, new, 1)

    def test_ibm_revenue_must_agree_with_the_headline(self):
        with self.assertRaisesRegex(ValueError, 'change-mismatch'):
            flash.parse_ibm(self.tampered('IBM', 'TOTAL REVENUE 17,103 16,331', 'TOTAL REVENUE 17,603 16,331'))
        with self.assertRaisesRegex(ValueError, 'change-mismatch'):  # 17,103 / 15,331 is up 12 percent, not 5
            flash.parse_ibm(self.tampered('IBM', 'TOTAL REVENUE 17,103 16,331', 'TOTAL REVENUE 17,103 15,331'))

    def test_ibm_net_income_chain(self):
        parsed = flash.parse_ibm(self.tampered('IBM', 'NET INCOME $ 2,190 $ 1,744', 'NET INCOME $ 2,290 $ 1,744'))
        self.assertEqual(keys(parsed), ['revenue'])  # net income, and the EPS and operating EPS checked through it, are dropped
        parsed = flash.parse_ibm(self.tampered('IBM', 'Provision for/(benefit from) income taxes 298 686', 'Provision for/(benefit from) income taxes 298 696'))
        self.assertEqual(keys(parsed), ['revenue'])

    def test_ibm_eps_checks(self):
        parsed = flash.parse_ibm(self.tampered('IBM', 'TOTAL $ 2.30 $ 1.84', 'TOTAL $ 2.40 $ 1.84'))
        self.assertEqual(keys(parsed), ['revenue', 'net-income'])
        # operating EPS: GAAP + adjustments must equal the operating column
        parsed = flash.parse_ibm(self.tampered('IBM', '$ 2.31 $ 0.57 $ 0.07 $ — $ 2.95', '$ 2.31 $ 0.67 $ 0.07 $ — $ 2.95'))
        self.assertEqual(keys(parsed), ['revenue', 'eps', 'net-income'])
        # and the summary's stated year-to-year change (11 %) must agree with $2.95 against $2.65
        parsed = flash.parse_ibm(self.tampered('IBM', '9 % 0.7 Pts 12 % 11 %', '9 % 0.7 Pts 12 % 21 %'))
        self.assertEqual(keys(parsed), ['revenue', 'eps', 'net-income'])

    def test_ibm_period_and_columns(self):
        with self.assertRaisesRegex(ValueError, 'columns-unrecognized'):
            flash.parse_ibm(self.tampered('IBM', 'Nine Months Ended September 30, 2026 2025 2026 2025 REVENUE',
                                          'Nine Months Ended September 30, 2025 2026 2025 2026 REVENUE'))
        with self.assertRaisesRegex(ValueError, 'columns-unrecognized'):
            flash.parse_ibm(self.tampered('IBM', 'announced third-quarter 2026 earnings', 'announced second-quarter 2026 earnings'))

    def test_iren_chain_and_headline(self):
        with self.assertRaisesRegex(ValueError, 'change-mismatch'):  # the summary table's revenue must equal the statement's
            flash.parse_iren(self.tampered('IREN', 'Bitcoin Mining revenue 28 67 Total revenue 228 137', 'Bitcoin Mining revenue 28 67 Total revenue 238 137'))
        with self.assertRaisesRegex(ValueError, 'change-mismatch'):  # 'increased 66% sequentially': 228 / 137
            flash.parse_iren(self.tampered('IREN', 'increased 66% sequentially', 'increased 76% sequentially'))
        parsed = flash.parse_iren(self.tampered('IREN', 'Total operating (expenses) income (368) (724)', 'Total operating (expenses) income (378) (724)'))
        self.assertEqual(keys(parsed), ['revenue'])
        parsed = flash.parse_iren(self.tampered('IREN', 'Income tax (expense) benefit (2) 8', 'Income tax (expense) benefit (2) 18'))
        self.assertEqual(keys(parsed), ['revenue', 'operating-income'])

    def test_iren_year_ago_only_from_a_year_ago_column(self):
        # were the second column the year-ago quarter, its values would be published as year-ago figures
        body = self.tampered('IREN', 'Quarter ended Quarter ended September 30, 20261 June 30, 2026 Revenue AI Cloud Services',
                             'Quarter ended Quarter ended September 30, 20261 September 30, 2025 Revenue AI Cloud Services')
        with self.assertRaisesRegex(ValueError, 'change-mismatch'):  # ...but the headline says 'sequentially', so nothing is read
            flash.parse_iren(body)

    def test_vistra_chains(self):
        with self.assertRaisesRegex(ValueError, 'statement-mismatch'):
            flash.parse_vistra(self.tampered('VST', 'Operating costs (683) (655)', 'Operating costs (693) (655)'))
        parsed = flash.parse_vistra(self.tampered('VST', 'Income tax expense (356) (204)', 'Income tax expense (366) (204)'))
        self.assertEqual(keys(parsed), ['revenue', 'operating-income'])
        # net income must also match the highlight sentence
        parsed = flash.parse_vistra(self.tampered('VST', 'Net Income of $1,140 million, including', 'Net Income of $1,150 million, including'))
        self.assertEqual(keys(parsed), ['revenue', 'operating-income'])
        # a broken statement still leaves the sentence reading through the profile
        broken = self.tampered('VST', 'Operating costs (683) (655)', 'Operating costs (693) (655)')
        self.assertEqual(flash.parse_with_sentences('VST', broken, 'https://www.sec.gov/x')['method'], 'issuer-highlight-sentences')

    def test_tesla_chains(self):
        parsed = flash.parse_tesla(self.tampered('TSLA', 'Gross profit 5,054 5,009 4,720 4,751 5,494', 'Gross profit 5,054 5,009 4,720 4,751 5,594'))
        self.assertEqual(keys(parsed), ['revenue'])
        parsed = flash.parse_tesla(self.tampered('TSLA', 'Provision for income taxes 570 325 257 201 152', 'Provision for income taxes 570 325 257 201 162', count=2))
        self.assertEqual(keys(parsed), ['revenue', 'operating-income'])
        parsed = flash.parse_tesla(self.tampered('TSLA', 'Diluted $ 0.39 $ 0.24 $ 0.13 $ 0.32 $ 0.22', 'Diluted $ 0.39 $ 0.24 $ 0.13 $ 0.32 $ 0.25'))
        self.assertEqual(keys(parsed), ['revenue', 'net-income', 'operating-income'])
        # non-GAAP EPS: GAAP + the per-share adjustments
        parsed = flash.parse_tesla(self.tampered('TSLA', 'net of tax, per share 0.13 0.19 0.23 0.29 0.28', 'net of tax, per share 0.13 0.19 0.23 0.29 0.38'))
        self.assertEqual(keys(parsed), ['revenue', 'eps', 'net-income', 'operating-income'])
        # the summary's revenue must equal the statement's
        with self.assertRaisesRegex(ValueError, 'change-mismatch'):
            flash.parse_tesla(self.tampered('TSLA', 'Services and other revenue 3,475 3,371 3,745 4,581 4,605 Total revenues 28,095 24,901 22,387 28,236 28,046',
                                            'Services and other revenue 3,475 3,371 3,745 4,581 4,605 Total revenues 28,095 24,901 22,387 28,236 28,146'))

    def test_tesla_columns_must_end_with_the_titled_quarter(self):
        with self.assertRaisesRegex(ValueError, 'columns-unrecognized'):
            flash.parse_tesla(text('TSLA').replace('Q3 2026 Update', 'Q2 2026 Update', 1))


if __name__ == '__main__':
    unittest.main()
