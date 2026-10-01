import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import official_research as research
import monitor
from test_headline_translation import ENV

NOW=datetime(2026,10,1,14,0,tzinfo=timezone.utc)
URL='https://nebius.com/newsroom/nebius-acquires-inferize-to-strengthen-nebius-token-factorys-production-inference-stack'
TITLE="Nebius acquires Inferize to strengthen Nebius Token Factory's production inference stack"
QUOTES=["Nebius today announced it has acquired Inferize, an inference optimization company.",
        "Inferize's technology and team have joined Nebius Token Factory.",
        "Inferize's technology cuts idle GPU time, driving higher capacity utilization and better token economics."]
BODY=' '.join(QUOTES)+' '+('Company announcement background. '*50)

def copy(ja,en,quote): return {'ja':ja,'en':en,'evidenceQuote':quote}
NOTE={'title':copy('Nebius、Inferizeを買収','Nebius acquires Inferize',QUOTES[0]),
      'summary':copy('推論最適化企業Inferizeを買収した。','Nebius acquired inference optimization company Inferize.',QUOTES[0]),
      'facts':[copy('Inferizeを買収した。','Nebius acquired Inferize.',QUOTES[0]),
               copy('技術とチームがToken Factoryに加わった。','The technology and team joined Token Factory.',QUOTES[1]),
               copy('GPUの遊休時間を減らす技術を取り込む。','The technology reduces idle GPU time.',QUOTES[2])],
      'purpose':copy('稼働率とトークンの経済性の改善を目指す。','Nebius aims to improve utilization and token economics.',QUOTES[2])}
def response(*args):return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(NOTE,ensure_ascii=False)}]}]}

class OfficialResearchTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'db.sqlite'
        with research.connect(self.path) as db:
            db.execute('INSERT INTO sources(url,ticker,title,published_on,discovered_at,sha256) VALUES(?,?,?,?,?,?)',(URL,'NBIS',TITLE,'2026-10-01',NOW.isoformat(),'body-v1'))
            db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',(URL,'NBIS',NOW.isoformat()))
            db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',(URL,'body-v1',NOW.isoformat(),BODY,len(BODY)))
    def feed(self):
        with research.connect(self.path) as db:return research.feed(db,NOW)
    def run_note(self,transport=response):return research.run_once(self.path,transport,ENV,NOW.timestamp())
    def test_current_body_automatically_publishes_both_languages_and_timestamps(self):
        self.assertEqual(self.run_note(),'done')
        item=self.feed()[0]
        self.assertEqual(item['kind'],'acquisition');self.assertIn('買収',item['title']['ja'])
        self.assertEqual(item['title']['en'],'Nebius acquires Inferize')
        self.assertIn('generationMs',item);self.assertNotIn('evidenceQuote',json.dumps(item))
        self.assertNotIn('background',json.dumps(item))
        self.assertEqual(self.run_note(lambda *_:self.fail('duplicate call')),'idle')
    def test_evidence_ids_resolve_to_exact_source_without_model_rewriting(self):
        def selected(payload,key):
            self.assertIn('Use no digits',payload['instructions'])
            excerpts=json.loads(payload['input'])['evidenceExcerpts']
            note=json.loads(json.dumps(NOTE))
            for item in [note['title'],note['summary'],*note['facts'],note['purpose']]:
                item.pop('evidenceQuote');item['evidenceId']='0'
            self.assertIn(QUOTES[0],excerpts['0'])
            return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(note)}]}]}
        self.assertEqual(self.run_note(selected),'done')
        self.assertEqual(len(self.feed()),1)

    def test_corrected_quote_failure_can_recover_once_and_invalid_ids_stay_private(self):
        with research.connect(self.path) as db:
            row=research.candidates(db,NOW)[0]
            db.execute("INSERT INTO official_research_jobs(event_id,sha,attempts,next_at,lease,state,failure_kind) VALUES(?,?,4,0,'old','retry','unsupported-quote')",(row['id'],row['sha']))
        def invalid(payload,key):
            note=json.loads(json.dumps(NOTE))
            note['title'].pop('evidenceQuote');note['title']['evidenceId']='unknown'
            return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(note)}]}]}
        self.assertEqual(self.run_note(invalid),'retry')
        self.assertEqual(self.feed(),[])
        self.assertEqual(self.run_note(lambda *_:self.fail('unbounded corrected retry')),'idle')
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT attempts FROM official_research_jobs').fetchone()[0],5)

    def test_revision_changed_during_generation_cannot_publish(self):
        def revise(*args):
            with research.connect(self.path) as db:db.execute("UPDATE sources SET sha256='v2'")
            return response()
        self.assertEqual(self.run_note(revise),'stale');self.assertEqual(self.feed(),[])
    def test_held_sources_incomplete_bodies_and_promotions_stay_private(self):
        with research.connect(self.path) as db:db.execute("UPDATE sources SET status='held'")
        self.assertEqual(self.run_note(),'idle')
        with research.connect(self.path) as db:
            db.execute("UPDATE sources SET status='pending'")
            db.execute("UPDATE source_revisions SET extracted_text='Incomplete body'")
        self.assertEqual(self.run_note(),'idle')
    def test_unsupported_evidence_and_numbers_are_rejected(self):
        for field,bad in [('evidenceQuote','This unsupported claim does not occur in the body.'),('ja','売上は99%増加した。'),('en','Sign up https://example.com')]:
            note=json.loads(json.dumps(NOTE));note['facts'][0][field]=bad
            with self.subTest(field=field), self.assertRaises(ValueError):research.validate(note,BODY)
    def test_shared_daily_budget_prevents_extra_provider_calls(self):
        with research.connect(self.path) as db:
            for i in range(3):db.execute('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',(NOW.timestamp(),'test','test','test','done',str(i)))
        self.assertEqual(self.run_note(lambda *_:self.fail('over budget')),'idle')

    def test_research_subcap_reserves_headline_capacity(self):
        with research.connect(self.path) as db:
            for i in range(20):
                db.execute('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
                           (NOW.timestamp(),'research:test','test','test','failed',str(i)))
        env={**ENV,'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT':'200'}
        self.assertEqual(research.run_once(self.path,lambda *_:self.fail('research stole headline reserve'),env,NOW.timestamp()),'idle')

    def test_evidence_windows_keep_product_number_and_context_together(self):
        body='Background. '*46+'Microsoft 365 Copilot supports meeting summaries.\n'+('Further context. '*90)
        excerpts=research.evidence_excerpts(body)
        self.assertTrue(any('Microsoft 365 Copilot supports meeting summaries.' in q for q in excerpts.values()))
        for quote in excerpts.values():
            self.assertIn(quote,body)
            self.assertLessEqual(len(quote),research.MAX_EVIDENCE_CHARS)
        altered=json.loads(json.dumps(NOTE));altered['facts'][0]['en']='Revenue increased by 9999 percent.'
        with self.assertRaisesRegex(ValueError,'unsupported-number'):
            research.validate(altered,BODY)

    def test_corrected_window_gets_one_final_bounded_recovery(self):
        with research.connect(self.path) as db:
            row=research.candidates(db,NOW)[0]
            db.execute("INSERT INTO official_research_jobs(event_id,sha,attempts,next_at,lease,state,failure_kind) VALUES(?,?,6,0,'old','retry','unsupported-number')",(row['id'],row['sha']))
        def fail(*args):raise ValueError('unsupported-number')
        self.assertEqual(self.run_note(fail),'retry')
        self.assertEqual(self.run_note(lambda *_:self.fail('unbounded retry')),'idle')
    def test_legacy_unclassified_failure_has_one_bounded_diagnostic_retry(self):
        with research.connect(self.path) as db:
            rows=research.candidates(db,NOW)
            row=rows[0]
            db.execute("INSERT INTO official_research_jobs(event_id,sha,attempts,next_at,lease,state) VALUES(?,?,3,0,'legacy','retry')",(row['id'],row['sha']))
        def fail(*args):raise ValueError('incomplete')
        self.assertEqual(self.run_note(fail),'retry')
        self.assertEqual(self.run_note(lambda *_:self.fail('unbounded retry')),'idle')
        with research.connect(self.path) as db:
            job=db.execute('SELECT attempts,failure_kind FROM official_research_jobs').fetchone()
            self.assertEqual(job['attempts'],4);self.assertEqual(job['failure_kind'],'incomplete')

    def test_numerical_worker_runs_even_when_translation_is_unconfigured(self):
        import service
        with patch.dict('os.environ',{},clear=True):app=service.AutomaticMonitor(self.path,Path(self.tmp.name)/'snapshot.json')
        def publish(*args):app.stop_event.set()
        with patch.object(service.market_results,'run_once',side_effect=publish) as worker:
            app.run_results();worker.assert_called_once()
        self.assertIsNot(app.result_thread,app.headline_translation_thread)
        self.assertIsNot(app.official_research_thread,app.headline_translation_thread)

if __name__=='__main__':unittest.main()
