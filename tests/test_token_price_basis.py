"""Token prices keep their denominator, currency, role and introductory phase."""
from collections import Counter
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import factual_validation as validation
import token_pricing


class TokenPriceBasisTests(unittest.TestCase):
    SOURCE = ('A synthetic service will launch at an introductory price\n1\nof $2 per million input tokens '
              'and $10 per million output tokens, with cached input tokens priced at 95% off input token price.')
    JA = '導入価格は入力100万トークンあたり$2、出力100万トークンあたり$10で、キャッシュ済み入力は入力料金から95%割引となる予定。'
    EN = ('It will launch at an introductory price of $2 per million input tokens and $10 per million output tokens, '
          'with cached input priced at 95% off the input token price.')

    def test_implicit_one_and_explicit_million_price_bases_are_equivalent(self):
        for en in (self.EN, self.EN.replace('per million', 'per 1 million'), self.EN.replace('per million', 'per 1M')):
            for ja in (self.JA, self.JA.replace('100万トークン', 'トークン100万'),
                       self.JA.replace('$2', '2ドル').replace('$10', '10ドル')):
                with self.subTest(ja=ja, en=en):
                    validation.validate_numbers(ja, self.SOURCE)
                    validation.validate_numbers(en, self.SOURCE)
                    validation.validate_pair(ja, en)
                    self.assertEqual(validation.number_checks({'ja': ja, 'en': en, 'evidenceQuote': self.SOURCE}), [])
        values = validation.numeric_values('$2 per million input tokens')
        self.assertIn((Decimal(1000000), 'per-input-tokens'), values)
        self.assertNotIn((Decimal(1000000), 'number'), values)

    def test_denominator_changed_by_order_of_magnitude_is_rejected(self):
        for wrong in (self.JA.replace('100万', '1000万'), self.EN.replace('per million', 'per 10 million'),
                      self.JA.replace('100万', '10万'), self.EN.replace('per million', 'per 0.1 million')):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                validation.validate_numbers(wrong, self.SOURCE)

    def test_price_role_swap_cannot_borrow_matching_global_quantities(self):
        for wrong in (self.JA.replace('$2', '$X').replace('$10', '$2').replace('$X', '$10'),
                      self.EN.replace('$2', '$X').replace('$10', '$2').replace('$X', '$10')):
            self.assertEqual(Counter(validation.numeric_values(wrong)), Counter(validation.numeric_values(self.JA)))
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                validation.validate_numbers(wrong, self.SOURCE)

    def test_wrong_currency_cannot_borrow_the_same_numbers(self):
        for wrong in (self.JA.replace('$', '€'), self.EN.replace('$', '£')):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                validation.validate_numbers(wrong, self.SOURCE)

    def test_introductory_period_is_not_regular_or_unconditional_pricing(self):
        for wrong in (self.JA.replace('導入価格', '導入期間終了後の価格'),
                      self.EN.replace('an introductory price', 'a price after the introductory period'),
                      self.JA.replace('導入価格', '価格'), self.EN.replace('introductory ', '')):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                validation.validate_numbers(wrong, self.SOURCE)
        source = 'After the introductory period expires, the price of $4 per 1M input tokens and $20 per 1M output tokens will apply.'
        ja = '導入期間終了後は入力100万トークンあたり$4、出力100万トークンあたり$20を適用する。'
        en = 'After the introductory period, pricing will be $4 per 1M input tokens and $20 per 1M output tokens.'
        validation.validate_numbers(ja, source)
        validation.validate_pair(ja, en)
        with self.assertRaisesRegex(ValueError, 'unsupported-number'):
            validation.validate_numbers(ja.replace('導入期間終了後', '導入価格'), source)

    def test_price_phase_does_not_leak_across_a_complete_sentence(self):
        source = 'Introductory pricing is under discussion. The current price is $2 per million input tokens.'
        self.assertEqual(next(iter(token_pricing.token_prices(source)))[-1], 'unspecified')
        with self.assertRaisesRegex(ValueError, 'unsupported-number'):
            validation.validate_numbers('導入価格は入力100万トークンあたり$2。', source)

    def test_denominator_does_not_supply_unrelated_million_or_one(self):
        source = '$2 per million input tokens'
        for wrong in ('100万人に2ドル。', '1年で2ドル。', '$2 per million output tokens',
                      '入力100万文字あたり$2', '入力100万あたり$2', '$2 per million input characters'):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                validation.validate_numbers(wrong, source)
        self.assertEqual(token_pricing.bases('One million people use the input screen.'), [])
        self.assertEqual(token_pricing.bases('入力100万文字あたり$2'), [])

    def test_repeated_bases_retain_bilingual_counts_and_cached_role(self):
        with self.assertRaisesRegex(ValueError, 'unsupported-number'):
            validation.validate_pair('入力100万トークンあたり$2、入力100万トークンあたり$2。', '$2 per million input tokens.')
        with self.assertRaisesRegex(ValueError, 'unsupported-number'):
            validation.validate_numbers('$2 per million cached input tokens', '$2 per million input tokens')
        validation.validate_pair('キャッシュ済み入力100万トークンあたり$2。', '$2 per million cached input tokens.')

    def test_unparsed_money_connectors_fail_closed_instead_of_empty_relation_set(self):
        en = 'Introductory pricing is $10 USD per million input tokens and $2 USD per million output tokens.'
        ja = '導入価格は入力100万トークンあたりの料金が$10、出力100万トークンあたりの料金が$2。'
        for wrong in (en, ja, ja.replace('$10', '10ドル').replace('$2', '2ドル'),
                      en.replace('$10 USD', 'USD 10').replace('$2 USD', 'USD 2'),
                      en.replace('$10 USD', '10 US dollars').replace('$2 USD', '2 US dollars'),
                      en.replace('$10 USD', '10').replace('$2 USD', '2')):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                validation.validate_numbers(wrong, self.SOURCE)
        with self.assertRaisesRegex(ValueError, 'unsupported-number'):
            validation.validate_pair(ja, en)

    def test_after_introductory_pricing_cannot_use_introductory_rates(self):
        for wrong in ('After introductory pricing, the price is $2 per million input tokens and $10 per million output tokens.',
                      'Post-introductory pricing is $2 per million input tokens and $10 per million output tokens.',
                      '導入価格終了後は入力100万トークンあたり$2、出力100万トークンあたり$10。',
                      'These are not introductory prices: $2 per million input tokens and $10 per million output tokens.',
                      'Non-introductory pricing is $2 per million input tokens and $10 per million output tokens.',
                      '導入価格ではありませんが、入力100万トークンあたり$2、出力100万トークンあたり$10。',
                      '導入価格ではない。入力100万トークンあたり$2、出力100万トークンあたり$10。'):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                validation.validate_numbers(wrong, self.SOURCE)

    def test_nested_price_guard_change_invalidates_warm_success(self):
        import official_research as research
        item = {'ja': self.JA, 'en': self.EN, 'evidenceQuote': self.SOURCE}
        title = {'ja': 'サービス料金', 'en': 'Service pricing', 'evidenceQuote': self.SOURCE}
        note = {'title': title, 'summary': item, 'facts': [deepcopy(item) for _ in range(3)], 'purpose': item}
        with patch.object(research, '_validation_success', research.ValidationSuccess()):
            research.validate(deepcopy(note), self.SOURCE, 'Service pricing')
            with patch.object(token_pricing, 'token_prices', side_effect=ValueError('unsupported-number')):
                with self.assertRaisesRegex(ValueError, 'unsupported-number'):
                    research.validate(deepcopy(note), self.SOURCE, 'Service pricing')


if __name__ == '__main__':
    unittest.main()
