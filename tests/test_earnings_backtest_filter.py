import json
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
FX=ROOT/'tests/fixtures'
sys.path.insert(0,str(ROOT/'scripts/research'))
import earnings_backtest as backtest
import deep_analysis
import issuer_result_flash as flash

class ResultsExhibit(unittest.TestCase):
    def test_a_results_release_names_results_and_a_period(self):
        yes=['EX-99.1 Oracle Announces Q1 Results Driven by Triple Digit Growth in Cloud Infrastructure Revenues',   # Q1 notation, no word "quarter" (Nov 13)
             'Applied Materials Announces Fourth Quarter and Fiscal Year 2026 Results','Acme Reports Full-Year Earnings',
             'Marvell Reports Second Quarter of Fiscal Year 2027 Financial Results']
        no=['Oracle announces appointment of a new director','Acme declares a quarterly dividend','Acme to report results on December 10',   # a period word without results, results without a period
            'Results of the annual meeting of shareholders']
        for text in yes: self.assertTrue(backtest.is_results_exhibit(text),text)
        for text in no: self.assertFalse(backtest.is_results_exhibit(text),text)
    def test_only_the_top_of_the_release_counts(self):
        self.assertFalse(backtest.is_results_exhibit('x'*3000+' Q1 results'))
    def test_tesla_update_is_results_and_its_deliveries_report_is_not(self):
        # Nov 20: Tesla's "Q3 2026 Update" names neither results nor earnings, and its deliveries report "achieves these results"
        self.assertTrue(backtest.is_results_exhibit((FX/'tesla-update-q326-head.txt').read_text()))
        self.assertFalse(backtest.is_results_exhibit((FX/'tesla-deliveries-q326-head.txt').read_text()))

class Watch(unittest.TestCase):
    def test_the_daily_check_covers_every_calendar_company(self):
        # owner, Nov 20: every company on the earnings calendar, not only the 22 deep-analysis companies (which stay first)
        coverage=[row['ticker'] for row in json.loads((ROOT/'lib/research/calendar-coverage.json').read_text())]
        self.assertEqual(len(backtest.WATCH),len(set(backtest.WATCH)))
        self.assertEqual(sorted(backtest.WATCH),sorted(coverage))
        self.assertEqual(backtest.WATCH[:22],deep_analysis.ROSTER)
        self.assertEqual([t for t in backtest.WATCH if t not in flash.PROFILES],[])  # a failing company is then always a regression

if __name__=='__main__': unittest.main()
