import json
import sys
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import market_results as results
import monitor
import signals
import x_api

TEXT = '$MU Q4 2026 earnings highlights\nRevenue: $54.23B (Est $51.07B)\nAdjusted EPS: $33.42 (Est $31.61)\nAdjusted gross margin: 87.0%\nQ1 guidance: Revenue: $61.5B ± $1.5B\nAdjusted EPS: $38.15 ± $1.00'

class ResultTests(unittest.TestCase):
    def test_earnings_preserve_actuals_ranges_and_ignore_different_consensus(self):
        r=results.projection(TEXT,['MU'])
        self.assertEqual(r['period'],'Q4 2026')
        values={f['key']:f['value'] for f in r['facts']}
        self.assertEqual(values['revenue'],'$54.23B')
        self.assertEqual(values['eps'],'$33.42')
        self.assertEqual(values['guidance-revenue'],'$61.5B ± $1.5B')
        self.assertEqual(values['guidance-eps'],'$38.15 ± $1.00')
        self.assertNotIn('31.61',json.dumps(r))
        self.assertIsNone(results.projection('$MU earnings preview Q4 Revenue: $54B',['MU']))
        self.assertIsNone(results.projection('$MU Q4 earnings Revenue: $54',['MU']))

    def test_estimates_do_not_replace_actuals_and_other_fields_still_publish(self):
        r=results.projection('$MU Q4 earnings Expected EPS $1.20; Revenue $10B',['MU'])
        self.assertEqual([f['key'] for f in r['facts']],['revenue'])
        r=results.projection('$MU Q4 earnings Expected EPS $1.20; Actual EPS $-1.21; Revenue $10B',['MU'])
        self.assertEqual(next(f['value'] for f in r['facts'] if f['key']=='eps'),'$-1.21')
        self.assertIn('$-1.21',r['titleJa'])
        self.assertIn('$-1.21',r['titleEn'])

    def test_explicit_accounting_basis_is_preserved_in_both_languages(self):
        for label, expected_ja, expected_en in [('GAAP','GAAP EPS','GAAP EPS'),('Non-GAAP','調整後EPS','Adjusted EPS'),('Adj.','調整後EPS','Adjusted EPS')]:
            r=results.projection('$MU Q4 2026 earnings '+label+' EPS $33.42',['MU'])
            self.assertEqual(r['facts'][0]['ja'],expected_ja)
            self.assertEqual(r['facts'][0]['en'],expected_en)

    def test_annual_guidance_is_not_labelled_next_quarter_in_either_language(self):
        r=results.projection('$MU Q4 earnings Revenue $10B; Full-year outlook Revenue $40B',['MU'])
        fact=next(f for f in r['facts'] if f['key']=='guidance-revenue')
        self.assertEqual(fact['ja'],'通期 売上高')
        self.assertEqual(fact['en'],'Full-year Revenue')
        r=results.projection('$MU Q4 earnings Revenue $10B; Outlook Revenue $11B',['MU'])
        fact=next(f for f in r['facts'] if f['key']=='guidance-revenue')
        self.assertEqual(fact['en'],'Guidance Revenue')

    def test_accounts_are_processed_independently_without_whole_release_veto(self):
        reference=datetime.now(timezone.utc)
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'db.sqlite'
            with monitor.connect(path) as db:
                signals.schema(db)
                for account, amount in [('tipranks','10'),('wallstengine','11'),('fabymetal4','10')]:
                    source=next(s for s in signals.SOURCES if s.get('format')=='x-api' and account in [a.lower() for a in s.get('accounts',[])])
                    content=f'$MU Q4 2026 earnings Revenue ${amount}B; Adjusted EPS $-1.21'
                    item={'url':f'https://x.com/{account}/status/{len(amount)+len(account)}','title':content,'text':content,
                          'publishedAt':reference.isoformat(),'matches':{'MU':['$MU']},'truncated':False}
                    signals.save(db,source,[item],{},reference.isoformat(),'synthetic',1)
            results.run_once(path,signals.SOURCES,reference)
            with monitor.connect(path) as db:
                items=results.public_feed(db,reference)
                self.assertEqual(len(items),3)
                self.assertEqual({next(f['value'] for f in item['facts'] if f['key']=='eps') for item in items},{'$-1.21'})
                self.assertEqual({item['publisher']:next(f['value'] for f in item['facts'] if f['key']=='revenue') for item in items},
                                 {'TipRanks':'$10B','Wall St Engine':'$11B','FabyΔ':'$10B'})
                self.assertTrue(all('pendingFacts' not in item for item in items))
                self.assertTrue(all(item['url'].startswith('https://x.com/') for item in items))

    def test_disagreeing_values_remain_attributed_without_rewriting_titles(self):
        items=[]
        for publisher, value in [('One','$10B'),('Two','$11B')]:
            item=results.projection('$MU Q4 2026 earnings Revenue '+value,['MU'])
            item.update({'publisher':publisher,'publishedAt':'2026-10-02T00:00:00Z'})
            items.append(item)
        public=results.latest_source_posts(items)
        self.assertEqual(len(public),2)
        self.assertEqual({item['publisher']:item['facts'][0]['value'] for item in public},{'One':'$10B','Two':'$11B'})
        self.assertTrue(all(item['facts'][0]['value'] in item['titleJa'] and item['facts'][0]['value'] in item['titleEn'] for item in public))

    def test_currency_is_not_invented_for_foreign_or_unspecified_amounts(self):
        self.assertIsNone(results.projection('$ASML Q4 earnings Revenue 10B; EPS 1.20',['ASML']))
        self.assertIsNone(results.projection('$ASML Q4 earnings Revenue €10B; EPS €1.20',['ASML']))

    def test_source_number_formatting_and_signs_are_preserved(self):
        items=[]
        for publisher, value in [('One','$10.00B'),('Two','$10000M')]:
            item=results.projection('$MU Q4 2026 earnings Revenue '+value,['MU'])
            item.update({'publisher':publisher,'publishedAt':'2026-10-02T00:00:00Z'})
            items.append(item)
        self.assertTrue(all('pendingFacts' not in item for item in results.latest_source_posts(items)))
        for value in ('$-1.20','$+1.20','$1.21'):
            projected=results.projection('$MU Q4 2026 earnings Adjusted EPS '+value,['MU'])
            self.assertEqual(projected['facts'][0]['value'],value)
            self.assertIn(value,projected['titleJa'])
            self.assertIn(value,projected['titleEn'])

    def test_corrected_post_supersedes_older_figures_without_false_conflict(self):
        items=[]
        for publisher,value,at in [('One','$10B','2026-10-02T00:00:00Z'),('One','$11B','2026-10-02T00:01:00Z'),('Two','$11B','2026-10-02T00:01:00Z')]:
            item=results.projection('$MU Q4 2026 earnings Revenue '+value,['MU'])
            item.update({'publisher':publisher,'publishedAt':at})
            items.append(item)
        public=results.latest_source_posts(items)
        self.assertEqual(len(public),2)
        self.assertTrue(all('pendingFacts' not in item for item in public))
        self.assertTrue(all(item['facts'][0]['value']=='$11B' for item in public))

    def test_indicator_keeps_negative_result_without_inventing_stock_association(self):
        r=results.projection('US ADP SEPTEMBER ACTUAL -32K; EST +50K; PREV +54K',['ECON'])
        self.assertEqual(r['titleJa'],'ADP：結果 -32K')
        self.assertIsNone(results.projection('ADP tomorrow expected +50K',['ECON']))

    def test_source_to_public_and_both_languages_are_persisted_automatically(self):
        source=next(s for s in signals.SOURCES if s['id']=='x-wallstengine')
        reference=datetime.now(timezone.utc)
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'db.sqlite'
            with monitor.connect(path) as db:
                signals.schema(db)
                item={'url':'https://x.com/wallstengine/status/777','title':TEXT[:500], 'text':TEXT,
                      'publishedAt':reference.isoformat(),'matches':{'MU':['$MU']},'truncated':False}
                signals.save(db,source,[item],{},reference.isoformat(),'synthetic',1)
            results.run_once(path,signals.SOURCES,reference)
            results.run_once(path,signals.SOURCES,reference)
            with monitor.connect(path) as db:
                public=results.public_feed(db,reference)
                self.assertEqual(len(public),1)
                self.assertIn('33.42',public[0]['titleJa'])
                self.assertIn('33.42',public[0]['titleEn'])
                self.assertIsInstance(public[0]['detectionToPublicMs'],int)
                self.assertEqual(public[0]['sourceToDetectionMs'],0)
                payload=json.loads(db.execute('SELECT payload FROM market_result_publications').fetchone()[0])
                payload['url']='https://x.com/theflynews/status/777'
                payload['publisher']='The Fly'
                db.execute('UPDATE market_result_publications SET payload=?',(json.dumps(payload),))
                self.assertEqual(results.public_feed(db,reference),[])
                db.execute("UPDATE signal_documents SET sha='changed'")
                self.assertEqual(results.public_feed(db,reference),[])

    def test_long_faby_post_is_read_and_impostor_is_rejected(self):
        source=next(s for s in signals.SOURCES if s['id']=='x-wallstengine')
        payload={'data':[{'id':'999','author_id':'1','text':'shortened', 'note_tweet':{'text':TEXT}}],
                 'includes':{'users':[{'id':'1','username':'FABYMETAL4'}]}}
        items=x_api.parse_response(source,payload,list(monitor.PROVIDERS))
        self.assertEqual(items[0]['text'],TEXT)
        payload['includes']['users'][0]['username']='FakeFaby'
        self.assertEqual(x_api.parse_response(source,payload,list(monitor.PROVIDERS)),[])
