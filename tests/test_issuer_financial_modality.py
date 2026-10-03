"""Regression from the actual 1108 public language pair, not a model call."""
import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import issuer_business_news as news

SOURCE='The GPU assets have been leased under a long-term lease expected to generate recurring, long-term cash flows.'
EN='La Rosa Holdings acquired latest-generation NVIDIA B300 GPUs expected to generate long-term recurring revenue through lease arrangements and is evaluating strategic alternatives for its real estate operations to accelerate its transition into AI infrastructure.'
JA='La Rosa Holdingsは最新のNVIDIA B300 GPUを取得し長期リースによる収益源を確立、AIインフラへの事業転換を加速するため不動産事業の戦略的見直しを検討している。'

class FinancialModalityTests(unittest.TestCase):
    def pair(self,ja=JA,en=EN,source=SOURCE):
        return {'ja':ja,'en':en,'evidenceQuote':source}
    def test_actual_published_summary_cannot_assert_expected_revenue_is_established(self):
        with self.assertRaisesRegex(ValueError,'lost-forecast-modality'):
            news.validate_financial_modality(self.pair())
    def test_qualifier_on_unrelated_corporate_plan_does_not_cure_financial_assertion(self):
        with self.assertRaisesRegex(ValueError,'lost-forecast-modality'):
            news.validate_financial_modality(self.pair(ja=JA.replace('検討している','実施する見込み')))
    def test_completed_acquisition_and_expected_revenue_can_coexist(self):
        news.validate_financial_modality(self.pair(ja='La Rosa HoldingsはNVIDIA B300 GPUを取得した。長期リースを通じて継続的な収益を生むと見込んでいる。'))
    def test_expected_source_outcome_cannot_become_an_actual_english_return(self):
        with self.assertRaisesRegex(ValueError,'lost-forecast-modality'):
            news.validate_financial_modality(self.pair(en='The acquired assets generated recurring revenue.',ja='取得資産は継続的な収益を生んだ。'))
    def test_actual_financial_outcome_without_forecast_is_unchanged(self):
        news.validate_financial_modality(self.pair(en='The company generated revenue.',ja='同社は収益を生んだ。',source='The company generated revenue during the quarter.'))
    def test_actual_source_leased_those_assets_back_is_completed(self):
        source='The company acquired the GPUs and leased those assets back under a long-term lease expected to generate recurring, long-term cash flows.'
        with self.assertRaisesRegex(ValueError,'lost-action-status'):
            news.validate_financial_modality(self.pair(source=source,en='The company plans to lease assets expected to generate recurring cash flows.',ja='同社は資産をリースする予定で、継続的なキャッシュフローを生むと見込む。'))
        news.validate_financial_modality(self.pair(source=source,en='The company acquired and leased back the GPUs, which are expected to generate recurring cash flows.',ja='同社はGPUを取得してリースバックした。継続的なキャッシュフローを見込んでいる。'))

    def test_completed_lease_cannot_be_rewritten_as_intent(self):
        with self.assertRaisesRegex(ValueError,'lost-action-status'):
            news.validate_financial_modality(self.pair(en='The company plans to lease assets expected to generate recurring cash flows.',ja='同社は資産をリースする予定で、継続的なキャッシュフローを生むと見込む。'))

if __name__=='__main__':unittest.main()
