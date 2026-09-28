import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import editorial_posts as posts
import note_translation as translation
import x_api

ENV = {'NOTE_TRANSLATION_ENABLED':'true','OPENAI_API_KEY':'synthetic-test-key-only-1234','NOTE_TRANSLATION_MODEL':'synthetic-model','NOTE_TRANSLATION_DAILY_LIMIT':'3'}
RESULT = {'titleEn':'A quick thought','introEn':'A note from RIZEL','bodyEn':"I'll wait and see how this plays out."}

def response(payload, key):
    assert payload['store'] is False
    assert 'conversational' in payload['instructions']
    return {'status':'completed','output_text':json.dumps(RESULT),'usage':{'total_tokens':100}}

class TranslationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'notes.sqlite'
        with posts.connect(self.path) as db:
            self.note=posts.save(db,{'id':'synthetic-note-0001','version':0,'kind':'notes','titleJa':'少し様子見','introJa':'ひとりごと','bodyJa':'もう少し様子見かな。'})['item']
            self.note=posts.review(db,{'id':self.note['id'],'version':1,'decision':'published','reviewer':'owner','reason':'Owner published'})['item']
    def test_disabled_never_calls_provider(self):
        self.assertEqual(translation.run_once(self.path,lambda *a:self.fail('API called'),env={}), 'disabled')
    def test_translates_once_preserving_japanese_publication(self):
        self.assertEqual(translation.run_once(self.path,response,ENV,now=1000),'done')
        with posts.connect(self.path) as db:
            item=posts.queue(db,published=True)['items'][0]
            self.assertEqual(item['bodyJa'],self.note['bodyJa']); self.assertEqual(item['bodyEn'],RESULT['bodyEn'])
            self.assertEqual(item['publishedAt'],self.note['publishedAt'])
        self.assertEqual(translation.run_once(self.path,lambda *a:self.fail('duplicate'),ENV,now=1001),'idle')
    def test_withdrawal_during_generation_cannot_republish(self):
        def changed(payload,key):
            with posts.connect(self.path) as db:
                posts.review(db,{'id':self.note['id'],'version':2,'decision':'withdrawn','reviewer':'owner','reason':'Owner withdrew'})
            return response(payload,key)
        self.assertEqual(translation.run_once(self.path,changed,ENV,now=1000),'stale')
        with posts.connect(self.path) as db:self.assertEqual(posts.queue(db,published=True)['items'],[])
    def test_edit_during_generation_cannot_apply_old_english(self):
        def changed(payload,key):
            with posts.connect(self.path) as db:posts.save(db,{**self.note,'bodyJa':'編集後の本文'})
            return response(payload,key)
        self.assertEqual(translation.run_once(self.path,changed,ENV,now=1000),'stale')
        with posts.connect(self.path) as db:self.assertEqual(posts.queue(db)['items'][0]['bodyEn'],'')
    def test_failure_keeps_japanese_and_bounds_retries(self):
        def failed(*args):raise RuntimeError('sensitive provider body')
        for now in (1000,1300,1600):self.assertEqual(translation.run_once(self.path,failed,ENV,now=now),'retry')
        self.assertEqual(translation.run_once(self.path,response,ENV,now=1900),'idle')
        with posts.connect(self.path) as db:self.assertEqual(len(posts.queue(db,published=True)['items']),1)
        self.assertNotIn(b'sensitive provider body',self.path.read_bytes())
    def test_refusal_or_partial_output_never_publishes(self):
        self.assertEqual(translation.run_once(self.path,lambda *a:{'status':'incomplete','output_text':json.dumps(RESULT)},ENV,now=1000),'retry')
    def test_live_lease_prevents_second_worker(self):
        with translation.connect(self.path) as db:
            self.assertIsNotNone(translation.claim(db,3,'synthetic-model',1000))
        self.assertEqual(translation.run_once(self.path,lambda *a:self.fail('concurrent'),ENV,now=1001),'idle')
    def test_official_short_update_needs_no_cashtag_or_earnings(self):
        source={'accounts':['nebiusai'],'officialUpdates':True}
        payload={'includes':{'users':[{'id':'7','username':'nebiusai'}]},'data':[{'id':'12345','author_id':'7','text':"Proud to support this new platform.",'created_at':'2026-09-28T09:00:00Z'}]}
        item=x_api.parse_response(source,payload,['NBIS'])[0]
        self.assertIn('NBIS',item['matches'])
        payload['includes']['users'][0]['username']='impostor'
        self.assertEqual(x_api.parse_response(source,payload,['NBIS']),[])

class OfficialFeedTests(unittest.TestCase):
    def test_public_projection_keeps_links_and_rejects_private_sources(self):
        import signals
        from datetime import datetime, timezone
        with tempfile.TemporaryDirectory() as tmp:
            with posts.connect(Path(tmp)/'db') as db:
                signals.schema(db)
                for source,url in [('x-nebius-official','https://x.com/nebiusai/status/123'),('x-nebius-official','https://x.com/impostor/status/124'),('x-tipranks','https://x.com/TipRanks/status/125')]:
                    db.execute('''INSERT INTO signal_events(source_id,url,sha,title,tickers_json,matches_json,event_kind,published_at,observed_at,excerpt,diff,truncated)
                    VALUES(?,?,'hash','Official update','["NBIS"]','{}','new','2026-09-28T09:00:00Z','2026-09-28T09:01:00Z','PRIVATE','PRIVATE',0)''',(source,url))
                db.commit()
                items=signals.public_official_updates(db,reference=datetime(2026,9,28,10,tzinfo=timezone.utc))
                self.assertEqual(len(items),1)
                self.assertNotIn('PRIVATE',json.dumps(items))
                self.assertEqual(items[0]['url'],'https://x.com/nebiusai/status/123')

    def test_baseline_displays_newest_release_before_later_inserted_old_post(self):
        import signals
        from datetime import datetime, timezone
        with tempfile.TemporaryDirectory() as tmp:
            with posts.connect(Path(tmp)/'db') as db:
                signals.schema(db)
                for post_id, published in [('123', '2026-09-28T09:00:00Z'), ('124', '2026-09-27T09:00:00Z')]:
                    db.execute("INSERT INTO signal_events(source_id,url,sha,title,tickers_json,matches_json,event_kind,published_at,observed_at,excerpt,diff,truncated) VALUES('x-nebius-official',?,'hash','Official update','[\"NBIS\"]','{}','baseline',?,'2026-09-28T09:01:00Z','','',0)", ('https://x.com/nebiusai/status/'+post_id,published))
                db.commit()
                items=signals.public_official_updates(db,reference=datetime(2026,9,28,10,tzinfo=timezone.utc))
                self.assertTrue(items[0]['url'].endswith('/123'))
