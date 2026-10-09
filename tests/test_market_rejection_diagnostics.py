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


class JapaneseCompoundUnitTests(unittest.TestCase):
    def test_hyakuman_and_senman_amounts_match_their_source(self):
        import factual_validation as f
        for text in ('Acmeは40百万ドルを調達した', 'Acmeは4千万ドルを調達した', 'Acmeは4000万ドルを調達した'):
            f.validate_numbers(text, 'Acme raised $40 million in new funding.')
        f.validate_numbers('売上高は150十億ドル', 'Revenue was $150 billion.')

    def test_compound_units_still_reject_a_wrong_scale(self):
        import factual_validation as f
        for text, source in (('Acmeは40百万ドルを調達した', 'Acme raised $4 million.'),
                             ('Acmeは4千万ドルを調達した', 'Acme raised $4 million.'),
                             ('Acmeは3千万人を採用', 'Acme hired 3,000 people.')):
            with self.assertRaisesRegex(ValueError, 'unsupported-number'):
                f.validate_numbers(text, source)


class AttributionTailTests(unittest.TestCase):
    SOURCE = 'Microsoft plans to cut jobs at its data-center unit, according to Bloomberg.'
    EN = 'Microsoft plans to cut jobs at its data-center unit, according to Bloomberg.'

    def check(self, en, ja, source=None):
        import source_news_grounding as grounding
        source = source or self.SOURCE
        grounding.validate({'en': en, 'ja': ja}, source, grounding.context(source))

    def test_closing_attribution_is_not_a_second_clause(self):
        import source_news_grounding as grounding
        for quote in (self.SOURCE, 'Oil tankers resume runs through Hormuz, WSJ reports.',
                      'Acme plans to cut jobs, according to people familiar with the matter.'):
            grounding.relation_boundary(quote)
        self.check(self.EN, 'Bloombergによると、Microsoftはデータセンター部門で人員削減を計画している。')

    def test_attribution_must_survive_and_cannot_carry_more(self):
        import source_news_grounding as grounding
        for en, ja in ((self.EN, 'Microsoftはデータセンター部門で人員削減を計画している。'),
                       ('Microsoft plans to cut jobs at its data-center unit.', 'Bloombergによると、Microsoftはデータセンター部門で人員削減を計画している。'),
                       (self.EN, 'Bloombergによると、Googleはデータセンター部門で人員削減を計画している。')):
            with self.assertRaises(ValueError):
                self.check(en, ja)
        for quote in ('Acme will not buy Beta, according to Bloomberg.', 'Acme buys Beta, according to Bloomberg and Reuters.',
                      'Acme buys Beta, according to 3 people.', 'Acme buys Beta, its rival, Reuters reports.',
                      'Acme buys Beta, expanding its reach.'):
            with self.assertRaisesRegex(ValueError, grounding.RELATION_FAILURE):
                grounding.relation_boundary(quote)


class SummaryDetailFillerTests(unittest.TestCase):
    JA = '米国債のリスクが16年ぶりに最高水準に達しました。詳細は投稿されたリンクで確認できます。投稿者はこの情報を伝えています。'
    EN = 'US Treasury risk hit its highest level in 16 years. Details are available in the posted link. The poster shared this information.'

    def test_post_and_link_sentences_are_dropped_and_a_restated_headline_gives_no_detail(self):
        self.assertIsNone(news.without_filler(self.JA, self.EN, '米国債のリスク、16年ぶりの高水準に'))

    def test_detail_that_adds_a_figure_or_fact_is_kept_without_filler(self):
        self.assertEqual(news.without_filler(self.JA, self.EN, '米国債のリスク指標、過去最高'),
                         ('米国債のリスクが16年ぶりに最高水準に達しました。', 'US Treasury risk hit its highest level in 16 years.'))
        ja = '米国債のリスク指標が16年ぶりの高水準に達した。前回の高水準は2010年で、指標は1.2から1.8に上昇した。'
        en = 'The gauge hit a 16-year high. The last such high was in 2010, and the gauge rose from 1.2 to 1.8.'
        self.assertEqual(news.without_filler(ja, en, '米国債のリスク、16年ぶりの高水準に'), (ja, en))

    def test_prompt_no_longer_asks_for_the_posting_account(self):
        self.assertNotIn('posting account)', news.DETAIL_POLICY)
        self.assertIn('Never mention the post', news.DETAIL_POLICY)


class ResearchRejectionDetailTests(unittest.TestCase):
    def test_spelled_count_words_come_with_the_next_word(self):
        import factual_validation as f
        with self.assertRaisesRegex(ValueError, 'unsupported-number'):
            f.validate_numbers('9社が参加', 'Nine companies joined, up three percent')
        self.assertEqual(f.LAST_NUMBER_REJECTION[0]['sourceWords'], ['nine companies', 'three percent'])

    def test_direction_and_name_rejections_record_what_differed(self):
        import factual_validation as f
        with self.assertRaisesRegex(ValueError, 'changed-direction'):
            f.validate_directions('Revenue fell 5%', 'Revenue rose 5%')
        detail = f.LAST_DIRECTION_REJECTION[0]
        self.assertEqual((detail['copy'], detail['source']), ('down', ['up']))
        with self.assertRaisesRegex(ValueError, 'changed-names'):
            f.validate_names('Zorvexは新製品を発表', 'Acme announced a product')
        self.assertEqual(f.LAST_NAME_REJECTION[0], 'zorvex')
