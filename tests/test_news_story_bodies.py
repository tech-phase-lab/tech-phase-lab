import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from urllib.error import HTTPError
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import official_research as research
import signals
from test_headline_translation import ENV

NOW=datetime(2026,10,2,13,0,tzinfo=timezone.utc)
SOURCE=next(s for s in signals.SOURCES if s['id']=='nvidia-developer')
URL='https://developer.nvidia.com/blog/announcing-a-new-platform/'
QUOTES=['NVIDIA announced a new platform for developers building local AI applications.',
        'The platform supports local testing before developers deploy applications.',
        'The developer tools help teams build applications on their own computers.']
BODY=' '.join(QUOTES)
def copy(ja,en,quote): return {'ja':ja,'en':en,'evidenceQuote':quote}
NOTE={'title':copy('NVIDIAが新しい開発基盤を発表','NVIDIA announces a new developer platform',QUOTES[0]),
      'summary':copy('ローカルAIアプリ向けの開発基盤を発表した。','NVIDIA announced a platform for local AI applications.',QUOTES[0]),
      'facts':[copy('開発者向けの基盤を発表した。','NVIDIA announced a developer platform.',QUOTES[0]),
               copy('展開前にローカルでテストできる。','The platform supports local testing before deployment.',QUOTES[1]),
               copy('開発チームが自身のコンピューターでアプリを構築するのを支援する。','The tools help teams build applications on their own computers.',QUOTES[2])],
      'purpose':copy('ローカルAIアプリ開発を支援する。','The platform supports local AI development.',QUOTES[0])}
class NewsStoryBodyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'db.sqlite'
        self.item={'url':URL,'title':'NVIDIA announces a new developer platform','text':'Short feed introduction only.',
                   'matches':{'NVDA':['publisher-company']},'publishedAt':NOW.isoformat(),'truncated':False}
        with research.connect(self.path) as db:
            signals.save(db,SOURCE,[self.item],{},NOW.isoformat(),'synthetic',1)
    def test_full_article_evidence_reaches_inline_bilingual_body_without_raw_source(self):
        calls=[]
        def request(source,validators):
            calls.append(source)
            return {'body':('<nav>PRIVATE-NAV</nav><article><h1>'+self.item['title']+'</h1><p>'+BODY+'</p></article>').encode()}
        self.assertEqual(research.prepare_story_body(self.path,NOW,request),'ready')
        self.assertEqual(calls[0]['url'],URL)
        with research.connect(self.path) as db:
            self.assertNotIn('PRIVATE-NAV',db.execute('SELECT body FROM official_story_bodies').fetchone()[0])
            self.assertNotIn('bodyJa',signals.public_official_updates(db,reference=NOW)[0])
        def response(*args):return {'status':'completed','output_text':json.dumps(NOTE)}
        with patch.object(signals,'fetch',side_effect=AssertionError('unexpected request')):
            self.assertEqual(research.run_once(self.path,response,ENV,NOW.timestamp()),'done')
        with research.connect(self.path) as db:
            news=signals.public_official_updates(db,reference=NOW)[0]
            self.assertIn(NOTE['facts'][1]['ja'],news['bodyJa'])
            self.assertIn(NOTE['facts'][1]['en'],news['bodyEn'])
            self.assertNotIn('evidenceQuote',json.dumps(news))
            self.assertNotIn(BODY,json.dumps(news))
            self.assertEqual(research.feed(db,NOW),[])
        def temporarily_unavailable(*args): raise HTTPError(URL,503,'Unavailable',{},None)
        later=NOW+timedelta(minutes=16)
        self.assertEqual(research.prepare_story_body(self.path,later,temporarily_unavailable),'retry')
        with research.connect(self.path) as db:
            self.assertIn(NOTE['facts'][1]['ja'],signals.public_official_updates(db,reference=later)[0]['bodyJa'])
            signals.save(db,SOURCE,[{**self.item,'text':'Changed source revision'}],{},NOW.isoformat(),'synthetic',1)
            self.assertNotIn('bodyJa',signals.public_official_updates(db,reference=NOW)[0])
    def test_access_error_preserves_headline_and_schedules_body_retry(self):
        def blocked(*args):raise HTTPError(URL,403,'Forbidden',{},None)
        self.assertEqual(research.prepare_story_body(self.path,NOW,blocked),'retry')
        self.assertEqual(research.prepare_story_body(self.path,NOW,lambda *_:self.fail('retried too early')),'idle')
        with research.connect(self.path) as db:
            self.assertEqual(len(signals.public_official_updates(db,reference=NOW)),1)
            self.assertGreater(db.execute('SELECT next_at FROM official_story_bodies').fetchone()[0],NOW.timestamp())
