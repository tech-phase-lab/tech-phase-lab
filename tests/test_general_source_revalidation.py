"""Source-proven terminology repair and zero-call atomic revalidation."""
from copy import deepcopy
from datetime import timedelta
import json
import unittest
from unittest.mock import patch
import test_general_source_news as fixtures
NOW,ENV,CEO_COPY,ROUNDUP,BROKER_COPY=fixtures.NOW,fixtures.ENV,fixtures.CEO_COPY,fixtures.ROUNDUP,fixtures.BROKER_COPY
import general_source_news as news
import official_research as research

class RevalidationTests(fixtures.GeneralSourceNewsTests):
    # Reuse source/database setup without inheriting parent test cases below.
    def seed_failure(self,body=None,copy=None,kind='changed-business-topic'):
        self.seed(**({'text':body} if body else {}))
        with research.connect(self.path) as db:
            row=news.candidates(db,NOW)[0]
            self.row=row
            value={'facts':deepcopy(copy or CEO_COPY)}
            if not body:
                value['facts'][1]['ja']=value['facts'][1]['ja'].replace('前回の決算説明会以降','直近の決算発表以降')
                value['facts'][1]['en']=value['facts'][1]['en'].replace('prior earnings call','last earnings call')
            self.raw=json.dumps(value,ensure_ascii=False)
            db.execute("INSERT INTO official_research_jobs VALUES(?,?,3,?,'prior-lease','retry',?)",(row['id'],row['sha'],(NOW+timedelta(hours=1)).timestamp(),kind))
            db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',('prior-lease',row['id'],row['sha'],(NOW-timedelta(seconds=20)).isoformat(),kind,'facts[1]',self.raw))
            db.execute('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
                       ((NOW-timedelta(seconds=25)).timestamp(),'research:'+row['source_id'],row['sha'],ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],'failed','prior-lease'))
        return value
    def test_reviewed_timing_anchor_recovers_without_calls_or_retry_reset(self):
        self.seed_failure()
        self.assertEqual(self.run_once(transport=lambda *_:self.fail('extra model call')),'done')
        item=self.feed()[0]
        self.assertIn('直近の決算説明会以降',item['bodyJa'])
        self.assertNotIn('決算発表以降',item['bodyJa'])
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT payload FROM official_research_attempt_failures').fetchone()[0],self.raw)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT state FROM signal_headline_translation_calls').fetchone()[0],'failed')
            job=db.execute('SELECT * FROM official_research_jobs').fetchone()
            self.assertEqual(job['attempts'],3);self.assertEqual(job['next_at'],(NOW+timedelta(hours=1)).timestamp())
            saved=db.execute('SELECT * FROM official_research_publications').fetchone()
            self.assertEqual(saved['started_at'],(NOW-timedelta(seconds=25)).isoformat())
            self.assertEqual(saved['public_at'],NOW.isoformat())
            audit=db.execute('SELECT * FROM business_news_revalidations').fetchone()
            self.assertEqual((audit['sha'],audit['body_sha']),(self.row['sha'],self.row['body_sha']))
            self.assertEqual(audit['original_payload_sha'],news.digest(self.raw))
            self.assertEqual(audit['validated_payload_sha'],news.digest(saved['payload']))
            self.assertEqual(json.loads(audit['adjustments'])[0]['to'],'決算説明会')
        self.assertEqual(self.run_once(transport=lambda *_:self.fail('duplicate call')),'idle')
    def test_broker_or_still_wrong_copy_is_never_recovered(self):
        self.seed_failure(body=ROUNDUP,copy=BROKER_COPY)
        self.assertEqual(self.run_once(transport=lambda *_:self.fail('backoff bypass')),'idle')
        self.assertEqual(self.feed(),[])
    def test_wrong_year_survives_no_terminology_revalidation(self):
        bad=deepcopy(CEO_COPY);bad[1]['ja']=bad[1]['ja'].replace('2028','2030')
        self.seed_failure(copy=bad)
        self.assertEqual(self.run_once(transport=lambda *_:self.fail('backoff bypass')),'idle')
        self.assertEqual(self.feed(),[])
    def test_missing_original_call_proof_or_changed_revision_cannot_recover(self):
        self.seed_failure()
        with research.connect(self.path) as db:
            db.execute("UPDATE signal_headline_translation_calls SET source_id='other'")
        self.assertEqual(self.run_once(transport=lambda *_:self.fail('backoff bypass')),'idle')
        self.assertEqual(self.feed(),[])
    def test_disabled_approval_cannot_recover(self):
        self.seed_failure()
        self.assertEqual(self.run_once(env={**ENV,'OFFICIAL_HEADLINE_TRANSLATION_ENABLED':'false'},transport=lambda *_:self.fail('call')),'disabled')
        self.assertEqual(self.feed(),[])

# Avoid repeating the parent test suite through inheritance.
for _name in list(vars(fixtures.GeneralSourceNewsTests)):
    if _name.startswith('test_'):
        setattr(RevalidationTests,_name,None)

class MeaningRegressionTests(unittest.TestCase):
    def test_announcement_word_is_not_by_itself_a_product_launch(self):
        self.assertNotIn('launch',news.concepts('前回の決算発表以降、需要が強まった。','ja'))
        self.assertIn('launch',news.concepts('新製品を発表した。','ja'))
        self.assertIn('launch',news.concepts('製品Aを発表した。','ja'))
        self.assertIn('launch',news.concepts('モデルXを公開した。','ja'))
        with self.assertRaisesRegex(ValueError,'changed-business-topic'):
            news.validate_pair({'ja':'需要の見通しを示し、製品Aを発表した。','en':'The company expects stronger demand.'},{'quote':'The company expects stronger demand.','actor':'report'})
    def test_possible_earnings_undervaluation_retains_uncertainty(self):
        unit={'quote':'Earnings durability may still be underestimated.','actor':'report'}
        news.validate_pair({'ja':'利益の持続力が過小評価されている可能性がある。','en':'Persistent earnings are possibly undervalued.'},unit)
    def test_fiscal_basis_may_not_be_added_to_bare_years(self):
        unit={'quote':'Sees supply-demand tightening further into 2027-28.','actor':'report'}
        with self.assertRaisesRegex(ValueError,'unsupported-fiscal-basis'):
            news.validate_pair({'ja':'需給は2027-28年度にさらに逼迫すると見込む。','en':'The firm expects supply-demand conditions to tighten into FY2027-28.'},unit)
    def test_revenue_guidance_is_not_ambiguous_earnings_outlook(self):
        unit={'quote':'Revenue guidance is well above expectations.','actor':'report'}
        with self.assertRaisesRegex(ValueError,'changed-business-topic'):
            news.validate_pair({'ja':'収益見通しは予想を大きく上回る。','en':'Revenue guidance considerably exceeds expectations.'},unit)
        news.validate_pair({'ja':'売上高見通しは予想を大きく上回る。','en':'Revenue guidance considerably exceeds expectations.'},unit)
    def test_descriptive_with_does_not_authorize_a_causal_relation(self):
        unit={'quote':'Demand durability is improving, with revenue guidance well above expectations.','actor':'report'}
        with self.assertRaisesRegex(ValueError,'unsupported-causality'):
            news.validate_pair({'ja':'売上高ガイダンスが予想以上であるため、需要の持続性は改善している。','en':'Durability of demand is improving, with revenue guidance exceeding expectations.'},unit)

if __name__=='__main__':unittest.main()
