"""Offline buyback intake, meaning, clocks and shared publisher regression tests."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import re
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import buyback_news as buyback
import general_source_news as news
import official_research as research
import signals
import x_api
from test_headline_translation import ENV

NOW=datetime(2026,10,4,0,20,tzinfo=timezone.utc)
SOURCE=next(s for s in signals.SOURCES if s['id']=='x-trendspider')
AUTH='NVIDIA $NVDA authorized an additional $150 billion for share repurchases.'
FACT={'ja':'NVIDIAは自社株買いの追加枠$150 billion を承認した。',
      'en':'NVIDIA has approved $150 billion in additional share buyback authority.','evidenceId':'0'}
RECAP='''Nvidia $NVDA is betting big... on itself.

Nearly $20B repurchased last quarter, equivalent to ~92% of free cash flow.

Another $150B just authorized. $235B in remaining capacity.

Jensen is not playing around.'''

class BuybackTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'db.sqlite'
        with research.connect(self.path):pass

    def seed(self,body=AUTH,source=SOURCE,account='TrendSpider',number=1,published='2026-10-03T23:15:00Z',observed='2026-10-03T23:15:01Z'):
        item={'url':f'https://x.com/{account}/status/{number}','title':' '.join(body.split())[:500],
              'text':body,'publishedAt':published,'truncated':False,'matches':{'NVDA':['$NVDA']}}
        with research.connect(self.path) as db:signals.save(db,source,[item],{},observed,'synthetic',1)
        return item

    def test_intake_words_do_not_grant_publication_and_index_scope_survives(self):
        texts=[AUTH,RECAP,'NVIDIA $NVDAは自社株買いの追加枠$150 billion を承認した。',
               '$NVDA has historical quarterly buybacks on this chart.',
               'S&P 500 rebalance: additions $VYLR $TWLO; removals $CTVA $WDB',
               'NVIDIA $NVDA launched a new GPU product for customers.',
               'Buyback chart of an unrelated unmonitored company.']
        payload={'includes':{'users':[{'id':'1','username':'TrendSpider'}]},'data':[
            {'id':str(i+1),'author_id':'1','text':text,'created_at':'2026-10-03T23:15:00Z'} for i,text in enumerate(texts)]}
        parsed=x_api.parse_response(SOURCE,payload,list(signals.ALIASES))
        self.assertEqual([x['text'] for x in parsed],texts[:5])
        self.assertIn('NVDA',parsed[0]['matches'])
        self.assertEqual(parsed[4]['matches'],{'MARKET':['index-membership']})
        self.assertEqual(signals.x_content_kind(SOURCE,AUTH),'share-buyback')
        self.seed(RECAP)
        with research.connect(self.path) as db:
            rows=news.candidates(db,NOW)
            self.assertEqual(len(rows),1)
            self.assertTrue(rows[0]['units'][0]['buyback']['historical'])
            self.assertEqual(news.public_items(db,NOW),[])

    def test_fresh_action_requires_company_binding_status_and_amount(self):
        cases=[('NVIDIA $NVDA authorized a new $4 billion share repurchase program.',True),
               ('NVIDIA authorized a new $4 billion share repurchase program.',True),
               ('NVIDIA $NVDA repurchased 94 million shares for $19.7 billion in Q2 FY2027.',True),
               ('NVIDIA $NVDA plans $4 billion in share buybacks.',True),
               ('NVIDIA $NVDA quarterly buybacks reached $19.7 billion last quarter.',False),
               ('NVIDIA $NVDA share buyback history and chart.',False),
               ('NVIDIA $NVDA authorized a share buyback program.',False),
               ('Somebody authorized a $4 billion share buyback. NVIDIA $NVDA is unrelated.',False),
               ('NVIDIA $NVDA is worth $4 billion. Buybacks are interesting.',False),
               ('NVIDIA $NVDA says Acme authorized a $4 billion share repurchase.',False),
               ('NVIDIA $NVDA authorized a $4 billion debt buyback.',False)]
        for body,eligible in cases:
            units,_=buyback.prepare(body,'NVDA',signals.ALIASES['NVDA'])
            self.assertEqual(bool(units),eligible,body)

    def test_authorization_is_not_execution_and_amount_roles_cannot_swap(self):
        buyback.validate(FACT,AUTH,required=True)
        for fact in [
            {**FACT,'ja':'NVIDIAは$150 billionの自己株式を取得した。'},
            {**FACT,'en':'NVIDIA repurchased $150 billion of its shares.'},
            {**FACT,'en':'NVIDIA has $150 billion in remaining share repurchase authorization.'},
            {**FACT,'ja':'NVIDIAの自社株買いの残額は$150 billion。'},
            {**FACT,'en':'NVIDIA authorized EUR150 billion for share repurchases.'},
        ]:
            with self.subTest(fact=fact),self.assertRaises(ValueError):buyback.validate(fact,AUTH,required=True)

    def test_source_and_event_dates_are_distinct_and_future_event_is_rejected(self):
        body=AUTH.replace('authorized','on September 28, 2026 authorized')
        self.seed(body)
        with research.connect(self.path) as db:row=news.candidates(db,NOW)[0]
        self.assertEqual(row['units'][0]['buyback']['eventDate'],'2026-09-28')
        item=news.public_item(row,{'facts':[{'ja':'dummy','en':'dummy'}]})
        self.assertEqual(item['publishedOn'],'2026-09-28')
        self.assertEqual(item['sourcePublishedAt'],'2026-10-03T23:15:00Z')
        self.assertNotIn('publishedAt',item)
        self.seed(AUTH.replace('authorized','on October 5, 2026 authorized'),number=2)
        with research.connect(self.path) as db:self.assertEqual(len(news.candidates(db,NOW)),1)

    def test_same_dated_action_deduplicates_and_retains_earliest_clocks(self):
        body=AUTH.replace('authorized','on September 28, 2026 authorized')
        self.seed(body)
        grouped=next(s for s in signals.SOURCES if s['id']=='x-wallstengine')
        self.seed(body.replace('authorized an additional','approved an additional'),source=grouped,
                  account='TipRanks',number=2,observed='2026-10-03T23:16:00Z')
        with research.connect(self.path) as db:
            self.assertEqual(len(list(news.assessments(db,NOW))),2)
            self.assertEqual(len(news.candidates(db,NOW)),1)
            self.assertEqual(news.candidates(db,NOW)[0]['observed_at'],'2026-10-03T23:15:01Z')

    def test_generic_publisher_uses_existing_single_call_budget_and_rechecks_revision(self):
        self.seed()
        def response(payload,key):
            self.assertIn('Buyback evidence',payload['instructions'])
            self.assertEqual(payload['max_output_tokens'],2400)
            self.assertIn('buyback',json.loads(payload['input'])['evidenceContext']['0'])
            value={'disposition':'publish','reason':'material-company-development','facts':[FACT]}
            return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(value)}]}]}
        with patch.object(research,'prepare_story_body',return_value='idle'),patch.object(research,'datetime') as clock,patch.object(news,'datetime') as newsclock:
            clock.fromtimestamp.side_effect=datetime.fromtimestamp;clock.now.return_value=NOW
            newsclock.now.return_value=NOW;newsclock.max=datetime.max
            result=research.run_once(self.path,response,{**ENV,'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT':'200'},NOW.timestamp())
        self.assertEqual(result,'done')
        with research.connect(self.path) as db:
            item=news.public_items(db,NOW)[0]
            self.assertIn('自社株買い',item['bodyJa']);self.assertIn('buyback authority',item['bodyEn'])
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
        self.seed('Correction: NVIDIA $NVDA did not authorize this share repurchase program.',observed=NOW.isoformat())
        with research.connect(self.path) as db:self.assertEqual(news.public_items(db,NOW),[])

    def test_executed_shares_money_and_program_period_are_not_interchangeable(self):
        quote='NVIDIA $NVDA repurchased 94 million shares for $19.7 billion in Q2 FY2027.'
        good={'ja':'NVIDIAはQ2 FY2027に自己株式94 million 株を$19.7 billion で買い戻した。',
              'en':'In Q2 FY2027, NVIDIA bought back 94 million shares for $19.7 billion.'}
        buyback.validate(good,quote,required=True)
        for lang,text in [
            ('en','NVIDIA approved 94 million shares for $19.7 billion in Q2 FY2027.'),
            ('en','NVIDIA repurchased $94 million shares for 19.7 billion shares in Q2 FY2027.'),
            ('ja','NVIDIAはQ2 2027に自己株式94 million 株を$19.7 billion で買い戻した。'),
        ]:
            with self.subTest(lang=lang,text=text),self.assertRaises(ValueError):
                buyback.validate({**good,lang:text},quote,required=True)

    def test_primary_release_increment_and_remaining_amount_keep_separate_roles(self):
        quote=('NVIDIA today announced that its Board of Directors has authorized an additional '
               '$150 billion under the company’s existing share repurchase program, increasing '
               'the total remaining amount authorized to $235 billion.')
        copy={'en':'NVIDIA approved another $150 billion in share repurchases, with $235 billion of remaining authorization.',
              'ja':'NVIDIAは自社株買い枠を追加で$150 billion 承認し、残額は$235 billion となった。'}
        buyback.validate(copy,quote,required=True)
        self.assertEqual(len(buyback.roles(quote,'en')),2)
        for lang in ('ja','en'):
            changed=copy[lang].replace('$150','$999').replace('$235','$150').replace('$999','$235')
            with self.subTest(lang=lang),self.assertRaises(ValueError):
                buyback.validate({**copy,lang:changed},quote,required=True)

    def test_reviewed_japanese_remaining_authorization_preserves_both_amount_roles(self):
        quote=('NVIDIA today announced that its Board of Directors has authorized an additional '
               '$150 billion under the company’s existing share repurchase program, increasing '
               'the total remaining amount authorized to $235 billion.')
        copy={'ja':'NVIDIA取締役会は自社株買い承認枠を1500億ドル追加し、残る承認枠は2350億ドルとなった。',
              'en':'NVIDIA’s board authorized an additional $150 billion for share repurchases, bringing the remaining authorization to $235 billion.'}
        buyback.validate(copy,quote,required=True)
        for remaining in ('残る承認枠','残る取得枠','残りの承認枠','残存承認枠','残額'):
            buyback.validate({**copy,'ja':copy['ja'].replace('残る承認枠',remaining)},quote,required=True)
        for changed in (
            copy['ja'].replace('1500','9999').replace('2350','1500').replace('9999','2350'),
            copy['ja'].replace('残る承認枠','追加の承認枠'),
            copy['ja'].replace('1500億ドル追加','2350億ドル追加'),
            copy['ja'].replace('残る承認枠は2350億ドル','残る承認枠は1500億ドル'),
        ):
            with self.subTest(changed=changed),self.assertRaises(ValueError):
                buyback.validate({**copy,'ja':changed},quote,required=True)

    def test_exact_requested_post_matches_explicit_query_literal_but_stays_historical(self):
        # Conservative literal coverage of this OR clause, not an X search emulator.
        # No stemming, quoted-post indexing, image text or undocumented behavior.
        clause=SOURCE['query'].split(' OR (buyback OR ',1)[1].rsplit(')) -is:retweet -is:reply',1)[0]
        terms=['buyback',*[part.strip('"') for part in clause.split(' OR ')]]
        def matches(body,term):
            boundary=r'(?<!\w)'+re.escape(term)+r'(?!\w)' if term.isascii() else re.escape(term)
            return bool(re.search(boundary,body,re.I))
        old_terms=('buyback','buybacks','share repurchase','stock repurchase','自社株買い','自己株式取得')
        self.assertFalse(any(matches(RECAP,term) for term in old_terms))
        self.assertEqual([term for term in terms if matches(RECAP,term)],['repurchased'])
        payload={'includes':{'users':[{'id':'1','username':'TrendSpider'}]},'data':[
            {'id':'2106523440635363385','author_id':'1','text':RECAP,'created_at':'2026-10-03T23:15:00.217Z'}]}
        parsed=x_api.parse_response(SOURCE,payload,list(signals.ALIASES))
        self.assertEqual([row['text'] for row in parsed],[RECAP])
        self.seed(RECAP,number=2106523440635363385,published='2026-10-03T23:15:00.217Z')
        with research.connect(self.path) as db:
            rows=news.candidates(db,NOW)
            self.assertEqual(len(rows),1)
            self.assertTrue(rows[0]['units'][0]['buyback']['historical'])
            self.assertEqual(news.public_items(db,NOW),[])
        for variant in ('repurchase','repurchases','repurchased','repurchasing'):
            with self.subTest(variant=variant):
                self.assertIn(variant,terms)
                self.assertTrue(any(matches(f'NVIDIA $NVDA {variant} its shares.',term) for term in terms))
        for phrase in ('bought back','buy back','buying back','自社株買い','自己株式取得'):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase,terms)
                self.assertTrue(any(matches(f'NVIDIA $NVDA {phrase}.',term) for term in terms))
                self.assertTrue(buyback.CUE.search(f'NVIDIA $NVDA {phrase}.'))
        # The compact replacement keeps both prior quoted phrases through their
        # explicit shared token; it does not assume inflection or stemming.
        for phrase in ('share repurchase','stock repurchase'):
            self.assertTrue(matches(phrase,'repurchase'))
            self.assertTrue(any(matches(phrase,term) for term in terms))
        self.assertFalse(any(matches('NVIDIA $NVDA repurchasedish chart.',term) for term in terms))

    def test_back_phrases_still_require_share_action_amount_and_stage(self):
        cases=[('NVIDIA $NVDA bought back 3 million shares for $4 billion.',True),
               ('NVIDIA $NVDA plans to buy back $4 billion of shares.',True),
               ('NVIDIA $NVDA approved buying back $4 billion of shares.',True),
               ('NVIDIA $NVDA is buying back $4 billion of shares.',False),
               ('NVIDIA $NVDA plans to buy back $4 billion of bonds.',False),
               ('NVIDIA $NVDA buy back chart.',False),
               ('NVIDIA $NVDA plans to buy back shares.',False)]
        for body,eligible in cases:
            with self.subTest(body=body):
                self.assertTrue(buyback.CUE.search(body))
                units,_=buyback.prepare(body,'NVDA',signals.ALIASES['NVDA'])
                self.assertEqual(bool(units),eligible)

    def test_index_query_branch_and_filters_remain_exactly_preserved(self):
        index_branch=('from:TrendSpider ((("S&P 500" OR S&P500 OR SPX OR Nasdaq OR NDX) '
                      '(rebalance OR rebalancing OR reconstitution OR add OR added OR additions OR '
                      'removed OR removals OR join OR joins OR joining OR replace OR replaces OR '
                      'replacing OR inclusion OR exclusion OR deletions))')
        self.assertEqual(SOURCE['query'].split(' OR (buyback OR ',1)[0],index_branch)
        self.assertTrue(SOURCE['query'].endswith(')) -is:retweet -is:reply'))

    def test_queries_and_limits_preserve_approved_routes(self):
        active=[s for s in signals.SOURCES if s['format']=='x-api' and s.get('enabled') is not False]
        self.assertEqual(len(active),4)
        self.assertTrue(all(len(s['query'])<=512 and s['maxResults']==30 for s in active))
        self.assertEqual(SOURCE['intervalSeconds'],120)
        self.assertIn(' OR 自社株買い',SOURCE['query'])
        self.assertEqual(len(SOURCE['query']),440)
        for term in ('repurchase','repurchases','repurchased','repurchasing'):
            self.assertIn(f' OR {term} OR ',SOURCE['query'])
        grouped=next(s for s in active if s['id']=='x-wallstengine')
        self.assertEqual((len(grouped['query']),grouped['intervalSeconds']),(508,30))
        self.assertIn('from:FABYMETAL4 (',grouped['query'])
        self.assertIn('OR results OR',grouped['query'])

if __name__=='__main__':unittest.main()
