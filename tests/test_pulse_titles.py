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
                          ({**GOOD, 'shortJa': 'オラクル、電力費3億ドル負担計画を撤回'}, 'changed-negation')):
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
