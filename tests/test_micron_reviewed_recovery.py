"""Exact failed-copy recovery keeps paid attempts and retained evidence intact."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime,timezone
import json
import sqlite3
import unittest
from unittest.mock import patch

import test_broker_outlook as broker
import test_retained_business_admission as fixture
import general_source_news as news
import micron_reviewed_recovery as recovery
import official_research as research

FAILED=datetime(2026,10,3,15,32,38,937042,tzinfo=timezone.utc)
STARTED=datetime(2026,10,3,15,32,30,tzinfo=timezone.utc)
PUBLIC=datetime(2026,10,4,0,20,tzinfo=timezone.utc)
MODEL=fixture.ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL']


class MicronReviewedRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.fixture=fixture.RetainedBusinessAdmissionTests()
        self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.path=self.fixture.path
        self.review,_=recovery.reviewed()
        self.fixture.raw(broker.BODY,number=2106377353018626530,
                         published_at=self.review['publishedAt'],first_seen_at=self.review['observedAt'],
                         last_seen_at=self.review['observedAt'])
        with research.connect(self.path) as db:
            self.assertEqual(news.admit_retained(db,STARTED)['inserted'],1)
            db.execute('UPDATE signal_events SET id=1244')
        original={'disposition':'publish','reason':'material-company-development','facts':self.review['originalFacts']}
        response={'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(original,ensure_ascii=False)}]}]}
        with patch.object(research,'prepare_story_body',return_value='idle'),patch.object(research,'datetime') as clock:
            clock.fromtimestamp.side_effect=datetime.fromtimestamp;clock.now.return_value=FAILED
            self.assertEqual(research.run_once(self.path,lambda *_:response,fixture.ENV,STARTED.timestamp()),'review')

    def publish(self):
        with research.connect(self.path) as db:
            return recovery.publish(db,PUBLIC,MODEL,clock=lambda:PUBLIC)

    def snapshot(self,db,table):
        return [dict(r) for r in db.execute('SELECT * FROM '+table)]

    def test_exact_current_copy_recovery_is_atomic_zero_call_and_honest_about_clocks(self):
        unchanged=('signal_events','signal_documents','signal_x_acquisition','general_source_semantic_reviews',
                   'official_research_attempt_failures','official_research_attempt_body_proofs','signal_headline_translation_calls')
        with research.connect(self.path) as db:
            before={table:self.snapshot(db,table) for table in unchanged}
            old_job=self.snapshot(db,'official_research_jobs')[0]
            self.assertEqual(news.public_items(db,PUBLIC),[])
        with patch.object(research,'prepare_story_body',side_effect=AssertionError('no source call')),patch.object(research,'datetime') as clock:
            clock.fromtimestamp.side_effect=datetime.fromtimestamp;clock.now.return_value=PUBLIC
            self.assertEqual(research.run_once(self.path,lambda *_:self.fail('no model call'),fixture.ENV,PUBLIC.timestamp()),'done')
        with research.connect(self.path) as db:
            for table in unchanged:self.assertEqual(self.snapshot(db,table),before[table],table)
            job=self.snapshot(db,'official_research_jobs')[0]
            self.assertEqual(job,{**old_job,'state':'done','failure_kind':None})
            saved=self.snapshot(db,'official_research_publications')[0]
            self.assertEqual(saved['started_at'],STARTED.isoformat())
            self.assertEqual(saved['public_at'],PUBLIC.isoformat())
            self.assertEqual(saved['generation_ms'],8937)
            audit=self.snapshot(db,'business_news_revalidations')[0]
            self.assertEqual(audit['original_payload_sha'],news.digest(before['official_research_attempt_failures'][0]['payload']))
            self.assertEqual(audit['validated_payload_sha'],news.digest(saved['payload']))
            changes=json.loads(audit['adjustments'])
            self.assertEqual(changes['originalJob'],old_job)
            self.assertEqual(changes['originalReview'],before['general_source_semantic_reviews'][0])
            self.assertEqual(changes['originalFailedAt'],FAILED.isoformat())
            item=news.public_items(db,PUBLIC)[0]
            self.assertEqual(item['publishedAt'],self.review['publishedAt'])
            self.assertEqual(item['observedAt'],self.review['observedAt'])
            for lang,body in [('ja','bodyJa'),('en','bodyEn')]:
                for fact in self.review['facts']:self.assertIn(fact[lang],item[body])
                self.assertEqual(item[body].count('JPMorgan'),7)
            self.assertEqual(news.semantic_review(db,news.candidates(db,PUBLIC)[0],PUBLIC),None)
        self.assertFalse(self.publish())

    def test_wrong_current_proof_payload_lease_and_job_fail_closed(self):
        mutations=(
            "UPDATE official_research_attempt_body_proofs SET body_sha='changed'",
            "UPDATE official_research_attempt_failures SET payload='{}'",
            "UPDATE official_research_attempt_failures SET failed_at='2026-10-03T15:32:39+00:00'",
            "UPDATE official_research_jobs SET lease='changed'",
            "UPDATE official_research_jobs SET state='retry'",
            "UPDATE general_source_semantic_reviews SET lease='changed'",
            "UPDATE signal_headline_translation_calls SET state='completed'",
            "UPDATE signal_headline_translation_calls SET model='different'",
            "UPDATE signal_documents SET text=text || ' changed'",
        )
        with sqlite3.connect(self.path) as original:
            script='\n'.join(original.iterdump())
        for index,sql in enumerate(mutations):
            path=self.path.parent/f'case-{index}.sqlite'
            with self.subTest(sql=sql):
                # Use an independent exact starting DB for every mutation.
                with sqlite3.connect(path) as clone:clone.executescript(script);clone.execute(sql)
                with research.connect(path) as checked:
                    self.assertFalse(recovery.publish(checked,PUBLIC,MODEL,clock=lambda:PUBLIC))
                    self.assertEqual(checked.execute('SELECT count(*) FROM official_research_publications').fetchone()[0],0)

    def test_rollback_preserves_terminal_state_and_concurrent_recovery_is_once(self):
        with research.connect(self.path) as db:
            db.execute("CREATE TRIGGER reject_audit BEFORE INSERT ON business_news_revalidations BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END")
        with self.assertRaises(sqlite3.IntegrityError):self.publish()
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT state FROM official_research_jobs').fetchone()[0],'review')
            db.execute('DROP TRIGGER reject_audit')
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:self.publish(),range(2)))
        self.assertEqual(sorted(results),[False,True])

    def test_resolution_does_not_release_tampered_or_unreviewed_publication(self):
        self.assertTrue(self.publish())
        with research.connect(self.path) as db:
            db.execute("UPDATE business_news_revalidations SET validated_payload_sha='changed'")
            self.assertEqual(news.public_items(db,PUBLIC),[])
            self.assertEqual(len(news.candidates(db,PUBLIC)),0)

    def test_all_seven_corrected_claims_pass_and_actual_errors_are_rejected(self):
        with research.connect(self.path) as db:row=news.candidates(db,PUBLIC,include_review=True)[0]
        recovery.note_for(row,self.review)
        for index in (3,4,5,6):
            with self.subTest(actual_field=index),self.assertRaises(ValueError):
                news.validate_pair(self.review['originalFacts'][index],row['units'][index])
        for index,lang,text in (
            (3,'en','Non-HBM server DRAM is forecast to grow by +37%.'),
            (3,'ja','非HBMサーバーDRAMは+37%成長すると推計している。'),
            (5,'ja',self.review['facts'][5]['ja'].replace('2030年まで','2030年までに')),
            (5,'en',self.review['facts'][5]['en'].replace('through 2030','by 2030')),
            (5,'ja',self.review['facts'][5]['ja'].replace('>35%','35%以上')),
            (6,'en',self.review['facts'][6]['en'].replace('50%+','more than 50%')),
            (4,'ja',self.review['facts'][4]['ja'].replace('混合平均','加重平均')),
            (4,'ja',self.review['facts'][4]['ja'].replace('CY27','FY27')),
        ):
            copy=deepcopy(self.review['facts'][index]);copy[lang]=text
            with self.subTest(index=index,lang=lang,text=text),self.assertRaises(ValueError):
                news.validate_pair(copy,row['units'][index])


if __name__=='__main__':unittest.main()
