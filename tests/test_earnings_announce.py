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

class SecFiling(unittest.TestCase):
    URL='https://www.sec.gov/Archives/edgar/data/6951/000162828026073360/amat-20261112.htm'
    ACCEPTED='2026-11-12T21:02:46.000Z'
    NOW=datetime(2026,11,13,12,50,0,tzinfo=timezone.utc)
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=str(Path(self.tmp.name)/'db.sqlite')
        with monitor.connect(self.path) as db: signals.schema(db)
    def filing(self,url,text,accepted=ACCEPTED,form='8-K',title='8-K · 8-K',ticker='AMAT',detected='2026-11-13T12:40:00+00:00'):
        """A stored filing: `detected` is when WE first stored it (not when the SEC accepted it); text is the stored EX-99.1 press release."""
        with monitor.connect(self.path) as db:
            db.execute('INSERT OR REPLACE INTO sources(url,ticker,title,discovered_at,sha256,status,sec_form,sec_acceptance_datetime) VALUES(?,?,?,?,?,?,?,?)',(url,ticker,title,detected,'h','pending',form,accepted))
            db.execute('INSERT OR REPLACE INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',(url,ticker,detected))
            if text is not None: db.execute('INSERT OR REPLACE INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',(url,'h',detected,text,len(text)))
    def feed(self):
        with monitor.connect(self.path) as db: return announce.public_feed(db,'2026-11-01T00:00:00+00:00')
    def test_an_already_stored_8k_is_announced_from_its_press_release_text(self):
        # the production case: the row exists with the old title "8-K · 8-K"; the monitor stored the EX-99.1 text
        release=(Path(__file__).parent/'fixtures/amat-8k-exhibit-head.txt').read_text()
        self.filing(self.URL,release)
        self.filing('https://www.sec.gov/Archives/edgar/data/6951/000162828026067303/amat-20261026.htm','EX-99.1 Applied Materials announces a quarterly cash dividend and a new buyback plan',accepted='2026-11-12T20:00:00.000Z')
        self.filing('https://www.sec.gov/Archives/edgar/data/6951/000162828026067304/amat-20261026.htm',None)                                   # text not stored yet
        self.filing('https://www.sec.gov/Archives/edgar/data/6951/000162828026067305/amat-20261026.htm',release,form='6-K')                    # not an 8-K
        self.assertEqual(announce.run_once(self.path,self.NOW),1)
        self.assertEqual(announce.run_once(self.path,self.NOW),0)
        [item]=self.feed()
        self.assertEqual((item['ticker'],item['facts'],item['url'],item['titleJa']),('AMAT',[],self.URL,'AMAT 決算を発表しました'))
        self.assertEqual(item['period'],'Q4 2026')   # from the press release's own heading: the phone alert key (ticker, quarter, month) then matches the figures'
    def test_a_first_discovery_of_old_filings_does_not_announce_past_results(self):
        # an empty database discovers a company's whole filing history "now": only the SEC's own acceptance time says what is recent
        release=(Path(__file__).parent/'fixtures/amat-8k-exhibit-head.txt').read_text()
        for year in (2022,2023,2024,2025):
            self.filing(f'https://www.sec.gov/Archives/edgar/data/6951/00016282802600{year}/amat-{year}1117.htm',release,accepted=f'{year}-11-17T21:00:00.000Z')
            self.filing(f'https://www.sec.gov/Archives/edgar/data/6951/00016282802700{year}/amat-{year}1118.htm',None,accepted=f'{year}-11-18T21:00:00.000Z',title='8-K · Item 2.02 Results of Operations and Financial Condition')
        self.filing('https://www.sec.gov/Archives/edgar/data/6951/000162828026099999/amat-20261112.htm',release,accepted=None)          # no acceptance time: never guessed
        self.filing(self.URL,release)
        self.assertEqual(announce.run_once(self.path,self.NOW),1)
        self.assertEqual([item['url'] for item in self.feed()],[self.URL])
    def test_the_line_and_the_later_figures_are_one_phone_alert(self):
        release=(Path(__file__).parent/'fixtures/amat-8k-exhibit-head.txt').read_text()
        self.filing(self.URL,release)
        announce.run_once(self.path,self.NOW)
        [line]=self.feed()
        line={**line,'publishedAt':'2026-11-12T21:02:50.000+00:00','observedAt':'2026-11-12T21:02:50.000+00:00'}
        figures={'kind':'earnings','ticker':'AMAT','period':'Q4 FY2026','titleJa':'AMAT Q4 FY2026決算：売上高$10.409B','titleEn':'AMAT Q4 FY2026 earnings: Revenue $10.409B',
                 'facts':[{'key':'revenue','ja':'売上高','en':'Revenue','value':'$10.409B'}],'publishedAt':'2026-11-12T21:03:00.000+00:00','observedAt':'2026-11-12T21:03:00.000+00:00'}
        keys=[web_push.event_key(web_push.normalize_result(item)) for item in (line,figures)]
        self.assertEqual(keys[0],keys[1])
    def test_a_company_never_gets_more_than_two_alerts_a_month_and_one_never_covers_another(self):
        def item(ticker,period,rid,at='2026-11-12T21:02:50.000+00:00'):
            return {'kind':'earnings','ticker':ticker,'period':period,'researchId':rid,'titleJa':f'{ticker} 決算','titleEn':f'{ticker} earnings','facts':[],'publishedAt':at,'observedAt':at}
        key=lambda x:web_push.event_key(web_push.normalize_result(x))
        # the fast "announced" line has no quarter yet (Q0); the figures that follow name theirs
        line=item('AMAT','Latest','ir-announce-1'); again=item('AMAT','Latest','ir-announce-2','2026-11-12T21:03:10.000+00:00')   # a second filing the same night
        figures=item('AMAT','Q4 FY2026','ir-flash-1','2026-11-12T21:03:00.000+00:00'); later=item('AMAT','Q4 2026','ir-announce-3','2026-11-12T22:00:00.000+00:00')
        self.assertEqual(len({key(x) for x in (line,again,figures,later)}),2)
        self.assertEqual(key(line),key(again))
        self.assertEqual(key(figures),key(later))
        self.assertNotEqual(key(line),key(item('MSFT','Latest','ir-announce-1')))
        self.assertNotEqual(key(figures),key(item('MSFT','Q4 FY2026','ir-flash-1')))
    def test_the_filing_index_item_list_is_enough_without_the_text_when_recent(self):
        import json
        recent={'form':['8-K','8-K','4'],'accessionNumber':['0001628280-26-073360','0001628280-26-067303','0001628280-26-000001'],
                'primaryDocument':['amat-20261112.htm','amat-20261026.htm','x.xml'],'primaryDocDescription':['8-K','8-K','FORM 4'],'items':['2.02,9.01','8.01,9.01',''],
                'filingDate':['2026-11-12','2026-10-26','2026-10-01'],'acceptanceDateTime':['2026-11-12T21:02:46.000Z','2026-10-26T20:34:29.000Z','2026-10-01T10:00:00.000Z']}
        body=json.dumps({'cik':'0000006951','filings':{'recent':recent}})
        source={'format':'sec-json','cik':'0000006951','forms':['8-K'],'limit':40}
        links=monitor.sec_submission_links(body,'AMAT',source)
        titles={url.rsplit('/',2)[-2]:d['title'] for url,d in links.items()}
        self.assertEqual(titles['000162828026073360'],'8-K · Item 2.02 Results of Operations and Financial Condition')
        self.assertEqual(titles['000162828026067303'],'8-K · 8-K')
        self.assertTrue(announce.is_results_release(titles['000162828026073360']))
        self.assertFalse(announce.is_results_release(titles['000162828026067303']))
        self.filing(self.URL,None,title=titles['000162828026073360'])
        self.assertEqual(announce.run_once(self.path,self.NOW),1)
        # the same title on a filing accepted weeks ago is history, not news
        self.filing('https://www.sec.gov/Archives/edgar/data/6951/000162828026067303/amat-20261026.htm',None,title=titles['000162828026073360'],accepted='2026-10-26T20:34:29.000Z')
        self.assertEqual(announce.run_once(self.path,self.NOW),0)

if __name__=='__main__': unittest.main()
