"""Owner, Oct 11: PRO deep analysis by a higher-tier model, numbers checked."""
import json
import unittest

import test_official_research as base
from test_official_research import QUOTES, research
import deep_analysis

ENV = {'OPENAI_API_KEY': 'sk-test-' + 'x' * 30, 'RESEARCH_DEEP_MODEL': 'gpt-6-astra'}
EARNINGS = 'Nebius Reports Third Quarter 2026 Financial Results'


def point(ja, en, evidence='0'):
    return {'ja': ja, 'en': en, 'evidenceIds': [evidence]}


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
        # Only the analysis text is checked: the item also carries a wall-clock timestamp
        # whose seconds can read "45" (CI, Oct 14), which is not an invented number.
        analysis = {key: item[key] for key in ('headline', 'points', 'watch')}
        self.assertNotIn('45', json.dumps(analysis, ensure_ascii=False))
        self.assertEqual(len(item['points']), 2)

    def test_retries_stop_after_three_failed_attempts(self):
        self.earnings()
        bad = json.loads(json.dumps(GOOD))
        bad['points'] = [point('売上は45%増。', 'Revenue rose 45%.')] * 3
        for attempt in range(3):
            self.assertEqual(self.run_deep(reply(bad), now=base.NOW.timestamp() + attempt * 1000), 'retry')
        self.assertEqual(self.run_deep(lambda *_: self.fail('held'), now=base.NOW.timestamp() + 5000), 'idle')
        self.assertEqual(self.items(), [])

    def test_a_point_may_cite_several_excerpts_but_a_figure_must_be_in_one_of_them(self):
        excerpts = {'0': 'Revenue was $3.41 billion in the quarter.', '1': 'Operating income was $172 million.', '2': 'Unrelated background text.'}
        headline = {'ja': '売上高は34億1,000万ドル。', 'en': 'Revenue was $3.41 billion.'}
        both = {'ja': '売上高は3.41 billion ドル、営業利益は172 million ドルだった。', 'en': 'Revenue was $3.41 billion and operating income was $172 million.', 'evidenceIds': ['0', '1']}
        only_first = {'ja': '営業利益は172 million ドルだった。', 'en': 'Operating income was $172 million.', 'evidenceIds': ['0']}
        unknown = {'ja': '売上高は3.41 billion ドル。', 'en': 'Revenue was $3.41 billion.', 'evidenceIds': ['9']}
        note = {'headline': {'ja': 'Revenue was $3.41 billion', 'en': 'Revenue was $3.41 billion'}, 'points': [both, only_first, unknown, both], 'watch': None}
        try:
            deep_analysis.bind(note, excerpts)
        except deep_analysis.Unchecked as exc:  # pragma: no cover - only if the checks reject both citations
            self.fail(exc.detail)
        kept = deep_analysis.bind(note, excerpts)
        self.assertEqual(len(kept['points']), 2)  # the point citing only the revenue excerpt may not use the operating-income figure
        bad = {'headline': note['headline'], 'points': [only_first, unknown, only_first], 'watch': None}
        with self.assertRaises(deep_analysis.Unchecked) as caught:
            deep_analysis.bind(bad, excerpts)
        self.assertEqual(caught.exception.detail, {'kept': 0, 'rejected': {'evidence-missing': 1, 'unsupported-number:value:172000000:E': 2}})

    def test_the_headline_is_checked_against_its_own_excerpts_and_negation_rejections_name_their_rule(self):
        excerpts = {'0': 'Revenue was $3.41 billion in the quarter.', '1': 'The company did not raise guidance this quarter.',
                    '2': 'Operating income was $172 million.'}
        ok_point = {'ja': '営業利益は172 million ドル。', 'en': 'Operating income was $172 million.', 'evidenceIds': ['2']}
        headline = {'ja': '売上高は3.41 billion ドル。', 'en': 'Revenue was $3.41 billion.', 'evidenceIds': ['0']}
        note = {'headline': headline, 'points': [ok_point, ok_point], 'watch': None}
        self.assertEqual(len(deep_analysis.bind(note, excerpts)['points']), 2)  # the release has a negated clause elsewhere: not this headline's evidence
        flipped = {'ja': '会社は今四半期にガイダンスを引き上げた。', 'en': 'The company raised guidance this quarter.', 'evidenceIds': ['1']}
        with self.assertRaises(deep_analysis.Unchecked) as caught:
            deep_analysis.bind({'headline': headline, 'points': [flipped, flipped, ok_point], 'watch': None}, excerpts)
        [reason] = caught.exception.detail['rejected']
        self.assertTrue(reason.startswith('changed-negation:source-negated:'), reason)
        self.assertEqual(caught.exception.detail['kept'], 1)

    def test_a_rejected_headline_holds_the_analysis_and_records_why(self):
        excerpts = {'0': 'Revenue was $3.41 billion in the quarter.', '1': 'Operating income was $172 million.'}
        point = {'ja': '売上高は3.41 billion ドル。', 'en': 'Revenue was $3.41 billion.', 'evidenceIds': ['0']}
        bad_headline = {'ja': '売上高は45%増。', 'en': 'Revenue rose 45%.', 'evidenceIds': ['0']}
        with self.assertRaises(deep_analysis.Unchecked) as caught:
            deep_analysis.bind({'headline': bad_headline, 'points': [point, point], 'watch': None}, excerpts)
        self.assertEqual(str(caught.exception), 'unsupported-number')
        self.assertEqual(caught.exception.detail, {'headline': 'unsupported-number:value:45%:A'})

    def test_a_retry_tells_the_model_why_the_last_attempt_was_rejected(self):
        self.earnings()
        bad = json.loads(json.dumps(GOOD))
        bad['points'] = [point('売上は45%増。', 'Revenue rose 45%.')] * 3
        inputs = []
        def transport(payload, key):
            inputs.append(json.loads(payload['input']))
            return reply(bad)(payload, key)
        self.assertEqual(self.run_deep(transport), 'retry')
        self.assertEqual(self.run_deep(transport, now=base.NOW.timestamp() + 1000), 'retry')
        self.assertNotIn('previousAttemptRejected', inputs[0])
        self.assertEqual(inputs[1]['previousAttemptRejected'], {'kept': 0, 'rejected': {'unsupported-number:value:45%:A': 3}})

    def test_unsupported_figures_are_tagged_as_cited_elsewhere_absent_or_mixed(self):
        excerpts = {'0': 'Revenue was $3.41 billion in the quarter.', '1': 'Operating income was $172 million.'}
        def reason(text_en, text_ja):
            point = {'ja': text_ja, 'en': text_en, 'evidenceIds': ['0']}
            with self.assertRaises(deep_analysis.Unchecked) as caught:
                deep_analysis.bind({'headline': {'ja': '売上高は3.41 billion ドル。', 'en': 'Revenue was $3.41 billion.', 'evidenceIds': ['0']}, 'points': [point, point], 'watch': None}, excerpts)
            [key] = caught.exception.detail['rejected']
            return key
        self.assertTrue(reason('Operating income was $172 million.', '営業利益は172 million ドル。').endswith(':E'))  # in the release, not in the cited excerpt
        self.assertTrue(reason('Revenue rose 45%.', '売上は45%増。').endswith(':A'))  # nowhere in the release: calculated or invented
        self.assertTrue(reason('Revenue was $3.41 billion and costs rose 45%.', '売上高は3.41 billion ドル、費用は45%増。').endswith(':A'))

    def test_a_statement_table_figure_may_be_written_in_the_unit_its_header_declares(self):
        # Nov 14, NBIS: "In USD $ millions ... Revenues 146.1 980.8" -- the model wrote "$980.8 million" and the check saw 980800000 vs 980.8
        table = ('Q3 2026 Financial Highlights Consolidated results In USD $ millions Three months ended September 30 2025 2026 Change '
                 'Revenues 146.1 980.8 571 % Adjusted EBITDA / (loss) (5.2 ) 465.8 n/m Total assets 1,962.1 2026')
        def ok(ja, en):
            deep_analysis.checked({'ja': ja, 'en': en}, table)
        ok('売上高は980.8百万ドルだった。', 'Revenue was $980.8 million.')
        ok('調整後EBITDAは465.8百万ドル。', 'Adjusted EBITDA was $465.8 million.')
        for ja, en in [('売上高は9.8億ドル。', 'Revenue was $980.8 billion.'),          # wrong scale
                       ('売上高は9億8,000万ドル。', 'Revenue was $980.0 million.'),      # a figure the table does not print
                       ('売上は2,026百万ドル。', 'Revenue was $2,026 million.'),         # a year is not a table amount
                       ('売上は57.1百万ドル。', 'Revenue was $57.1 million.')]:          # a percentage is not an amount
            with self.assertRaises(ValueError, msg=en):
                deep_analysis.checked({'ja': ja, 'en': en}, table)
        self.assertEqual(deep_analysis.table_scaled_figures('Revenues 146.1 980.8'), '')  # no declared unit: nothing is converted
        self.assertEqual(deep_analysis.table_scaled_figures('In millions A 1.5 In thousands B 2.5'), '')  # mixed units: nothing is converted
        self.assertIn('980.8 million', deep_analysis.table_scaled_figures('(in millions of U.S. dollars) Revenues 980.8'))


    def test_why_an_analysis_is_held_is_recorded_and_older_holds_are_tried_again(self):
        self.earnings()
        bad = json.loads(json.dumps(GOOD))
        bad['points'] = [point('売上は45%増。', 'Revenue rose 45%.')] * 3
        for attempt in range(3):
            self.assertEqual(self.run_deep(reply(bad), now=base.NOW.timestamp() + attempt * 1000), 'retry')
        with deep_analysis.connect(self.path) as db:
            report = deep_analysis.diagnostics(db, now=base.NOW.timestamp() + 5000)
        [held] = report['notDone']
        self.assertEqual((held['subject'], held['state'], held['failure']), ('NBIS', 'held', 'too-few-checked-points'))
        self.assertEqual(held['detail'], {'kept': 0, 'rejected': {'unsupported-number:value:45%:A': 3}})
        self.assertEqual(report['version'], deep_analysis.VERSION)
        self.assertEqual(self.run_deep(lambda *_: self.fail('held'), now=base.NOW.timestamp() + 5000), 'idle')
        with deep_analysis.connect(self.path) as db:  # held by an older version of the checks
            db.execute('UPDATE deep_analyses SET version=0')
        self.assertEqual(self.run_deep(reply(GOOD), now=base.NOW.timestamp() + 6000), 'done')
        [item] = self.items()
        self.assertEqual(len(item['points']), 3)

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
