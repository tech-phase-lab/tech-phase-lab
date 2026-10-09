"""Market copy checks that rejected faithful translations, and rejection diagnostics (Oct 9)."""
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import bond_facts
import pipeline_status
import x_market_news as news


class JapaneseMaturityTests(unittest.TestCase):
    def test_ten_year_government_bond_in_japanese_is_a_maturity(self):
        original = 'US 10-year Treasury yield rises to 4.5%'
        for ja in ('米10年国債利回りが4.5%に上昇', '10年米国債の利回りが4.5%に上昇', '米10年債利回りが4.5%に上昇'):
            self.assertEqual(bond_facts.temporal_roles(ja), bond_facts.temporal_roles(original), ja)
            news.validate({'titleJa': ja, 'titleEn': original}, original)

    def test_period_is_still_not_a_maturity(self):
        original = 'U.S. Treasuries have suffered their worst 10-year period in history'
        with self.assertRaisesRegex(ValueError, 'invalid-copy'):
            news.validate({'titleJa': '米10年国債、史上最悪の成績', 'titleEn': original}, original)


class CashtagTests(unittest.TestCase):
    def test_cashtag_may_drop_the_dollar_sign_but_not_disappear_or_grow(self):
        self.assertTrue(news.cashtags_kept('WTI原油が上昇', '$WTI rises'))
        self.assertTrue(news.cashtags_kept('$WTI rises', '$WTI rises'))
        self.assertFalse(news.cashtags_kept('原油が上昇', '$WTI rises'))
        self.assertFalse(news.cashtags_kept('$WTI and $XLE rise', '$WTI rises'))
        self.assertFalse(news.cashtags_kept('WTIX rises', '$WTI rises'))


class DiagnoseTests(unittest.TestCase):
    def test_names_the_failing_check_without_copy_text(self):
        original = 'US 10-year Treasury yield rises to 4.5%'
        detail = news.diagnose({'titleJa': '米10年国債利回りが4.6%に上昇', 'titleEn': original}, original)
        self.assertEqual(detail['check'], 'numbers')
        self.assertEqual(detail['values'], ['4.6%', 'missing 4.5%'])
        detail = news.diagnose({'titleJa': '米国債、10年物が史上最悪', 'titleEn': 'x'},
                               'U.S. Treasuries have suffered their worst 10-year period in history')
        self.assertEqual(detail['check'], 'bond-roles')
        self.assertIn('maturity:10', detail['roles'])
        self.assertNotIn('史上最悪', str(detail))
        self.assertEqual(news.diagnose(None, original), {'check': 'shape'})
        source = 'Japan 30-year government bond yield rises to highest since 24 yrs ago'
        detail = news.diagnose({'titleJa': '日本30年国債利回り、24年ぶり高水準', 'titleEn': source}, source)
        self.assertEqual(detail['sourceContext'], ['to highest since 24 yrs ago'])


class ResearchFailureTests(unittest.TestCase):
    def test_counts_reasons_and_waiting_jobs_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'signals.sqlite'
            db = sqlite3.connect(path)
            db.executescript('''
              CREATE TABLE official_research_attempt_failures(lease TEXT PRIMARY KEY, event_id INTEGER, sha TEXT,
                failed_at TEXT, reason TEXT, detail TEXT, payload TEXT);
              CREATE TABLE official_research_jobs(event_id INTEGER PRIMARY KEY, sha TEXT, attempts INTEGER,
                next_at REAL, lease TEXT, state TEXT, failure_kind TEXT);''')
            now = time.time()
            recent = pipeline_status.timestamp(now - 60)
            old = pipeline_status.timestamp(now - 3 * 86400)
            db.executemany('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)', [
                ('a', 1, 's', recent, 'unsupported-number', '', '{"secret":"copy"}'),
                ('b', 2, 's', recent, 'unsupported-number', '', None),
                ('c', 3, 's', recent, 'invalid-copy', '', None),
                ('d', 4, 's', old, 'lost-negation', '', None)])
            db.executemany('INSERT INTO official_research_jobs VALUES(?,?,?,?,?,?,?)', [
                (1, 's', 2, now, '', 'retry', 'unsupported-number'), (2, 's', 1, now, '', 'review', None),
                (3, 's', 1, now, '', 'done', None)])
            db.commit(); db.close()
            state = pipeline_status.research_failures(path, now=now)
        self.assertEqual(state['failureReasons24h'], {'unsupported-number': 2, 'invalid-copy': 1})
        self.assertEqual(state['waitingJobs'], {'retry:unsupported-number': 1, 'review': 1})
        self.assertEqual([entry['reason'] for entry in state['recent']].count('unsupported-number'), 2)
        self.assertNotIn('secret', str(state))


class SpelledNumberTests(unittest.TestCase):
    def test_translation_may_write_digits_for_spelled_source_numbers(self):
        import factual_validation as fv
        fv.validate_numbers('100万ドルを寄付', 'donates one million dollars')
        fv.validate_numbers('20億ドル', 'two billion dollars')
        for text, source in (('3人', 'appoints two'), ('2人', 'appoints two'), ('1人', 'a person'),
                             ('200万ドル', 'one million dollars'), ('3日間', 'across three targets')):
            with self.assertRaisesRegex(ValueError, 'unsupported-number'):
                fv.validate_numbers(text, source)


class BondLookbackTests(unittest.TestCase):
    def test_year_high_and_qualified_lookback_match_japanese_buri(self):
        original = 'Japan 30-year government bond yield hits 24-year high'
        news.validate({'titleJa': '日本30年国債利回り、24年ぶりの高水準', 'titleEn': original}, original)
        self.assertEqual(bond_facts.temporal_roles('highest in nearly 24 years'), bond_facts.temporal_roles('24年ぶりの高水準'))
        with self.assertRaisesRegex(ValueError, 'unsupported-number|invalid-copy'):
            news.validate({'titleJa': '日本30年国債利回り、20年ぶりの高水準', 'titleEn': original}, original)


if __name__ == '__main__':
    unittest.main()


class RelationDiagnosticsTests(unittest.TestCase):
    def test_relation_rule_records_cue_and_nearby_source_words(self):
        import source_news_grounding as grounding
        for quote, rule, cue in (('Acme opens a plant in Ohio and hires 300 workers', 'coordination', 'and'),
                                 ('Acme will not open the plant', 'negation', 'not')):
            grounding.LAST_RELATION_REJECTION[0] = {}
            with self.assertRaisesRegex(ValueError, grounding.RELATION_FAILURE):
                grounding.relation_boundary(quote)
            detail = grounding.LAST_RELATION_REJECTION[0]
            self.assertEqual((detail['rule'], detail['cue']), (rule, cue))
            self.assertIn('[' + cue + ']', detail['around'])
            self.assertLessEqual(len(detail['around']), 90)

    def test_thousands_separator_still_passes(self):
        import source_news_grounding as grounding
        grounding.relation_boundary('Acme hires 1,200 workers')

    def test_fact_count_mismatch_records_counts(self):
        import general_source_news as general
        with self.assertRaisesRegex(ValueError, 'invalid-note'):
            general.bind_note({'facts': [{}]}, {'units': [{'id': 'a'}, {'id': 'b'}]})
        self.assertEqual(general.LAST_NOTE_REJECTION[0], {'rule': 'fact-count', 'facts': 1, 'units': 2})
