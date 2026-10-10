import json
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import editorial_posts as posts
import note_translation as translation
from test_editorial_posts import draft,review
from test_note_translation import ENV

class WeeklyTranslationTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.path=Path(self.tmp.name)/'weekly.sqlite'
  with posts.connect(self.path) as db:self.item=posts.save(db,{**draft(),'titleEn':'','introEn':'','bodyEn':''})['item']
 def response(self,payload,key):
  self.assertEqual(set(json.loads(payload['input'])),{'titleJa','introJa','bodyJa'})
  return {'status':'completed','output_text':json.dumps({'titleEn':'Weekly review','introEn':'This week in brief.','bodyEn':'## News\nReviewed report.'})}
 def test_translation_stays_private_until_reviewed(self):
  self.assertEqual(translation.run_once(self.path,self.response,ENV,now=1000),'done')
  with posts.connect(self.path) as db:
   item=posts.queue(db)['items'][0];self.assertEqual(item['status'],'draft');self.assertEqual(posts.queue(db,published=True)['items'],[])
   self.assertEqual(item['titleEn'],'Weekly review');self.assertEqual(item['bodyJa'],self.item['bodyJa'])
   with self.assertRaises(ValueError):posts.review(db,{**review(item),'verified':False})
   self.assertEqual(posts.review(db,review(item))['item']['status'],'published')
 def test_changed_japanese_invalidates_all_english(self):
  translation.run_once(self.path,self.response,ENV,now=1000)
  with posts.connect(self.path) as db:
   item=posts.queue(db)['items'][0];item=posts.save(db,{**item,'introJa':'新しい要点'})['item']
   for field in ('titleEn','introEn','bodyEn'):self.assertEqual(item[field],'')
   with self.assertRaises(ValueError):posts.review(db,review(item))
 def test_edit_during_translation_discards_old_revision(self):
  def changed(payload,key):
   with posts.connect(self.path) as db:posts.save(db,{**self.item,'bodyJa':'修正された本文'})
   return self.response(payload,key)
  self.assertEqual(translation.run_once(self.path,changed,ENV,now=1000),'stale')
  with posts.connect(self.path) as db:self.assertEqual(posts.queue(db)['items'][0]['bodyEn'],'')
