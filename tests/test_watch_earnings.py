import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import monitor
import watch_earnings as watch
from test_issuer_earnings import BODY

URL='https://investors.micron.com/news/press-release/2026/results/default.aspx'
TITLE='Micron Reports Fiscal Fourth Quarter and Full Year 2026 Results'

class WatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=str(Path(self.tmp.name)/'db.sqlite')
        with monitor.connect(self.path):pass
        self.insert()
    def insert(self,body=BODY,url=URL,date='2026-09-30',title=TITLE):
        sha=hashlib.sha256(body.encode()).hexdigest()
        with monitor.connect(self.path) as db:
            db.execute('INSERT OR REPLACE INTO sources(url,ticker,title,published_on,discovered_at,sha256) VALUES(?,?,?,?,?,?)',(url,'MU',title,date,'2026-10-01T00:00:00Z',sha))
            db.execute('INSERT OR REPLACE INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',(url,sha,'2026-10-01T00:00:01Z',body,len(body)))
    def test_persists_bilingual_snapshot_and_separate_clocks_idempotently(self):
        self.assertEqual(watch.run_once(self.path),'updated')
        snap=watch.feed(self.path)['snapshot']
        self.assertEqual(snap['period'],'FQ4 2026')
        self.assertEqual(snap['metrics']['revenueMillionUSD'],54230)
        self.assertEqual(snap['metrics']['guidanceLowMillionUSD'],60000)
        self.assertEqual(snap['metrics']['guidanceHighMillionUSD'],63000)
        self.assertEqual(snap['metrics']['adjustedEPS'],33.42)
        self.assertNotIn('133.19',json.dumps(snap))
        self.assertEqual(snap['tiles'][0]['value'],{'ja':'542.3億ドル','en':'$54.23B'})
        self.assertEqual(len(snap['cards']),4)
        self.assertIsNone(snap['publishedAt']);self.assertIsNone(snap['sourceToDetectionMs'])
        self.assertGreaterEqual(snap['detectionToPublicMs'],0)
        self.assertEqual(watch.run_once(self.path),'idle')
        self.assertEqual(watch.feed(self.path)['snapshot']['publicAt'],snap['publicAt'])
    def test_negative_eps_and_cash_never_become_positive(self):
        body=BODY.replace('Non-GAAP net income of $38.40 billion, or $33.42','Non-GAAP net loss of $1.40 billion, or $1.42').replace('cash flow of $43.97','cash flow of $-3.97')
        self.insert(body);watch.run_once(self.path);snap=watch.feed(self.path)['snapshot']
        self.assertEqual(snap['metrics']['adjustedEPS'],-1.42)
        self.assertEqual(snap['metrics']['operatingCashFlowMillionUSD'],-3970)
        self.assertIn('マイナス',json.dumps(snap['cards'][2],ensure_ascii=False))
    def test_optional_missing_fields_do_not_block_revenue_or_reuse_old_values(self):
        self.insert(BODY.replace('Non-GAAP net income','Adjusted profit').replace('Operating cash flow','Cash operations').replace('Business Outlook','Outlook'))
        watch.run_once(self.path)
        # Annual boundary still exists: publish revenue, never annual totals.
        self.assertEqual(watch.feed(self.path)['snapshot']['metrics']['revenueMillionUSD'],54230)
        self.assertNotIn('guidanceLowMillionUSD',watch.feed(self.path)['snapshot']['metrics'])
        self.insert(BODY.replace('Non-GAAP net income','Adjusted profit').replace('Operating cash flow','Cash operations'))
        watch.run_once(self.path);snap=watch.feed(self.path)['snapshot']
        self.assertNotIn('adjustedEPS',snap['metrics']);self.assertEqual(snap['tiles'][1]['value']['ja'],'未取得')
    def test_revision_replacement_withdrawal_and_unrecognized_layout(self):
        watch.run_once(self.path);old=watch.feed(self.path)['snapshot']['revision']
        self.insert(BODY.replace('54.23','59.25'));watch.run_once(self.path)
        self.assertNotEqual(watch.feed(self.path)['snapshot']['revision'],old)
        self.assertEqual(watch.feed(self.path)['snapshot']['metrics']['revenueMillionUSD'],59250)
        with monitor.connect(self.path) as db:db.execute("UPDATE sources SET status='held'")
        self.assertIsNone(watch.feed(self.path)['snapshot'])
        self.insert('Micron unsupported quarterly results');watch.run_once(self.path)
        self.assertEqual(watch.feed(self.path)['status'],'partial')
    def test_older_backfill_and_wrong_issuer_do_not_replace_latest(self):
        watch.run_once(self.path)
        self.insert(BODY.replace('Fiscal Q4','Fiscal Q3').replace('FQ1-27','FQ4-26'),url=URL+'?old',date='2026-06-24')
        self.insert(BODY.replace('54.23','999.23'),url='https://evil.example/micron/results')
        watch.run_once(self.path)
        self.assertEqual(watch.feed(self.path)['snapshot']['period'],'FQ4 2026')
    def test_invalid_guidance_year_does_not_mislabel_forecast(self):
        self.insert(BODY.replace('FQ1-27','FQ1-28'));watch.run_once(self.path)
        self.assertIsNone(watch.feed(self.path)['snapshot'])
    def test_date_only_never_produces_fake_latency(self):
        self.assertIsNone(watch.latency('2026-09-30','2026-10-01T00:00:00Z'))
        self.assertEqual(watch.latency('2026-09-30T12:00:00Z','2026-09-30T12:00:01Z'),1000)

    def test_endpoint_requires_token_and_serves_persisted_revision(self):
        import os
        from types import SimpleNamespace
        from unittest.mock import patch
        import service
        watch.run_once(self.path)
        handler=object.__new__(service.Handler)
        handler.path='/watch-earnings'
        handler.server=SimpleNamespace(app=SimpleNamespace(db_path=self.path))
        results=[];handler.send_json=lambda status,payload:results.append((status,payload))
        for configured,supplied,expected in [('', '',401),('test','',401),('test','Bearer wrong',401),('test','Bearer test',200)]:
            handler.headers={'Authorization':supplied}
            with patch.dict(os.environ,{'RESEARCH_API_TOKEN':configured}):handler.do_GET()
            self.assertEqual(results[-1][0],expected)
        self.assertEqual(results[-1][1]['snapshot']['period'],'FQ4 2026')
