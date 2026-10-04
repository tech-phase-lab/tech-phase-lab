"""Reuse only a complete current issuer collection, before feed extensions."""
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

import test_buyback_context as fixture
import buyback_recap
import general_source_news as news
import official_research as research
import signals
import issuer_syndication
import oracle_reviewed_recovery


class RequestBuybackContextTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'db.sqlite'
        self.source=next(source for source in signals.SOURCES if source['id']=='nvidia-developer')
        with research.connect(self.path) as db:
            self.normal=self.seed(db,0,'NVIDIA approves additional $150 billion share repurchase authorization',
                                  '2026-09-28T20:00:00Z')

    def seed(self,db,index,title,published='2026-10-03T20:00:00Z'):
        url=f'https://developer.nvidia.com/blog/context-fixture-{index}/'
        signals.save(db,self.source,[{'url':url,'title':title,'text':title,'truncated':False,
                                     'publishedAt':published,'matches':{'NVDA':['NVIDIA']}}],
                     {},published,'synthetic',1)
        return dict(db.execute('SELECT * FROM signal_events WHERE url=?',(url,)).fetchone())

    def projection(self,db,**kwargs):
        # The outer projector's body reader has already validated these values;
        # here the test isolates collection boundaries, not article validation.
        with patch.object(research,'public_story_body',return_value={'bodyJa':fixture.OFFICIAL['bodyJa'],'bodyEn':fixture.OFFICIAL['bodyEn']}),patch.object(news,'public_items',return_value=[]) as general:
            result=signals.public_official_updates(db,reference=fixture.NOW,read_only=True,**kwargs)
        return result,general.call_args.kwargs['authorization_context']

    def test_complete_body_projection_reuses_exact_independent_context(self):
        with research.connect(self.path) as db:
            _,context=self.projection(db,limit=500)
            with patch.object(research,'public_story_body',return_value={'bodyJa':fixture.OFFICIAL['bodyJa'],'bodyEn':fixture.OFFICIAL['bodyEn']}):
                expected=buyback_recap.published_context(db,fixture.NOW)
            self.assertEqual(context,expected)
            self.assertEqual([item['id'] for item in context],[str(self.normal['id'])])

    def test_first_100_boundary_does_not_admit_an_older_101st_authorization(self):
        with research.connect(self.path) as db:
            for index in range(1,102):self.seed(db,index,f'NVIDIA announces new GPU product update {index}')
            _,context=self.projection(db,limit=500)
            self.assertEqual(context,[])
            with patch.object(research,'public_story_body',side_effect=AssertionError('older body outside top100')):
                self.assertEqual(buyback_recap.published_context(db,fixture.NOW),context)

    def test_incomplete_or_metadata_only_projection_keeps_independent_lookup(self):
        with research.connect(self.path) as db:
            self.seed(db,1,'NVIDIA announces new GPU product')
            self.assertIsNone(self.projection(db,limit=1)[1])
            self.assertIsNone(self.projection(db,limit=500,include_bodies=False)[1])

    def test_injected_and_syndicated_records_do_not_enter_issuer_context(self):
        publisher=oracle_reviewed_recovery.publisher()
        injected={**self.normal,'id':99999,'source_id':publisher['id'],
                  'url':'https://'+publisher['allowedHosts'][0]+'/news-releases/context-fixture.html',
                  'title':'Oracle approves additional share repurchase authorization',
                  'tickers_json':json.dumps(['ORCL'])}
        syndicated={**fixture.OFFICIAL,'id':'88888','title':'NVIDIA announces share buyback',
                    'url':'https://example.com/syndicated','publishedAt':'2026-10-03T22:00:00Z','observedAt':'2026-10-03T22:00:00Z'}
        with research.connect(self.path) as db:
            with patch.object(oracle_reviewed_recovery,'public_event',return_value=injected),patch.object(issuer_syndication,'public_items',return_value=[syndicated]):
                _,context=self.projection(db,limit=500)
            self.assertEqual([item['id'] for item in context],[str(self.normal['id'])])
            # Any source-ID or URL collision falls back rather than inferring
            # that the injected exception preserved ordinary eligibility/order.
            for changed in ({**injected,'source_id':self.source['id']},
                            {**injected,'url':self.normal['url']}):
                with patch.object(oracle_reviewed_recovery,'public_event',return_value=changed):
                    self.assertIsNone(self.projection(db,limit=500)[1])


if __name__=='__main__':unittest.main()
