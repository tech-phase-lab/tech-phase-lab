from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import factual_validation as validation


class FactualValidationTests(unittest.TestCase):
    def test_purpose_cannot_be_translated_as_achieved_benefit(self):
        for ja, en in (
            ('買収し、性能を向上させた。', 'It acquired the company to improve performance.'),
            ('コストを削減した。', 'It aims to reduce costs.'),
            ('能力の拡大を目指す。', 'It expanded capacity.'),
        ):
            with self.subTest(ja=ja), self.assertRaisesRegex(ValueError, 'invalid-copy'):
                validation.validate_pair(ja, en)
        validation.validate_pair('性能改善を目指して買収した。', 'It acquired the company to improve performance.')
        validation.validate_pair('性能を改善した。', 'It improved performance.')
        validation.validate_pair('事業を拡大し、コスト削減を目指す。', 'It expanded the business and aims to reduce costs.')

    def test_gpu_overhead_metaphor_does_not_become_taxation(self):
        source = 'The technology cuts the idle GPU tax by reducing unused capacity.'
        with self.assertRaisesRegex(ValueError, 'invalid-copy'):
            validation.validate_semantics('アイドルGPU課税を削減する。', source)
        validation.validate_semantics('GPUの遊休コストを削減する。', source)
        validation.validate_semantics('政府が課税を開始した。', 'The government introduced a tax.')

    def test_future_integration_does_not_become_work_already_underway(self):
        source = 'Engineers will work across the platform, starting with the integration of their technology.'
        for text in ('Engineers are now integrating the technology.', '技術統合を進めている。', '技術を統合した。'):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, 'invalid-copy'):
                validation.validate_semantics(text, source)
        validation.validate_semantics('技術統合から取り組む予定。', source)
        validation.validate_semantics('The team will integrate its technology.', source)
        validation.validate_semantics('技術統合を進めている。', 'Engineers are integrating the technology.')

    def test_spelled_duration_cannot_be_omitted_or_changed_in_other_language(self):
        validation.validate_pair('3か月以内に開発した。', 'It developed a prototype within three months.')
        for ja in ('短期間で開発した。', '4か月以内に開発した。'):
            with self.subTest(ja=ja), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                validation.validate_pair(ja, 'It developed a prototype within three months.')
        validation.validate_pair('チームが加わった。', 'One of the teams joined.')

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



    def test_hyphenated_magnitudes_and_spelled_hardware_counts(self):
        validation.validate_pair('1000億パラメータのモデル', '100-billion-parameter models')
        validation.validate_pair('2台のDGX Spark', 'two DGX Spark units')
        validation.validate_pair('2台の64GBユニット', 'two 64GB units')
        validation.validate_pair('Q3にリリースした。', 'Released in Q3.')
        for wrong in ('100億パラメータ', '-1000億パラメータ', '1001億パラメータ'):
            with self.assertRaisesRegex(ValueError,'unsupported-number'):
                validation.validate_pair(wrong,'100-billion-parameter models')
        with self.assertRaisesRegex(ValueError,'unsupported-number'):
            validation.validate_pair('3台のDGX Spark','two DGX Spark units')
        validation.validate_pair('GPUのうちひとつ', 'one of the GPUs')

if __name__ == "__main__":
    unittest.main()
