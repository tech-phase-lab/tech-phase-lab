import copy
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import amount_relations as relation
import factual_validation
import monitor
import headline_translation
import official_headline_corrections as correction
import official_research
import signals


class AmountRelationTests(unittest.TestCase):
    def test_increment_is_not_total_in_japanese_or_english(self):
        for wrong in ('NVIDIA、株式買い戻し枠を1500億ドルに拡大と発表',
                      'NVIDIA、自社株買い承認枠を1500億ドルへ拡大',
                      'NVIDIA increases share repurchase authorization to $150 billion',
                      'NVIDIA announces a $150 billion share repurchase authorization'):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'changed-amount-relation'):
                relation.validate_amount_relations(wrong, correction.TITLE)
        for right in (correction.TITLE_JA, 'NVIDIA、自社株買い枠を1500億ドル増額',
                      'NVIDIA、自社株買い枠を1500億ドル分増額',
                      'NVIDIA increases share repurchase authorization by $150 billion'):
            relation.validate_amount_relations(right, correction.TITLE)

    def test_additional_authorization_noun_phrases_keep_increment_relation(self):
        source='NVIDIA authorized an additional $150 billion for share repurchases.'
        good=(
            'NVIDIAは自社株買いの追加枠$150 billion を承認した。',
            'NVIDIAは追加の承認枠1500億ドルを承認した。',
            'NVIDIA has approved $150 billion in additional share buyback authority.',
            'NVIDIA approved $150 billion of additional stock repurchase authorization.',
        )
        for text in good:
            with self.subTest(text=text):
                relation.validate_amount_relations(text,source)
                with self.assertRaisesRegex(ValueError,'changed-amount-relation'):
                    relation.validate_amount_relations(text,'NVIDIA increased total remaining authorization to $150 billion.')
        for text in (
            'NVIDIAは残る追加枠1500億ドルを承認した。',
            'NVIDIA approved a total $150 billion in additional share buyback authority.',
            'NVIDIA approved $150 billion in remaining share buyback authority.',
            'NVIDIA approved $235 billion in additional share buyback authority, with a remaining balance of $150 billion.',
        ):
            with self.subTest(text=text),self.assertRaisesRegex(ValueError,'changed-amount-relation'):
                relation.validate_amount_relations(text,source)

    def test_two_amounts_cannot_swap_roles_or_borrow_relation(self):
        source = 'NVIDIA authorized an additional $150 billion, increasing the total remaining authorization to $235 billion.'
        good = 'NVIDIAは1500億ドル追加し、残りは2350億ドルに拡大。'
        relation.validate_amount_relations(good, source)
        for wrong in ('NVIDIAは2350億ドル追加し、残りは1500億ドルに拡大。',
                      'NVIDIA increases the authorization to $150 billion, with an additional $235 billion.'):
            with self.assertRaisesRegex(ValueError, 'changed-amount-relation'):
                relation.validate_amount_relations(wrong, source)

    def test_exact_signed_currency_magnitudes_and_dates_remain_guarded(self):
        for wrong in ('NVIDIA、自社株買い枠を1500万ドル追加',
                      'NVIDIA、自社株買い枠を-1500億ドル追加',
                      'NVIDIA、自社株買い枠を1500億ドル追加、2028年に完了'):
            with self.assertRaisesRegex(ValueError, 'unsupported-number'):
                factual_validation.validate_numbers(wrong, correction.TITLE)
        self.assertEqual(relation.monetary_relations('increased by -$1.5 billion'),
                         {('USD', relation.Decimal('-1500000000'), 'increment')})
        self.assertNotEqual(relation.monetary_relations('increased by €1.5 billion'),
                            relation.monetary_relations('increased by $1.5 billion'))

    def test_unrelated_numbers_and_unclassified_money_are_not_blocked(self):
        for text, source in [('1500億ドル規模の市場', 'A $150 billion market'),
                             ('NVIDIAが新製品を発表', correction.TITLE),
                             ('売上高は10％増加', 'Revenue increased by 10%')]:
            relation.validate_amount_relations(text, source)

    def test_reviewed_title_requires_exact_source_title_url_date(self):
        row = {'source_id': 'primary-ir-NVDA', 'url': correction.URL, 'title': correction.TITLE,
               'published_on': '2026-09-28', 'truncated': False}
        self.assertEqual(correction.reviewed_headline(row), correction.TITLE_JA)
        for field, value in [('source_id', 'other'), ('url', correction.URL + '?other'),
                             ('title', correction.TITLE + ' correction'), ('published_on', '2026-10-03'),
                             ('truncated', True)]:
            self.assertIsNone(correction.reviewed_headline({**row, field: value}))

    def test_live_shape_projection_corrects_only_current_revision_without_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            db = official_research.connect(Path(directory) / 'test.sqlite')
            self.addCleanup(db.close)
            observed = '2026-09-28T11:05:29.215000+00:00'
            with db:
                monitor.add_source(db, 'NVDA', correction.URL, '2026-09-28', correction.TITLE)
                db.execute('UPDATE sources SET sha256=?,extracted_text=?,extracted_chars=?', ('old-xml', 'retained XML', 12))
                db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',
                           (correction.URL, 'old-xml', observed, 'retained XML', 12))
                db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)', (correction.URL, 'NVDA', observed))
                signals.public_official_updates(db, reference=datetime(2026, 10, 4, tzinfo=timezone.utc))
                row = db.execute('SELECT * FROM signal_events').fetchone()
                db.execute('INSERT INTO signal_headline_translations VALUES(?,?,?,?,?,?)',
                           (row['source_id'], row['url'], row['sha'], 'NVIDIA、株式買い戻し枠を1500億ドルに拡大と発表', 'old', observed))
            before = {table: [tuple(r) for r in db.execute('SELECT * FROM ' + table)]
                      for table in ('sources', 'release_events', 'signal_events', 'signal_headline_translations')}
            with patch.object(signals, 'fetch', side_effect=AssertionError('network')):
                items = signals.public_official_updates(db, reference=datetime(2026, 10, 4, tzinfo=timezone.utc), read_only=True)
            self.assertEqual(items[0]['translationJa'], correction.TITLE_JA)
            self.assertIsNone(headline_translation.claim(db, signals.SOURCES, 50, 'unused',
                datetime(2026, 10, 4, tzinfo=timezone.utc).timestamp()))
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)
            self.assertEqual(items[0]['publishedOn'], '2026-09-28')
            self.assertEqual(items[0]['observedAt'], observed)
            self.assertNotIn('bodyJa', items[0])
            self.assertEqual(before, {table: [tuple(r) for r in db.execute('SELECT * FROM ' + table)] for table in before})
            db.execute("UPDATE sources SET sha256='new-revision'")
            self.assertEqual(signals.public_official_updates(db, reference=datetime(2026, 10, 4, tzinfo=timezone.utc), read_only=True), [])



