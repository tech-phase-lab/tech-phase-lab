"""One-line top-strip titles summarized from published headlines (no live calls)."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import factual_validation
import headline_translation
import preview_summaries
import pulse_titles

ENV = {'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'true', 'OPENAI_API_KEY': 'synthetic-test-key-only-1234',
       'OFFICIAL_HEADLINE_TRANSLATION_MODEL': 'synthetic-model', 'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT': '10'}
NOW = 1_800_000_000.0
JA = 'オラクル、ウィスコンシン州の100万人超の住民向けに電力費3億ドルを負担する計画を発表'
EN = 'Oracle Announces Commitment to Absorb $300 Million in Rising Energy Costs for Over 1 Million Wisconsin Residents'
PAYLOAD = {'officialUpdates': [{'id': '7', 'title': EN, 'translationJa': JA, 'publishedAt': '2026-10-06T01:00:00Z'},
                               {'id': '8', 'title': 'Nvidia ships chips', 'translationJa': 'エヌビディアが出荷',
                                'publishedAt': '2026-10-06T00:00:00Z'}],
           'marketUpdates': [], 'items': []}
GOOD = {'shortJa': 'オラクル、電力費3億ドル負担を計画', 'shortEn': 'Oracle plans to absorb $300M in energy costs'}


def reply(copy):
    return lambda payload, key: {'status': 'completed', 'output_text': json.dumps(copy, ensure_ascii=False)}


class PulseTitleTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / 'db.sqlite'
        with headline_translation.connect(self.path) as db:
            headline_translation.schema(db)

    def run_title(self, transport, now=NOW):
        return pulse_titles.run_once(self.path, PAYLOAD, transport, ENV, now=now)

    def attached(self):
        with headline_translation.connect(self.path) as db:
            return pulse_titles.attach(db, PAYLOAD)['officialUpdates']

    def test_long_headline_gets_a_checked_one_line_title(self):
        seen = []

        def provider(payload, key):
            seen.append(json.loads(payload['input']))
            return reply(GOOD)(payload, key)
        self.assertEqual(self.run_title(provider), 'done')
        # Only the published bilingual headline is sent; the short one needs no call.
        self.assertEqual(seen, [{'titleJa': JA, 'titleEn': EN}])
        self.assertEqual(self.run_title(lambda *_: self.fail('no second call')), 'idle')
        first, second = self.attached()
        self.assertEqual((first['pulseTitleJa'], first['pulseTitleEn']), (GOOD['shortJa'], GOOD['shortEn']))
        self.assertNotIn('pulseTitleJa', second)
        self.assertNotIn('pulseTitleJa', PAYLOAD['officialUpdates'][0])  # The input is never mutated.

    def test_changed_facts_or_dropped_status_are_rejected_and_retried(self):
        for bad, code in (({**GOOD, 'shortJa': 'オラクル、電力費30億ドル負担を計画'}, 'unsupported-number'),
                          ({**GOOD, 'shortJa': 'オラクル、電力費3億ドルを負担'}, 'changed-qualifier'),
                          ({**GOOD, 'shortJa': 'オラクル、電力費3億ドル負担計画を撤回'}, 'changed-negation'),
                          ({**GOOD, 'shortJa': 'オラクル、データセンター電力費3億ドルを全額負担する計画'}, 'too-long')):
            with self.subTest(code=code):
                with self.assertRaises(ValueError) as caught:
                    pulse_titles.validate(bad, JA, EN)
                self.assertEqual(str(caught.exception), code)
        self.assertEqual(self.run_title(reply({**GOOD, 'shortJa': 'オラクル、電力費30億ドル負担を計画'})), 'retry')
        self.assertNotIn('pulseTitleJa', self.attached()[0])
        seen = []

        def provider(payload, key):
            seen.append(json.loads(payload['input']))
            return reply(GOOD)(payload, key)
        self.assertEqual(self.run_title(provider, now=NOW + 3600), 'done')
        self.assertEqual(seen[0]['previousRejection'], 'unsupported-number')

    def test_strip_titles_use_a_small_share_of_the_daily_limit(self):
        with headline_translation.connect(self.path) as db, db:
            for n in range(2):
                db.execute("INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) "
                           "VALUES(?,?,?,?,?,?)", (NOW - 10, pulse_titles.LEDGER_PREFIX + str(n), 'x', 'm', 'done', str(n)))
        self.assertEqual(self.run_title(lambda *_: self.fail('budget share used')), 'idle')


class ValidatorIdiomTests(unittest.TestCase):
    def test_per_share_is_not_a_new_number(self):
        source = 'Revenue was $11.32 billion and GAAP EPS was $2.83 per diluted share for the quarter ended August 28, 2026.'
        factual_validation.validate_numbers('希薄化後1株当たり2.83ドル', source)
        factual_validation.validate_numbers('8月28日終了の四半期', source)
        # A year inferred against a source without one stays rejected...
        with self.assertRaises(ValueError):
            factual_validation.validate_numbers('quarter ended August 28, 2026', '2026年度、8月28日終了の四半期')
        with self.assertRaises(ValueError):
            factual_validation.validate_numbers('1株を売却', 'The company sold shares')

    def test_detail_bodies_may_state_a_year_once_but_titles_may_not_differ(self):
        # ...but between the two languages of a detail already checked against
        # its source, one side may omit the year or repeat it.
        ja = '同社は2026年度第4四半期（8月28日終了）の決算を発表した。'
        en = 'The company reported results for the fourth quarter of fiscal 2026, which ended August 28, 2026.'
        factual_validation.validate_pair(ja, en, exact_counts=False)
        with self.assertRaises(ValueError):
            factual_validation.validate_pair(ja, en)
        with self.assertRaises(ValueError):
            factual_validation.validate_pair('売上高は12%増', 'Revenue rose 13%', exact_counts=False)


if __name__ == '__main__':
    unittest.main()


class StripTitleCaseTests(unittest.TestCase):
    def test_realistic_short_titles(self):
        cases = (
            ('エヌビディア、オラクルがテキサス州の新データセンターにBlackwell GPUを5万基導入すると発表',
             'NVIDIA announces Oracle will deploy 50,000 Blackwell GPUs in new Texas data centers',
             'オラクル、GPU5万基を導入へ', 'Oracle will deploy 50,000 Blackwell GPUs', None),
            ('マイクロン、第4四半期売上高が113.2億ドルとなり過去最高を更新',
             'Micron reports record fiscal Q4 revenue of $11.32 billion',
             'マイクロン、売上高113.2億ドルで最高', 'Micron posts record $11.32B revenue', None),
            ('報道：アップル、AIスタートアップの買収を検討', 'Apple is reportedly considering acquiring an AI startup',
             'アップルがAI企業買収を検討', 'Apple weighs buying AI startup', 'changed-qualifier'),
            ('米10年債利回りが4.8%に上昇、2007年以来の高水準', 'U.S. 10-year Treasury yield rises to 4.8%, highest since 2007',
             '米10年債利回り4.8%、07年来高水準', 'US 10-year yield hits 4.8%, highest since 2007', 'unsupported-number'),
        )
        for ja, en, short_ja, short_en, code in cases:
            with self.subTest(short_ja=short_ja):
                if code is None:
                    pulse_titles.validate({'shortJa': short_ja, 'shortEn': short_en}, ja, en)
                else:
                    with self.assertRaisesRegex(ValueError, '^' + code + '$'):
                        pulse_titles.validate({'shortJa': short_ja, 'shortEn': short_en}, ja, en)

    def test_unit_written_against_a_number_is_not_a_new_name(self):
        factual_validation.validate_names('GPU5万基を導入', 'deploys 50,000 GPUs')
        with self.assertRaises(ValueError):
            factual_validation.validate_names('B200を出荷', 'Ships GPUs')

    def test_health_reports_strip_title_jobs(self):
        import pipeline_status
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'db.sqlite'
            self.assertEqual(pipeline_status.pulse_titles_status(path), {'jobs': 0})
            with headline_translation.connect(path) as db, db:
                pulse_titles.schema(db)
                db.execute("INSERT INTO pulse_title_jobs VALUES('a','r',1,0,'l','retry','changed-names')")
                db.execute("INSERT INTO pulse_title_jobs VALUES('b','r',1,0,'l','done',NULL)")
                db.execute("INSERT INTO pulse_titles VALUES('b','r','{}','now')")
            self.assertEqual(pipeline_status.pulse_titles_status(path),
                             {'jobs': 2, 'states': {'retry': 1, 'done': 1}, 'stored': 1,
                              'failureKinds': {'changed-names': 1}})


class PreviewLanguageTests(unittest.TestCase):
    def test_only_english_or_japanese_sources_reach_the_preview_list(self):
        import original_preview_news
        self.assertFalse(original_preview_news.english_or_japanese(
            'MIMARU eröffnet eine Immobilie in Osaka-Namba mit Apartments für sechs Personen und einer Küche. '
            'Die Wohnungen bieten Platz für Familien und Gruppen, die gemeinsam reisen möchten.'))
        self.assertFalse(original_preview_news.english_or_japanese(
            'MIMARU inaugura su establecimiento en Osaka Namba con apartamentos para seis personas y una cocina. '
            'Los apartamentos ofrecen espacio para familias y grupos que viajan juntos.'))
        self.assertTrue(original_preview_news.english_or_japanese(
            'Micron Technology today announced results for its fourth quarter of fiscal 2026, which ended '
            'August 28, 2026. Revenue was $11.32 billion.'))
        self.assertTrue(original_preview_news.english_or_japanese('マイクロンは2026年度第4四半期の決算を発表した。'))
        self.assertTrue(original_preview_news.english_or_japanese('$NVDA Blackwell ships'))


class RejectionDiagnosticsTests(unittest.TestCase):
    def test_rejection_names_the_field_and_check_without_copy(self):
        source = 'Acme Corp announced a new plant in Ohio.'
        result = {'titleJa': 'Zeta社がオハイオ州に新工場', 'titleEn': 'Acme Corp announces new Ohio plant',
                  'bodyJa': 'Zeta社はオハイオ州に新工場を発表した。', 'bodyEn': 'Acme Corp announced a new plant in Ohio.'}
        detail = preview_summaries.diagnose(result, source)
        self.assertEqual(detail, {'field': 'titleJa/titleEn', 'check': 'pair', 'code': 'changed-names', 'name': 'zeta'})
        self.assertNotIn('オハイオ', json.dumps(detail, ensure_ascii=False))


class NumberDiagnosticsTests(unittest.TestCase):
    def test_number_rejection_lists_only_the_unsupported_values(self):
        source = 'Acme Corp revenue rose to $1.2 billion in the third quarter.'
        result = {'titleJa': 'アクメ、売上高13億ドルに増加', 'titleEn': 'Acme revenue rises to $1.2 billion',
                  'bodyJa': 'x', 'bodyEn': 'y'}
        self.assertEqual(preview_summaries.diagnose(result, source),
                         {'field': 'titleJa', 'check': 'numbers', 'code': 'unsupported-number',
                          'values': ['1300000000']})


class ResearchShareTests(unittest.TestCase):
    def test_research_notes_use_at_most_a_share_of_large_limits(self):
        import official_research
        self.assertEqual(official_research.research_cap(600), 300)
        self.assertEqual(official_research.research_cap(400), 200)
        self.assertEqual(official_research.research_cap(5), 5)


class PreviewStripTitleTests(unittest.TestCase):
    def test_summarized_test_publications_get_strip_titles(self):
        payload = {'officialUpdates': [], 'marketUpdates': [], 'items': [], 'originalPreviewItems': [
            {'id': 'p1', 'summaryPolicy': 'preview-summary-v1', 'titleJa': JA, 'titleEn': EN,
             'sourcePublishedAt': '2026-10-06T09:00:00Z'},
            {'id': 'p2', 'excerptOriginal': 'untranslated', 'previewPublishedAt': '2026-10-06T10:00:00Z'}]}
        self.assertEqual([key for _, key, _, _ in pulse_titles.sources(payload)], ['preview:p1'])
