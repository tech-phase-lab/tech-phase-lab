"""Closed source grammar, typed quantities and immutable bilingual projection."""
from copy import deepcopy
import json
import unittest
from unittest.mock import patch

import test_buyback_context as fixture
import buyback_recap
import buyback_structured as structured
import general_source_news as news


def candidate(body=fixture.RAW['body'],ticker='NVDA'):
    title=' '.join(body.split())[:500]
    sha=news.digest(title+'\n'+body)
    raw={'id':1246,'source_id':fixture.SOURCE['id'],'url':fixture.RAW['url'],
         'sha':sha,'current_sha':sha,'document_title':title,'title':title,'body':body,
         'published_at':fixture.RAW['publishedAt'],'observed_at':fixture.RAW['firstSeenAt'],
         'tickers_json':json.dumps([ticker]),'truncated':0,'event_kind':'baseline'}
    return news.assess(raw,fixture.SOURCE,fixture.NOW,{raw['url'].casefold():sha})[0]


class StructuredBuybackTests(unittest.TestCase):
    def accepted(self,body=fixture.RAW['body'],ticker='NVDA'):
        row=candidate(body,ticker);self.assertIsNotNone(row)
        note,reason=structured.validated_note(row)
        self.assertIsNone(reason);self.assertIsNotNone(note)
        news.validate_note(note,row)
        return row,note

    def rejected(self,body,ticker='NVDA'):
        row=candidate(body,ticker)
        if row is not None:
            note,reason=structured.validated_note(row)
            self.assertIsNone(note);self.assertEqual(reason,structured.FAILURE)

    def test_retained_claims_keep_roles_qualifiers_period_and_source_clock(self):
        row,note=self.accepted()
        claims=structured.parse(row)
        self.assertEqual([claim.status for claim in claims],['executed','authorization'])
        self.assertEqual([claim.amount.qualifier for claim in claims],['nearly','exact'])
        self.assertEqual(claims[0].amount.amount,20_000_000_000)
        self.assertEqual(claims[0].cashflow_qualifier,'about')
        self.assertEqual(claims[0].period,'last quarter')
        self.assertEqual(claims[1].relation,'additional')
        self.assertEqual(claims[1].remaining.amount,235_000_000_000)
        self.assertTrue(all(claim.action_date is None for claim in claims))
        self.assertEqual(note[structured.MARKER]['source']['published_at'],fixture.RAW['publishedAt'])
        self.assertIn('200億ドル弱',note['facts'][0]['ja']);self.assertIn('約92%',note['facts'][0]['ja'])
        self.assertIn('1500億ドル追加',note['facts'][1]['ja']);self.assertIn('2350億ドル',note['facts'][1]['ja'])
        related,_=buyback_recap.relate(row,[fixture.OFFICIAL])
        news.validate_note(note,related)
        item=news.public_item(related,note)
        self.assertEqual(item['publishedAt'],fixture.RAW['publishedAt'])
        self.assertNotIn('publishedOn',item);self.assertIn('recap',item['title'])
        self.assertNotIn('$150',item['bodyEn']);self.assertIn('2026-09-28',item['bodyEn'])
        self.assertLessEqual(len(item['bodyJa'].split('\n\n')[0]),180)
        self.assertLessEqual(len(item['bodyEn'].split('\n\n')[0]),180)

    def test_generic_issuers_currencies_amounts_and_periods(self):
        for ticker,name,currency in (('MSFT','Microsoft','$'),('AMD','AMD','USD'),('MU','Micron','JPY')):
            body=(f'{name} ${ticker} buyback update.\n\n'
                  f'Approximately {currency}2.75 million repurchased previous quarter, equivalent to ~85.2% of free cash flow.\n\n'
                  f'Additional {currency}7.5 billion approved. {currency}12 billion in remaining capacity.')
            with self.subTest(ticker=ticker):
                row,note=self.accepted(body,ticker)
                self.assertEqual(structured.parse(row)[0].ticker,ticker)
                self.assertIn('about 85.2%',note['facts'][0]['en'])
                self.assertNotIn('NVIDIA',str(note))
        for currency in ('€','GBP'):
            self.rejected(f'NVIDIA $NVDA repurchased {currency}2.75 million last quarter.')
        for period in ('last year','in Q2 FY2027','on 2026-09-28'):
            with self.subTest(period=period):
                self.accepted(f'NVIDIA $NVDA repurchased $19.7 billion of its own shares {period}.')

    def test_additional_new_and_plain_authorization_are_distinct(self):
        variants=(('an additional $4 billion for share repurchases','additional'),
                  ('a new $4 billion share repurchase program','new-program'),
                  ('$4 billion for share repurchases','authorization'))
        for clause,relation in variants:
            row,note=self.accepted('NVIDIA $NVDA authorized '+clause+'.')
            self.assertEqual(structured.parse(row)[0].relation,relation)
            self.assertEqual('追加' in note['facts'][0]['ja'],relation=='additional')
        row,note=self.accepted('NVIDIA $NVDA authorized an additional $4 billion for share repurchases on 2026-09-28, with $6 billion in remaining authorization.')
        self.assertEqual(structured.parse(row)[0].action_date,'2026-09-28')
        self.assertIn('2026-09-28',note['facts'][0]['ja'])

    def test_direct_company_sources_are_paraphrased_without_copy_guard_exceptions(self):
        for body in ('NVIDIA approved $4 billion for share repurchases.',
                     'NVIDIA approved a new $4 billion share repurchase program on 2026-09-28.',
                     'NVIDIA bought back $19.7 billion of its own shares in Q2 FY2027.'):
            with self.subTest(body=body):self.accepted(body)

    def test_unknown_header_tail_gap_and_interior_url_cannot_disappear(self):
        claim='Nearly $20B repurchased last quarter.'
        for header in ('NVIDIA $NVDA rumored buyback.','NVIDIA $NVDA expected buyback.',
                       'NVIDIA $NVDA fiscal year 2027.','NVIDIA $NVDA in focus.'):
            with self.subTest(header=header):self.rejected(header+'\n\n'+claim)
        for tail in ('This never actually happened.','The company denies this.',
                     'This is merely an example.','It was only an estimate.',
                     'Acme completed the transaction.','Jensen is not playing around. This is hypothetical.',
                     'This Never Happened is not playing around.','Rumor is not playing around.'):
            with self.subTest(tail=tail):self.rejected('NVIDIA $NVDA buyback update.\n\n'+claim+'\n\n'+tail)
        self.rejected('NVIDIA $NVDA buyback update.\n\nhttps://example.com/context\n\n'+claim)
        self.rejected(fixture.RAW['body'].replace('Nearly $20B','Nearly https://example.com/context $20B'))

    def test_negative_conditional_attributed_and_competing_claims_are_review(self):
        for statement in (
            'NVIDIA $NVDA did not repurchase $20B last quarter.',
            'NVIDIA $NVDA could have repurchased $20B last quarter.',
            'NVIDIA $NVDA plans to repurchase $20B last quarter.',
            'NVIDIA $NVDA repurchased $20B last quarter, if the report is true.',
            'NVIDIA $NVDA repurchased $20B last quarter, according to Acme.',
            'NVIDIA $NVDA repurchased $20B last quarter. The company denies this.',
            'NVIDIA $NVDA repurchased $20B last quarter and Apple $AAPL approved $5B.',
            'NVIDIA $NVDA repurchased $20B last quarter, while Acme bought shares.',
            'NVIDIA $NVDA authorized a new $4B of debt purchases.',
            'NVIDIA $NVDA authorized another $4B for share repurchases, with EUR6B in remaining authorization.',
        ):
            with self.subTest(statement=statement):self.rejected(statement)

    def test_unsupported_quantities_periods_and_date_attachment_stay_review(self):
        for statement in (
            'NVIDIA $NVDA repurchased $1,50 billion last quarter.',
            'NVIDIA $NVDA repurchased -$2 billion last quarter.',
            'NVIDIA $NVDA repurchased $0 billion last quarter.',
            'NVIDIA $NVDA repurchased $1e9 last quarter.',
            'NVIDIA $NVDA repurchased $2-$3 billion last quarter.',
            'NVIDIA $NVDA repurchased 94 million shares for $19.7 billion in Q2 FY2027.',
            'NVIDIA $NVDA repurchased $2B on 2026-10-05.',
            'NVIDIA $NVDA repurchased $2B on 2026-02-30.',
            'NVIDIA $NVDA repurchased $2B last fiscal quarter.',
            'NVIDIA $NVDA authorized an additional $4B for share repurchases, with $6B in remaining authorization on 2026-09-28.',
            'NVIDIA $NVDA authorized an additional $4B for share repurchases. $6B in remaining capacity.',
            'NVIDIA $NVDA authorized an additional $4B for share repurchases, with approximately $6B in remaining authorization.',
        ):
            with self.subTest(statement=statement):self.rejected(statement)

    def test_typed_proof_and_copy_are_recomputed_on_each_validation(self):
        row,note=self.accepted()
        for field in ('facts','qualifier','actor','role','source','version','boolean-version','float-scale','general-version','semantic-version'):
            damaged=deepcopy(note)
            if field=='facts':damaged['facts'][0]['ja']=damaged['facts'][0]['ja'].replace('200億ドル弱','約200億ドル')
            elif field=='qualifier':damaged[structured.MARKER]['claims'][0]['amount']['qualifier']='about'
            elif field=='actor':damaged[structured.MARKER]['claims'][0]['actor']='Microsoft'
            elif field=='role':damaged[structured.MARKER]['claims'][1]['relation']='new-program'
            elif field=='source':damaged[structured.MARKER]['source']['sha']='superseded'
            elif field=='boolean-version':damaged[structured.MARKER]['version']=True
            elif field=='float-scale':damaged[structured.MARKER]['claims'][0]['amount']['scale']=1e9
            elif field=='general-version':damaged['generalSourceVersion']=True
            elif field=='semantic-version':damaged['semanticAssessment']['version']=1.0
            else:damaged[structured.MARKER]['version']=-1
            with self.subTest(field=field),self.assertRaises(ValueError):news.validate_note(damaged,row)
        changed=candidate(fixture.RAW['body'].replace('Jensen is not playing around.','This never actually happened.'))
        self.assertIsNotNone(changed)
        with self.assertRaises(ValueError):news.validate_note(note,changed)
        changed=deepcopy(row);changed['units'][0]['buyback']['sourceStart']=float(changed['units'][0]['buyback']['sourceStart'])
        with self.assertRaises(ValueError):news.validate_note(note,changed)
        with patch('builtins.open',side_effect=AssertionError('unexpected file I/O')):
            news.validate_note(note,row)

    def test_same_amount_occurrences_keep_their_own_qualifiers_and_periods(self):
        row,note=self.accepted('NVIDIA $NVDA buyback update.\n\nNearly $20B repurchased last quarter.\n\nApproximately $20B repurchased last year.')
        claims=structured.parse(row)
        self.assertEqual([claim.amount.qualifier for claim in claims],['nearly','about'])
        self.assertEqual([claim.period for claim in claims],['last quarter','last year'])
        self.assertIn('200億ドル弱',note['facts'][0]['ja'])
        self.assertIn('約200億ドル',note['facts'][1]['ja'])
        changed=deepcopy(note);changed['facts'][1]['ja']=changed['facts'][0]['ja']
        with self.assertRaises(ValueError):news.validate_note(changed,row)


if __name__=='__main__':unittest.main()
