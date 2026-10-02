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

    def test_saved_mistranslation_is_revalidated_and_automatically_regenerated(self):
        self.assertEqual(self.run_note(), 'done')
        with research.connect(self.path) as db:
            payload=json.loads(db.execute('SELECT payload FROM official_research_publications').fetchone()[0])
            payload['summary']['ja']='買収し、性能を向上させた。'
            payload['summary']['en']='It acquired Inferize to improve performance.'
            db.execute('UPDATE official_research_publications SET payload=?', (json.dumps(payload),))
        self.assertEqual(self.feed(), [])
        self.assertEqual(self.run_note(), 'done')
        self.assertEqual(self.feed()[0]['summary']['ja'], NOTE['summary']['ja'])
        self.assertEqual(self.run_note(lambda *_:self.fail('duplicate regeneration')), 'idle')

    def test_failed_copy_has_private_revision_bound_audit_evidence(self):
        def wrong(*args):
            result=response()
            note=json.loads(json.dumps(NOTE))
            note['summary']['ja']='買収し、性能を向上させた。'
            note['summary']['en']='It acquired Inferize to improve performance.'
            result['output'][0]['content'][0]['text']=json.dumps(note)
            return result
        self.assertEqual(self.run_note(wrong), 'retry')
        with research.connect(self.path) as db:
            failure=db.execute('SELECT * FROM official_research_attempt_failures').fetchone()
            self.assertEqual(failure['reason'], 'invalid-copy')
            self.assertEqual(failure['detail'], 'summary')
            self.assertEqual(json.loads(failure['payload'])['summary']['ja'], '買収し、性能を向上させた。')
        self.assertEqual(self.feed(), [])

    def test_only_unambiguous_source_name_case_is_normalized(self):
        note=json.loads(json.dumps(NOTE))
        note['title']['ja']='NEbius、Inferizeを買収'
        result=research.validate(note, BODY, TITLE)
        self.assertEqual(result['title']['ja'], 'Nebius、Inferizeを買収')
        note['title']['ja']='OTHERbrand、Inferizeを買収'
        self.assertEqual(research.validate(note, BODY, TITLE)['title']['ja'], note['title']['ja'])

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

    def test_planned_acquisition_cannot_be_translated_as_completed(self):
        note=json.loads(json.dumps(NOTE))
        with self.assertRaisesRegex(ValueError,'invalid-copy'):
            research.validate(note,BODY,'Nebius to Acquire Inferize')
        note['title']['ja']='Nebius、Inferize買収へ'
        note['summary']['ja']='NebiusがInferizeの買収契約を締結。'
        note['title']['en']='Nebius to acquire Inferize'
        note['summary']['en']='Nebius entered an agreement to acquire Inferize.'
        for item in note['facts']:
            if 'acquired' in item['en']:
                item['en']='Nebius entered an agreement to acquire Inferize.'
                item['ja']='Inferizeの買収契約を締結した。'
        research.validate(note,BODY,'Nebius to Acquire Inferize')
    def test_numeric_substrings_and_changed_units_are_rejected(self):
        quote='Revenue was $15 billion and operating margin was 25 percent.'
        for text in ('Revenue was $5 billion.', 'Revenue was $15 million.', 'Margin was 5%.'):
            note=json.loads(json.dumps(NOTE))
            note['facts'][0]=copy('原文の数値を確認した。', text, quote)
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, 'unsupported-number'):
                research.validate(note, BODY+' '+quote)

    def test_completed_fact_cannot_hide_behind_planned_title_and_summary(self):
        quote='The company signed an agreement to acquire Inferize. Closing is expected next year.'
        note=json.loads(json.dumps(NOTE))
        for field in ('title','summary'):
            note[field]=copy('Inferize買収へ。', 'Agreement to acquire Inferize.',quote)
        note['facts'][0]=copy('Inferizeの買収を完了した。','Completed the acquisition of Inferize.',quote)
        with self.assertRaisesRegex(ValueError,'invalid-copy'):
            research.validate(note,BODY+' '+quote,'Nebius to acquire Inferize')
        # A neutral title does not disable evidence-level status validation.
        with self.assertRaisesRegex(ValueError,'invalid-copy'):
            research.validate(note,BODY+' '+quote,'Nebius announces strategic transaction')

    def test_long_body_tail_is_included_without_silent_truncation(self):
        body=('Background context. '*3000)+'TAIL_GUIDANCE_END'
        excerpts=research.evidence_excerpts(body)
        self.assertTrue(any('TAIL_GUIDANCE_END' in q for q in excerpts.values()))
        for quote in excerpts.values():
            self.assertIn(quote,body)
            self.assertLessEqual(len(quote),research.MAX_EVIDENCE_CHARS)

    def test_stored_invalid_publication_is_hidden_and_regenerated(self):
        self.assertEqual(research.run_once(self.path,response,{**ENV,'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT':'200'},NOW.timestamp()),'done')
        with research.connect(self.path) as db:
            payload=json.loads(db.execute('SELECT payload FROM official_research_publications').fetchone()[0])
            payload['facts'][0]['en']='Revenue was 9999 billion.'
            db.execute('UPDATE official_research_publications SET payload=?',(json.dumps(payload),))
        self.assertEqual(self.feed(),[])
        self.assertEqual(research.run_once(self.path,response,{**ENV,'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT':'200'},NOW.timestamp()),'done')
        self.assertEqual(len(self.feed()),1)

    def test_sign_digit_polarity_and_bilingual_mismatches_are_rejected(self):
        cases=[
            ('結果は+32。','Actual was +32.','Actual was -32.'),
            ('EPSは$-1.20。','EPS was $-1.20.','EPS was $-1.21.'),
            ('売上高は5%増加。','Revenue increased 5%.','Revenue decreased 5%.'),
            ('純利益は$5 billion。','Net income was $5 billion.','Net loss was $5 billion.'),
            ('EPSは$-1.20。','EPS was $1.20.','EPS was $-1.20 and prior EPS was $1.20.'),
        ]
        for ja,en,quote in cases:
            note=json.loads(json.dumps(NOTE))
            note['facts'][0]=copy(ja,en,quote)
            with self.subTest(quote=quote), self.assertRaises(ValueError):
                research.validate(note,BODY+' '+quote)
        import factual_validation as validation
        validation.validate_numbers('EPS was $-1.20.','EPS was ($1.20).')
        with self.assertRaises(ValueError):
            validation.validate_numbers('EPS was $1.20.','EPS was ($1.20).')

    def test_shared_daily_budget_prevents_extra_provider_calls(self):
        with research.connect(self.path) as db:
            for i in range(3):db.execute('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',(NOW.timestamp(),'test','test','test','done',str(i)))
        self.assertEqual(self.run_note(lambda *_:self.fail('over budget')),'idle')

    def test_twenty_historical_failures_do_not_strand_retry_with_shared_capacity(self):
        with research.connect(self.path) as db:
            for i in range(20):
                db.execute('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
                           (NOW.timestamp(),'research:test','test','test','failed',str(i)))
            row=research.candidates(db,NOW)[0]
            db.execute("INSERT INTO official_research_jobs(event_id,sha,attempts,next_at,lease,state,failure_kind) VALUES(?,?,1,0,'old','retry','invalid-copy')",(row['id'],row['sha']))
        env={**ENV,'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT':'200'}
        self.assertEqual(research.run_once(self.path,response,env,NOW.timestamp()),'done')
        self.assertEqual(len(self.feed()),1)
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT attempts FROM official_research_jobs').fetchone()[0],2)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],21)

    def test_pending_headline_reserves_last_shared_slot_then_article_can_use_it(self):
        with research.connect(self.path) as db:
            for i in range(2):
                db.execute('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
                           (NOW.timestamp(),'research:test','test','test','failed',str(i)))
        self.assertEqual(self.run_note(lambda *_:self.fail('stole pending headline slot')),'idle')
        with research.connect(self.path) as db:
            row=research.candidates(db,NOW)[0]
            db.execute('INSERT INTO signal_headline_translations(source_id,url,sha,headline_ja,model,created_at) VALUES(?,?,?,?,?,?)',
                       (row['source_id'],row['url'],row['sha'],'Nebius、Inferizeを買収','synthetic',NOW.isoformat()))
        self.assertEqual(self.run_note(),'done')

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

    def test_repeated_failure_waits_for_backoff_before_retry(self):
        with research.connect(self.path) as db:
            row=research.candidates(db,NOW)[0]
            db.execute("INSERT INTO official_research_jobs(event_id,sha,attempts,next_at,lease,state,failure_kind) VALUES(?,?,6,0,'old','retry','unsupported-number')",(row['id'],row['sha']))
        def fail(*args):raise ValueError('unsupported-number')
        self.assertEqual(self.run_note(fail),'retry')
        self.assertEqual(self.run_note(lambda *_:self.fail('unbounded retry')),'idle')
    def test_legacy_unclassified_failure_retries_with_backoff(self):
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

    def test_stopped_article_job_recovers_after_backoff_without_manual_reset(self):
        with research.connect(self.path) as db:
            row=research.candidates(db,NOW)[0]
            db.execute("INSERT INTO official_research_jobs(event_id,sha,attempts,next_at,lease,state,failure_kind) VALUES(?,?,8,?, 'old','retry','provider-unavailable')", (row['id'], row['sha'], NOW.timestamp()+60))
        self.assertEqual(self.run_note(lambda *_:self.fail('before retry deadline')), 'idle')
        self.assertEqual(research.run_once(self.path,response,ENV,NOW.timestamp()+60), 'done')

    def test_numerical_worker_runs_even_when_translation_is_unconfigured(self):
        import service
        with patch.dict('os.environ',{},clear=True):app=service.AutomaticMonitor(self.path,Path(self.tmp.name)/'snapshot.json')
        def publish(*args):app.stop_event.set()
        with patch.object(service.market_results,'run_once',side_effect=publish) as worker:
            app.run_results();worker.assert_called_once()
        self.assertIsNot(app.result_thread,app.headline_translation_thread)
        self.assertIsNot(app.official_research_thread,app.headline_translation_thread)

if __name__=='__main__':unittest.main()
