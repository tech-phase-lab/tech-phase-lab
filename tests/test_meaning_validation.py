from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import factual_validation as validation


def check(ja, en):
    validation.validate_numbers(ja, en)
    validation.validate_semantics(ja, en)
    validation.validate_names(ja, en)


class MeaningValidationTests(unittest.TestCase):
    REVERSED = (
        ('Micron revenue rose 10% in fiscal Q4', 'マイクロン、第4四半期売上高が10%減', 'changed-direction'),
        ('Micron raises full-year guidance', 'マイクロン、通期見通しを引き下げ', 'changed-direction'),
        ('Nvidia beats revenue estimates', 'エヌビディア、売上高が予想を下回る', 'changed-direction'),
        ('Analyst upgrades AMD to Buy', 'アナリストがAMDを格下げ', 'changed-direction'),
        ('Revenue rose 12% while gross margin declined', '売上高は12%減少、粗利益率は上昇', 'changed-metric-direction'),
        ('Broadcom does not expect delays to shipments', 'ブロードコム、出荷遅延を見込む', 'changed-negation'),
        ('TSMC swings to net profit', 'TSMC、赤字に転落', 'changed-direction'),
        ('Vertiv shares jump 8% after earnings', 'バーティブ株、決算後に8%急落', 'changed-direction'),
        ('Company reports narrower loss', '同社、損失が拡大', 'changed-direction'),
        ('Oracle wins $10B contract', 'オラクル、100億ドルの契約を失う', 'changed-direction'),
        ('$NVDA added to index', '$AMDが指数に採用', 'changed-names'),
        ('Dell names Jane Smith CFO', 'デル、John DoeをCFOに任命', 'changed-names'),
    )
    FAITHFUL = (
        ('Micron revenue rose 10% in fiscal Q4', 'マイクロン、第4四半期売上高が10%増'),
        ('Micron raises full-year guidance', 'マイクロン、通期見通しを引き上げ'),
        ('Nvidia beats revenue estimates', 'エヌビディア、売上高が予想を上回る'),
        ('Analyst upgrades AMD to Buy', 'アナリストがAMDを「買い」に格上げ'),
        ('Revenue rose 12% while gross margin declined', '売上高は12%増加、一方で粗利益率は低下'),
        ('Broadcom does not expect delays to shipments', 'ブロードコム、出荷の遅延は見込まず'),
        ('TSMC swings to net profit', 'TSMC、黒字に転換'),
        ('Company reports narrower loss', '同社、損失が縮小'),
        ('Microsoft expands partnership with OpenAI', 'マイクロソフト、OpenAIとの提携を拡大'),
        ('NVIDIA GeForce NOW adds 10 games this fall', 'NVIDIA GeForce NOW、今秋10本のゲームを追加'),
        ('Fed holds rates steady, signals cuts later', 'FRB、金利を据え置き　後の利下げを示唆'),
        ('Dell to acquire startup for $2B', 'デル、スタートアップを20億ドルで買収する計画'),
    )

    def test_reversed_translations_are_rejected(self):
        for en, ja, code in self.REVERSED:
            with self.subTest(en=en):
                with self.assertRaisesRegex(ValueError, '^' + code + '$'):
                    check(ja, en)

    def test_faithful_translations_pass(self):
        for en, ja in self.FAITHFUL:
            with self.subTest(en=en):
                check(ja, en)

    def test_pair_check_rejects_reversed_bilingual_copy(self):
        with self.assertRaisesRegex(ValueError, 'changed-'):
            validation.validate_pair('マイクロン、見通しを引き下げ', 'Micron raises its outlook')
        validation.validate_pair('マイクロン、見通しを引き上げ', 'Micron raises its outlook')

    def test_whether_or_not_is_not_a_negation(self):
        validation.validate_negation('採用するかどうかを検討', 'Company weighs whether or not to adopt the chip')

    def test_summary_may_leave_out_a_negated_side_clause(self):
        source = 'Brent crude rises 2% as OPEC+ says it will not raise output'
        validation.validate_negation('ブレント原油が2%上昇', source)
        validation.validate_negation('Brent crude rises 2%', source)
        validation.validate_negation('米10年債利回りが再び急上昇',
                                     'U.S. 10-Year Treasury Yield rising sharply again. Not seen since 2007.')

    def test_summary_that_restates_a_negated_clause_keeps_the_negation(self):
        source = 'Brent crude rises 2% as OPEC+ says it will not raise output'
        with self.assertRaisesRegex(ValueError, '^changed-negation$'):
            validation.validate_negation('OPEC+ says it will raise output', source)
        with self.assertRaisesRegex(ValueError, '^changed-negation$'):
            validation.validate_negation('OPEC+が増産すると表明', 'OPEC+ says it will not raise output')
        validation.validate_negation('OPEC+ will not raise output', source)

    def test_names_spaced_differently_are_the_same_name(self):
        validation.validate_names('S&P500に採用', 'Added to the S&P 500 index')
        with self.assertRaisesRegex(ValueError, '^changed-names$'):
            validation.validate_names('S&P500に採用', 'Added to the index')
        with self.assertRaisesRegex(ValueError, '^changed-names$'):
            validation.validate_names('Armが上昇', 'Pharma stocks rise')

    def test_every_lane_recognizes_the_new_failure_codes(self):
        import general_source_news, headline_translation, x_market_news
        for code in validation.MEANING_FAILURES:
            self.assertIn(code, headline_translation.VALIDATION_FAILURES)
            self.assertIn(code, x_market_news.FAILURES)
            self.assertIn(code, general_source_news.FAILURE_CODES)


if __name__ == '__main__':
    unittest.main()
