"""A brief is a verified subset, never approval of the rejected complete copy."""
from copy import deepcopy
from datetime import timedelta
import json
import unittest

import test_broker_outlook as broker
import general_source_news as news
import general_source_briefs as briefs
import micron_reviewed_recovery as reviewed
import official_research as research


class GeneralSourceBriefTests(unittest.TestCase):
    def setup_case(self,facts=None,model_review=False,body=broker.BODY):
        parent=broker.BrokerOutlookTests()
        parent.setUp();self.addCleanup(parent.doCleanups)
        case=parent.database();raw=parent.raw(case,body)
        with research.connect(case.path) as db:
            self.assertEqual(news.admit_retained(db,broker.NOW)['inserted'],1)
            row=news.candidates(db,broker.NOW)[0]
        calls=[]
        def transport(*_):
            calls.append(1)
            return broker.result('review' if model_review else 'publish',
                                 'ambiguous-actor-or-action' if model_review else 'material-company-development',
                                 [] if model_review else facts)
        self.assertEqual(parent.run_once(case,transport),'review')
        self.assertEqual(len(calls),1)
        return parent,case,row,raw

    def test_actual_rejected_micron_narrative_needs_review_not_silent_omission(self):
        manifest,_=reviewed.reviewed()
        parent,case,row,raw=self.setup_case(manifest['originalFacts'])
        with research.connect(case.path) as db:
            self.assertEqual(briefs.publications(db,broker.NOW),[])
            self.assertEqual(news.public_items(db,broker.NOW),[])
            self.assertIsNone(db.execute('SELECT payload FROM general_source_briefs').fetchone()[0])
        self.assertEqual(parent.run_once(case,lambda *_:self.fail('extra call')),'idle')

    def test_bad_independent_company_list_allows_only_untickered_sector_narrative(self):
        body=('JPMorgan sees memory supply remaining tight through 2028, with customer order discussions already extending into 2031.\n\n'
              'Its estimates point to:\n• Micron revenue growth: +20%\n• HBM bit demand growth: +63%')
        facts=[deepcopy(broker.COPY[0]),deepcopy(broker.COPY[1]),
               {'ja':'Micronの売上高は+20%増えると見込む。','en':'Micron revenue is projected to grow +999%.','evidenceId':'2'},
               {**deepcopy(broker.COPY[2]),'evidenceId':'3'}]
        parent,case,row,raw=self.setup_case(facts,body=body)
        with research.connect(case.path) as db:
            records=briefs.publications(db,broker.NOW)
            self.assertEqual(len(records),1)
            note=records[0][2]
            self.assertEqual(note['scope'],'sector')
            self.assertEqual([f['evidenceId'] for f in note['facts']],['0','1'])
            self.assertEqual(note['pendingEvidenceIds'],['2','3'])
            item=news.public_items(db,broker.NOW)[0]
            self.assertEqual(item['tickers'],[])
            self.assertNotIn('MU',item['title'])
            self.assertEqual(item['title'],'Broker industry outlook (brief; details awaiting review)')
            self.assertEqual(item['translationJa'],'証券会社による業界見通し（短報・詳細確認中）')
            self.assertNotIn('Micron',item['bodyEn'])
            self.assertEqual(item['brief'],{'version':1,'scope':'sector','validFacts':2,'pendingFacts':2})
            self.assertEqual(item['publishedAt'],broker.PUBLISHED)
            self.assertEqual(item['observedAt'],broker.FIRST)
            for token in ('2028','2031'):
                self.assertIn(token,item['bodyEn']);self.assertIn(token,item['bodyJa'])
            for token in ('63%','37%','54%','35%','50%'):
                self.assertNotIn(token,item['bodyEn']);self.assertNotIn(token,item['bodyJa'])
            self.assertEqual(dict(db.execute('SELECT * FROM signal_x_acquisition').fetchone()),raw)
            original=json.loads(db.execute('SELECT payload FROM official_research_attempt_failures').fetchone()[0])
            self.assertEqual(original['facts'],facts)
            self.assertEqual(db.execute('SELECT state FROM official_research_jobs').fetchone()[0],'review')
            state=research.delivery_diagnostics(db,broker.NOW,[],set())
            self.assertEqual((state['validated'],state['partialPublished'],state['unfinished'],state['reviewHeld']),(0,1,1,1))
            initial=[tuple(r) for r in db.execute('SELECT * FROM general_source_briefs')]
        for _ in range(3):self.assertEqual(parent.run_once(case,lambda *_:self.fail('extra paid call')),'idle')
        with research.connect(case.path) as db:
            self.assertEqual([tuple(r) for r in db.execute('SELECT * FROM general_source_briefs')],initial)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)

    def test_nonleading_company_core_keeps_correct_unit_bindings(self):
        facts=deepcopy(broker.COPY);facts[3]['en']+=' Revenue was $999 billion.'
        _,case,_,_=self.setup_case(facts)
        with research.connect(case.path) as db:
            note=briefs.publications(db,broker.NOW)[0][2]
            self.assertEqual(note['scope'],'company')
            self.assertEqual([f['evidenceId'] for f in note['facts']],['0','1','5','6'])
            self.assertEqual(note['pendingEvidenceIds'],['2','3','4'])
            item=news.public_items(db,broker.NOW)[0]
            self.assertEqual(item['tickers'],['MU'])
            self.assertTrue(item['title'].endswith(' (brief; details awaiting review)'))
            self.assertTrue(item['translationJa'].endswith('（短報・詳細確認中）'))
            self.assertLessEqual(len(item['title']),180)
            self.assertLessEqual(len(item['translationJa']),180)
            self.assertIn('>35%',item['bodyEn']);self.assertIn('50%+',item['bodyEn'])
            self.assertNotIn('999',item['bodyEn']);self.assertNotIn('63%',item['bodyEn'])

    def test_dependent_peer_and_company_claims_do_not_lose_qualifiers(self):
        facts=deepcopy(broker.COPY)
        facts[6]['en']=facts[6]['en'].replace('50%+','more than 50%')
        _,case,_,_=self.setup_case(facts)
        with research.connect(case.path) as db:
            self.assertEqual(briefs.publications(db,broker.NOW),[])
            self.assertEqual(news.public_items(db,broker.NOW),[])

    def test_all_invalid_or_explicit_model_review_stays_held(self):
        facts=deepcopy(broker.COPY)
        for fact in facts:fact['en']+=' Revenue was $999 billion.'
        for model_review in (False,True):
            with self.subTest(model_review=model_review):
                parent,case,_,_=self.setup_case(facts,model_review)
                with research.connect(case.path) as db:
                    self.assertEqual(news.public_items(db,broker.NOW),[])
                    self.assertEqual(briefs.publications(db,broker.NOW),[])
                    self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0],0)
                self.assertEqual(parent.run_once(case,lambda *_:self.fail('review may not retry')),'idle')

    def test_current_body_failure_and_call_proofs_are_required_at_every_read(self):
        facts=deepcopy(broker.COPY);facts[3]['en']+=' Revenue was $999 billion.'
        mutations=(
            "UPDATE signal_documents SET sha='superseded'",
            "UPDATE official_research_attempt_body_proofs SET body_sha='changed'",
            "UPDATE official_research_attempt_failures SET payload='{}'",
            "UPDATE official_research_jobs SET lease='different'",
            "UPDATE signal_headline_translation_calls SET state='completed'",
            "UPDATE general_source_briefs SET payload='{}'",
            "UPDATE general_source_briefs SET public_at='2027-01-01T00:00:00+00:00'",
        )
        for sql in mutations:
            with self.subTest(sql=sql):
                _,case,_,_=self.setup_case(facts)
                with research.connect(case.path) as db:
                    self.assertEqual(len(news.public_items(db,broker.NOW)),1)
                    db.execute(sql)
                    self.assertEqual(news.public_items(db,broker.NOW),[])

    def test_existing_saved_output_revalidation_is_bounded_and_idempotent(self):
        facts=deepcopy(broker.COPY);facts[3]['en']+=' Revenue was $999 billion.'
        _,case,_,_=self.setup_case(facts)
        with research.connect(case.path) as db:
            db.execute('DELETE FROM general_source_briefs')
            before=[tuple(r) for r in db.execute('SELECT * FROM official_research_attempt_failures')]
            later=broker.NOW+timedelta(minutes=15)
            self.assertTrue(briefs.revalidate_one(db,later))
            self.assertFalse(briefs.revalidate_one(db,later+timedelta(minutes=1)))
            saved=db.execute('SELECT * FROM general_source_briefs').fetchone()
            self.assertEqual(saved['public_at'],later.isoformat())
            self.assertEqual(saved['started_at'],broker.NOW.isoformat())
            self.assertEqual([tuple(r) for r in db.execute('SELECT * FROM official_research_attempt_failures')],before)
            item=news.public_items(db,later)[0]
            self.assertEqual(item['publishedAt'],broker.PUBLISHED)
            self.assertEqual(item['observedAt'],broker.FIRST)

    def test_qualifier_blocks_cannot_be_dropped_across_any_paragraph_boundary(self):
        conditions=(
            'The forecast assumes demand doubles before 2030.',
            'Only if demand doubles before 2030.',
            'The estimate depends on demand doubling before 2030.',
            'The transaction is subject to demand doubling before 2030.',
            'Micron’s growth forecast assumes demand doubles before 2030.',
            'JPMorgan’s estimate is conditional on demand doubling before 2030.',
            'The projection rests on demand doubling before 2030.',
            'Micron’s earnings thesis rests on demand doubling before 2030.',
            'Micron can reach that growth only after demand doubles.',
        )
        for separator in ('\n','\n\n'):
            for condition in conditions:
                with self.subTest(separator=repr(separator),condition=condition):
                    body='JPMorgan expects 20% revenue growth at Micron.'+separator+condition
                    units,reason=news.broker_commentary.prepare(body,'MU')
                    self.assertEqual(reason,'eligible-broker-commentary')
                    row={'general_source':True,'semantic_assessment':True,'url':broker.URL,'ticker':'MU','body':body,'units':units}
                    good={'ja':'Micronの売上高は20%増えると見込む。','en':'Micron revenue is projected to grow 20%.','evidenceId':'0'}
                    news.validate_pair(good,units[0])
                    bad={'ja':'需要は2030年より前に倍増すると予想される。','en':'Demand is expected to double before 2030. Revenue was $999 billion.','evidenceId':'1'}
                    self.assertIsNone(briefs.build({'disposition':'publish','reason':'material-company-development','facts':[good,bad]},row))

    def test_temporal_guard_does_not_mistake_percent_money_or_counts_for_years(self):
        validate=news.broker_commentary.validate_periods
        for quantity in ('20%','20 percent','$2000','2000 units','2000 employees','2000 million'):
            with self.subTest(quantity=quantity):
                validate('Micron revenue is projected to grow by '+quantity+'.',
                         'JPMorgan expects Micron revenue to grow by '+quantity+'.','en')
                validate('Micronの売上高は20%増えると見込む。',
                         'JPMorgan expects Micron revenue to grow by '+quantity+'.','ja')
        for quote in ('Contracts continue through FY2028.','Contracts continue through 2030.'):
            year='2028' if '2028' in quote else '2030'
            validate(f'契約は{year}年まで続く。',quote,'ja')
            with self.assertRaisesRegex(ValueError,'lost-period-relation'):
                validate(f'契約は{year}年までに完了する。',quote,'ja')
        quote='Construction ends by 2030 and service continues through 2030.'
        validate('The build ends by 2030 and operations run through 2030.',quote,'en')
        validate('建設は2030年までに終わり、サービスは2030年まで続く。',quote,'ja')

    def test_numeric_format_does_not_hide_a_list_prerequisite(self):
        for label in ('Required customer demand growth','Necessary demand growth','Prerequisite demand growth',
                      'Minimum demand growth to enable the forecast','Demand growth condition','Assumed demand growth'):
            with self.subTest(label=label):
                body='JPMorgan expects 20% revenue growth at Micron.\n\nIts estimates point to:\n\n• '+label+': +50%'
                units,reason=news.broker_commentary.prepare(body,'MU')
                self.assertEqual(reason,'eligible-broker-commentary')
                row={'general_source':True,'semantic_assessment':True,'url':broker.URL,'ticker':'MU','body':body,'units':units}
                value={'disposition':'publish','reason':'material-company-development','facts':[
                    {'ja':'Micronの売上高は20%増えると見込む。','en':'Micron revenue is projected to grow 20%.','evidenceId':'0'},
                    {'ja':'需要は+50%増えると予測している。','en':'Demand growth is forecast at +999%.','evidenceId':'1'}]}
                self.assertFalse(briefs.independent_metric_entry(units[1]['quote'],'MU'))
                self.assertIsNone(briefs.build(value,row))
        for label in ('HBM bit demand growth','Non-HBM server DRAM','CY27 HBM blended ASP','Micron revenue growth'):
            self.assertTrue(briefs.independent_metric_entry(label+': +50%','MU'))


if __name__=='__main__':unittest.main()
