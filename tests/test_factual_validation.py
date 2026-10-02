from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import factual_validation as validation


class FactualValidationTests(unittest.TestCase):
    def test_real_headline_calendar_and_amount_formats_keep_exact_values(self):
        for source, ja in (
            ('Acquisition announced October 1, 2026', '買収を2026年10月1日に発表'),
            ('Reports Fourth-Quarter and Full-Year 2026 Results', '2026年度第4四半期の決算'),
            ('Declares fourth quarter 2026 dividend', '2026年第4四半期の配当'),
            ('2027–2028 fellowships with awards up to $60,000', '2027〜2028年、最大6万ドル'),
            ('Second Quarter 2026 EPS growth 53% (adjusted growth +60%)', '2026年第2四半期、EPS53％増、調整後60％増'),
            ('Announces a $150 Billion repurchase authorization', '自社株買い枠を1500億ドルに'),
            ('Join us on October 1 for a clinical speech AI session', '10月1日に医療音声AIの説明会'),
        ):
            with self.subTest(source=source):
                validation.validate_numbers(ja, source)

    def test_changed_digit_sign_scale_date_and_quarter_are_rejected(self):
        for source, wrong in (
            ('$150 billion', '150億ドル'), ('$150 billion', '-1500億ドル'),
            ('$150 billion', '1500万ドル'), ('$150 billion', '1501億ドル'),
            ('Awards up to $60,000', '最大60万ドル'),
            ('October 1, 2026', '2026年1月10日'), ('October 1, 2026', '2027年10月1日'),
            ('Fourth quarter 2026, revenue $2 billion', '2026年第2四半期'),
            ('Second Quarter 2026 growth -53%', '2026年第2四半期、53％増'),
        ):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError,'unsupported-number'):
                validation.validate_numbers(wrong, source)

    def test_bilingual_quantity_and_date_checks_accept_only_same_values(self):
        validation.validate_pair('1500億ドル', '$150 billion')
        validation.validate_pair('2026年10月1日', 'October 1, 2026')
        for ja,en in [('1500万ドル','$150 billion'), ('2026年1月10日','October 1, 2026')]:
            with self.subTest(ja=ja), self.assertRaises(ValueError):
                validation.validate_pair(ja,en)

    def test_accounting_loss_sign_survives_unit_conversion(self):
        validation.validate_numbers('-12億ドル', 'Net loss was ($1.2B).')
        with self.assertRaises(ValueError):
            validation.validate_numbers('12億ドル', 'Net loss was ($1.2B).')

    def test_financial_abbreviation_cannot_change_magnitude(self):
        with self.assertRaisesRegex(ValueError, "unsupported-number"):
            validation.validate_numbers("Revenue was $10M.", "Revenue was $10B.")

    def test_spelled_and_abbreviated_units_are_equivalent(self):
        validation.validate_numbers("Revenue was $10B.", "Revenue was $10 billion.")
        validation.validate_numbers("$10B投資を発表。", "Announces a $10 billion investment.")
        validation.validate_numbers("Margin was 25％.", "Margin was 25 percent.")

    def test_abbreviated_units_remain_bound_to_their_number(self):
        with self.assertRaisesRegex(ValueError, "unsupported-number"):
            validation.validate_numbers("Revenue was $10B.", "Revenue was $10M and backlog was $9B.")


if __name__ == "__main__":
    unittest.main()
