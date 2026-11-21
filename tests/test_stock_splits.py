from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import stock_splits
import web_push

AFTER = datetime(2026, 11, 21, 1, 0, tzinfo=timezone.utc)


class StockSplitTests(unittest.TestCase):
    def test_manual_list_has_sndk_eight_for_one(self):
        rows = [row for row in stock_splits.known_splits() if row[0] == 'SNDK']
        self.assertEqual([(row[1].isoformat(), row[2]) for row in rows], [('2026-11-20', 8.0)])

    def test_pre_split_old_target_is_recognized_only_near_the_ratio(self):
        self.assertEqual(stock_splits.pre_split_previous('SNDK', 1400, 175, AFTER), 8.0)
        self.assertIsNone(stock_splits.pre_split_previous('SNDK', 175, 150, AFTER))
        self.assertIsNone(stock_splits.pre_split_previous('MU', 1400, 175, AFTER))
        self.assertIsNone(stock_splits.pre_split_previous('SNDK', 1400, 175, datetime(2026, 11, 19, 15, 0, tzinfo=timezone.utc)))
        self.assertIsNone(stock_splits.pre_split_previous('SNDK', 1400, 175, datetime(2027, 3, 1, tzinfo=timezone.utc)))

    def test_push_body_puts_the_old_target_on_todays_basis(self):
        with mock.patch.object(stock_splits, 'pre_split_previous', lambda *args: 8.0):
            body = web_push.price_target_payload('SNDK', 'Firm', 1400, 180, True, 't')['body']
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
