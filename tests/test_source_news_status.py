"""Synthetic status regressions through the one-call worker and public reader.

The fixture records the exact pre-fix matrix observed on release 864729a7.
Its outcome/reason/actor fields are historical evidence, not current assertions.
All raw rows live in temporary databases and every model response is mocked.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import test_retained_business_admission as fixture
import test_broker_outlook as broker
from test_general_semantic_assessment import result
from test_source_news_admission import REFLECTION
import general_source_news as news
import official_research as research

MATRIX = json.loads((Path(__file__).parent/'fixtures/source-news-status-baseline.json').read_text())


class SourceNewsStatusTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.create_connection', 'socket.socket.connect'):
            guard = patch(target, side_effect=AssertionError('network forbidden'))
            guard.start()
            self.addCleanup(guard.stop)

    def run_claim(self, source, en, ja, expected, *, evidence_id='0'):
        case = fixture.RetainedBusinessAdmissionTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        raw = case.raw(source)
        calls = []
        copy = {'en': en, 'ja': ja, 'evidenceId': evidence_id}

        def model(payload, key):
            data = json.loads(payload['input'])
            calls.append(data)
            self.assertEqual(data['evidenceExcerpts'], {'0': source})
            self.assertIsNone(data['ticker'])
            return result(facts=[copy])

        self.assertEqual(case.run_once(model), expected)
        with research.connect(case.path) as db:
            items = news.public_items(db, fixture.NOW)
            self.assertEqual(len(items), int(expected == 'done'))
            if items:
                self.assertIn(en, items[0]['bodyEn'])
                self.assertIn(ja, items[0]['bodyJa'])
                self.assertEqual(items[0]['tickers'], [])
                self.assertEqual(items[0]['publishedAt'], raw['published_at'])
                self.assertEqual(items[0]['observedAt'], raw['first_seen_at'])
            self.assertEqual(dict(db.execute('SELECT * FROM signal_x_acquisition').fetchone()), raw)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 1)
            event = dict(db.execute('SELECT * FROM signal_events').fetchone())
            self.assertEqual(json.loads(event['tickers_json']), [])
            self.assertEqual(json.loads(event['matches_json']), {})
        self.assertEqual(case.run_once(lambda *_: self.fail('closed attempt repeated')), 'idle')
        self.assertEqual(len(calls), 1)
        return case

    def test_exact_baseline_matrix(self):
        self.assertEqual(len(MATRIX), 20)
        for row in MATRIX:
            with self.subTest(label=row['label']):
                case = self.run_claim(row['source'], row['en'], row['ja'], row['expected'])
                if row['expected'] == 'review':
                    with research.connect(case.path) as db:
                        self.assertEqual(db.execute('SELECT reason FROM official_research_attempt_failures').fetchone()[0],
                                         'changed-claim-status')

    def test_announcement_and_release_cannot_change_in_either_language(self):
        for verb in ('announced', 'unveiled', 'introduced', 'launched', 'released'):
            announcement = verb in ('announced', 'unveiled', 'introduced')
            source = f'Orion Labs {verb} a new AI model for developers.'
            en = f'Orion Labs {verb} a new model using AI for developers.'
            ja = 'Orion Labsは開発者向けの新しいAIモデルを'+('発表した。' if announcement else '公開した。')
            wrong_en = 'Orion Labs '+('launched' if announcement else 'announced')+' a new model using AI for developers.'
            wrong_ja = ja.replace('発表した', '公開した') if announcement else ja.replace('公開した', '発表した')
            for lang in ('en', 'ja'):
                with self.subTest(verb=verb, lang=lang):
                    self.run_claim(source, wrong_en if lang == 'en' else en,
                                   wrong_ja if lang == 'ja' else ja, 'review')

    def test_completed_and_future_release_are_supported(self):
        examples = [
            ('Orion Labs launched a new AI model for developers.',
             'Orion Labs released a new model using AI for developers.',
             'Orion Labsは開発者向けの新しいAIモデルの提供を開始した。'),
            ('Orion Labs released a new AI model for developers.',
             'Orion Labs launched a new model using AI for developers.',
             'Orion Labsは開発者向けの新しいAIモデルを公開した。'),
            ('Orion Labs plans to release a new AI model for developers.',
             'Orion Labs plans to release a new model using AI for developers.',
             'Orion Labsは開発者向けの新しいAIモデルを公開する予定だ。'),
            ('Orion Labs is preparing to release a new AI model for developers.',
             'Orion Labs is preparing to release a new model using AI for developers.',
             'Orion Labsは開発者向けの新しいAIモデルの公開を準備している。'),
        ]
        for source, en, ja in examples:
            with self.subTest(source=source):
                self.run_claim(source, en, ja, 'done')

    def test_unproven_availability_is_held_in_source_and_copy(self):
        # Even contiguous "made available" does not prove a direct actor when
        # it belongs to a nested reported claim. No word-bag normalization.
        sources = [
            'Orion Labs made a new AI model available for developers.',
            'Orion Labs made available a new AI model for developers.',
            'Orion Labs made a presentation about available AI models for developers.',
            'Orion Labs made an announcement about available AI models for developers.',
            'Orion Labs made a statement about available AI models for developers.',
            'Orion Labs made improvements to available AI models for developers.',
            'Orion Labs said Aurora Systems made available a new AI model for developers.',
        ]
        for source in sources:
            other = "Aurora Systems' " if 'Aurora Systems' in source else ''
            en = f'Orion Labs released {other}models using AI for developers.'
            ja = 'Orion Labsは'+('Aurora Systemsの' if other else '')+'開発者向けのAIモデルを公開した。'
            with self.subTest(source=source):
                case = self.run_claim(source, en, ja, 'review')
                with research.connect(case.path) as db:
                    self.assertEqual(db.execute('SELECT reason FROM official_research_attempt_failures').fetchone()[0],
                                     'unproven-source-relation')
        self.run_claim('Orion Labs released a new AI model for developers.',
                       'Orion Labs made a presentation about available AI models for developers.',
                       'Orion Labsは開発者向けの新しいAIモデルを公開した。', 'review')
        # Also reject an unproven output with no completed source action.
        self.run_claim('Orion Labs is developing a new AI model for developers.',
                       'Orion Labs made a new AI model available for developers.',
                       'Orion Labsは開発者向けの新しいAIモデルを開発している。', 'review')

    def test_japanese_desire_or_uncertain_continuation_is_not_completion(self):
        for verb, action in (('announced', '発表'), ('unveiled', '披露'), ('introduced', '紹介'),
                             ('released', '公開'), ('launched', '公開')):
            source = f'Orion Labs {verb} a new AI model for developers.'
            en = f'Orion Labs {verb} a new model using AI for developers.'
            for ending in ('したい', 'したかった', 'したなら', 'したら', 'しているはずだ',
                           'した方が良い', 'した場合', 'したと仮定', 'した模様だ', 'した様子だ', 'した？', 'した?'):
                with self.subTest(verb=verb, ending=ending):
                    punctuation = '' if ending.endswith(('?', '？')) else '。'
                    self.run_claim(source, en, 'Orion Labsは開発者向けの新しいAIモデルを'+action+ending+punctuation, 'review')
            for ending in ('した', 'している', '済み', '済みだ', '済みである'):
                with self.subTest(verb=verb, ending=ending):
                    self.run_claim(source, en, 'Orion Labsは開発者向けの新しいAIモデルを'+action+ending+'。', 'done')
            for punctuation in ('.', '!', '！', ''):
                with self.subTest(verb=verb, punctuation=punctuation):
                    self.run_claim(source, en, 'Orion Labsは開発者向けの新しいAIモデルを'+action+'した'+punctuation, 'done')

    def test_status_wording_never_relaxes_actor_numbers_evidence_or_topic(self):
        source = 'Orion Labs announced 2 new AI models for developers in 2027.'
        en = 'Orion Labs announced 2 new models using AI for developers in 2027.'
        ja = 'Orion Labsは開発者向けの2つの新しいAIモデルを2027年に発表した。'
        self.run_claim(source, en, ja, 'done')
        for changed_en, changed_ja, evidence_id in [
            (en.replace('Orion Labs', 'Nebius'), ja, '0'),
            (en, ja.replace('Orion Labs', 'Nebius'), '0'),
            (en.replace('2 new', '3 new'), ja, '0'),
            (en, ja.replace('2027', '2028'), '0'),
            (en, ja, '1'),
            (en.replace('models using AI', 'AI production facilities'), ja, '0'),
        ]:
            with self.subTest(en=changed_en, ja=changed_ja, evidence_id=evidence_id):
                self.run_claim(source, changed_en, changed_ja, 'review', evidence_id=evidence_id)

    def test_new_active_leads_are_bound_without_relaxing_relation_boundary(self):
        for verb in ('unveiled', 'introduced'):
            source = f'Orion Labs {verb} a new AI model for developers.'
            self.assertEqual(news.source_news_grounding.context(source)['actor'], 'Orion Labs')
            en = f'Orion Labs {verb} a new model using AI for developers.'
            ja = 'Orion Labsは開発者向けの新しいAIモデルを発表した。'
            self.run_claim(source, en, ja, 'done')
            for bad_source in (
                f'Orion Labs was {verb} by Aurora Systems for developers.',
                f'Orion Labs {verb} a new AI model by Aurora Systems for developers.',
                f'Orion Labs never {verb} a new AI model for developers.',
                source[:-1]+' and another company launched a model.',
            ):
                with self.subTest(source=bad_source):
                    self.run_claim(bad_source, en, ja, 'review')

    def test_public_reader_rejects_status_upgrade_after_saved_publication(self):
        row = MATRIX[0]
        case = self.run_claim(row['source'], row['en'], row['ja'], 'done')
        with research.connect(case.path) as db:
            saved = json.loads(db.execute('SELECT payload FROM official_research_publications').fetchone()[0])
            for lang, replacement in (
                ('en', 'Orion Labs made a new model using AI available for developers.'),
                ('ja', 'Orion Labsは開発者向けの新しいAIモデルの提供を開始した。'),
            ):
                changed = deepcopy(saved)
                changed['facts'][0][lang] = replacement
                db.execute('UPDATE official_research_publications SET payload=?', (json.dumps(changed),))
                self.assertEqual(news.public_items(db, fixture.NOW), [])
            db.execute('UPDATE official_research_publications SET payload=?', (json.dumps(saved),))
            self.assertEqual(len(news.public_items(db, fixture.NOW)), 1)
        self.assertEqual(case.run_once(lambda *_: self.fail('public rejection repeated provider')), 'idle')

    def test_reflection_and_broker_public_bytes_match_original_release(self):
        # Golden digest was produced offline from the complete public JSON on
        # release 864729a7, with these exact synthetic inputs and frozen clocks.
        snapshots = {}
        case = fixture.RetainedBusinessAdmissionTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        case.raw(REFLECTION)
        response = result(facts=[{'ja': '別の表現。', 'en': 'Different wording.', 'evidenceId': str(i)}
                                 for i in range(2)])
        self.assertEqual(case.run_once(lambda *_: response), 'done')
        with research.connect(case.path) as db:
            snapshots['Reflection'] = news.public_items(db, fixture.NOW)
        case = fixture.RetainedBusinessAdmissionTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        broker_case = broker.BrokerOutlookTests()
        broker_case.raw(case)
        self.assertEqual(broker_case.run_once(case, lambda *_: result(facts=broker.COPY)), 'done')
        with research.connect(case.path) as db:
            snapshots['broker'] = news.public_items(db, broker.NOW)
        serialized = json.dumps(snapshots, ensure_ascii=False, sort_keys=True, indent=2)+'\n'
        self.assertEqual(hashlib.sha256(serialized.encode()).hexdigest(),
                         '80a1dc8c9604e33d19b409d63e9734a637abd5dda1e3e71602dbcac9e1d5ab08')


if __name__ == '__main__':
    unittest.main()
