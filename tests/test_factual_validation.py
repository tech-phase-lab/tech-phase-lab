from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import factual_validation as validation


class FactualValidationTests(unittest.TestCase):
    GPU_LIFE_SOURCE = (
        'The A100 GPU shipped in 2020 and remains in commercial service six years later. '
        'An analyst puts useful life at five to six years for an eight-GPU H100 system '
        'and nine to 10 years for GB300 NVL72, based on resale values.'
    )

    def test_percentage_comparison_keeps_baseline_in_both_languages(self):
        source = 'The model detects 50% more emissions than human experts.'
        for ja in ('人間の専門家より50％多い排出を検出する。',
                   '人間の専門家による検出量よりも50パーセント多く検出する。',
                   '専門家と比べて排出を50％多く検出する。'):
            for en in ('The model detects 50% more emissions than human experts.',
                       'Compared with human experts, the model detects 50 percent more emissions.'):
                with self.subTest(ja=ja, en=en):
                    validation.validate_semantics(ja, source)
                    validation.validate_semantics(en, source)
                    validation.validate_pair(ja, en)
        validation.validate_pair('専門家より12.5％少ない誤検出。',
                                 '12.5% fewer false positives than human experts.')
        validation.validate_pair('既知より50％多い排出。',
                                 '50% more emissions than previously known.')

    def test_percentage_comparison_rejects_changed_missing_or_detached_baseline(self):
        source = 'The model detects 50% more emissions than human experts.'
        for wrong in ('既知より50％多い排出を検出。',
                      '従来より50％多い排出を検出。',
                      '50％多い排出を検出。',
                      '人間の専門家より50％少ない排出を検出。',
                      '人間の専門家と共同開発した。既知より50％多い排出を検出。',
                      '人間の専門家と共同開発し、既知より50％多い排出を検出。',
                      'The model detects 50% more emissions than previously known.',
                      'Human experts built a model detecting 50% more emissions than last year.'):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'unsupported-comparison-baseline'):
                validation.validate_semantics(wrong, source)
            with self.subTest(pair=wrong), self.assertRaisesRegex(ValueError, 'unsupported-comparison-baseline'):
                validation.validate_pair(wrong, source)

    def test_percentage_baseline_scope_does_not_infer_from_unrelated_experts(self):
        validation.validate_semantics('追加のモデルを発表した。',
                                      'The model detects 50% more emissions than human experts.')
        validation.validate_semantics('人間の専門家は稼働率50％と報告した。',
                                      'Human experts reported utilization at 50%.')
        self.assertEqual(validation.percentage_comparisons(
            'Experts developed the model, which detects 50% more emissions than last year.'), set())
        self.assertEqual(validation.percentage_comparisons(
            'The model detects 50% more emissions. Human experts checked the work.'), set())
        validation.validate_semantics('前年より50％多い排出を検出。',
                                      'Experts developed the model, which detects 50% more emissions than last year.')
        # A recognized baseline cannot be borrowed from another comparison.
        with self.assertRaisesRegex(ValueError, 'unsupported-comparison-baseline'):
            validation.validate_semantics('専門家より20％多い結果。既知より50％多い排出。',
                                          '20% more results than experts; 50% more emissions than experts.')

    def test_megawatt_per_unit_basis_matches_explicit_japanese_denominator(self):
        source = 'Each megawatt costs roughly $60 million.'
        for ja in ('1メガワットあたり約6000万ドル', '1MW当たり約6,000万ドル',
                   'メガワットあたり約6000万ドル', 'メガワット当たり約6000万ドル', 'メガワット毎に約6000万ドル'):
            for en in ('$60 million per megawatt', '$60 million per MW', '$60 million per 1 MW'):
                with self.subTest(ja=ja, en=en):
                    validation.validate_numbers(ja, source)
                    validation.validate_numbers(en, source)
                    validation.validate_pair(ja, en)
                    self.assertEqual(validation.number_checks({'ja': ja, 'en': en, 'evidenceQuote': source}), [])
        self.assertEqual(validation.numeric_values('1MW当たり'), [(validation.Decimal(1), 'per-MW')])
        self.assertEqual(validation.numeric_values('per one megawatt'), [(validation.Decimal(1), 'per-MW')])

    def test_per_megawatt_does_not_authorize_unrelated_one_or_changed_basis(self):
        for source in ('Each megawatt costs roughly $60 million.', '$60 million per 1 MW'):
            for wrong in ('1年で6000万ドル', '1GPUあたり6000万ドル', '1GWあたり6000万ドル',
                          '2MW当たり6000万ドル', '-1MW当たり6000万ドル', '1MW当たり600万ドル',
                          '6000万ドルの1%'):
                with self.subTest(source=source, wrong=wrong), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                    validation.validate_numbers(wrong, source)
        with self.assertRaisesRegex(ValueError, 'unsupported-number'):
            validation.validate_pair('1MW当たり6000万ドル', '$60 million')
        validation.validate_pair('2MW当たり6000万ドル', '$60 million per 2 megawatts')

    def test_spelled_duration_range_endpoints_have_only_temporal_scope(self):
        validation.validate_pair('5〜6年と9〜10年', 'five to six years and nine to 10 years')
        validation.validate_pair('5〜6か月', 'five to six months')
        validation.validate_pair('9〜10年', 'nine-to-ten-year')
        with self.assertRaisesRegex(ValueError, 'unsupported-number'):
            validation.validate_numbers('5〜6年', 'five to six alternatives and 6 years')
        for text in ('nine to 10 alternatives', 'Eleven announced a product.', 'one of the teams'):
            self.assertNotIn((validation.Decimal(9 if text.startswith('nine') else 11 if text.startswith('Eleven') else 1), 'number'),
                             validation.numeric_values(text))
        with self.assertRaisesRegex(ValueError, 'unsupported-number'):
            validation.validate_pair('5〜7年', 'five to six years')

    def test_gpu_observed_age_and_attributed_life_estimates_validate(self):
        for ja, en in (
            ('同社によると、2020年出荷のA100 GPUは6年後も商用利用が続いている。',
             'NVIDIA says the A100 GPU, shipped in 2020, remains commercially used six years later.'),
            ('Barkrは転売価格に基づき、GB300 NVL72の有効寿命を9〜10年と推定している。',
             'Barkr estimates GB300 NVL72 useful life at nine to 10 years, based on resale values.'),
            ('BarkrはH100システムの有効寿命を5〜6年と推定している。',
             'Barkr estimates useful life at five to six years for an H100 system.'),
        ):
            with self.subTest(ja=ja):
                validation.validate_numbers(ja, self.GPU_LIFE_SOURCE)
                validation.validate_numbers(en, self.GPU_LIFE_SOURCE)
                validation.validate_pair(ja, en)
                self.assertEqual(validation.number_checks({'ja': ja, 'en': en, 'evidenceQuote': self.GPU_LIFE_SOURCE}), [])

    def test_model_lifetime_cannot_borrow_another_models_interval(self):
        for wrong in (
            'A100 has an estimated useful life of 9–10 years.',
            'A100の有効寿命は9〜10年と推定されている。',
            'H100 has an estimated useful life of 9–10 years.',
            'GB300 NVL72 has an estimated useful life of 5–6 years.',
            'A100 remains in commercial service nine to 10 years later.',
            'The 2020-launched A100 GPU is still commercially valuable up to 9 to 10 years later, '
            'as supported by extended depreciation schedules.',
        ):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                validation.validate_numbers(wrong, self.GPU_LIFE_SOURCE)

    def test_gpu_estimate_cannot_become_observed_history_or_certain_lifetime(self):
        for wrong in (
            'GB300 NVL72 has been in service nine to 10 years.',
            'GB300 NVL72は9〜10年間稼働している。',
            'GB300 NVL72 has a useful life of nine to 10 years.',
            'GB300 NVL72の有効寿命は9〜10年だ。',
            'A100 has an estimated useful life of six years.',
        ):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                validation.validate_numbers(wrong, self.GPU_LIFE_SOURCE)
        with self.assertRaisesRegex(ValueError, 'unsupported-number'):
            validation.validate_pair('GB300 NVL72は9〜10年間稼働している。',
                                     'GB300 NVL72 has an estimated useful life of nine to 10 years.')

    def test_unrelated_years_and_clauses_do_not_support_model_life_claim(self):
        claim = 'A100 has an estimated useful life of nine to 10 years.'
        for source in (
            'A100 shipped in 2020. Studies estimated useful life at nine to 10 years.',
            'A100 shipped in 2020, while unrelated studies estimated useful life at nine to 10 years.',
            'A100 shipped in 2020, unrelated studies estimated useful life at nine to 10 years.',
            'A100 is used commercially six years later. There are 9 labs and 10 teams.',
            'A100 has an estimated useful life of nine years. A different project lasts 10 years.',
        ):
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                validation.validate_numbers(claim, source)
        self.assertEqual(validation.model_year_facts('The A100 launch was in 2020. There are 10 studies.'), set())
        with self.assertRaisesRegex(ValueError, 'unsupported-number'):
            validation.validate_numbers('A100 has an estimated useful life of 10 years.',
                                        'A100 has an estimated useful life of nine years with an unrelated plan lasting 10 years.')
        validation.validate_numbers('A100 remains in commercial service six years later.',
                                    'Barkr estimates useful life at nine to 10 years for GB300 NVL72 '
                                    'and A100 remains in commercial service six years later.')

    def test_model_duration_failures_have_scoped_diagnostics(self):
        checks = validation.number_checks({
            'ja': 'A100の有効寿命を9〜10年と推定している。',
            'en': 'A100 has an estimated useful life of nine to 10 years.',
            'evidenceQuote': self.GPU_LIFE_SOURCE,
        })
        self.assertEqual(checks, [
            {'check': language + '-evidence-model-duration', 'unsupported': [
                {'model': 'A100', 'minYears': '9', 'maxYears': '10', 'basis': 'estimated-useful-life'}],
             'truncated': False} for language in ('ja', 'en')])

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

    def test_standard_abbreviated_months_keep_exact_calendar_values(self):
        for abbreviation, month in (
            ('Jan', 1), ('Feb', 2), ('Mar', 3), ('Apr', 4), ('May', 5),
            ('Jun', 6), ('Jul', 7), ('Aug', 8), ('Sep', 9), ('Sept', 9),
            ('Oct', 10), ('Nov', 11), ('Dec', 12),
        ):
            for suffix in ('', '.'):
                with self.subTest(abbreviation=abbreviation, suffix=suffix):
                    validation.validate_pair(f'2026年{month}月1日', f'{abbreviation}{suffix} 1, 2026')
                    validation.validate_pair(f'{month}月1日', f'{abbreviation.lower()}{suffix} 1')
        validation.validate_pair('10月1日から11月1日まで', 'From Oct. 1 to Nov. 1')
        validation.validate_pair('9月29日に発売', 'Launched Sept. 29')

    def test_abbreviated_months_do_not_allow_inferred_years_or_recombined_dates(self):
        for text, evidence in (
            ('2024年10月1日', 'Oct. 1, 2026'),
            ('2026年10月1日', 'Oct. 1. A separate roadmap covers 2026.'),
            ('10月2日', 'Oct. 1 and Nov. 2'),
            ('2024年10月1日', 'Oct. 1, 2026 and Nov. 2, 2024'),
            ('9月29日', 'Oct. 29'),
        ):
            with self.subTest(text=text, evidence=evidence), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                validation.validate_numbers(text, evidence)
        for invalid in ('Feb. 30, 2026', 'Sept. 31', 'Apr. 0'):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                validation.dates(invalid)
        for text in ('Mar leads the project.', 'An Octopus model.', 'MAR2026', 'Oct. release'):
            with self.subTest(text=text):
                self.assertEqual(validation.dates(text), [])
                self.assertNotIn((validation.Decimal(3), 'number'), validation.numeric_values(text))
                self.assertNotIn((validation.Decimal(10), 'number'), validation.numeric_values(text))

    def test_reusable_numeric_checks_preserve_exact_diagnostic_format(self):
        item = {'ja': '2024年10月1日', 'en': 'Oct. 1, 2026',
                'evidenceQuote': 'The service launches Oct. 1, 2026.'}
        self.assertEqual(validation.number_checks(item), [
            {'check': 'ja-evidence-quantity', 'unsupported': [
                {'value': '2024', 'dimension': 'number', 'count': 1}], 'truncated': False},
            {'check': 'ja-evidence-date', 'unsupported': [[2024, 10, 1]], 'truncated': False},
            {'check': 'bilingual-quantity-count',
             'jaOnly': [{'value': '2024', 'dimension': 'number', 'count': 1}],
             'enOnly': [{'value': '2026', 'dimension': 'number', 'count': 1}], 'truncated': False},
            {'check': 'ja-other-language-numbers'},
            {'check': 'en-other-language-numbers'},
        ])
        self.assertEqual(validation.number_checks({'ja': '', 'en': '', 'evidenceQuote': None}), [])
        quantities = validation.quantities([(validation.Decimal(4), 'number')] * 2
                                          + [(validation.Decimal(3), 'percent')])
        self.assertEqual(quantities, [{'value': '4', 'dimension': 'number', 'count': 2},
                                      {'value': '3', 'dimension': 'percent', 'count': 1}])

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



    def test_compound_japanese_amounts_preserve_exact_magnitude_and_sign(self):
        validation.validate_pair('15万6,000ドル超', 'over $156,000')
        validation.validate_pair('1億2500万6000ドル', '$125,006,000')
        validation.validate_pair('-15万6000ドル', '-$156,000')
        validation.validate_pair('15万円と6000円', '150,000 yen and 6,000 yen')
        for wrong in ('15万600ドル', '15万6001ドル', '-15万6000ドル',
                      '156万ドル', '15万6000万ドル'):
            with self.assertRaisesRegex(ValueError, 'unsupported-number'):
                validation.validate_pair(wrong, '$156,000')

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

    def test_spelled_person_counts_and_exact_percentages(self):
        validation.validate_pair('最大8人の話者', 'up to eight speakers')
        validation.validate_pair('2人の参加者', 'two participants')
        validation.validate_pair('従業員のひとり', 'one of the employees')
        for wrong in ('最大7人の話者', '最大80人の話者'):
            with self.assertRaisesRegex(ValueError, 'unsupported-number'):
                validation.validate_pair(wrong, 'up to eight speakers')
        with self.assertRaisesRegex(ValueError, 'unsupported-number'):
            validation.validate_numbers('about 55%', '55.05%')

if __name__ == "__main__":
    unittest.main()
