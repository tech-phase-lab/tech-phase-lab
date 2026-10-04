"""Display-copy mistakes fall back without changing the underlying publication."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import compact_headlines


class CompactHeadlineTests(unittest.TestCase):
    def test_new_company_and_story_can_shorten_without_url_rules(self):
        result = {'shortTitleJa': 'Example、新AI基盤を発表',
                  'shortTitleEn': 'Example announces new AI platform'}
        self.assertEqual(compact_headlines.validated(result,
            'Exampleが新しいAI基盤を発表しました',
            'Example announces a new AI platform'), result)

    def test_sign_digit_quantity_and_status_errors_use_full_copy(self):
        cases = [
            ('利益-15%', 'Profit -15%', '利益+15%', 'Profit +15%'),
            ('利益15%', 'Profit 15%', '利益5%', 'Profit 5%'),
            ('売上15%、利益5%', 'Revenue 15%, profit 5%', '売上15%', 'Revenue 15%'),
            ('Exampleを買収予定', 'Plans to acquire Example', 'Exampleを買収済み', 'Acquired Example'),
            ('Exampleを買収する可能性', 'May acquire Example', 'Exampleを買収予定', 'Will acquire Example'),
            ('買収を否定', 'Denies acquisition', '買収', 'Acquisition'),
        ]
        for ja, en, short_ja, short_en in cases:
            with self.subTest(en=en):
                self.assertEqual(compact_headlines.validated(
                    {'shortTitleJa':short_ja, 'shortTitleEn':short_en}, ja, en), {})

    def test_missing_or_malformed_optional_pair_is_not_a_publication_error(self):
        for result in ({}, {'shortTitleJa':None,'shortTitleEn':None},
                       {'shortTitleJa':'速報','shortTitleEn':'Bad\x00copy'},
                       {'shortTitleJa':'速報','shortTitleEn':'Bad\rcopy'}):
            self.assertEqual(compact_headlines.validated(result, '速報です', 'Breaking news'), {})
