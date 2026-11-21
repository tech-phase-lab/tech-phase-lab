from datetime import date, datetime, timezone
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import stock_splits
import web_push

AFTER = datetime(2026, 11, 21, 1, 0, tzinfo=timezone.utc)
PRE = {'ticker': 'SNDK', 'firm': 'Firm', 'previous': 1200, 'latest': 1400, 'publishedAt': '2026-11-18T12:00:00+00:00'}


class StockSplitTests(unittest.TestCase):
    def test_manual_list_has_sndk_eight_for_one_and_aph_2024(self):
        rows = stock_splits.known_splits()
        self.assertIn(('SNDK', date(2026, 11, 20), 8.0), rows)
        self.assertIn(('APH', date(2024, 6, 12), 2.0), rows)

    def test_old_target_is_pre_split_only_from_the_same_firms_pre_split_action(self):
        self.assertEqual(stock_splits.pre_split_previous('SNDK', 'Firm', 1400, 180, [PRE], AFTER), 8.0)
        self.assertIsNone(stock_splits.pre_split_previous('SNDK', 'Firm', 1400, 180, [], AFTER))
        self.assertIsNone(stock_splits.pre_split_previous('SNDK', 'Firm', 1400, 180, [{**PRE, 'firm': 'Other'}], AFTER))
        self.assertIsNone(stock_splits.pre_split_previous('SNDK', 'Firm', 1400, 180, [{**PRE, 'publishedAt': '2026-11-20T15:00:00+00:00'}], AFTER))
        self.assertIsNone(stock_splits.pre_split_previous('MU', 'Firm', 1400, 180, [PRE], AFTER))
        self.assertIsNone(stock_splits.pre_split_previous('SNDK', 'Firm', 1400, 180, [PRE], datetime(2027, 3, 1, tzinfo=timezone.utc)))

    def test_a_real_cut_after_a_two_for_one_stays_a_cut(self):
        splits = (('X', date(2027, 1, 5), 2.0),)
        earlier = [{'ticker': 'X', 'firm': 'F', 'latest': 90, 'publishedAt': '2027-01-02T15:00:00+00:00'}]
        self.assertIsNone(stock_splits.pre_split_previous('X', 'F', 100, 65, earlier, datetime(2027, 1, 11, tzinfo=timezone.utc), splits))

    def test_push_body_puts_the_old_target_on_todays_basis(self):
        original = stock_splits.pre_split_previous
        stock_splits.pre_split_previous = lambda *args, **kwargs: 8.0
        try:
            body = web_push.price_target_payload('SNDK', 'Firm', 1400, 180, True, 't', [PRE])['body']
        finally:
            stock_splits.pre_split_previous = original
        self.assertEqual(body, 'Firm: $175 → $180（旧目標$1400は8:1分割前）')
        self.assertEqual(web_push.price_target_payload('NVDA', 'Firm', 295, 340, False, 't')['body'], 'Firm: $295 → $340')

    def test_missing_file_means_no_split(self):
        stock_splits.known_splits.cache_clear()
        try:
            self.assertEqual(stock_splits.known_splits(Path('/nonexistent/stock-splits.json')), ())
        finally:
            stock_splits.known_splits.cache_clear()


if __name__ == '__main__':
    unittest.main()
