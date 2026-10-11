"""Owner, Oct 11: PRO deep analysis by a higher-tier model, numbers checked."""
import json
import unittest

import test_official_research as base
from test_official_research import QUOTES, research
import deep_analysis

ENV = {'OPENAI_API_KEY': 'sk-test-' + 'x' * 30, 'RESEARCH_DEEP_MODEL': 'gpt-6-astra'}
EARNINGS = 'Nebius Reports Third Quarter 2026 Financial Results'


def point(ja, en, evidence='0'):
    return {'ja': ja, 'en': en, 'evidenceId': evidence}


GOOD = {'headline': {'ja': 'Nebius、Inferize買収で推論基盤を強化', 'en': 'Nebius strengthens its inference stack with Inferize'},
        'points': [point('Inferizeの買収は推論の最適化を自社に取り込む動き。', 'Acquiring Inferize brings inference optimization in-house.'),
                   point('技術とチームはToken Factoryに加わった。', 'The technology and team joined Token Factory.'),
                   point('GPUの遊休時間を減らし、稼働率の改善を狙う。', 'It aims to cut idle GPU time and lift utilization.')],
        'watch': point('今後は稼働率の改善が数字に表れるかを確認したい。', 'Watch whether utilization gains show up in reported figures.')}


def reply(note):
    return lambda payload, key: {'status': 'completed', 'output': [{'type': 'message', 'content': [
        {'type': 'output_text', 'text': json.dumps(note, ensure_ascii=False)}]}]}


class DeepAnalysisTests(unittest.TestCase):
    setUp = base.OfficialResearchTests.setUp

    def earnings(self):
        with research.connect(self.path) as db:
            db.execute('UPDATE sources SET title=?', (EARNINGS,))

    def run_deep(self, transport, now=None):
        return deep_analysis.run_once(self.path, transport, ENV, now=base.NOW.timestamp() if now is None else now,
                                      reference=base.NOW)

    def items(self):
        with deep_analysis.connect(self.path) as db:
            return deep_analysis.member_view(db, reference=base.NOW)

    def test_an_earnings_release_gets_one_checked_analysis(self):
        self.earnings()
        seen = []
        def transport(payload, key):
            seen.append(payload)
            return reply(GOOD)(payload, key)
        self.assertEqual(self.run_deep(transport), 'done')
        self.assertEqual(seen[0]['model'], 'gpt-6-astra')
        [item] = self.items()
        self.assertEqual(item['kind'], 'earnings')
        self.assertEqual(item['subject'], 'NBIS')
        self.assertEqual(len(item['points']), 3)
        self.assertEqual(self.run_deep(lambda *_: self.fail('analysed twice')), 'idle')

    def test_an_invented_number_is_left_out_and_too_few_points_hold_the_analysis(self):
        self.earnings()
        note = json.loads(json.dumps(GOOD))
        note['points'][0] = point('売上は前年比45%増えた。', 'Revenue rose 45% year over year.')
        self.assertEqual(self.run_deep(reply(note)), 'done')
        [item] = self.items()
        self.assertNotIn('45', json.dumps(item, ensure_ascii=False))
        self.assertEqual(len(item['points']), 2)

    def test_retries_stop_after_three_failed_attempts(self):
        self.earnings()
        bad = json.loads(json.dumps(GOOD))
        bad['points'] = [point('売上は45%増。', 'Revenue rose 45%.')] * 3
        for attempt in range(3):
            self.assertEqual(self.run_deep(reply(bad), now=base.NOW.timestamp() + attempt * 1000), 'retry')
        self.assertEqual(self.run_deep(lambda *_: self.fail('held'), now=base.NOW.timestamp() + 5000), 'idle')
        self.assertEqual(self.items(), [])

    def test_earnings_only_companies_get_no_deep_analysis(self):
        self.earnings()
        from unittest.mock import patch
        providers = deep_analysis.monitor.PROVIDERS
        with patch.dict(providers, {'NBIS': {**providers['NBIS'], 'scope': 'earnings'}}):
            self.assertEqual(self.run_deep(lambda *_: self.fail('earnings-only')), 'idle')

    def test_other_news_and_missing_configuration_never_call_the_model(self):
        self.assertEqual(self.run_deep(lambda *_: self.fail('not earnings')), 'idle')
        self.earnings()
        self.assertEqual(deep_analysis.run_once(self.path, lambda *_: self.fail('unconfigured'),
                                                {'OPENAI_API_KEY': ENV['OPENAI_API_KEY']}, now=base.NOW.timestamp(),
                                                reference=base.NOW), 'idle')


class IndicatorAnalysisTests(unittest.TestCase):
    setUp = base.OfficialResearchTests.setUp

    def test_an_indicator_flash_is_analysed_from_its_own_figures_only(self):
        from unittest.mock import patch
        import market_results
        flash = {'id': '9', 'kind': 'economic', 'period': 'SEPTEMBER U.S. CPI', 'url': 'https://x.com/wallstengine/status/9',
                 'titleEn': 'U.S. September CPI: YoY 2.9%',
                 'facts': [{'key': 'cpi-yoy', 'ja': 'CPI（前年比）', 'en': 'CPI (YoY)', 'value': '2.9%', 'comparisons': {'forecast': '2.9%', 'previous': '2.7%'}}]}
        note = {'headline': {'ja': '米CPIは前年比2.9%で予想通り', 'en': 'U.S. CPI at 2.9% YoY, in line with forecasts'},
                'points': [point('前年比2.9%は予想の2.9%と一致した。', 'The 2.9% YoY reading matched the 2.9% forecast.'),
                           point('前回の2.7%から伸びが強まった。', 'It firmed from the previous 2.7%.'),
                           point('利下げ観測は3.5%まで後退した。', 'Rate-cut odds fell to 3.5%.')],
                'watch': point('コアの動きを確認したい。', 'Watch the core reading.')}
        with patch.object(market_results, 'public_feed', return_value=[flash]):
            self.assertEqual(deep_analysis.run_once(self.path, reply(note), ENV, now=base.NOW.timestamp(), reference=base.NOW), 'done')
        with deep_analysis.connect(self.path) as db:
            [item] = deep_analysis.member_view(db, reference=base.NOW)
        self.assertEqual(item['kind'], 'indicator')
        self.assertEqual(len(item['points']), 2)
        self.assertNotIn('3.5', json.dumps(item, ensure_ascii=False))


if __name__ == '__main__':
    unittest.main()
