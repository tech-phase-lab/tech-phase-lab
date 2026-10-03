"""Offline end-to-end general publication and shared-budget checks."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import hashlib
import json
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import general_source_news as news
import official_research as research
import official_research_diagnostics as diagnostic
import headline_translation
import monitor
import signals
from test_headline_translation import ENV as BASE_ENV

NOW=datetime(2026,10,3,8,0,tzinfo=timezone.utc)
ENV={**BASE_ENV,'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT':'200'}
SOURCE=next(s for s in signals.SOURCES if s['id']=='x-wallstengine')
CEO='Micron $MU CEO: \n\n“We expect fiscal 2027 to be even better. Industry demand has strengthened since our last earnings call, and we expect memory and storage supply-demand conditions to be much tighter in fiscal 2027 and 2028 than they were in 2026.”'
ROUNDUP='''Micron’s $MU Q4 reinforced the same story across Wall Street – AI memory demand remains strong, supply is tightening, and earnings durability may still be underestimated.

TD Cowen: Buy | $1,600
Demand durability keeps improving, with revenue guidance well above expectations and AI memory upside beyond signed long-term agreements.

JPMorgan: Overweight | $1,540
Called Q4 a “decisive beat-and-raise,” highlighting tighter supply-demand conditions and stronger multi-year earnings power.

RBC: Outperform | $1,500
Sees supply-demand tightening further into 2027-28 and believes floor-pricing agreements still receive little credit in the stock.

Morgan Stanley: Overweight | $1,200
Says the business continues to show strength, with Micron’s earnings durability still underappreciated despite more normalized beats.'''
CEO_COPY=[
 {'ja':'経営陣はFY2027が一段と好調になると見込む。','en':'Management forecasts a stronger fiscal 2027.','evidenceId':'0'},
 {'ja':'前回の決算説明会以降、業界の需要は強まった。メモリーとストレージの需給はFY2027と2028に、2026よりも逼迫すると見込む。',
  'en':'Since the prior earnings call, industry demand has increased. Memory and storage markets are expected to be tighter in fiscal 2027 and 2028 than in 2026.','evidenceId':'1'}]
BROKER_COPY=[
 {'ja':'MicronのQ4はAIメモリーの需要の強さと供給逼迫を示した。利益の持続性は依然として過小評価されている可能性がある。','en':"Micron's Q4 highlighted resilient AI-memory demand and tighter supply; earnings durability may remain undervalued.",'evidenceId':'0'},
 {'ja':'需要の持続性は改善しており、売上高ガイダンスは予想を大幅に上回る。AIメモリーには締結済みの長期契約を超える伸びしろがある。','en':'Revenue guidance substantially exceeded expectations as lasting demand improved, with AI memory offering potential beyond existing long-term contracts.','evidenceId':'1'},
 {'ja':'Q4は予想を明確に上回り見通しを引き上げた決算と評価。需給の一段の逼迫と複数年にわたる収益力の強さを指摘した。','en':'Q4 was described as a clear expectations beat accompanied by raised guidance, with tighter markets and improved earnings capacity over several years.','evidenceId':'2'},
 {'ja':'2027-28にかけて需給がさらに逼迫すると見込み、最低価格契約の価値は株価に十分織り込まれていないとみる。','en':'The firm expects markets to tighten further in 2027-28, while minimum-price agreements are still viewed as receiving little recognition in the shares.','evidenceId':'3'},
 {'ja':'事業の強さは続いており、決算の上振れ幅が平常化してもMicronの利益の持続性は過小評価されていると指摘。','en':"Micron's business remains robust. Its persistent earnings are described as underappreciated even as results beat forecasts by more typical margins.",'evidenceId':'4'}]


def response(facts):
    return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps({'facts':facts},ensure_ascii=False)}]}]}


class GeneralSourceNewsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'db.sqlite'
        with research.connect(self.path):pass
    def seed(self,text=CEO,number=1044,source=SOURCE,account='wallstengine',observed=None):
        item={'url':f'https://x.com/{account}/status/{number}','title':' '.join(text.split())[:500],
              'text':text,'publishedAt':(NOW-timedelta(days=2)).isoformat(),'matches':{'MU':['$MU']},'truncated':False}
        with research.connect(self.path) as db:
            signals.save(db,source,[item],{},observed or (NOW-timedelta(days=2)+timedelta(seconds=28)).isoformat(),'synthetic',1)
        return item
    def run_once(self,facts=CEO_COPY,now=NOW,env=ENV,transport=None):
        with patch.object(research,'prepare_story_body',return_value='idle'), patch.object(research,'datetime') as clock:
            clock.fromtimestamp.side_effect=datetime.fromtimestamp
            clock.now.return_value=now
            return research.run_once(self.path,transport or (lambda *_:response(facts)),env,now.timestamp())
    def feed(self):
        with research.connect(self.path) as db:return news.public_items(db,NOW)
    def test_ceo_current_revision_to_existing_public_feed_without_padding(self):
        original=self.seed()
        self.assertEqual(self.run_once(),'done')
        item=self.feed()[0]
        self.assertEqual(item['publishedAt'],original['publishedAt'])
        self.assertIn('Micron CEO',item['bodyEn'])
        self.assertIn('2028',item['bodyJa']);self.assertIn('見込',item['bodyJa'])
        self.assertNotIn('wallstengine',item['publisher'])
        self.assertNotIn('evidenceQuote',json.dumps(item))
        self.assertNotEqual(item['bodyEn'],CEO)
        with research.connect(self.path) as db:
            self.assertEqual(signals.public_official_updates(db,reference=NOW)[0]['id'],item['id'])
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
            self.assertEqual(headline_translation.diagnostics(db,env=ENV,now=NOW.timestamp())['pending'],0)
        self.assertEqual(self.run_once(transport=lambda *_:self.fail('duplicate call')),'idle')
    def test_roundup_broker_target_bindings_are_static_context(self):
        self.seed(ROUNDUP,1085,account='TipRanks')
        self.assertEqual(self.run_once(BROKER_COPY),'done')
        item=self.feed()[0]
        for actor,target in [('TD Cowen','$1,600'),('JPMorgan','$1,540'),('RBC','$1,500'),('Morgan Stanley','$1,200')]:
            self.assertIn(actor+': reported rating',item['bodyEn'])
            self.assertIn('stated price target '+target,item['bodyEn'])
        self.assertNotIn('raised its price target',item['bodyEn'])
        self.assertNotIn('引き上げた目標株価',item['bodyJa'])
    def test_provider_payload_and_all_failures_use_existing_bounded_ledger(self):
        self.seed()
        def fail(payload,key):
            self.assertEqual(payload['model'],ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'])
            self.assertEqual(payload['max_output_tokens'],2400)
            self.assertFalse(payload['store'])
            self.assertIn('evidenceExcerpts',json.loads(payload['input']))
            raise RuntimeError('offline provider failure')
        self.assertEqual(self.run_once(transport=fail),'retry')
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT state FROM signal_headline_translation_calls').fetchone()[0],'failed')
            self.assertEqual(news.diagnostics(db,NOW)['retryReasons'],{'provider-unavailable':1})
        self.assertEqual(self.run_once(transport=lambda *_:self.fail('backoff ignored')),'idle')
        self.assertEqual(self.run_once(now=NOW+timedelta(seconds=61)),'done')
    def test_cap_and_disabled_configuration_never_call(self):
        self.seed()
        self.assertEqual(self.run_once(env={**ENV,'OFFICIAL_HEADLINE_TRANSLATION_ENABLED':'false'},transport=lambda *_:self.fail('disabled')),'disabled')
        with research.connect(self.path) as db:
            db.executemany('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
              [(NOW.timestamp(),'existing','sha','approved','failed',str(i)) for i in range(200)])
        self.assertEqual(self.run_once(transport=lambda *_:self.fail('cap exceeded')),'idle')
    def test_current_revision_change_during_transport_cannot_publish(self):
        self.seed()
        def change(*_):
            self.seed(CEO.replace('2028','2029'),observed=(NOW-timedelta(seconds=5)).isoformat())
            return response(CEO_COPY)
        self.assertEqual(self.run_once(transport=change),'stale')
        self.assertEqual(self.feed(),[])
    def test_changed_body_hides_saved_news_and_retraction_revokes_it(self):
        original=self.seed();self.assertEqual(self.run_once(),'done')
        correction={**original,'text':'Correction: the report is withdrawn.','title':'Correction: the report is withdrawn.'}
        with research.connect(self.path) as db:
            signals.save_evidence(db,SOURCE,[],{'_acquired_posts':[correction]},NOW.isoformat());db.commit()
        self.assertEqual(self.feed(),[])
    def test_read_only_diagnostic_accepts_new_publication_schema(self):
        self.seed();self.assertEqual(self.run_once(),'done')
        result=diagnostic.queue(self.path,view='all',reference=NOW)
        self.assertEqual(result['counts']['validatedPublications'],1)
        self.assertEqual(result['items'][0]['publication']['validation']['status'],'valid')
    def test_shared_cap_reservation_is_atomic_and_headlines_keep_priority(self):
        from concurrent.futures import ThreadPoolExecutor
        self.seed()
        with research.connect(self.path) as db:
            db.executemany('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
              [(NOW.timestamp(),'existing','sha','approved','failed','prior-'+str(i)) for i in range(199)])
        with patch.object(headline_translation,'diagnostics',return_value={'pending':1}):
            self.assertEqual(self.run_once(transport=lambda *_:self.fail('headline reserve consumed')),'idle')
        def claim(_):
            with research.connect(self.path) as db:return research.claim(db,NOW,'approved',200)
        with ThreadPoolExecutor(max_workers=2) as pool:
            claims=list(pool.map(claim,range(2)))
        self.assertEqual(sum(c is not None for c in claims),1)
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],200)
    def test_invalid_saved_publication_clock_can_be_repaired(self):
        self.seed();self.assertEqual(self.run_once(),'done')
        with research.connect(self.path) as db:
            db.execute('UPDATE official_research_publications SET public_at=?',((NOW+timedelta(days=1)).isoformat(),))
        self.assertEqual(self.feed(),[])
        self.assertEqual(self.run_once(),'done')
        self.assertEqual(len(self.feed()),1)

    def test_numeric_or_forecast_failure_is_audited_and_never_public(self):
        self.seed()
        bad=json.loads(json.dumps(CEO_COPY));bad[1]['ja']=bad[1]['ja'].replace('2028','2030')
        self.assertEqual(self.run_once(bad),'retry');self.assertEqual(self.feed(),[])
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT failure_kind FROM official_research_jobs').fetchone()[0],'unsupported-number')
            self.assertEqual(news.diagnostics(db,NOW)['published'],0)
            self.assertEqual(news.diagnostics(db,NOW)['pending'],1)

if __name__=='__main__':unittest.main()
