"""Offline source-first news regressions. No fixture claims live retained bytes.

REFLECTION is exact live-X wording observed on 2026-10-04 at 14:07:28Z.
Its reconstructed normalized-title+body SHA differs from the retained UI SHA;
this is a synthetic current-revision fixture, never an imported live record.
"""
from copy import deepcopy
import json
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

import test_retained_business_admission as fixture
from test_general_semantic_assessment import result
import general_source_news as news
import official_research as research
import related_company_news as structured

REFLECTION = ('NVIDIA-backed Reflection is preparing to release a new open-weight AI model '
              'expected to compete with top Chinese 🇨🇳 models.\n\n'
              'Note: Reflection has signed major compute deals recently with Nebius and SpaceX.')
UNTRACKED = 'Orion Labs plans to build 2 factories in 2027 if permits are approved.'
COPY = {'en': 'Orion Labs plans construction of 2 factories in 2027, conditional on permit approval.',
        'ja': 'Orion Labsは許可を条件として2027年に2工場の建設を計画している。', 'evidenceId': '0'}
# The shared numeric-order guard deliberately preserves source quantity order.
COPY['ja'] = 'Orion Labsは2工場を2027年に建設する計画で、許可の取得を条件としている。'


class SourceNewsTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.create_connection', 'socket.socket.connect'):
            guard=patch(target, side_effect=AssertionError('network forbidden'))
            guard.start(); self.addCleanup(guard.stop)

    def database(self):
        case=fixture.RetainedBusinessAdmissionTests(); case.setUp()
        self.addCleanup(case.doCleanups); return case

    def rendered(self, row):
        return [{**unit['relatedSubject']['safeParaphrase'], 'evidenceId': unit['id']} for unit in row['units']]

    def test_live_wording_fixture_does_not_claim_retained_sha(self):
        title=' '.join(REFLECTION.split())[:500]
        self.assertEqual(news.digest(title+'\n'+REFLECTION), '935954b6d91d2ed5862651628c2b545dd2e8e459536bc3baa8f3aa85395de484')
        self.assertNotEqual(news.digest(title+'\n'+REFLECTION), 'fe67eda5811d2a2837edd8cbd543ffcf62a5c8b6874e62823708aed54958e208')

    def test_exact_retained_source_has_preparation_title_and_unchanged_body_clocks(self):
        body=REFLECTION+' https://t.co/PWtHATzR0I'
        now=datetime.fromisoformat('2026-10-04T14:40:44+00:00')
        case=self.database()
        raw=case.raw(body,number=2106737247274065925,
                     published_at='2026-10-04T13:24:35.000Z',
                     first_seen_at='2026-10-04T13:25:09.427+00:00',
                     last_seen_at='2026-10-04T13:25:09.427+00:00')
        self.assertEqual(raw['sha'],'fe67eda5811d2a2837edd8cbd543ffcf62a5c8b6874e62823708aed54958e208')
        self.assertEqual(news.digest(body),'a0e4d39322004bb2c19f8edc70a186823f8b5d579197a56689828cbb9e68364b')
        output=result(facts=[{'ja':'別の表現。','en':'Different wording.','evidenceId':str(i)} for i in range(2)])
        with patch.object(fixture,'NOW',now):
            self.assertEqual(case.run_once(lambda *_:output),'done')
            self.assertEqual(case.run_once(lambda *_:self.fail('title caused another call')),'idle')
        with research.connect(case.path) as db:
            item=news.public_items(db,now)[0]
            self.assertEqual(item['title'],'Reflection prepares new AI model release')
            self.assertEqual(item['translationJa'],'Reflection、新AIモデルの公開を準備')
            self.assertEqual(item['publishedAt'],raw['published_at'])
            self.assertEqual(item['observedAt'],raw['first_seen_at'])
            self.assertEqual(dict(db.execute('SELECT * FROM signal_x_acquisition').fetchone()),raw)
            self.assertIn('is preparing for the release of a new open-weight AI model',item['bodyEn'])
            self.assertIn('expected to rival leading Chinese models',item['bodyEn'])
            self.assertIn('has recently signed significant agreements for compute with Nebius and SpaceX',item['bodyEn'])
            self.assertIn('公開に向けて準備している',item['bodyJa'])
            self.assertIn('Reflectionは最近、NebiusとSpaceX',item['bodyJa'])

    def test_preparation_headline_is_generic_and_does_not_misstate_other_stages(self):
        for action in ('plans to release','intends to release','has released'):
            body=REFLECTION.replace('is preparing to release',action)
            row=structured.prepare(body,{'NVDA','NBIS'},{'NVDA','NBIS'},news.signals.ALIASES)
            self.assertIsNotNone(row)
            self.assertIsNone(structured.preparation_title({**row,'source_news':True}))

    def test_unknown_company_empty_tickers_publishes_without_fake_identity(self):
        case=self.database(); raw=case.raw(UNTRACKED)
        seen=[]
        def model(payload,key):
            data=json.loads(payload['input']); seen.append(data)
            self.assertIsNone(data['ticker'])
            self.assertEqual(data['evidenceExcerpts'], {'0':UNTRACKED})
            return result(facts=[COPY])
        self.assertEqual(case.run_once(model), 'done')
        with research.connect(case.path) as db:
            row=news.candidates(db,fixture.NOW)[0]; event=dict(db.execute('SELECT * FROM signal_events').fetchone())
            self.assertIsNone(row['ticker']); self.assertEqual(json.loads(event['tickers_json']), [])
            self.assertEqual(json.loads(event['matches_json']), {})
            item=news.public_items(db,fixture.NOW)[0]
            self.assertEqual(item['tickers'], []); self.assertTrue(item['title'].startswith('Orion Labs:'))
            self.assertIn(COPY['ja'],item['bodyJa']); self.assertIn(COPY['en'],item['bodyEn'])
            self.assertEqual(item['publishedAt'],raw['published_at']); self.assertEqual(item['observedAt'],raw['first_seen_at'])
            self.assertEqual(dict(db.execute('SELECT * FROM signal_x_acquisition').fetchone()),raw)
        self.assertEqual(case.run_once(lambda *_:self.fail('duplicate call')), 'idle')
        self.assertEqual(len(seen),1)

    def test_valid_empty_event_metadata_does_not_block_known_or_unknown_subject(self):
        for name in ('Microsoft','Orion Labs'):
            with self.subTest(name=name):
                case=self.database();body=UNTRACKED.replace('Orion Labs',name);case.raw(body);case.admit()
                with research.connect(case.path) as db:
                    db.execute("UPDATE signal_events SET tickers_json='[]',matches_json='{}'")
                    original=dict(db.execute('SELECT * FROM signal_events').fetchone())
                copy={key:(value.replace('Orion Labs',name) if key in ('en','ja') else value) for key,value in COPY.items()}
                self.assertEqual(case.run_once(lambda *_:result(facts=[copy])),'done')
                with research.connect(case.path) as db:
                    self.assertEqual(dict(db.execute('SELECT * FROM signal_events').fetchone()),original)
                    item=news.public_items(db,fixture.NOW)[0]
                    self.assertEqual(item['tickers'],[])
                    self.assertTrue(item['title'].startswith(name+':'))
        case=self.database();case.raw(UNTRACKED.replace('Orion Labs','Microsoft'));case.admit()
        with research.connect(case.path) as db:
            db.execute("UPDATE signal_events SET tickers_json='[\"MU\"]'")
            self.assertEqual(news.candidates(db,fixture.NOW),[])

    def test_related_entities_are_tags_not_actors_and_original_output_is_audited(self):
        case=self.database(); raw=case.raw(REFLECTION)
        original={'disposition':'publish','reason':'material-company-development','facts':[
            {'ja':'別の自然な言い換え。','en':'A different faithful wording.', 'evidenceId':str(i)} for i in range(2)]}
        response=result(facts=original['facts'])
        raw_response=response['output'][0]['content'][0]['text']
        self.assertEqual(case.run_once(lambda *_:response),'done')
        with research.connect(case.path) as db:
            row=news.candidates(db,fixture.NOW)[0]; item=news.public_items(db,fixture.NOW)[0]
            self.assertIsNone(row['ticker']); self.assertEqual(item['tickers'],['NBIS','NVDA'])
            self.assertEqual(item['title'],'Reflection prepares new AI model release')
            self.assertIn('Reflection, with backing from NVIDIA, is preparing', item['bodyEn'])
            self.assertIn('expected to rival leading Chinese models',item['bodyEn'])
            self.assertIn('Reflection has recently signed',item['bodyEn'])
            self.assertIn('Nebius and SpaceX',item['bodyEn'])
            self.assertIn('公開に向けて準備',item['bodyJa']); self.assertIn('見込まれ',item['bodyJa'])
            self.assertIn('Reflectionは最近、NebiusとSpaceX',item['bodyJa'])
            audit=dict(db.execute('SELECT * FROM source_news_claim_derivations').fetchone())
            self.assertEqual(audit['original_response'],raw_response)
            self.assertEqual(json.loads(audit['original_response']),original)
            self.assertEqual(audit['sha'],raw['sha'])
            self.assertEqual(dict(db.execute('SELECT * FROM signal_x_acquisition').fetchone()),raw)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
            for private in ('relatedSubject','safeParaphrase','sourceClaimDerivation','source_snapshot','original_response'):
                self.assertNotIn(private,json.dumps(item))
        self.assertEqual(case.run_once(lambda *_:self.fail('duplicate provider')), 'idle')

    def test_binding_is_generic_and_no_known_company_is_needed(self):
        body=REFLECTION.replace('NVIDIA','Aurora Ventures').replace('Reflection','Helix Labs').replace('Nebius','Orion Systems').replace('SpaceX','Cosmos Labs')
        case=self.database(); case.raw(body)
        self.assertEqual(case.run_once(lambda *_:result(facts=[{'ja':'別の表現。','en':'Different wording.', 'evidenceId':str(i)} for i in range(2)])), 'done')
        with research.connect(case.path) as db:
            item=news.public_items(db,fixture.NOW)[0]
            self.assertEqual(item['tickers'],[]); self.assertEqual(item['title'],'Helix Labs prepares new AI model release')
            self.assertIn('backing from Aurora Ventures',item['bodyEn'])
            self.assertIn('Orion Systems and Cosmos Labs',item['bodyEn'])

    def test_single_related_name_does_not_become_subject(self):
        body=REFLECTION.split('\n\n')[0]
        case=self.database(); case.raw(body)
        self.assertEqual(case.run_once(lambda *_:result(facts=[{'ja':'言い換え。','en':'Another wording.', 'evidenceId':'0'}])), 'done')
        with research.connect(case.path) as db:
            item=news.public_items(db,fixture.NOW)[0]
            self.assertEqual(item['tickers'],['NVDA']); self.assertEqual(item['title'],'Reflection prepares new AI model release')

    def test_amount_entity_action_date_condition_negation_changes_cannot_publish(self):
        variants=[
            {**COPY,'en':COPY['en'].replace('2 factories','3 factories')},
            {**COPY,'ja':COPY['ja'].replace('2027','2028')},
            {**COPY,'en':COPY['en'].replace('Orion Labs','Nebius')},
            {**COPY,'en':COPY['en'].replace('plans construction','has completed construction')},
            {**COPY,'en':COPY['en'].replace(', conditional on permit approval','')},
        ]
        for copy in variants:
            with self.subTest(copy=copy):
                case=self.database(); case.raw(UNTRACKED)
                self.assertEqual(case.run_once(lambda *_:result(facts=[copy])), 'review')
                with research.connect(case.path) as db:self.assertEqual(news.public_items(db,fixture.NOW),[])
                self.assertEqual(case.run_once(lambda *_:self.fail('review repeated')), 'idle')
        body='Orion Labs plans no factory construction in 2027.'
        case=self.database();case.raw(body)
        bad={'en':'Orion Labs plans factory construction in 2027.',
             'ja':'Orion Labsは2027年に工場建設を計画している。','evidenceId':'0'}
        self.assertEqual(case.run_once(lambda *_:result(facts=[bad])),'review')

    def test_condition_polarity_and_predicate_are_bound_in_both_languages(self):
        variants=[
            {**COPY,'en':'Orion Labs plans construction of 2 factories in 2027 unless permits are approved.'},
            {**COPY,'en':COPY['en'].replace('permit approval','permit denial')},
            {**COPY,'ja':COPY['ja'].replace('許可の取得','許可の却下')},
            {**COPY,'ja':COPY['ja'].replace('許可の取得を条件としている','許可が得られない限りの計画だ')},
        ]
        for copy in variants:
            with self.subTest(copy=copy):
                case=self.database();case.raw(UNTRACKED)
                self.assertEqual(case.run_once(lambda *_:result(facts=[copy])),'review')
                with research.connect(case.path) as db:
                    self.assertEqual(news.public_items(db,fixture.NOW),[])
                    failure=db.execute('SELECT reason FROM official_research_attempt_failures').fetchone()[0]
                    self.assertEqual(failure,'unproven-source-condition')
        # No arbitrary condition predicate is guessed from a vague cue.
        case=self.database();case.raw(UNTRACKED.replace('permits are approved','demand increases'))
        self.assertEqual(case.run_once(lambda *_:result(facts=[COPY])),'review')
        with research.connect(case.path) as db:
            self.assertEqual(db.execute('SELECT reason FROM official_research_attempt_failures').fetchone()[0],'unproven-source-condition')

    def test_unsupported_passive_multiactor_and_quantity_relations_fail_closed(self):
        examples=[
            ('Orion Labs was acquired by Nebius in 2027.',
             {'en':'Orion Labs completed its acquisition of Nebius during 2027.',
              'ja':'Orion Labsは2027年にNebiusの買収を完了した。','evidenceId':'0'}),
            ('Orion Labs will build a factory and Nebius will not launch its model.',
             {'en':'Orion Labs will not build a factory, while Nebius will launch its model.',
              'ja':'Orion Labsは工場建設を行わない予定で、Nebiusはモデルを公開する予定だ。','evidenceId':'0'}),
            ('Orion Labs plans to build 2 factories and 3 laboratories in 2027.',
             {'en':'Orion Labs plans 2 laboratories and 3 factories for construction in 2027.',
              'ja':'Orion Labsは2研究所と3工場の建設を2027年に計画している。','evidenceId':'0'}),
        ]
        for body,copy in examples:
            with self.subTest(body=body):
                case=self.database();case.raw(body)
                self.assertEqual(case.run_once(lambda *_:result(facts=[copy])),'review')
                with research.connect(case.path) as db:
                    self.assertEqual(news.public_items(db,fixture.NOW),[])
                    self.assertEqual(db.execute('SELECT reason FROM official_research_attempt_failures').fetchone()[0],'unproven-source-relation')
                self.assertEqual(case.run_once(lambda *_:self.fail('closed private review repeated')),'idle')

    def test_passive_acquisition_boundary_uses_clause_roles_not_by_adjacency(self):
        clauses=[
            'was acquired in 2027 by Nebius',
            'was acquired last month by Nebius',
            'was recently acquired by Nebius',
            'was quietly acquired in 2027 by Nebius',
            'has been acquired in 2027 by Nebius',
            'is expected to be acquired in 2027 by Nebius',
            'was not acquired in 2027 by Nebius',
            'got acquired in 2027 by Nebius',
            'was purchased in 2027 by Nebius',
            'was taken over in 2027 by Nebius',
            'was acquired in 2027',
            'has been acquired last month',
            'will be acquired in 2027',
        ]
        for clause in clauses:
            with self.subTest(clause=clause):
                body='Orion Research Labs '+clause+'.'
                case=self.database();case.raw(body)
                timing='last month' if 'last month' in clause else 'during 2027'
                target=' of Nebius' if 'Nebius' in clause else ''
                copy={'en':f'Orion Research Labs completed its acquisition{target} {timing}.',
                      'ja':'Orion Research Labsは'+('先月' if 'last month' in clause else '2027年に')+('Nebiusの' if target else '')+'買収を完了した。',
                      'evidenceId':'0'}
                self.assertEqual(case.run_once(lambda *_:result(facts=[copy])),'review')
                with research.connect(case.path) as db:
                    self.assertEqual(news.public_items(db,fixture.NOW),[])
                    self.assertEqual(db.execute('SELECT reason FROM official_research_attempt_failures').fetchone()[0],'unproven-source-relation')
        # A directly expressed active actor remains a supported source case.
        for verb in ('acquired','has acquired'):
            case=self.database();case.raw(f'Orion Research Labs {verb} Nebius in 2027.')
            copy={'en':'Orion Research Labs completed its acquisition of Nebius during 2027.',
                  'ja':'Orion Research Labsは2027年にNebiusの買収を完了した。','evidenceId':'0'}
            self.assertEqual(case.run_once(lambda *_:result(facts=[copy])),'done')

    def test_generic_passive_boundary_is_not_limited_to_acquisition_vocabulary(self):
        for verb,ja_action in [('launched','公開した'),('unveiled','発表した'),
                               ('released','公開した'),('announced','発表した'),
                               ('introduced','導入した'),('built','建設した'),('created','作成した')]:
            with self.subTest(verb=verb):
                case=self.database();case.raw(f'Orion Research Labs was {verb} by Nebius in 2027.')
                copy={'en':f'Orion Research Labs {verb} Nebius during 2027.',
                      'ja':f'Orion Research Labsは2027年にNebiusを{ja_action}。','evidenceId':'0'}
                self.assertEqual(case.run_once(lambda *_:result(facts=[copy])),'review')
                with research.connect(case.path) as db:
                    self.assertEqual(news.public_items(db,fixture.NOW),[])
                    self.assertEqual(db.execute('SELECT reason FROM official_research_attempt_failures').fetchone()[0],'unproven-source-relation')
        case=self.database();case.raw('Orion Labs launched by its partner Nebius in 2027.')
        copy={'en':'Orion Labs launched its partner Nebius during 2027.',
              'ja':'Orion Labsは2027年に提携先のNebiusを公開した。','evidenceId':'0'}
        self.assertEqual(case.run_once(lambda *_:result(facts=[copy])),'review')
        with research.connect(case.path) as db:
            self.assertEqual(news.public_items(db,fixture.NOW),[])
        # The boundary is structural and conservative, not a growing verb list.
        self.assertFalse(news.source_news_grounding.unsupported_auxiliary_role('Orion Research Labs is developing a new model.'))
        self.assertTrue(news.source_news_grounding.unsupported_auxiliary_role('Orion Research Labs is being developed by Nebius.'))
        self.assertTrue(news.source_news_grounding.unsupported_auxiliary_role('Orion Research Labs was recently unveiled.'))
        self.assertTrue(news.source_news_grounding.unsupported_auxiliary_role('Orion Research Labs has been unexpectedly transformed.'))

    def test_secondary_actor_descriptors_and_unmarked_clauses_cannot_move_negation(self):
        endings=[
            ', while its partner Nebius will not launch a model.',
            ', Nebius will not launch a model.',
            ' and partner Nebius will not launch a model.',
            ' and its business partner Nebius will not launch a model.',
            ', while its partner will not launch a model.',
        ]
        for ending in endings:
            with self.subTest(ending=ending):
                body='Orion Labs will build a factory'+ending
                case=self.database();case.raw(body)
                copy={'en':body.replace('will build','will not build').replace('will not launch','will launch'),
                      'ja':'Orion Labsは工場建設を行わない予定で、提携先の'+('Nebiusは' if 'Nebius' in body else '企業は')+'モデルを公開する予定だ。',
                      'evidenceId':'0'}
                self.assertEqual(case.run_once(lambda *_:result(facts=[copy])),'review')
                with research.connect(case.path) as db:
                    self.assertEqual(news.public_items(db,fixture.NOW),[])
                    self.assertEqual(db.execute('SELECT reason FROM official_research_attempt_failures').fetchone()[0],'unproven-source-relation')

    def test_single_count_keeps_its_noun_binding(self):
        case=self.database();case.raw(UNTRACKED)
        copy={**COPY,'en':COPY['en'].replace('factories','laboratories'),
              'ja':COPY['ja'].replace('工場','研究所')}
        self.assertEqual(case.run_once(lambda *_:result(facts=[copy])),'review')
        with research.connect(case.path) as db:
            self.assertEqual(db.execute('SELECT reason FROM official_research_attempt_failures').fetchone()[0],'unproven-source-relation')

    def test_deleted_audit_plus_invalid_or_missing_publication_never_spends_again(self):
        for missing in (False,True):
            with self.subTest(missing=missing):
                case=self.database();case.raw(REFLECTION)
                output=result(facts=[{'ja':'言い換え。','en':'Different wording.', 'evidenceId':str(i)} for i in range(2)])
                self.assertEqual(case.run_once(lambda *_:output),'done')
                with research.connect(case.path) as db:
                    db.execute('DELETE FROM source_news_claim_derivations')
                    if missing:
                        db.execute('DELETE FROM official_research_publications')
                    else:
                        payload=json.loads(db.execute('SELECT payload FROM official_research_publications').fetchone()[0])
                        payload['sourceClaimDerivation']['version']=99
                        db.execute('UPDATE official_research_publications SET payload=?',(json.dumps(payload),))
                    self.assertEqual(news.public_items(db,fixture.NOW),[])
                self.assertEqual(case.run_once(lambda *_:self.fail('closed source attempt regenerated')),'idle')
                with research.connect(case.path) as db:
                    self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
                # A genuine new current revision is not that closed attempt.
                case.raw(REFLECTION+' https://example.com/source',
                         first_seen_at=(fixture.NOW-timedelta(minutes=2)).isoformat(),last_seen_at=(fixture.NOW-timedelta(minutes=2)).isoformat())
                self.assertEqual(case.run_once(lambda *_:output),'done')
                with research.connect(case.path) as db:
                    self.assertEqual(len(news.public_items(db,fixture.NOW)),1)
                    self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],2)

    def test_graph_never_silently_discards_new_material_clauses(self):
        source_changes=[
            REFLECTION.replace('new open-weight','new $3 billion open-weight'),
            REFLECTION.replace('is preparing to release','has already released'),
            REFLECTION.replace('recently with','in 2027 with'),
            REFLECTION.replace('recently with','only if financing is approved with'),
            REFLECTION.replace('has signed','has not signed'),
            REFLECTION.replace('Note: Reflection','Note: Nebius'),
            REFLECTION+'\n\nReflection also plans to acquire Orion Labs for $3 billion.',
        ]
        for body in source_changes:
            with self.subTest(body=body):
                self.assertIsNone(structured.prepare(body,{'NVDA','NBIS'},{'NVDA','NBIS'},news.signals.ALIASES))
                case=self.database();case.raw(body)
                with research.connect(case.path) as db:
                    rows=list(news.retained_assessments(db,fixture.NOW))
                    if rows[0][1]:
                        candidate=rows[0][1]
                        self.assertFalse(structured.structured(candidate))
                        self.assertEqual('\n\n'.join(u['quote'] for u in candidate['units']),body)

    def test_public_mutation_of_actor_stage_relationship_or_context_is_rejected(self):
        case=self.database();case.raw(REFLECTION)
        self.assertEqual(case.run_once(lambda *_:result(facts=[{'ja':'言い換え。','en':'Different wording.', 'evidenceId':str(i)} for i in range(2)])), 'done')
        with research.connect(case.path) as db:
            saved=json.loads(db.execute('SELECT payload FROM official_research_publications').fetchone()[0])
            for index,lang,before,after in [
                (0,'en','Reflection, with backing from NVIDIA','NVIDIA, with backing from Reflection'),
                (0,'en','is preparing for the release of','has released'),
                (0,'en','expected to rival','already outperforming'),
                (1,'en','has recently signed','plans to sign'),
                (1,'en','Nebius and SpaceX','NVIDIA and SpaceX'),
                (1,'ja','Reflectionは最近','Nebiusは最近'),
            ]:
                changed=deepcopy(saved);changed['facts'][index][lang]=changed['facts'][index][lang].replace(before,after)
                db.execute('UPDATE official_research_publications SET payload=?',(json.dumps(changed),))
                self.assertEqual(news.public_items(db,fixture.NOW),[])
            db.execute('UPDATE official_research_publications SET payload=?',(json.dumps(saved),))
            self.assertEqual(len(news.public_items(db,fixture.NOW)),1)
            db.execute("UPDATE source_news_claim_derivations SET source_snapshot='{}'")
            self.assertEqual(news.public_items(db,fixture.NOW),[])
        self.assertEqual(case.run_once(lambda *_:self.fail('audit failure caused paid regeneration')), 'idle')

    def test_materiality_review_promotion_withdrawal_and_duplicates_preserve_history(self):
        case=self.database();raw=case.raw(UNTRACKED)
        self.assertEqual(case.run_once(lambda *_:result('review','not-material-business-news',[])),'review')
        with research.connect(case.path) as db:
            original=dict(db.execute('SELECT * FROM general_source_semantic_reviews').fetchone())
        case.raw(UNTRACKED,number=2000)
        self.assertEqual(case.run_once(lambda *_:self.fail('duplicate reviewed source')),'idle')
        with research.connect(case.path) as db:
            self.assertEqual(dict(db.execute('SELECT * FROM general_source_semantic_reviews').fetchone()),original)
        promo=self.database();promo.raw('Orion Labs launches a webinar. Register now for our course.')
        self.assertEqual(promo.run_once(lambda *_:self.fail('promotion')),'idle')
        published=self.database();published.raw(UNTRACKED)
        self.assertEqual(published.run_once(lambda *_:result(facts=[COPY])),'done')
        published.raw('Correction: the earlier Orion Labs report is withdrawn and should not be relied upon.',
                      first_seen_at=(fixture.NOW-timedelta(minutes=1)).isoformat(),last_seen_at=(fixture.NOW-timedelta(minutes=1)).isoformat())
        with research.connect(published.path) as db:self.assertEqual(news.public_items(db,fixture.NOW),[])
        self.assertEqual(published.run_once(lambda *_:self.fail('withdrawn source')),'idle')

    def test_multiple_cashtags_are_assessed_without_reassigning_actions(self):
        body='Micron $MU signed an agreement with Microsoft $MSFT for expanded production.'
        copy={'en':'Micron signed a production agreement with Microsoft.',
              'ja':'MicronはMicrosoftとの生産拡大契約を締結した。','evidenceId':'0'}
        case=self.database();case.raw(body)
        self.assertEqual(case.run_once(lambda *_:result(facts=[copy])),'done')
        with research.connect(case.path) as db:self.assertEqual(news.public_items(db,fixture.NOW)[0]['tickers'],['MSFT','MU'])
        bad=self.database();bad.raw(body)
        changed={**copy,'en':'Microsoft signed a production agreement with Micron.'}
        self.assertEqual(bad.run_once(lambda *_:result(facts=[changed])),'review')

    def test_shared_budget_and_source_revision_race_apply_to_source_news(self):
        case=self.database();case.raw(REFLECTION)
        with research.connect(case.path) as db:
            db.executemany('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
                           [(fixture.NOW.timestamp(),'existing','sha','approved','failed',str(i)) for i in range(200)])
        self.assertEqual(case.run_once(lambda *_:self.fail('budget exceeded')),'idle')
        race=self.database();race.raw(REFLECTION)
        def revise(*_):
            race.raw('Correction: the earlier Reflection report was withdrawn by the source.',
                     first_seen_at=(fixture.NOW-timedelta(minutes=1)).isoformat(),last_seen_at=(fixture.NOW-timedelta(minutes=1)).isoformat())
            return result(facts=[{'ja':'言い換え。','en':'Different wording.', 'evidenceId':str(i)} for i in range(2)])
        self.assertEqual(race.run_once(revise),'stale')
        with research.connect(race.path) as db:
            self.assertEqual(news.public_items(db,fixture.NOW),[])
            self.assertFalse(db.execute("SELECT 1 FROM sqlite_master WHERE name='source_news_claim_derivations'").fetchone())

if __name__=='__main__':unittest.main()
