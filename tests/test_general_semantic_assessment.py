"""One-call source-bound materiality assessment within the existing ledger."""
from datetime import datetime, timedelta
import json
import time
import unittest
from unittest.mock import patch

import test_retained_business_admission as fixture
import general_source_news as news
import official_research as research
import headline_translation
import signals
import x_api

NOW=fixture.NOW
BODY='Micron $MU has begun sampling its next-generation memory chips with industrial customers.'
COPY={'ja':'マイクロンは産業分野の顧客に向けて次世代メモリーチップのサンプル提供を始めた。',
      'en':'Micron has started providing samples of its next-generation memory chips to industrial customers.',
      'evidenceId':'0'}


def result(disposition='publish',reason='material-company-development',facts=None):
    value={'disposition':disposition,'reason':reason,'facts':[COPY] if facts is None else facts}
    return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(value)}]}]}


class GeneralSemanticAssessmentTests(unittest.TestCase):
    setUp=fixture.RetainedBusinessAdmissionTests.setUp
    raw=fixture.RetainedBusinessAdmissionTests.raw
    document=fixture.RetainedBusinessAdmissionTests.document
    admit=fixture.RetainedBusinessAdmissionTests.admit
    intake=fixture.RetainedBusinessAdmissionTests.intake
    run_once=fixture.RetainedBusinessAdmissionTests.run_once

    def test_keyword_free_response_to_one_assessment_and_bilingual_publication(self):
        payload={'includes':{'users':[{'id':'1','username':'wallstengine'}]},
                 'data':[{'id':'1044','author_id':'1','text':BODY,'created_at':fixture.PUBLISHED}]}
        self.assertEqual(x_api.parse_response(fixture.SOURCE,payload,list(signals.ALIASES)),[])
        acquired=x_api.acquired_posts(fixture.SOURCE,payload)
        self.assertEqual(len(acquired),1)
        with research.connect(self.path) as db:
            signals.save(db,fixture.SOURCE,[],{'_acquired_posts':acquired},fixture.FIRST,'synthetic',1)
        calls=[]
        def model(payload,key):
            calls.append(payload)
            self.assertEqual(payload['model'],fixture.ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'])
            self.assertEqual(payload['max_output_tokens'],2400);self.assertFalse(payload['store'])
            self.assertIn('Decide by meaning',payload['instructions'])
            self.assertIn('disposition',payload['text']['format']['schema']['required'])
            self.assertEqual(json.loads(payload['input'])['evidenceExcerpts'],{'0':BODY})
            return result()
        self.assertEqual(self.run_once(model),'done')
        self.assertEqual(len(calls),1)
        with research.connect(self.path) as db:
            row=news.candidates(db,NOW)[0]
            self.assertTrue(row['semantic_assessment'])
            item=news.public_items(db,NOW)[0]
            self.assertIn(COPY['ja'],item['bodyJa']);self.assertIn(COPY['en'],item['bodyEn'])
            self.assertEqual(item['publishedAt'],fixture.PUBLISHED);self.assertEqual(item['observedAt'],fixture.FIRST)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
            saved=json.loads(db.execute('SELECT payload FROM official_research_publications').fetchone()[0])
            self.assertEqual(saved['semanticAssessment']['disposition'],'publish')
        self.assertEqual(self.run_once(lambda *_:self.fail('duplicate assessment')),'idle')

    def test_alias_only_company_cue_can_receive_semantic_assessment(self):
        self.raw(BODY.replace(' $MU',''))
        self.assertEqual(self.run_once(lambda *_:result()),'done')
        with research.connect(self.path) as db:self.assertEqual(len(news.public_items(db,NOW)),1)

    def test_non_news_review_is_terminal_current_sha_and_not_a_publication(self):
        self.raw('Micron $MU appears in a list of company names discussed by market followers today.')
        self.assertEqual(self.run_once(lambda *_:result('review','not-material-business-news',[])),'review')
        with research.connect(self.path) as db:
            self.assertEqual(news.public_items(db,NOW),[])
            self.assertEqual(news.candidates(db,NOW),[])
            self.assertEqual(db.execute('SELECT count(*) FROM general_source_semantic_reviews').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT state FROM official_research_jobs').fetchone()[0],'review')
        report=self.intake()
        self.assertEqual(report['counts']['assessedReviewRows'],1)
        self.assertEqual(report['records'][0]['reason'],'not-material-business-news')
        for _ in range(2):self.assertEqual(self.run_once(lambda *_:self.fail('review repeated')),'idle')
        self.assertEqual(self.admit()['restored'],0)

    def test_completed_unsubstantiated_copy_is_terminal_review_not_retry(self):
        self.raw(BODY)
        bad={**COPY,'en':COPY['en']+' Revenue was $99 billion.'}
        self.assertEqual(self.run_once(lambda *_:result(facts=[bad])),'review')
        with research.connect(self.path) as db:
            self.assertEqual(news.public_items(db,NOW),[])
            self.assertEqual(db.execute('SELECT reason FROM general_source_semantic_reviews').fetchone()[0],'unsubstantiated-model-output')
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_attempt_failures').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_attempt_body_proofs').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT state FROM signal_headline_translation_calls').fetchone()[0],'failed')
        self.assertEqual(self.run_once(lambda *_:self.fail('invalid copy retried')),'idle')

    def test_check_failure_is_retried_before_staying_in_review(self):
        # Owner, Oct 9: 49 of 53 held stories had failed one attempt. A check
        # failure gets SEMANTIC_REVIEW_AFTER_ATTEMPTS attempts, after a delay.
        self.raw(BODY)
        bad={**COPY,'en':COPY['en']+' Revenue was $99 billion.'}
        self.assertEqual(self.run_once(lambda *_:result(facts=[bad])),'review')
        with research.connect(self.path) as db:
            decided=datetime.fromisoformat(db.execute('SELECT decided_at FROM general_source_semantic_reviews').fetchone()[0]).timestamp()
            later=decided+research.SEMANTIC_RETRY_DELAY_SECONDS+1
            self.assertEqual(research.release_early_semantic_holds(db,now=decided+1),0)  # waits out the delay
            self.assertEqual(research.release_early_semantic_holds(db,now=later),1)
            self.assertEqual(db.execute('SELECT count(*) FROM general_source_semantic_reviews').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT state FROM official_research_jobs').fetchone()[0],'retry')
            db.execute('UPDATE official_research_jobs SET next_at=0'); db.commit()
        self.assertEqual(self.run_once(lambda *_:result()),'done')

    def test_review_stays_after_the_last_attempt_or_a_model_decision(self):
        self.raw(BODY)
        bad={**COPY,'en':COPY['en']+' Revenue was $99 billion.'}
        self.assertEqual(self.run_once(lambda *_:result(facts=[bad])),'review')
        with research.connect(self.path) as db:
            decided=datetime.fromisoformat(db.execute('SELECT decided_at FROM general_source_semantic_reviews').fetchone()[0]).timestamp()
            later=decided+research.SEMANTIC_RETRY_DELAY_SECONDS+3600
            db.execute('UPDATE official_research_jobs SET attempts=?',(research.SEMANTIC_REVIEW_AFTER_ATTEMPTS,)); db.commit()
            self.assertEqual(research.release_early_semantic_holds(db,now=later),0)
            self.assertEqual(db.execute('SELECT state FROM official_research_jobs').fetchone()[0],'review')
        self.raw(BODY+' A second source unit is retained for consideration.',number=2000)
        self.assertEqual(self.run_once(lambda *_:result('review','insufficient-source-evidence',[])),'review')
        with research.connect(self.path) as db:
            db.execute('UPDATE official_research_jobs SET attempts=1'); db.commit()
            self.assertEqual(research.release_early_semantic_holds(db,now=later),1)  # only the check failure
            self.assertEqual(db.execute("SELECT count(*) FROM general_source_semantic_reviews WHERE reason='insufficient-source-evidence'").fetchone()[0],1)

    def test_backlog_release_retries_held_check_failures_once_and_records_the_site(self):
        self.raw(BODY)
        bad={**COPY,'en':COPY['en']+' Revenue was $99 billion.'}
        self.assertEqual(self.run_once(lambda *_:result(facts=[bad])),'review')
        self.assertTrue(any(code=='unsupported-number' and '.py:' in site
                            for code,site in research.FAILURE_SITES))
        with research.connect(self.path) as db:
            self.assertEqual(research.release_research_backlog_once(db),1)
            self.assertEqual(research.release_research_backlog_once(db),0)
            db.execute('UPDATE official_research_jobs SET next_at=0'); db.commit()
        self.assertEqual(self.run_once(lambda *_:result()),'done')

    def test_provider_failure_uses_existing_retry_and_budget_without_false_review(self):
        self.raw(BODY)
        def failed(*_):raise RuntimeError('offline provider unavailable')
        self.assertEqual(self.run_once(failed),'retry')
        self.assertEqual(self.run_once(lambda *_:self.fail('backoff ignored')),'idle')
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM general_source_semantic_reviews').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
            db.execute('UPDATE official_research_jobs SET next_at=0')
        self.assertEqual(self.run_once(lambda *_:result()),'done')
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],2)

    def test_shared_budget_and_headline_reserve_apply_to_assessment(self):
        self.raw(BODY)
        with research.connect(self.path) as db:
            db.executemany('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
                [(NOW.timestamp(),'existing','sha','approved','failed',str(i)) for i in range(199)])
        with patch.object(headline_translation,'diagnostics',return_value={'pending':1}):
            self.assertEqual(self.run_once(lambda *_:self.fail('headline reserve consumed')),'idle')
        self.assertEqual(self.run_once(lambda *_:result('review','insufficient-source-evidence',[])),'review')
        self.raw(BODY+' A second source unit is retained for consideration.',number=2000)
        self.assertEqual(self.run_once(lambda *_:self.fail('shared cap exceeded')),'idle')
        with research.connect(self.path) as db:self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],200)

    def test_source_revision_change_during_positive_or_negative_assessment_is_stale(self):
        for decision in ['publish','review']:
            with self.subTest(decision=decision):
                self.raw(BODY)
                def revise(*_):
                    self.raw('Correction: the earlier post is withdrawn and should not be relied upon.',
                             first_seen_at=(NOW-timedelta(minutes=1)).isoformat(),last_seen_at=(NOW-timedelta(minutes=1)).isoformat())
                    return result() if decision=='publish' else result('review','insufficient-source-evidence',[])
                self.assertEqual(self.run_once(revise),'stale')
                with research.connect(self.path) as db:
                    self.assertEqual(db.execute('SELECT count(*) FROM general_source_semantic_reviews').fetchone()[0],0)
                    self.assertEqual(news.public_items(db,NOW),[])
                    for table in ['signal_x_acquisition','signal_documents','signal_events','official_research_jobs']:
                        db.execute('DELETE FROM '+table)

    def test_new_source_sha_is_not_blocked_by_old_terminal_review(self):
        raw=self.raw(BODY)
        self.assertEqual(self.run_once(lambda *_:result('review','insufficient-source-evidence',[])),'review')
        self.raw(BODY+' Industrial customers are evaluating these samples.',
                 first_seen_at=(NOW-timedelta(minutes=2)).isoformat(),last_seen_at=(NOW-timedelta(minutes=2)).isoformat())
        self.assertEqual(self.run_once(lambda *_:result('review','insufficient-source-evidence',[])),'review')
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],2)
            self.assertEqual(db.execute('SELECT count(*) FROM general_source_semantic_reviews').fetchone()[0],2)
            self.assertNotEqual(news.candidates(db,NOW,include_review=True)[0]['sha'],raw['sha'])

    def test_existing_duplicate_event_does_not_repeat_a_terminal_assessment(self):
        self.raw(BODY);self.admit()
        with research.connect(self.path) as db:
            item={'url':'https://x.com/TipRanks/status/2000','title':' '.join(BODY.split())[:500],
                  'text':BODY,'publishedAt':fixture.PUBLISHED,'matches':{'MU':['$MU']},'truncated':False}
            signals.save(db,fixture.SOURCE,[item],{},(NOW-timedelta(days=2)+timedelta(seconds=30)).isoformat(),'synthetic',1)
        self.assertEqual(self.run_once(lambda *_:result('review','insufficient-source-evidence',[])),'review')
        self.assertEqual(self.run_once(lambda *_:self.fail('duplicate terminal assessment')),'idle')
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)

    def test_financial_ambiguity_and_false_actor_never_reach_assessment(self):
        for number,body in enumerate([
            'Micron $MU at $250 (was $200), Northstar Research sees durable memory demand.',
            'Micron $MU price objective now 250 from 200 at Northstar Research.',
            'Microsoft $MU has begun sampling its next-generation memory chips with industrial customers.',
        ]):self.raw(body,number=number+1)
        self.assertEqual(self.run_once(lambda *_:self.fail('ambiguous financial actor')),'idle')
        with research.connect(self.path) as db:self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],0)

    def test_public_read_rechecks_semantic_marker_and_current_body(self):
        self.raw(BODY);self.assertEqual(self.run_once(lambda *_:result()),'done')
        with research.connect(self.path) as db:
            saved=json.loads(db.execute('SELECT payload FROM official_research_publications').fetchone()[0])
            saved.pop('semanticAssessment')
            db.execute('UPDATE official_research_publications SET payload=?',(json.dumps(saved),))
            self.assertEqual(news.public_items(db,NOW),[])
        self.assertEqual(self.run_once(lambda *_:result()),'done')
        with research.connect(self.path) as db:
            db.execute("UPDATE signal_documents SET text='A changed body without the required SHA proof.'")
            self.assertEqual(news.public_items(db,NOW),[])


if __name__=='__main__':unittest.main()
