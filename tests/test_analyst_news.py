"""Offline source-to-publication checks; no live or model requests."""
from datetime import datetime, timedelta, timezone
import json
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import analyst_news as news
import monitor
import signals
import x_api

NOW = datetime(2026, 10, 3, 7, 0, tzinfo=timezone.utc)
SOURCE = next(s for s in signals.SOURCES if s['id']=='x-wallstengine')
LEGACY = next(s for s in signals.SOURCES if s['id']=='x-tipranks')
CASES = [
    ('IONQ','BofA initiated coverage of IonQ $IONQ with a Buy rating and $60 price target', 'initiation', 'BofA', '60'),
    ('SPCX','CLSA initiated coverage of SpaceX $SPCX with an Outperform rating and $250 price target.', 'initiation', 'CLSA', '250'),
    ('SPCX','TD Cowen initiated SpaceX $SPCX at Buy with a $200 price target, expecting growth.', 'initiation', 'TD Cowen', '200'),
    ('NFLX','🚨⬆️ Deutsche Bank upgraded Netflix $NFLX to Buy from Hold with a $95 price target.', 'upgrade', 'Deutsche Bank', '95'),
    ('AMZN',"🚨Amazon $AMZN added to US Conviction List at Goldman Sachs\n\nIt has a Buy rating on the shares with a $375 price target.", 'conviction-list', 'Goldman Sachs', None),
    ('RKLB','Rocket Lab $RKLB initiated with a Buy at Citi\n\nCiti initiated coverage of Rocket Lab with a Buy rating and $105 price target, which offers 51% upside.', 'initiation', 'Citi', '105'),
    ('MSFT',"Microsoft $MSFT added to Q4 'Tactical Ideas list' at Wells Fargo\n\nWells Fargo analyst Jane Smith added Microsoft to its list while keeping an Overweight rating on the shares with a $725 price target.", 'tactical-list', 'Wells Fargo', '725'),
    ('NVDA',"Nvidia $NVDA reinstated as Top Pick in semis at Morgan Stanley\n\nMorgan Stanley is reinstating Nvidia as the analyst's Top Pick in semis. The analyst has an Overweight rating and $300 price target on shares.", 'top-pick', 'Morgan Stanley', None),
    ('MRNA',"Citi downgraded $MRNA to Sell from Neutral, citing valuation.\n\nThe bank raised its price target to $80 from $60.", 'downgrade','Citi',None),
]


class AnalystNewsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)/'test.sqlite'
        with monitor.connect(self.path) as db:
            signals.schema(db)

    def seed(self, text=CASES[0][1], ticker='IONQ', number=100, source=SOURCE,
             account='TipRanks', published=None, observed=None):
        published = published or (NOW-timedelta(hours=1)).isoformat()
        observed = observed or (NOW-timedelta(minutes=59)).isoformat()
        item = {'url':f'https://x.com/{account}/status/{number}', 'title':' '.join(text.split())[:500],
                'text':text,'publishedAt':published,'matches':{ticker:['$'+ticker]},'truncated':False}
        with monitor.connect(self.path) as db:
            signals.save(db, source, [item], {}, observed, 'synthetic', 1)
        return item

    def feed(self, now=NOW):
        with monitor.connect(self.path) as db:
            return news.public_feed(db,now=now)

    def diagnostics(self):
        with monitor.connect(self.path) as db:
            return news.diagnostics(db,now=NOW)

    def test_source_bound_action_variants_and_optional_facts(self):
        for n,(ticker,text,action,firm,target) in enumerate(CASES):
            with self.subTest(ticker=ticker,firm=firm):
                facts,reason=news.projection(text,[ticker])
                self.assertEqual(reason,'eligible')
                self.assertEqual((facts['action'],facts['firm'],facts.get('target')),(action,firm,target))
                self.seed(text,ticker,n+100)
        self.assertEqual(news.run_once(self.path,now=NOW)['published'],9)
        feed=self.feed()
        self.assertEqual(len(feed),9)
        self.assertEqual(self.diagnostics()['pending'],0)
        for item in feed:
            self.assertIn('報道',item['titleJa'])
            self.assertTrue(item['titleEn'].startswith('Reported:'))
            self.assertNotIn('confidence',item)
            self.assertNotIn('previous',item)
            self.assertNotIn('url',item)
            self.assertNotIn('source',item)
            self.assertNotIn('%',item['bodyJa'])
            self.assertNotIn('X ·',json.dumps(item))
        nvda=next(i for i in feed if i['ticker']=='NVDA')
        self.assertIn('再指定',nvda['bodyJa'])
        self.assertNotIn('維持',nvda['bodyJa'])
        self.assertNotIn('unchanged',nvda['bodyEn'])
        msft=next(i for i in feed if i['ticker']=='MSFT')
        self.assertIn('Q4',msft['bodyEn'])
        self.assertIn('unchanged',msft['bodyEn'])
        mrna=next(i for i in feed if i['ticker']=='MRNA')
        self.assertIn('Neutral to Sell',mrna['bodyEn'])
        self.assertNotIn('$80',mrna['bodyEn'])
        self.assertNotIn('$60',mrna['bodyEn'])

    def test_future_equivalent_posts_are_not_id_or_symbol_whitelisted(self):
        self.seed('UBS initiated coverage of Example $EXMP with a Neutral rating and $27.50 price target.','EXMP',99999)
        news.run_once(self.path,now=NOW)
        self.assertEqual(self.feed()[0]['ticker'],'EXMP')
        self.assertIn('$27.5',self.feed()[0]['bodyEn'])

    def test_target_and_rating_are_optional_for_list_actions(self):
        self.seed('Nvidia $NVDA named as Top Pick at Morgan Stanley','NVDA')
        news.run_once(self.path,now=NOW)
        item=self.feed()[0]
        self.assertNotIn('Price target',item['bodyEn'])
        self.assertNotIn('Rating:',item['bodyEn'])

    def test_sources_and_author_are_both_checked(self):
        for account in ['FABYMETAL4','Unapproved','TipRanks.evil']:
            with self.subTest(account=account):
                self.seed(number=len(account),account=account)
        news.run_once(self.path,now=NOW)
        self.assertEqual(self.feed(),[])
        self.assertEqual(self.diagnostics()['excluded'],3)

    def test_archived_approved_route_and_current_route_deduplicate_origins(self):
        self.seed(number=1,source=LEGACY,published=(NOW-timedelta(hours=2)).isoformat(),observed=(NOW-timedelta(minutes=119)).isoformat())
        self.seed(number=2,account='wallstengine')
        news.run_once(self.path,now=NOW)
        feed=self.feed()
        self.assertEqual(len(feed),1)
        self.assertEqual(feed[0]['publishedAt'],(NOW-timedelta(hours=2)).isoformat())
        with monitor.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM analyst_news_publications').fetchone()[0],2)
        self.assertEqual(self.diagnostics()['published'],1)

    def test_different_broker_target_or_day_is_not_collapsed(self):
        self.seed(number=1)
        self.seed(CASES[0][1].replace('BofA','Citi'),number=2)
        self.seed(CASES[0][1].replace('$60','$65'),number=3)
        self.seed(number=4,published=(NOW-timedelta(days=1)).isoformat(),observed=(NOW-timedelta(days=1)+timedelta(seconds=10)).isoformat())
        news.run_once(self.path,now=NOW)
        self.assertEqual(len(self.feed()),4)

    def test_publication_waits_for_worker_and_clock_never_resets_on_replay(self):
        self.seed()
        self.assertEqual(self.feed(),[])
        self.assertEqual(self.diagnostics()['pending'],1)
        self.assertEqual(news.run_once(self.path,now=NOW)['state'],'done')
        with monitor.connect(self.path) as db:
            before=db.execute('SELECT public_at FROM analyst_news_publications').fetchone()[0]
        self.assertEqual(news.run_once(self.path,now=NOW+timedelta(seconds=10))['state'],'idle')
        with monitor.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT public_at FROM analyst_news_publications').fetchone()[0],before)

    def test_changed_revision_hides_old_facts_before_worker(self):
        self.seed();news.run_once(self.path,now=NOW)
        self.seed(CASES[0][1].replace('$60','$65'),observed=(NOW-timedelta(minutes=2)).isoformat())
        self.assertEqual(self.feed(),[])
        news.run_once(self.path,now=NOW)
        self.assertIn('$65',self.feed()[0]['bodyEn'])
        self.assertNotIn('$60',self.feed()[0]['bodyEn'])

    def test_unselected_retraction_invalidates_an_old_publication(self):
        original=self.seed();news.run_once(self.path,now=NOW)
        correction={**original,'text':'Correction: this report is withdrawn.','title':'Correction: this report is withdrawn.'}
        with monitor.connect(self.path) as db:
            signals.save_evidence(db,SOURCE,[],{'_acquired_posts':[correction]},NOW.isoformat())
            db.commit()
        self.assertEqual(self.feed(),[])
        news.run_once(self.path,now=NOW)
        self.assertEqual(self.feed(),[])

    def test_current_revision_retraction_cannot_publish(self):
        self.seed(CASES[0][1]+'\n\nCorrection: the report was retracted.')
        news.run_once(self.path,now=NOW)
        self.assertEqual(self.feed(),[])
        self.assertEqual(self.diagnostics()['rejectionReasons'],{'retracted-or-corrected-evidence':1})

    def test_tampered_body_and_payload_fail_closed(self):
        self.seed();news.run_once(self.path,now=NOW)
        with monitor.connect(self.path) as db:
            db.execute("UPDATE analyst_news_publications SET payload='{}'")
        self.assertEqual(self.feed(),[])
        news.run_once(self.path,now=NOW)
        self.assertEqual(len(self.feed()),1)
        with monitor.connect(self.path) as db:
            db.execute("UPDATE signal_documents SET text=text || ' altered'")
        self.assertEqual(self.feed(),[])
        self.assertIn('evidence-integrity-mismatch',self.diagnostics()['rejectionReasons'])

    def test_source_timestamps_are_exact_and_offset_aware(self):
        published='2026-10-03T14:00:00.123+09:00'
        observed='2026-10-03T05:00:01.456Z'
        self.seed(published=published,observed=observed)
        news.run_once(self.path,now=NOW)
        self.assertEqual(self.feed()[0]['publishedAt'],published)
        self.assertEqual(self.feed()[0]['observedAt'],observed)
        self.assertEqual(self.feed(now=NOW-timedelta(days=1)),[])

    def test_future_and_reversed_clocks_never_publish(self):
        self.seed(number=1,observed=(NOW+timedelta(seconds=1)).isoformat())
        self.seed(number=2,published=NOW.isoformat(),observed=(NOW-timedelta(seconds=1)).isoformat())
        self.seed(number=3,published=(NOW+timedelta(seconds=1)).isoformat())
        news.run_once(self.path,now=NOW)
        self.assertEqual(self.feed(),[])

    def test_publication_clock_tampering_hides_item(self):
        self.seed();news.run_once(self.path,now=NOW)
        with monitor.connect(self.path) as db:
            db.execute('UPDATE analyst_news_publications SET public_at=?',((NOW+timedelta(seconds=1)).isoformat(),))
        self.assertEqual(self.feed(),[])

    def test_reiterations_and_unknown_grammar_have_explicit_reasons(self):
        self.seed('BofA reiterated a Buy on $IONQ with a $60 price target.',number=1)
        self.seed('BofA placed $IONQ on its brand-new Special Opportunities roster with a Buy rating.',number=2)
        news.run_once(self.path,now=NOW)
        self.assertEqual(self.feed(),[])
        reasons=self.diagnostics()['rejectionReasons']
        self.assertEqual(reasons['no-new-analyst-action'],1)
        self.assertEqual(reasons['unsupported-analyst-syntax'],1)

    def test_ambiguous_or_negated_financial_claims_fail_closed(self):
        bad = [
            CASES[0][1]+'\n\nCiti has a Buy rating and $60 price target.',
            CASES[0][1]+'\n\nBofA also upgraded $MSFT to Buy.',
            CASES[0][1]+'\n\nThe firm did not initiate coverage.',
            CASES[5][1].replace('coverage of Rocket Lab','coverage of Microsoft'),
            'If BofA initiated coverage of IonQ $IONQ with a Buy rating and $60 price target, it would be news.',
            'BofA downgraded $IONQ to Buy from Buy with a $60 price target.',
        ]
        for text in bad:
            with self.subTest(text=text):
                facts,reason=news.projection(text,['IONQ','RKLB','MSFT'])
                self.assertIsNone(facts,reason)

    def test_worker_never_calls_provider_and_no_acquisition_query_changes(self):
        self.seed()
        with patch('brief_generator.request_response',side_effect=AssertionError('must not call model')), patch('x_api.fetch_posts',side_effect=AssertionError('must not fetch')):
            news.run_once(self.path,now=NOW)
        self.assertEqual(len(self.feed()),1)

    def test_unbound_optional_facts_negation_currency_and_ranges_are_rejected(self):
        header = 'Nvidia $NVDA named as Top Pick at Morgan Stanley\n\n'
        for tail in [
            'Separately, Morgan Stanley keeps an Overweight rating on Microsoft with a $725 price target.',
            'The analyst has an Overweight rating and $725 price target on Microsoft.',
            'It has a Buy rating on Microsoft.',
            'The bank raised its price target to $725 from $700 for Microsoft.',
            'Last year, the analyst had a Buy rating and a $300 price target.',
            'Last year, The bank raised its price target to $300 from $250.',
            'The analyst has a Buy rating and C$300 price target.',
            'Morgan Stanley also discussed Microsoft. The analyst has a Buy rating and $725 price target.',
            'A Microsoft analyst, who has a Buy rating and $725 price target.',
        ]:
            with self.subTest(tail=tail):
                facts,reason=news.projection(header+tail,['NVDA'])
                self.assertEqual(reason,'eligible')
                self.assertNotIn('rating',facts)
                self.assertNotIn('target',facts)
        bad = [header+'It is not true that The analyst has a Buy rating and $300 price target.',
               header+'It does not have a Buy rating or $300 price target.',
               header+'This never occurred.']
        bad += [
            'BofA initiated coverage of IonQ $IONQ with a Buy rating and not a $60 price target.',
            'BofA initiated coverage of IonQ $IONQ with a Buy rating and a $60-$80 price target range.',
            'BofA initiated coverage of IonQ $IONQ with a Buy rating and C$60 price target.',
            'BofA initiated coverage of IonQ $IONQ with a Buy rating and $1,000,00 price target.',
            'BofA initiated coverage of IonQ $IONQ with a Buy rating and $1.123456789 price target.',
            'BofA upgraded Netflix $NFLX to Buy from Hold, but this did not happen.',
            'BofA initiated coverage of IonQ $IONQ with a Buy rating; this is only a hypothetical example.',
        ]
        for text in bad:
            with self.subTest(text=text):
                self.assertIsNone(news.projection(text,['NVDA','IONQ','NFLX'])[0])

    def test_old_retained_correction_without_document_invalidation_hides_item(self):
        item=self.seed();news.run_once(self.path,now=NOW)
        text='Correction: this report is withdrawn.'
        sha=hashlib.sha256((text+'\n'+text).encode()).hexdigest()
        with monitor.connect(self.path) as db:
            db.execute('INSERT INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)',
                       (SOURCE['id'],item['url'],sha,text,text,item['publishedAt'],NOW.isoformat(),NOW.isoformat(),0,0))
        self.assertEqual(self.feed(),[])

    def test_route_migration_cannot_resurrect_same_origin_retraction(self):
        item=self.seed(source=LEGACY);news.run_once(self.path,now=NOW)
        text='Correction: this report is withdrawn.'
        corrected={**item,'title':text,'text':text}
        with monitor.connect(self.path) as db:
            signals.save_evidence(db,SOURCE,[],{'_acquired_posts':[corrected]},NOW.isoformat())
            db.commit()
        self.assertEqual(self.feed(),[])
        news.run_once(self.path,now=NOW)
        self.assertEqual(self.feed(),[])

    def test_equal_time_cross_store_conflicting_origin_heads_fail_closed(self):
        item=self.seed(source=LEGACY);news.run_once(self.path,now=NOW)
        sha=hashlib.sha256((item['title']+'\n'+item['text']).encode()).hexdigest()
        text='Correction: this report is withdrawn.'
        corrected=hashlib.sha256((text+'\n'+text).encode()).hexdigest()
        with monitor.connect(self.path) as db:
            db.execute('INSERT INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)',
                       (LEGACY['id'],item['url'],sha,item['title'],item['text'],item['publishedAt'],NOW.isoformat(),NOW.isoformat(),0,1))
            db.execute('INSERT INTO signal_documents VALUES(?,?,?,?,?,?,?)',
                       (SOURCE['id'],item['url'],corrected,text,text,NOW.isoformat(),NOW.isoformat()))
        self.assertEqual(self.feed(),[])

    def test_non_contract_source_timestamp_never_counts_as_published(self):
        self.seed(published='2026-10-03 05:00:00+00:00')
        news.run_once(self.path,now=NOW)
        self.assertEqual(self.feed(),[])
        self.assertEqual(self.diagnostics()['published'],0)
        self.assertEqual(self.diagnostics()['rejectionReasons'],{'invalid-source-clock':1})

    def test_live_msft_optional_context_duplicate_preserves_earlier_report(self):
        full=CASES[6][1]
        partial="Microsoft $MSFT added to Q4 'Tactical Ideas list' at Wells Fargo"
        self.seed(full,'MSFT',1081,published='2026-10-01T10:39:04Z',observed='2026-10-01T10:39:43.123Z')
        self.seed(partial,'MSFT',1082,account='wallstengine',published='2026-10-01T10:55:14Z',observed='2026-10-01T10:56:00.456Z')
        news.run_once(self.path,now=NOW)
        feed=self.feed()
        self.assertEqual(len(feed),1)
        self.assertEqual(feed[0]['publishedAt'],'2026-10-01T10:39:04Z')
        self.assertEqual(feed[0]['observedAt'],'2026-10-01T10:39:43.123Z')
        self.assertIn('Overweight',feed[0]['bodyEn'])
        self.assertIn('$725',feed[0]['bodyEn'])
        self.assertEqual(self.diagnostics()['eligible'],1)
        self.assertEqual(self.diagnostics()['published'],1)
        self.assertEqual(self.diagnostics()['pending'],0)
        with monitor.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM analyst_news_publications').fetchone()[0],2)

    def test_partial_report_cannot_bridge_conflicting_explicit_reports(self):
        full=CASES[6][1]
        partial="Microsoft $MSFT added to Q4 'Tactical Ideas list' at Wells Fargo"
        self.seed(full,'MSFT',1)
        self.seed(full.replace('$725','$700'),'MSFT',2)
        self.seed(partial,'MSFT',3)
        self.seed(partial,'MSFT',4,account='wallstengine')
        news.run_once(self.path,now=NOW)
        feed=self.feed()
        self.assertEqual(len(feed),3)
        self.assertEqual(sum('$725' in item['bodyEn'] for item in feed),1)
        self.assertEqual(sum('$700' in item['bodyEn'] for item in feed),1)
        self.assertEqual(self.diagnostics()['published'],3)
        self.assertEqual(self.diagnostics()['eligible'],3)

    def test_distinct_explicit_ratings_and_periods_remain_separate(self):
        self.seed(CASES[6][1],'MSFT',1)
        self.seed(CASES[6][1].replace('Overweight','Underweight'),'MSFT',2)
        self.seed(CASES[6][1].replace('Q4','Q1'),'MSFT',3)
        news.run_once(self.path,now=NOW)
        self.assertEqual(len(self.feed()),3)

    def test_earlier_partial_copy_is_not_enriched_with_later_facts_or_clock(self):
        partial="Microsoft $MSFT added to Q4 'Tactical Ideas list' at Wells Fargo"
        self.seed(partial,'MSFT',1,published='2026-10-01T10:00:00Z',observed='2026-10-01T10:01:00Z')
        self.seed(CASES[6][1],'MSFT',2,published='2026-10-01T11:00:00Z',observed='2026-10-01T11:01:00Z')
        news.run_once(self.path,now=NOW)
        feed=self.feed()
        self.assertEqual(len(feed),1)
        self.assertEqual(feed[0]['publishedAt'],'2026-10-01T10:00:00Z')
        self.assertEqual(feed[0]['observedAt'],'2026-10-01T10:01:00Z')
        self.assertNotIn('$725',feed[0]['bodyEn'])
        self.assertNotIn('Overweight',feed[0]['bodyEn'])

    def test_retracted_full_copy_cannot_enrich_remaining_valid_partial_origin(self):
        self.seed(CASES[6][1],'MSFT',1,published='2026-10-01T10:00:00Z',observed='2026-10-01T10:01:00Z')
        partial="Microsoft $MSFT added to Q4 'Tactical Ideas list' at Wells Fargo"
        self.seed(partial,'MSFT',2,published='2026-10-01T11:00:00Z',observed='2026-10-01T11:01:00Z')
        news.run_once(self.path,now=NOW)
        self.seed('Correction: the report was retracted.','MSFT',1,published='2026-10-01T10:00:00Z',observed=(NOW-timedelta(minutes=1)).isoformat())
        feed=self.feed()
        self.assertEqual(len(feed),1)
        self.assertEqual(feed[0]['publishedAt'],'2026-10-01T11:00:00Z')
        self.assertNotIn('$725',feed[0]['bodyEn'])
        self.assertEqual(self.diagnostics()['published'],1)

    def test_existing_acquisition_selection_recognizes_monitored_list_action(self):
        payload={'data':[{'id':'123','text':'Nvidia $NVDA reinstated as Top Pick at Morgan Stanley','created_at':NOW.isoformat(),'author_id':'1'}],
                 'includes':{'users':[{'id':'1','username':'TipRanks'}]}}
        rows=x_api.parse_response(SOURCE,payload,['NVDA'])
        self.assertEqual(len(rows),1)
        self.assertEqual(set(rows[0]['matches']),{'NVDA'})
        self.assertIn('$NVDA',rows[0]['matches']['NVDA'])
        payload['data'][0]['text']='Example $ZZZZ reinstated as Top Pick at Morgan Stanley'
        self.assertEqual(x_api.parse_response(SOURCE,payload,['NVDA']),[])


if __name__=='__main__':
    unittest.main()
