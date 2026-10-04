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


if __name__ == '__main__':
    unittest.main()
