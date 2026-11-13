import hashlib
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import monitor
import signals
import earnings_announce as announce
import market_results
import web_push

NOW=datetime(2026,11,12,13,0,30,tzinfo=timezone.utc)
DETECTED='2026-11-12T12:12:34+00:00'
PAGE='https://nebius.com/newsroom/nebius-reports-third-quarter-2026-financial-results'

class Titles(unittest.TestCase):
    def test_results_releases_versus_notices(self):
        yes=['Nebius reports third quarter 2026 financial results','Micron Reports Fiscal Fourth Quarter and Full Year 2026 Results',
             'CoreWeave Reports Strong Third Quarter 2026 Results','Nebius Group announces Q3 2026 financial results']
        no=['Nebius Group announces date of third quarter 2026 results and conference call','Nebius to participate in upcoming investor conferences',
            'NVIDIA to host conference call for third quarter results','Nebius acquires Inferize','Results of the annual general meeting']
        for title in yes: self.assertTrue(announce.is_results_release(title),title)
        for title in no: self.assertFalse(announce.is_results_release(title),title)
        self.assertEqual(announce.period_of('Nebius reports third quarter 2026 financial results'),'Q3 2026')
        self.assertEqual(announce.period_of('Acme Q2 results'),'Q2')
        self.assertIsNone(announce.period_of('Acme full-year results'))

class Publication(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=str(Path(self.tmp.name)/'db.sqlite')
        with monitor.connect(self.path) as db: signals.schema(db)
    def source(self,url,ticker,title,detected=DETECTED,status='pending'):
        with monitor.connect(self.path) as db:
            db.execute('INSERT OR REPLACE INTO sources(url,ticker,title,discovered_at,sha256,status) VALUES(?,?,?,?,?,?)',(url,ticker,title,detected,'x',status))
            db.execute('INSERT OR REPLACE INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',(url,ticker,detected))
    def test_line_without_figures_from_the_companys_own_page_once(self):
        self.source(PAGE,'NBIS','Nebius reports third quarter 2026 financial results')
        self.source('https://nebius.com/newsroom/date','NBIS','Nebius Group announces date of third quarter 2026 results and conference call')
        self.source('https://evil.example/results','NBIS','Nebius reports third quarter 2026 financial results')     # not an official host
        self.source('https://nebius.com/newsroom/q?utm=1','NBIS','Nebius reports second quarter 2026 financial results')  # query
        self.source('https://nebius.com/newsroom/old','NBIS','Nebius reports first quarter 2026 financial results','2026-05-13T12:00:00+00:00')  # outside the window
        self.assertEqual(announce.run_once(self.path,NOW),1)
        self.assertEqual(announce.run_once(self.path,NOW),0)
        with monitor.connect(self.path) as db: [item]=announce.public_feed(db,'2026-11-05T00:00:00+00:00')
        self.assertEqual((item['ticker'],item['period'],item['facts'],item['url']),('NBIS','Q3 2026',[],PAGE))
        self.assertEqual(item['researchId'],'ir-announce-'+item['id'])
        self.assertEqual(item['publishedAt'],'2026-11-12T12:12:34.000+00:00')
    def test_replaced_by_the_figures_and_kept_for_the_phone_alert(self):
        self.source(PAGE,'NBIS','Nebius reports third quarter 2026 financial results')
        announce.run_once(self.path,NOW)
        with monitor.connect(self.path) as db: [line]=announce.public_feed(db,'2026-11-05T00:00:00+00:00')
        flash={'kind':'earnings','researchId':'ir-flash-9','ticker':'NBIS','period':'Q3 2026','facts':[{'key':k,'ja':k,'en':k,'value':'$1M'} for k in ('revenue','adjusted-ebitda','adjusted-net-income')]}
        self.assertEqual([i['researchId'] for i in market_results.display_floor([line])],[line['researchId']])
        self.assertEqual([i['researchId'] for i in market_results.display_floor([line,flash])],['ir-flash-9'])
        other={**line,'ticker':'CRWV'}
        self.assertEqual(len(market_results.display_floor([other,flash])),2)
        # the phone alert accepts the line, once per company and quarter together with the later figures
        event=web_push.normalize_event({**line,'publishedAt':line['publishedAt']})
        self.assertEqual((event['ticker'],event['quarter']),('NBIS','Q3'))
        self.assertEqual(web_push.event_key(event),web_push.event_key(web_push.normalize_event({**flash,'titleJa':'NBIS Q3','titleEn':'NBIS Q3','publishedAt':line['publishedAt'],'observedAt':line['observedAt']})))

if __name__=='__main__': unittest.main()
