"""The reviewed broker article is bound to exact live-source hashes and evidence."""
from copy import deepcopy
from datetime import timedelta
import json
import unittest
from unittest.mock import patch
import test_general_source_news as fixture
import general_source_news as news
import official_research as research
import reviewed_business_news as reviewed

class ReviewedBusinessNewsTests(unittest.TestCase):
    setUp=fixture.GeneralSourceNewsTests.setUp
    seed=fixture.GeneralSourceNewsTests.seed
    run_once=fixture.GeneralSourceNewsTests.run_once
    feed=fixture.GeneralSourceNewsTests.feed
    def prepare(self,wrong=False):
        self.seed(fixture.ROUNDUP,1085,account='TipRanks')
        with research.connect(self.path) as db:
            self.row=news.candidates(db,fixture.NOW)[0]
            manifest=json.loads(reviewed.REVIEW.read_text())
            # Synthetic source identity keeps this test independent of live IDs.
            manifest.update(sourceId=self.row['source_id'],url=self.row['url'],sourceSha=self.row['sha'],bodySha=self.row['body_sha'])
            if wrong:manifest['bodySha']='wrong-current-body'
            self.manifest=json.dumps(manifest)
            self.raw=json.dumps({'facts':fixture.BROKER_COPY})
            db.execute("INSERT INTO official_research_jobs VALUES(?,?,4,?,'reviewed-prior-lease','retry','source-copy-overlap')",(self.row['id'],self.row['sha'],(fixture.NOW+timedelta(hours=2)).timestamp()))
            db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',('reviewed-prior-lease',self.row['id'],self.row['sha'],(fixture.NOW-timedelta(seconds=10)).isoformat(),'source-copy-overlap','fact',self.raw))
            db.execute('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',((fixture.NOW-timedelta(seconds=15)).timestamp(),'research:'+self.row['source_id'],self.row['sha'],fixture.ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],'failed','reviewed-prior-lease'))
    def test_reviewed_text_passes_all_current_source_fact_guards(self):
        self.prepare()
        value=json.loads(self.manifest)
        note=news.bind_note({'facts':value['facts']},self.row)
        text=news.public_item(self.row,note)
        for target in ('$1,600','$1,540','$1,500','$1,200'):self.assertIn(target,text['bodyEn'])
        self.assertIn('2027-28',text['bodyEn']);self.assertNotIn('FY2027',text['bodyEn'])
        self.assertIn('売上高見通し',text['bodyJa']);self.assertNotIn('収益見通し',text['bodyJa'])
    def test_atomic_zero_call_recovery_preserves_original_failure_and_clocks(self):
        self.prepare()
        with patch.object(type(reviewed.REVIEW),'read_text',return_value=self.manifest):
            self.assertEqual(self.run_once(transport=lambda *_:self.fail('extra model call')),'done')
            self.assertEqual(self.run_once(transport=lambda *_:self.fail('duplicate call')),'idle')
        self.assertEqual(len(self.feed()),1)
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT payload FROM official_research_attempt_failures').fetchone()[0],self.raw)
            job=db.execute('SELECT * FROM official_research_jobs').fetchone()
            self.assertEqual(job['attempts'],4);self.assertEqual(job['next_at'],(fixture.NOW+timedelta(hours=2)).timestamp())
            publication=db.execute('SELECT * FROM official_research_publications').fetchone()
            self.assertEqual(publication['started_at'],(fixture.NOW-timedelta(seconds=15)).isoformat())
            self.assertEqual(publication['public_at'],fixture.NOW.isoformat())
            self.assertIn('manual-reviewed-source-correction',db.execute('SELECT adjustments FROM business_news_revalidations').fetchone()[0])
    def test_mismatched_revision_or_unreviewed_copy_cannot_publish(self):
        self.prepare(wrong=True)
        with patch.object(type(reviewed.REVIEW),'read_text',return_value=self.manifest):
            self.assertEqual(self.run_once(transport=lambda *_:self.fail('backoff bypass')),'idle')
        self.assertEqual(self.feed(),[])
    def test_new_fiscal_or_target_claim_stays_fail_closed(self):
        self.prepare();value=json.loads(self.manifest)
        value['facts'][3]['en']=value['facts'][3]['en'].replace('2027-28','FY2027-28')
        with patch.object(type(reviewed.REVIEW),'read_text',return_value=json.dumps(value)):
            self.assertEqual(self.run_once(transport=lambda *_:self.fail('backoff bypass')),'idle')
        self.assertEqual(self.feed(),[])

if __name__=='__main__':unittest.main()
