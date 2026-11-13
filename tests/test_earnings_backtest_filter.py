import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import earnings_backtest as backtest

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

if __name__=='__main__': unittest.main()
