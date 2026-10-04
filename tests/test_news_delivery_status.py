"""Stopped semantic decisions remain visible without scheduling paid work."""
from datetime import timedelta
import json
import unittest
from unittest.mock import patch

import test_micron_reviewed_recovery as fixture
import test_official_research as primary_fixture
import general_source_news as news
import news_delivery_status as delivery
import official_research as research
import micron_reviewed_recovery as recovery


class NewsDeliveryStatusTests(unittest.TestCase):
    def setUp(self):
        self.case=fixture.MicronReviewedRecoveryTests()
        self.case.setUp();self.addCleanup(self.case.doCleanups)
        self.path=self.case.path

    def status(self,db):
        with patch.object(research,'datetime') as clock:
            clock.now.return_value=fixture.PUBLIC
            return research.diagnostics(db)

    def test_zero_retry_queue_still_counts_current_held_unpublished_and_ages(self):
        with research.connect(self.path) as db:
            calls=list(db.execute('SELECT * FROM signal_headline_translation_calls'))
            job=list(db.execute('SELECT * FROM official_research_jobs'))
            before=list(db.iterdump())
            result=self.status(db)
            self.assertEqual((result['pending'],result['published']),(0,0))
            state=result['delivery']
            self.assertEqual({k:state[k] for k in ('tracked','validated','automaticPending','reviewHeld','unpublished','assessedExcluded')},
                             {'tracked':1,'validated':0,'automaticPending':0,'reviewHeld':1,'unpublished':1,'assessedExcluded':0})
            self.assertEqual(state['reviewOverdue'],1)
            self.assertEqual(state['reviewReasons'],{'unsubstantiated-model-output':1})
            self.assertEqual(state['reviewOldestPublicationAgeMs']-state['reviewOldestCaptureAgeMs'],13668)
            self.assertEqual(news.diagnostics(db,fixture.PUBLIC)['delivery'],state)
            self.assertEqual(list(db.iterdump()),before)
            self.assertEqual(list(db.execute('SELECT * FROM signal_headline_translation_calls')),calls)
            self.assertEqual(list(db.execute('SELECT * FROM official_research_jobs')),job)

    def test_held_overdue_incident_persists_until_valid_reviewed_publication(self):
        with research.connect(self.path) as db:
            self.assertEqual(research.sync_incident(db,{},fixture.PUBLIC),'official-research-overdue')
            self.assertEqual(db.execute('SELECT state FROM official_research_jobs').fetchone()[0],'review')
            self.assertTrue(recovery.publish(db,fixture.PUBLIC,fixture.MODEL,clock=lambda:fixture.PUBLIC))
            state=self.status(db)['delivery']
            self.assertEqual((state['validated'],state['reviewHeld'],state['unpublished']),(1,0,0))
            self.assertIsNone(research.sync_incident(db,{},fixture.PUBLIC))
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)

    def test_negative_materiality_is_assessed_exclusion_not_delivery_overdue(self):
        with research.connect(self.path) as db:
            db.execute("UPDATE general_source_semantic_reviews SET reason='not-material-business-news'")
            state=self.status(db)['delivery']
            self.assertEqual((state['tracked'],state['assessedExcluded'],state['reviewHeld'],state['unpublished']),(1,1,0,0))
            self.assertIsNone(research.sync_incident(db,{},fixture.PUBLIC))

    def test_stale_source_is_not_counted_as_current_held_record(self):
        with research.connect(self.path) as db:
            db.execute("UPDATE signal_documents SET sha='superseded'")
            state=self.status(db)['delivery']
            self.assertEqual((state['tracked'],state['reviewHeld'],state['unpublished']),(0,0,0))

    def test_retry_and_running_states_remain_separate_from_manual_review(self):
        with research.connect(self.path) as db:
            db.execute('DELETE FROM general_source_semantic_reviews')
            for current in ('retry','running'):
                db.execute('UPDATE official_research_jobs SET state=?',(current,))
                state=self.status(db)['delivery']
                self.assertEqual((state['automaticPending'],state['reviewHeld'],state['unpublished']),(1,0,1))
                self.assertEqual(state['retryWaiting'],int(current=='retry'))
                self.assertEqual(state['running'],int(current=='running'))

    def test_date_only_sources_do_not_get_invented_precise_source_age(self):
        with research.connect(self.path) as db:
            row=news.candidates(db,fixture.PUBLIC,include_review=True)[0]
            review=news.semantic_review(db,row,fixture.PUBLIC)
            summary=delivery.summarize(db,fixture.PUBLIC,[],set(),[({**row,'published_at':'2026-10-03'},review)])
            self.assertIsNone(summary['reviewOldestPublicationAgeMs'])
            self.assertEqual(summary['reviewPublicationAgeUnmeasured'],1)
            self.assertGreater(summary['reviewOldestCaptureAgeMs'],300000)

    def test_invalid_saved_done_copy_is_a_manual_hold_not_automatic_pending(self):
        case=primary_fixture.OfficialResearchTests()
        case.setUp();self.addCleanup(case.doCleanups)
        transport=case.comparison_fixture('既知より50％多い排出を検出。')
        with patch.object(research.factual_validation,'validate_comparison_baselines'):
            self.assertEqual(case.run_note(transport),'done')
        reference=primary_fixture.NOW+timedelta(minutes=10)
        with research.connect(case.path) as db:
            rows=research.candidates(db,reference)
            self.assertEqual(len(rows),1)
            self.assertEqual(research.publication_hold_reason(db,rows[0],reference),'unsupported-comparison-baseline')
            state=research.delivery_diagnostics(db,reference,rows,set())
            self.assertEqual((state['tracked'],state['automaticPending'],state['publicationHeld'],state['reviewHeld'],state['unpublished']),(1,0,1,1,1))
            self.assertEqual(state['semanticReviewHeld'],0)
            self.assertEqual(state['publicationHoldReasons'],{'unsupported-comparison-baseline':1})
            self.assertEqual(state['reviewOverdue'],1)
            self.assertEqual(research.validated_publications(db,rows),[])
            calls=[tuple(r) for r in db.execute('SELECT * FROM signal_headline_translation_calls')]
            job=[tuple(r) for r in db.execute('SELECT * FROM official_research_jobs')]
            self.assertIsNone(research.claim(db,reference,primary_fixture.ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],200))
            self.assertEqual(research.sync_incident(db,{},reference),'official-research-overdue')
            self.assertEqual([tuple(r) for r in db.execute('SELECT * FROM signal_headline_translation_calls')],calls)
            self.assertEqual([tuple(r) for r in db.execute('SELECT * FROM official_research_jobs')],job)
            saved=db.execute('SELECT payload FROM official_research_publications').fetchone()[0]
            correct=json.loads(saved);correct['facts'][2]['ja']='人間の専門家より50％多い排出を検出。'
            db.execute('UPDATE official_research_publications SET payload=?',(json.dumps(correct),))
            valid={row['id'] for row,_,_ in research.validated_publications(db,rows)}
            state=research.delivery_diagnostics(db,reference,rows,valid)
            self.assertEqual((state['validated'],state['publicationHeld'],state['unpublished']),(1,0,0))
            self.assertIsNone(research.sync_incident(db,{},reference))


if __name__=='__main__':unittest.main()
