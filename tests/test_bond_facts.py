"""Bond durations retain their relationships instead of only their digits."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import bond_facts
import compact_headlines
import x_market_news as news


class BondFactsTests(unittest.TestCase):
    def test_observation_window_is_not_maturity_in_either_language(self):
        source = 'U.S. Treasuries have now suffered their worst 10-year period in history 🚨'
        valid = {'titleJa': '米国債、10年間の成績が史上最悪に',
                 'titleEn': 'U.S. Treasuries suffer their worst 10-year period in history'}
        self.assertEqual(news.validate(valid, source), valid)
        bad = {'titleJa': '米国債10年物は史上最悪の期間を記録',
               'titleEn': 'U.S. 10-Year Treasuries Experience Worst Period in History'}
        for key in bad:
            with self.subTest(key=key), self.assertRaises(ValueError):
                news.validate({**valid, key: bad[key]}, source)
        with self.assertRaises(ValueError):
            news.validate(bad, source)

    def test_unseen_numbers_and_both_temporal_roles_are_preserved(self):
        source = 'U.S. 30-year Treasury returns have their worst 5-year period in history.'
        valid = '米国30年物国債のリターンは5年間の期間で史上最悪。'
        bond_facts.validate(valid, source)
        bond_facts.validate('U.S. 30-year Treasury returns: worst 5-year period in history', source)
        for bad in ('米国5年物国債のリターンは30年間で史上最悪。',
                    '米国30年物国債のリターンは史上最悪。',
                    '米国30年物国債のリターンは5年間で最悪。'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                bond_facts.validate(bad, source)

    def test_return_yield_price_and_total_real_basis_cannot_be_substituted(self):
        source = 'U.S. Treasury 10-year rolling returns are the worst in history.'
        for metric in ('利回り', '価格', 'トータルリターン', '実質リターン', '年率換算リターン', '名目リターン'):
            with self.subTest(metric=metric), self.assertRaises(ValueError):
                bond_facts.validate(f'米国債の10年ローリング{metric}は史上最悪。', source)
        bond_facts.validate('米国債の10年ローリングリターンは史上最悪。', source)
        with self.assertRaises(ValueError):
            bond_facts.validate('米国債、10年間のリターンが史上最悪に',
                                'U.S. Treasuries have suffered their worst 10-year period in history')

    def test_calendar_may_is_not_forecast_modality(self):
        for context in ('in', 'during', 'through', 'before', 'after', 'until'):
            original = f'U.S. Treasury yields rose {context} May.'
            news.validate({'titleJa': '米国債利回りは5月に上昇した。',
                           'titleEn': original}, original)
        with self.assertRaises(ValueError):
            news.validate({'titleJa': '米国債利回りは上昇した。',
                           'titleEn': 'U.S. Treasury yields rose.'},
                          'U.S. Treasury yields may rise.')

    def test_annualization_and_rolling_basis_are_never_invented(self):
        source = 'U.S. Treasuries have suffered their worst 10-year period in history'
        for basis in ('annualized', 'nominal', 'rolling'):
            with self.subTest(basis=basis), self.assertRaises(ValueError):
                bond_facts.validate(f'U.S. Treasuries suffer their worst 10-year period in history on a {basis} basis', source)
        with self.assertRaises(ValueError):
            bond_facts.validate('米国債、10年間の年率換算成績が史上最悪に', source)

    def test_forecast_and_comparison_scope_are_not_dropped(self):
        source = 'U.S. Treasuries are on track for their worst 15-year period in history.'
        bond_facts.validate('米国債、15年間の成績が史上最悪となる見通し', source)
        for text in ('米国債、15年間の成績が史上最悪',
                     'U.S. Treasuries have suffered their worst 15-year period in history'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                bond_facts.validate(text, source)
        for qualifier in ('will', 'are likely to', 'could', 'would'):
            uncertain = f'U.S. Treasuries {qualifier} suffer their worst 15-year period in history.'
            with self.subTest(qualifier=qualifier), self.assertRaises(ValueError):
                bond_facts.validate('米国債、15年間の成績が史上最悪', uncertain)
        bond_facts.validate('米国債、5月に10年間の成績が史上最悪',
                            'U.S. Treasuries had their worst 10-year period in history on May 5')
        bond_facts.validate('米国債の10年ローリングリターン、過去100年で最低',
                            'U.S. Treasury 10-year rolling returns: lowest in the past 100 years')
        with self.assertRaises(ValueError):
            bond_facts.validate('米国債の10年ローリングリターンは最低',
                                'U.S. Treasury 10-year rolling returns: lowest in the past 100 years')

    def test_compaction_preserves_duration_role_or_falls_back_as_pair(self):
        ja = '米国債、10年間の成績が史上最悪に'
        en = 'U.S. Treasuries suffer their worst 10-year period in history'
        for short_ja, short_en in (
            ('米国債10年物最悪期間', 'U.S. 10-Year Treasuries Worst Period'),
            ('米国債、10年間で最悪', 'U.S. Treasuries: worst 10-year period'),
        ):
            self.assertEqual(compact_headlines.validated(
                {'shortTitleJa': short_ja, 'shortTitleEn': short_en}, ja, en), {})
        valid = {'shortTitleJa': '米国債、10年間が史上最悪',
                 'shortTitleEn': 'U.S. Treasuries: worst 10-year period in history'}
        self.assertEqual(compact_headlines.validated(valid, ja, en), valid)

    def test_direct_copy_is_source_grammar_bound_and_never_reads_chart_or_reply(self):
        for years in (10, 15):
            source = f'U.S. Treasuries have now suffered their worst {years}-year period in history 🚨 https://t.co/token123'
            copy = news.direct_period_copy(source)
            self.assertIn(f'{years}年間', copy['titleJa'])
            self.assertNotIn('年物', copy['titleJa'])
            self.assertNotIn('return', copy['titleEn'].lower())
        for source in (
            'U.S. Treasuries may suffer their worst 10-year period in history',
            'U.S. Treasuries have suffered their worst 10-year period since 1981',
            'U.S. 10-year Treasuries have now suffered their worst period in history',
            'U.S. Treasuries have suffered their worst 10-year period in history. Total returns fell 25%.',
        ):
            self.assertIsNone(news.direct_period_copy(source))


if __name__ == '__main__':
    unittest.main()
