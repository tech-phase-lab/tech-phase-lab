"""Offline distributor-to-semantic-publisher source contract tests."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime,timedelta,timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import issuer_business_news as news
import issuer_syndication as issuer
import official_research as research
import signals
from test_issuer_syndication import markup,SOURCE,NOW,PUBLISHED,OBSERVED
from test_official_research import NOTE,QUOTES,response
from test_headline_translation import ENV

TITLE='Nebius Acquires Inferize to Expand Inference Capacity'
URL='https://www.globenewswire.com/news-release/2026/09/30/9876543/0/en/nebius-acquires-inferize.html'
BODY='\n'.join(QUOTES)+'\n'+('Nebius provided background about its operations and inference services. '*14)

class IssuerBusinessNewsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'db.sqlite'
        with research.connect(self.path) as db:
            issuer.schema(db)
            signals.save(db,SOURCE,[{'url':URL,'title':TITLE,'text':TITLE,'matches':{'NBIS':['Nebius']},'publishedAt':PUBLISHED,'truncated':False}],{},OBSERVED,'fixture',1)
    def prepare(self):
        return issuer.run_once(self.path,NOW,request=lambda *_:{'body':markup(BODY,TITLE,URL,'Nebius'), 'etag':'fixture'})
    def run_note(self,transport=response):
        with patch.object(research,'prepare_story_body',return_value='idle'), patch.object(research,'datetime') as clock:
            clock.fromtimestamp.side_effect=datetime.fromtimestamp
            clock.now.return_value=NOW
            return research.run_once(self.path,transport,ENV,NOW.timestamp())
    def feed(self):
        with research.connect(self.path) as db:return signals.public_official_updates(db,reference=NOW)
    def test_verified_body_uses_existing_bounded_semantic_publisher(self):
        self.assertEqual(self.prepare(),'unsupported-facts')
        with research.connect(self.path) as db:
            self.assertEqual(len(news.candidates(db,NOW)),1)
        self.assertEqual(self.run_note(),'done')
        item=self.feed()[0]
        self.assertEqual(item['syndication']['policy'],news.POLICY)
        self.assertEqual(item['title'],TITLE);self.assertEqual(item['tickers'],['NBIS'])
        self.assertEqual(item['publishedAt'],PUBLISHED);self.assertEqual(item['observedAt'],OBSERVED)
        self.assertEqual(item['publisher'],'Nebius / GlobeNewswire')
        self.assertNotIn('evidenceQuote',json.dumps(item))
        self.assertEqual(self.run_note(lambda *_:self.fail('duplicate publication')),'idle')
        with research.connect(self.path) as db:
            self.assertEqual(news.diagnostics(db,NOW)['published'],1)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
    def test_title_mention_without_verified_article_body_is_not_eligible(self):
        with research.connect(self.path) as db:
            self.assertEqual(news.candidates(db,NOW),[])
            self.assertEqual(news.diagnostics(db,NOW)['rejectionReasons'],{'awaiting-verified-body':1})
        self.assertEqual(self.run_note(lambda *_:self.fail('unverified issuer generation')),'idle')
    def test_published_semantic_body_keeps_refreshing_and_changed_body_revokes_copy(self):
        self.prepare();self.assertEqual(self.run_note(),'done')
        changed=BODY.replace('Inferize, an inference optimization company.','Inferize, an inference software business.')
        issuer.run_once(self.path,NOW+timedelta(seconds=3601),request=lambda *_:{'body':markup(changed,TITLE,URL,'Nebius')})
        with research.connect(self.path) as db:
            self.assertEqual(news.public_items(db,NOW+timedelta(seconds=3601)),[])
            self.assertEqual(len(news.candidates(db,NOW+timedelta(seconds=3601))),1)

    def test_tampered_metadata_body_and_current_revision_fail_closed(self):
        self.prepare();self.assertEqual(self.run_note(),'done')
        with research.connect(self.path) as db:
            db.execute("UPDATE issuer_syndication_bodies SET metadata=json_set(metadata,'$.issuer','Another Corp.')")
        self.assertEqual(self.feed(),[])
    def test_bound_source_title_prevents_expanding_host_to_generic_finance(self):
        with research.connect(self.path) as db:
            db.execute("UPDATE signal_events SET title='Finance Alert About NBIS'")
        self.assertEqual(self.prepare(),'idle')
        self.assertEqual(self.feed(),[])
if __name__=='__main__':unittest.main()
