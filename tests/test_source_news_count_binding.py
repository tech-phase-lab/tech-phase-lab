"""Offline bounded counted-object regressions; no live/provider writes."""
from copy import deepcopy
import json
import unittest
from unittest.mock import patch

import test_retained_business_admission as fixture
from test_general_semantic_assessment import result
import general_source_news as news
import official_research as research
import source_news_grounding as grounding

SOURCE = 'Orion Labs launched 2 new AI models for developers in 2027.'
COPY = {'en': 'Orion Labs launched 2 new AI models in 2027 for developers.',
        'ja': 'Orion Labsは開発者向けの2つの新しいAIモデルを2027年に公開した。',
        'evidenceId': '0'}


class CountBindingTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.create_connection', 'socket.socket.connect'):
            guard = patch(target, side_effect=AssertionError('network forbidden'))
            guard.start(); self.addCleanup(guard.stop)

    def database(self):
        case = fixture.RetainedBusinessAdmissionTests(); case.setUp()
        self.addCleanup(case.doCleanups)
        return case

    def assert_worker(self, source, copy, outcome):
        case = self.database(); raw = case.raw(source)
        self.assertEqual(case.run_once(lambda *_: result(facts=[copy])), outcome)
        with research.connect(case.path) as db:
            self.assertEqual(dict(db.execute('SELECT * FROM signal_x_acquisition').fetchone()), raw)
            self.assertEqual(len(news.public_items(db, fixture.NOW)), int(outcome == 'done'))
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 1)
        self.assertEqual(case.run_once(lambda *_: self.fail('closed attempt spent again')), 'idle')
        return case

    def test_exact_known_modifier_witness_is_rejected(self):
        bad = {**COPY, 'en': 'Orion Labs launched 2 new factories using AI for developers in 2027.'}
        case = self.assert_worker(SOURCE, bad, 'review')
        with research.connect(case.path) as db:
            self.assertEqual(db.execute('SELECT reason FROM official_research_attempt_failures').fetchone()[0],
                             'unproven-source-relation')

    def test_faithful_modifier_phrase_is_public_in_both_languages(self):
        self.assert_worker(SOURCE, COPY, 'done')
        self.assert_worker(SOURCE, {**COPY, 'en': COPY['en'].replace('new AI models', 'new models using AI')}, 'done')
        self.assertEqual(grounding.counted_objects(SOURCE, 'en'), [(2, 'model', True, True)])
        self.assertEqual(grounding.counted_objects(COPY['ja'], 'ja'), [(2, 'model', True, True)])

    def test_noun_or_modifier_changes_in_either_language_are_rejected(self):
        variants = [
            {**COPY, 'en': COPY['en'].replace('new AI models', 'new factories using AI')},
            {**COPY, 'ja': COPY['ja'].replace('AIモデル', 'AI工場')},
            {**COPY, 'ja': COPY['ja'].replace('AIモデルを', 'AIモデルの設計図を')},
            {**COPY, 'ja': COPY['ja'].replace('AIモデルを', 'AIモデル の設計図を')},
            {**COPY, 'ja': COPY['ja'].replace('AIモデルを', 'AIモデル 工場を')},
            {**COPY, 'en': COPY['en'].replace('AI models', 'AI model-making factories')},
            {**COPY, 'en': COPY['en'].replace('new AI models', 'AI models')},
            {**COPY, 'ja': COPY['ja'].replace('新しいAIモデル', 'AIモデル')},
            {**COPY, 'en': COPY['en'].replace('new AI models', 'new models for AI developers')},
            {**COPY, 'ja': COPY['ja'].replace('2つの新しいAIモデル', '3つの新しいAIモデル')},
        ]
        for copy in variants:
            with self.subTest(copy=copy): self.assert_worker(SOURCE, copy, 'review')

    def test_unknown_counted_heads_or_modifiers_are_not_empty_bindings(self):
        for phrase in ('2 new products', '2 advanced models', '2 new AI model factories',
                       '2.5 new models', '2 advanced factories', 'eleven new AI models',
                       '2m new models', '2e3 new models', 'two-hundred new models',
                       '2 million new AI models', 'zero new AI models', '.5 new models',
                       '5. new models', '1/2 new models', 'hundreds of new models',
                       '½ new models', '1¼ new models', '² new models', '2 new AI model‐making factories',
                       '2 new AI model‑making factories', '2 new AI model–making factories',
                       '2 new AI model-making factories', '2 new AI model -making factories',
                       '2 new AI model - making factories', "2 new models' factories"):
            with self.subTest(phrase=phrase):
                with self.assertRaisesRegex(ValueError, grounding.RELATION_FAILURE):
                    grounding.counted_objects('Orion Labs released ' + phrase + '.', 'en')

    def test_factory_lab_counts_keep_number_and_do_not_borrow_year(self):
        self.assertEqual(grounding.counted_objects('2 new factories in 2027 if permits are approved.', 'en'),
                         [(2, 'factory', True, False)])
        self.assertEqual(grounding.counted_objects('2つの新しい工場を2027年に建設する。', 'ja'),
                         [(2, 'factory', True, False)])
        self.assertEqual(grounding.counted_objects('two laboratories', 'en'), [(2, 'laboratory', False, False)])
        self.assertEqual(grounding.counted_objects('2研究室', 'ja'), [(2, 'laboratory', False, False)])
        self.assertEqual(grounding.counted_objects('3 percent in 2027 if permits are approved.', 'en'), [])
        self.assertEqual(grounding.counted_objects('2 gigawatts of capacity', 'en'), [])
        self.assertEqual(grounding.counted_objects('3 minute development presentation', 'en'), [])
        self.assertEqual(grounding.counted_objects('$2 million of funding', 'en'), [])
        self.assertEqual(grounding.counted_objects('2 million dollars of funding', 'en'), [])
        self.assertEqual(grounding.counted_objects('2個の新しいAIモデルを公開した。', 'ja'), [(2, 'model', True, True)])

    def test_saved_public_copy_tamper_is_withdrawn_without_read_mutation(self):
        case = self.assert_worker(SOURCE, COPY, 'done')
        with research.connect(case.path) as db:
            saved = json.loads(db.execute('SELECT payload FROM official_research_publications').fetchone()[0])
            bad = deepcopy(saved)
            bad['facts'][0]['en'] = COPY['en'].replace('new AI models', 'new factories using AI')
            db.execute('UPDATE official_research_publications SET payload=?', (json.dumps(bad),))
            before = db.total_changes
            self.assertEqual(news.public_items(db, fixture.NOW), [])
            self.assertEqual(db.total_changes, before)
            db.execute('UPDATE official_research_publications SET payload=?', (json.dumps(saved),))
            self.assertEqual(len(news.public_items(db, fixture.NOW)), 1)
        self.assertEqual(case.run_once(lambda *_: self.fail('damaged copy spent again')), 'idle')


if __name__ == '__main__': unittest.main()