class ExecutionAndCapacityTests(unittest.TestCase):
    def test_through_fiscal_year_is_not_a_deadline(self):
        evidence = 'The company expects to execute the remaining program through fiscal year 2028.'
        for wrong in ('会社は2028会計年度までに実行する見込みとしている。',
                      'The company expects to execute the program by fiscal year 2028.',
                      'The company expects to execute it by the end of FY2028.'):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'changed-execution-period'):
                factual_validation.validate_semantics(wrong, evidence)
        factual_validation.validate_semantics('会社は2028会計年度にかけて実行する見込みとしている。', evidence)
        factual_validation.validate_semantics('The company expects execution through FY2028.', evidence)
        factual_validation.validate_semantics('会社は2028年度までに実行する。', 'The company will complete the program by fiscal year 2028.')

    def test_fiscal_year_optional_and_growth_percent_never_becomes_a_year(self):
        evidence = 'The company expects execution through fiscal year 2028.'
        for wrong in ('The company expects execution by the end of fiscal 2028.',
                      'The company expects execution by fiscal 2028.'):
            with self.assertRaisesRegex(ValueError, 'changed-execution-period'):
                factual_validation.validate_semantics(wrong, evidence)
        factual_validation.validate_semantics('The company expects execution through fiscal 2028.', evidence)
        factual_validation.validate_semantics('会社は2028会計年度にかけて実行する見込みとしている。',
                                             'The company expects execution through fiscal 2028.')
        # A percentage is not a year. Keep the successful baseline on this
        # release tree, including the shared official-item validation hook.
        growth = 'The company expects revenue to grow by 20%.'
        factual_validation.validate_semantics('売上高は20％増加する見込み。', growth)
        factual_validation.validate_pair('売上高は20％増加する見込み。', growth)
        official_research.validate_item('fact', {'ja': '売上高は20％増加する見込み。',
            'en': growth, 'evidenceQuote': growth}, growth, 'Company outlook')

    def test_separately_tensed_coordinated_actions_do_not_borrow_capability(self):
        evidence = 'Our cash generation gives us the capacity to invest in technologies and return capital to shareholders.'
        for wrong in ('The company can invest in technology and has returned capital to shareholders.',
                      'The company can invest in technology and will return capital to shareholders.',
                      'The company can invest in technology and returned capital to shareholders.',
                      'The company has invested in technology and can return capital to shareholders.',
                      'The company can invest in technology, has returned capital to shareholders.',
                      'The company can invest in technology while it returns capital to shareholders.',
                      '会社は技術に投資できるが、株主に資本を還元した。',
                      '会社は技術に投資できるとしており、株主への資本還元を実施した。',
                      '会社は株主への資本還元を実施しており、技術に投資できるとしている。',
                      '会社は技術に投資したとしており、資本還元を行えるとしている。'):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'changed-action-capacity'):
                factual_validation.validate_semantics(wrong, evidence)
        for right in ('The company can invest in technology and return capital to shareholders.',
                      'The company can invest in technology and can return capital to shareholders.',
                      'The company has the ability to invest in technology and return capital to shareholders.',
                      '会社は技術への投資と株主への資本還元を行えるとしている。'):
            factual_validation.validate_semantics(right, evidence)

    def test_bilingual_coordinated_financial_action_matrix(self):
        evidence = 'Our cash generation gives us the capacity to invest in technologies and return capital to shareholders.'
        japanese_actions = ('実施した', '行った', '行っている', '実行した', '行うとしている')
        for action in japanese_actions:
            for wrong in (f'会社は技術に投資できるとしており、株主への資本還元を{action}。',
                          f'会社は株主への資本還元を行えるとしており、技術への投資を{action}。',
                          f'会社は技術への投資を{action}が、株主への資本還元を行える。',
                          f'会社は投資能力を有しており、株主への資本還元を{action}。'):
                with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'changed-action-capacity'):
                    factual_validation.validate_semantics(wrong, evidence)
        for conjunction in ('and', 'but', 'while'):
            for action in ('has returned', 'will return', 'is returning', 'returned', 'returns'):
                wrong = f'The company can invest in technology {conjunction} {action} capital to shareholders.'
                with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'changed-action-capacity'):
                    factual_validation.validate_semantics(wrong, evidence)
        for right in ('会社は投資や株主還元を行える。', '会社は投資と資本還元ができる。',
                      '会社は投資と株主還元を行う能力がある。',
                      '会社は投資と株主還元を行うことができる。',
                      'The company can invest and return capital.',
                      'The company has capacity to invest and is able to return capital.'):
            factual_validation.validate_semantics(right, evidence)

    def test_capability_does_not_become_commitment_or_completed_action(self):
        evidence = 'Our cash generation gives us the capacity to invest in technologies and return capital to shareholders.'
        for wrong in ('会社は技術への投資と株主還元を行うとしている。',
                      'The company is investing in technologies and returning capital to shareholders.',
                      'The company will invest in technology and return capital to shareholders.',
                      '会社は投資と株主還元を実施した。性能を改善できる。'):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'changed-action-capacity'):
                factual_validation.validate_semantics(wrong, evidence)
        for right in ('会社は技術への投資と株主への資本還元を行えるとしている。',
                      'The company says it has capacity to invest in technology and return capital to shareholders.'):
            factual_validation.validate_semantics(right, evidence)
        factual_validation.validate_semantics('会社は設備に投資した。', 'The company invested in equipment.')
        factual_validation.validate_semantics('工場の生産能力は拡大した。', 'The factory increased production capacity.')

if __name__ == '__main__':
    unittest.main()
