"""Actual retained text and bounded cross-sentence buyback scope regressions."""
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import buyback_news as buyback
import buyback_recap
import general_source_news as news
import official_research as research
import signals
from test_headline_translation import ENV

RAW=json.loads((Path(__file__).parent/'fixtures/trendspider-buyback-retained.json').read_text())
NOW=datetime(2026,10,4,3,2,tzinfo=timezone.utc)
SOURCE=next(s for s in signals.SOURCES if s['id']=='x-trendspider')
FACT={'ja':'NVIDIAは前四半期に$20B弱の自社株を買い戻し、金額はフリーキャッシュフローの約92%に相当した。',
      'en':'During the previous quarter, NVIDIA bought back nearly $20B of its shares, an amount equivalent to about 92% of free cash flow.','evidenceId':'0'}
AUTH={'ja':'NVIDIAは自社株買い枠を$150B追加で承認し、残る承認枠は$235Bとなった。',
      'en':'NVIDIA approved another $150B in share repurchases, with $235B of authorization remaining.','evidenceId':'1'}
OFFICIAL={'id':'1101','url':'https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-a-150-Billion-Share-Repurchase-Authorization-Increase/default.aspx',
          'publisher':'NVIDIA IR','tickers':['NVDA'],'publishedOn':'2026-09-28',
          'bodyJa':'NVIDIAは自社株買い枠を1500億ドル追加し、残る承認枠は2350億ドルとなった。',
          'bodyEn':'NVIDIA’s board authorized an additional $150 billion for share repurchases, bringing the remaining authorization to $235 billion.'}

class BuybackContextTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'db.sqlite'
        with research.connect(self.path):pass

    def seed(self,body=RAW['body'],url=RAW['url'],account_source=SOURCE):
        item={'url':url,'title':' '.join(body.split())[:500],'text':body,
              'publishedAt':RAW['publishedAt'],'truncated':False,'matches':{'NVDA':['$NVDA']}}
        with research.connect(self.path) as db:signals.save(db,account_source,[item],{},RAW['firstSeenAt'],'synthetic',1)

    def row(self):
        self.seed()
        with research.connect(self.path) as db:return news.candidates(db,NOW)[0]

    def test_exact_retained_body_hash_spans_stage_and_qualifiers(self):
        self.assertEqual(len(RAW['body']),258)
        self.assertEqual(hashlib.sha256(RAW['body'].encode()).hexdigest(),RAW['bodySha'])
        row=self.row();self.assertEqual(row['body_sha'],RAW['bodySha']);self.assertEqual(row['sha'],RAW['sourceSha'])
        self.assertEqual(len(row['units']),2)
        for unit in row['units']:
            binding=unit['buyback']
            self.assertEqual(RAW['body'][binding['sourceStart']:binding['sourceEnd']],unit['quote'])
            self.assertIsNone(binding['eventDate'])
            self.assertEqual(binding['context'],'Nvidia $NVDA is betting big... on itself.')
        self.assertEqual([u['buyback']['status'] for u in row['units']],['executed','authorization'])
        for fact,unit in zip((FACT,AUTH),row['units']):news.validate_pair(fact,unit)
        self.assertNotIn('Jensen',json.dumps(news.evidence_excerpts(row)))
        self.assertNotIn('t.co',json.dumps(news.evidence_excerpts(row)))

    def test_competing_quoted_and_ambiguous_actors_never_inherit_header(self):
        cases=[
            'NVIDIA $NVDA and Acme in focus.\n\nNearly $20B repurchased last quarter.',
            'NVIDIA $NVDA says Acme is in focus.\n\nNearly $20B repurchased last quarter.',
            'NVIDIA $NVDA in focus.\n\nAcme repurchased $20B last quarter.',
            'NVIDIA $NVDA in focus.\n\nThe company praised Acme after it repurchased $20B last quarter.',
            'NVIDIA $NVDA in focus.\n\nIt watched while Acme repurchased $20B last quarter.',
            'NVIDIA $NVDA in focus.\n\nNearly $20B repurchased by Acme last quarter.',
            'NVIDIA $NVDA in focus.\n\n"Nearly $20B repurchased last quarter," said Acme.',
            'NVIDIA $NVDA in focus.\n\nNearly $20B repurchased last quarter. Acme approved another $5B.',
            'NVIDIA $NVDA in focus.\n\nApple $AAPL is the subject below.\n\nNearly $20B repurchased last quarter.',
            'NVIDIA $NVDA in focus.\n\nAn unrelated update follows.\n\nNearly $20B repurchased last quarter.',
            'NVIDIA $NVDA in focus.\n\nNearly $20B of bonds repurchased last quarter.',
            'NVIDIA $NVDA in focus.\n\nIt repurchased $20B and ACME repurchased $30B last quarter.',
            'NVIDIA $NVDA in focus.\n\nIt repurchased $20B and acme repurchased $30B last quarter.',
            'NVIDIA $NVDA in focus.\n\nNearly $20B repurchased last quarter, but ACME approved $30B.',
        ]
        for body in cases:
            with self.subTest(body=body):self.assertIsNone(buyback.prepare(body,'NVDA',signals.ALIASES['NVDA'])[0])
        self.seed(RAW['body'].replace('Nearly','Apple $AAPL: Nearly'))
        with research.connect(self.path) as db:self.assertEqual(news.candidates(db,NOW),[])

    def test_sentence_or_paragraph_layout_preserves_literal_claim_spans(self):
        for body in (RAW['body'].replace('\n\n',' '),RAW['body'].replace('\n\n','\n\n  ')):
            units,reason=buyback.prepare(body,'NVDA',signals.ALIASES['NVDA'])
            self.assertEqual(reason,'eligible-buyback-recap');self.assertEqual(len(units),2)
            for unit in units:
                scope=unit['buyback']
                self.assertEqual(body[scope['sourceStart']:scope['sourceEnd']],unit['quote'])

    def test_direct_subject_continuation_is_generic_without_official_confirmation(self):
        body='NVIDIA $NVDA buyback update.\n\nIt approved an additional $4 billion in share repurchases.'
        units,reason=buyback.prepare(body,'NVDA',signals.ALIASES['NVDA'])
        self.assertEqual(reason,'eligible-buyback');self.assertEqual(len(units),1)
        self.assertEqual(units[0]['buyback']['status'],'authorization')
        self.assertFalse(units[0]['buyback']['historical'])

    def test_period_qualifier_and_cashflow_basis_cannot_shift(self):
        unit=self.row()['units'][0]
        cases=[('en',FACT['en'].replace('nearly ','').replace('about ','')),
               ('en',FACT['en'].replace('nearly','about')),
               ('ja',FACT['ja'].replace('$20B弱','$20B').replace('約92%','92%')),
               ('ja',FACT['ja'].replace('$20B弱','約$20B')),
               ('en',FACT['en'].replace('previous quarter','last year')),
               ('ja',FACT['ja'].replace('前四半期','昨年')),
               ('ja',FACT['ja'].replace('前四半期','過去')),
               ('en',FACT['en'].replace('free cash flow','revenue')),
               ('ja',FACT['ja'].replace('フリーキャッシュフロー','売上高')),
               ('en',FACT['en'].replace('bought back','authorized'))]
        for lang,text in cases:
            with self.subTest(text=text),self.assertRaises(ValueError):news.validate_pair({**FACT,lang:text},unit)

    def test_existing_authorization_is_context_not_another_fresh_fact(self):
        row=self.row()
        related,reason=buyback_recap.relate(row,[OFFICIAL])
        self.assertEqual(reason,'eligible-buyback-recap')
        self.assertEqual(len(related['units']),2)
        self.assertEqual(related['units'][0]['buyback']['status'],'executed')
        self.assertEqual(related['related_authorizations'][0]['id'],'1101')
        note,_=news.bind_assessment({'disposition':'publish','reason':'material-company-development','facts':[FACT,AUTH]},related)
        item=news.public_item(related,note)
        self.assertEqual(item['publishedAt'],RAW['publishedAt']);self.assertNotIn('publishedOn',item)
        self.assertIn('recap',item['title']);self.assertIn('振り返り',item['translationJa'])
        self.assertIn('2026-09-28',item['bodyEn']);self.assertNotIn('$150B',item['bodyEn'])
        self.assertIn('previous quarter',item['bodyEn']);self.assertIn('前四半期',item['bodyJa'])
        # No issuer evidence is a prerequisite for X reporting.
        unlinked,_=buyback_recap.relate(row,[])
        self.assertEqual(len(unlinked['units']),2)
        news.bind_assessment({'disposition':'publish','reason':'material-company-development','facts':[FACT,AUTH]},unlinked)
        for changed in ({**OFFICIAL,'tickers':['AAPL']},{**OFFICIAL,'publishedOn':'2026-10-04'},
                        {**OFFICIAL,'bodyEn':OFFICIAL['bodyEn'].replace('$235','$250')},
                        {**OFFICIAL,'bodyEn':OFFICIAL['bodyEn'].replace('additional','total')},
                        {**OFFICIAL,'bodyJa':''},
                        {**OFFICIAL,'bodyEn':OFFICIAL['bodyEn'].replace('authorized','plans to seek approval for')},
                        {**OFFICIAL,'bodyEn':OFFICIAL['bodyEn']+' The authorization was later revoked.'},
                        {**OFFICIAL,'publishedOn':'2026-10-03'},
                        {**OFFICIAL,'publishedOn':'2026-10-03','publishedAt':'2026-10-03T23:59:00Z'}):
            self.assertEqual(len(buyback_recap.relate(row,[changed])[0]['units']),2)
        competing={**OFFICIAL,'id':'987','publishedOn':'2026-10-01'}
        self.assertEqual(len(buyback_recap.relate(row,[OFFICIAL,competing])[0]['units']),2)

    def test_late_official_context_does_not_change_saved_evidence_shape(self):
        row=self.row()
        note,_=news.bind_assessment({'disposition':'publish','reason':'material-company-development','facts':[FACT,AUTH]},row)
        related,_=buyback_recap.relate(row,[OFFICIAL])
        self.assertEqual(related['units'],row['units'])
        news.validate_note(note,related)
        self.assertIn('$150B',news.public_item(row,note)['bodyEn'])
        self.assertNotIn('$150B',news.public_item(related,note)['bodyEn'])
        other={**OFFICIAL,'bodyEn':OFFICIAL['bodyEn'].replace('NVIDIA’s board authorized','NVIDIA said Acme authorized')}
        self.assertNotIn('related_authorizations',buyback_recap.relate(row,[other])[0])

    def test_historical_authorization_already_covered_needs_no_assessment(self):
        row=self.row()
        authorization={**row['units'][1],'id':'0','buyback':{**row['units'][1]['buyback'],'historical':True}}
        duplicate={**row,'units':[authorization]}
        selected,reason=buyback_recap.relate(duplicate,[OFFICIAL])
        self.assertIsNone(selected);self.assertEqual(reason,'covered-buyback-authorization')
        self.assertIsNotNone(buyback_recap.relate(duplicate,[])[0])

    def test_identical_recap_reposts_share_one_candidate_and_authorization_context(self):
        self.seed()
        grouped=next(s for s in signals.SOURCES if s['id']=='x-wallstengine')
        self.seed(url='https://x.com/TipRanks/status/2106523440635363386',account_source=grouped)
        with patch.object(buyback_recap,'published_context',return_value=[OFFICIAL]):
            with research.connect(self.path) as db:
                self.assertEqual(len(list(news.assessments(db,NOW))),2)
                rows=news.candidates(db,NOW)
                self.assertEqual(len(rows),1)
                self.assertEqual(rows[0]['related_authorizations'][0]['id'],'1101')

    def test_related_context_uses_metadata_and_never_validates_unrelated_articles(self):
        self.seed()
        with research.connect(self.path) as db:
            event=db.execute('SELECT id,url FROM signal_events').fetchone()
            buyback_item={**OFFICIAL,'id':str(event['id']),'url':event['url'],
                          'title':'NVIDIA announces a share repurchase authorization increase'}
            unrelated={**buyback_item,'id':'9999','url':'https://example.com/product',
                       'title':'NVIDIA introduces a new GPU product'}
            before=db.total_changes
            db.execute('PRAGMA query_only=ON')
            # The service suite replaces sys.modules['signals'] on import;
            # patch the same current module as the helper's lazy import.
            with patch.object(sys.modules['signals'],'public_official_updates',return_value=[unrelated,buyback_item]) as metadata,patch.object(research,'public_story_body',return_value={'bodyJa':OFFICIAL['bodyJa'],'bodyEn':OFFICIAL['bodyEn']}) as bodies:
                items=buyback_recap.published_context(db,NOW)
            self.assertEqual(len(items),1);self.assertEqual(bodies.call_count,1)
            self.assertEqual(bodies.call_args.args[1]['id'],event['id'])
            self.assertFalse(metadata.call_args.kwargs['include_bodies'])
            self.assertTrue(metadata.call_args.kwargs['read_only'])
            self.assertIsNot(metadata.call_args.kwargs['sources'],signals.SOURCES)
            self.assertEqual(db.total_changes,before);self.assertFalse(db.in_transaction)

    def test_second_claim_cannot_assert_future_event_or_borrow_past_clock(self):
        body=RAW['body'].replace('Another $150B just authorized.','Another $150B just authorized on 2026-10-05.')
        self.seed(body)
        with research.connect(self.path) as db:
            records=list(news.assessments(db,NOW))
            self.assertIsNone(records[0][1]);self.assertEqual(records[0][2],'invalid-source-clock')

    def test_recap_enters_existing_single_call_budget_and_preserves_report_clock(self):
        self.seed()
        def response(payload,key):
            context=json.loads(payload['input'])['evidenceContext']['0']['buyback']
            self.assertTrue(context['historical']);self.assertEqual(context['status'],'executed')
            self.assertIn('Nvidia $NVDA',context['context'])
            return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(
                {'disposition':'publish','reason':'material-company-development','facts':[FACT,AUTH]})}]}]}
        with patch.object(buyback_recap,'published_context',return_value=[OFFICIAL]),patch.object(research,'prepare_story_body',return_value='idle'),patch.object(research,'datetime') as clock,patch.object(news,'datetime') as newsclock:
            clock.fromtimestamp.side_effect=datetime.fromtimestamp;clock.now.return_value=NOW
            newsclock.now.return_value=NOW;newsclock.max=datetime.max
            result=research.run_once(self.path,response,{**ENV,'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT':'200'},NOW.timestamp())
            self.assertEqual(result,'done')
            with research.connect(self.path) as db:
                item=news.public_items(db,NOW)[0]
                self.assertEqual(item['publishedAt'],RAW['publishedAt'])
                self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
                self.assertIn('約92%',item['bodyJa'])
            # A source correction revokes the result through the existing head guard.
            self.seed('Correction: NVIDIA $NVDA did not repurchase the stated amount of shares.')
            with research.connect(self.path) as db:self.assertEqual(news.public_items(db,NOW),[])

if __name__=='__main__':unittest.main()
