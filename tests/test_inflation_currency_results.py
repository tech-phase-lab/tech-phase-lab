"""Oct 11: U.S. inflation flashes and non-USD earnings (synthetic posts)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import market_results as results

CPI = '''U.S. SEPTEMBER CPI 👇

CPI MoM 0.3%, (Est. 0.3%)
CPI YoY 2.9%, (Est. 2.9%)

CORE CPI MoM 0.3%, (Est. 0.3%)
CORE CPI YoY 3.1%, (Est. 3.1%)'''


def values(item):
    return {fact['key']: fact['value'] for fact in item['facts']}


class InflationTests(unittest.TestCase):
    def test_headline_and_core_keep_their_monthly_and_annual_basis(self):
        item = results.projection(CPI, ['ECON'])
        self.assertEqual(values(item), {'cpi-mom': '0.3%', 'cpi-yoy': '2.9%', 'core-cpi-mom': '0.3%', 'core-cpi-yoy': '3.1%'})
        self.assertEqual(item['titleJa'], '米国CPI（9月）：前月比 0.3%、前年比 2.9%、コア前月比 0.3%、コア前年比 3.1%')
        self.assertEqual(item['period'], 'SEPTEMBER U.S. CPI')
        self.assertEqual(item['facts'][1]['comparisons'], {'forecast': '2.9%'})

    def test_other_layouts_and_indices(self):
        self.assertEqual(values(results.projection('US CPI YoY ACTUAL 2.9%; EST 2.9%; PREV 2.7%', ['ECON'])), {'cpi-yoy': '2.9%'})
        self.assertEqual(values(results.projection('CPI: 0.3% MoM (est. 0.2%)', ['ECON'])), {'cpi-mom': '0.3%'})
        self.assertEqual(values(results.projection('US PPI MoM: -0.1%', ['ECON'])), {'ppi-mom': '-0.1%'})

    def test_ambiguous_previews_foreign_and_conflicting_posts_are_withheld(self):
        for text in ('CPI 2.9%', 'CPI YoY Est. 2.9%', 'CPI tomorrow expected 0.3% MoM', 'Eurozone CPI YoY 2.1%',
                     'CPI MoM 0.3% YoY 2.9%', 'CPI YoY 2.9%\nCPI YoY 3.0%', CPI + '\nCORE CPI 3.1% annualized'):
            with self.subTest(text=text):
                self.assertIsNone(results.projection(text, ['ECON']))

    def test_jobs_reports_are_unchanged(self):
        text = 'SEPTEMBER U.S. JOBS REPORT\nNONFARM PAYROLLS +29K, (Est. +90K)\nUNEMPLOYMENT RATE 4.2%, (Est. 4.1%)'
        self.assertEqual(values(results.projection(text, ['ECON'])), {'nonfarm-payrolls': '+29K', 'unemployment-rate': '4.2%'})


class CurrencyTests(unittest.TestCase):
    def test_euro_nt_dollar_and_won_keep_the_reported_currency(self):
        asml = results.projection('$ASML Q3 earnings: Revenue €7.52B, EPS €5.48. Q4 guidance: Revenue €9.2B ± €0.3B', ['ASML'])
        self.assertEqual(values(asml), {'revenue': '€7.52B', 'eps': '€5.48', 'guidance-revenue': '€9.2B ± €0.3B'})
        tsm = results.projection('$TSM Q3 2026 results: Revenue NT$989.9B, EPS NT$17.40', ['TSM'])
        self.assertEqual(values(tsm), {'revenue': 'NT$989.9B', 'eps': 'NT$17.40'})
        self.assertEqual(values(results.projection('$ASML Q3 earnings: Revenue EUR 7.52B, EPS EUR 5.48', ['ASML'])),
                         {'revenue': '€7.52B', 'eps': '€5.48'})
        self.assertEqual(values(results.projection('$SKHY Q3 earnings: Revenue ₩24.4T', ['SKHY'])), {'revenue': '₩24.4T'})

    def test_no_currency_is_assumed_and_words_are_not_units(self):
        self.assertIsNone(results.projection('$TSM Q3 results: Revenue 989.9B, EPS 17.40', ['TSM']))
        item = results.projection('$NVDA Q2 earnings: Revenue $46.7B, Adj. EPS $1.05 This beat estimates', ['NVDA'])
        self.assertEqual(values(item), {'revenue': '$46.7B', 'eps': '$1.05'})


if __name__ == '__main__':
    unittest.main()
