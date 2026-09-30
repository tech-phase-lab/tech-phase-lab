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
