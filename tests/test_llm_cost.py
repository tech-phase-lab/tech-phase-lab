"""Paid calls are counted, never limited (owner, Nov 15): a day over the line is a warning, not a stop."""
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import test_official_research as base  # noqa: E402
from test_official_research import research  # noqa: E402
import deep_analysis  # noqa: E402
import llm_cost  # noqa: E402
from test_deep_analysis import ENV, GOOD, EARNINGS  # noqa: E402

PRICES = json.dumps({'gpt-6-astra': {'input': 2.0, 'cachedInput': 0.5, 'output': 10.0}})


def answering(note, input_tokens, cached, output_tokens):
    def transport(payload, key):
        return {'status': 'completed', 'usage': {'input_tokens': input_tokens, 'output_tokens': output_tokens,
                                                  'input_tokens_details': {'cached_tokens': cached}},
                'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(note, ensure_ascii=False)}]}]}
    return transport


class LlmCostTests(unittest.TestCase):
    setUp = base.OfficialResearchTests.setUp

    def earnings(self):
        with research.connect(self.path) as db:
            db.execute('UPDATE sources SET title=?', (EARNINGS,))

    def test_cost_is_tokens_times_the_unit_price_with_cached_input_at_its_own_price(self):
        table = llm_cost.prices({llm_cost.PRICES_ENV: PRICES})
        self.assertEqual(table, {'gpt-6-astra': (2.0, 0.5, 10.0)})
        # 10,000 input of which 6,000 cached, 1,000 output: 4,000 x 2 + 6,000 x 0.5 + 1,000 x 10 = 21,000 per million
        self.assertAlmostEqual(llm_cost.cost_usd('gpt-6-astra', 10000, 6000, 1000, table), 0.021)
        self.assertIsNone(llm_cost.cost_usd('unpriced-model', 10000, 0, 1000, table))
        self.assertIsNone(llm_cost.cost_usd('gpt-6-astra', None, None, None, table))
        self.assertEqual(llm_cost.prices({llm_cost.PRICES_ENV: 'not json'}), {})
        self.assertEqual(llm_cost.prices({llm_cost.PRICES_ENV: json.dumps({'m': {'input': -1, 'output': 1}})}), {})

    def test_a_deep_analysis_call_is_counted_with_its_tokens_and_shows_in_health(self):
        self.earnings()
        env = {**ENV, llm_cost.PRICES_ENV: PRICES}
        now = base.NOW.timestamp()
        self.assertEqual(deep_analysis.run_once(self.path, answering(GOOD, 10000, 6000, 1000), env, now=now, reference=base.NOW), 'done')
        with deep_analysis.connect(self.path) as db:
            today = llm_cost.today(db, now, env)
            self.assertEqual(today['lanes']['deep-analysis'], {'calls': 1, 'models': {'gpt-6-astra': 1}, 'inputTokens': 10000, 'cachedTokens': 6000, 'outputTokens': 1000,
                                                              'estimatedUsd': 0.021})
            self.assertEqual((today['estimatedUsd'], today['overWarning'], today['unknownCostCalls']), (0.021, False, 0))
            self.assertGreater(today['sourceCharsSent'], 0)
            self.assertEqual(deep_analysis.diagnostics(db, now=now)['cost']['lanes']['deep-analysis']['calls'], 1)
            report = json.dumps(deep_analysis.diagnostics(db, now=now), ensure_ascii=False)
            self.assertNotIn(GOOD['points'][0]['ja'], report)  # health shows counts and money, never text

    def test_a_model_without_a_price_is_unknown_not_free(self):
        self.earnings()
        now = base.NOW.timestamp()
        deep_analysis.run_once(self.path, answering(GOOD, 10000, 0, 1000), ENV, now=now, reference=base.NOW)
        with deep_analysis.connect(self.path) as db:
            today = llm_cost.today(db, now, ENV)
        self.assertEqual((today['estimatedUsd'], today['unknownCostCalls'], today['unpricedModels']), (0, 1, ['gpt-6-astra']))

    def test_passing_the_daily_line_only_warns_and_never_stops_or_delays_an_analysis(self):
        self.earnings()
        env = {**ENV, llm_cost.PRICES_ENV: PRICES}
        now = base.NOW.timestamp()
        with deep_analysis.connect(self.path) as db:
            llm_cost.schema(db)
            # 1.5 USD already spent today by the weekly lane
            db.execute('INSERT INTO llm_usage VALUES(?,?,?,?,?,?,?,?,?)', (now - 60, 'weekly', 'weekly:x', 'gpt-6-astra', 0, 0, 150000, None, None))
            self.assertTrue(llm_cost.today(db, now, env)['overWarning'])
            self.assertEqual(llm_cost.sync_incident(db, now, env), 'llm-cost-warning')
            row = db.execute('SELECT severity,status FROM operational_incidents WHERE incident_key=?', (llm_cost.INCIDENT_KEY,)).fetchone()
            self.assertEqual((row[0], row[1]), ('warning', 'open'))
        # the release still gets its analysis, at once
        self.assertEqual(deep_analysis.run_once(self.path, answering(GOOD, 10000, 0, 1000), env, now=now, reference=base.NOW), 'done')
        with deep_analysis.connect(self.path) as db:
            self.assertEqual(len(deep_analysis.member_view(db, reference=base.NOW)), 1)
            # the next day the count starts again and the warning clears
            self.assertIsNone(llm_cost.sync_incident(db, now + 86400, env))
            self.assertEqual(db.execute('SELECT status FROM operational_incidents WHERE incident_key=?', (llm_cost.INCIDENT_KEY,)).fetchone()[0], 'resolved')

    def test_counting_never_breaks_the_call_it_counts(self):
        self.assertFalse(llm_cost.record(object(), 'deep-analysis', 'x', 'm', {}))
        with research.connect(self.path) as db:
            self.assertTrue(llm_cost.record(db, 'weekly', 'weekly:x', 'm', {'status': 'completed'}))  # no usage reported: counted as a call, cost unknown
            self.assertEqual(llm_cost.today(db, datetime.now(timezone.utc).timestamp(), {})['unknownCostCalls'], 1)


if __name__ == '__main__':
    unittest.main()
