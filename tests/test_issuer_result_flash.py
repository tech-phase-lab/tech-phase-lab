import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import monitor
import issuer_result_flash as flash
import market_results
import signals
import release_watch

FX=Path(__file__).parent/'fixtures'
def fixture(name): return (FX/name).read_text()
NOW=datetime(2026,11,12,13,0,30,tzinfo=timezone.utc)
DETECTED='2026-11-12T13:00:05+00:00'
NB_PAGE='https://nebius.com/newsroom/nebius-reports-third-quarter-2026-financial-results'
PDF='https://assets.nebius.com/assets/72a8c258-bbb7-4df7-ab9d-8698f6cb88fc/PR.pdf'
LETTER='https://assets.nebius.com/assets/a6ecfd85-a6cb-4967-8ef7-9a25bd261f9c/SHLQ226.pdf'
CR_URL='https://www.sec.gov/Archives/edgar/data/1769628/000176962826000461/coreweave3q26earningspress.htm'

class Parsers(unittest.TestCase):
    def test_nebius_tables_of_four_releases(self):
        expected={'q226':('Q2 2026',[('revenue','$582.3M'),('net-income','$-190.4M'),('adjusted-ebitda','$236.2M'),('adjusted-net-income','$-33.2M')]),
                  'q126':('Q1 2026',[('revenue','$399M'),('net-income','$621.2M'),('adjusted-ebitda','$129.5M'),('adjusted-net-income','$-100.3M')]),
                  'q425':('Q4 2025',[('revenue','$227.7M'),('net-income','$-249.6M'),('adjusted-ebitda','$15M'),('adjusted-net-income','$-173M')]),
                  'q325':('Q3 2025',[('revenue','$146.1M'),('net-income','$-119.6M'),('adjusted-ebitda','$-5.2M'),('adjusted-net-income','$-100.4M')])}
        for name,(period,facts) in expected.items():
            parsed=flash.parse_nebius(fixture(f'nebius-results-{name}.txt'))
            self.assertEqual((parsed['period'],[(k,v) for k,v,_ in parsed['facts']]),(period,facts),name)
    def test_coreweave_table_and_guidance(self):
        parsed=flash.parse_coreweave(fixture('coreweave-results-q326.txt'))
        self.assertEqual(parsed['period'],'Q3 2026')
        self.assertEqual([(k,v) for k,v,_ in parsed['facts']],[('revenue','$3.661B'),('eps','$-1.27'),('net-income','$-709M'),('operating-income','$207M'),
                                           ('adjusted-ebitda','$2.256B'),('guidance-revenue','$13.0B-$13.3B')])
        # the prior-year column (Q3 2025), read from the same rows
        self.assertEqual([(k,y) for k,_,y in parsed['facts']],[('revenue','$1.365B'),('eps','$-0.22'),('net-income','$-110M'),('operating-income','$52M'),
                                           ('adjusted-ebitda','$838M'),('guidance-revenue',None)])
    def test_unknown_layouts_publish_nothing(self):
        text=fixture('nebius-results-q226.txt')
        for broken in (text.replace('Revenues','Net sales'),                        # revenue row renamed
                       text.replace('2025 2026 Change','2024 2025 Change',1),       # columns are not the reported quarter
                       text.replace('Q2 2026 financial highlights','Q2 2026 results'),
                       text.replace('In USD $ millions','In thousands')):
            with self.assertRaises(ValueError): flash.parse_nebius(broken)
        cr=fixture('coreweave-results-q326.txt')
        for broken in (cr.replace('Revenue $ 3,661','Sales $ 3,661'),cr.replace('Three Months Ended September 30, 2026 2025','Three Months Ended September 30, 2025 2026'),
                       cr.replace('(In millions','(In thousands')):
            with self.assertRaises(ValueError): flash.parse_coreweave(broken)
    def test_a_repeated_row_is_left_out_not_guessed(self):
        text=fixture('nebius-results-q226.txt').replace('Adjusted net loss (91.5) (33.2) -64% (175.2) (133.5) -24%',
            'Adjusted net loss (91.5) (33.2) -64% (175.2) (133.5) -24%\nAdjusted net loss (1.0) (2.0) -64% (1.0) (2.0) -24%')
        keys=[f[0] for f in flash.parse_nebius(text)['facts']]
        self.assertNotIn('adjusted-net-income',keys); self.assertIn('revenue',keys)
    def test_only_the_nebius_results_page_is_a_candidate(self):
        ok=flash.NEBIUS_RESULTS_PATH.match
        self.assertTrue(ok('/newsroom/nebius-reports-third-quarter-2026-financial-results'))
        self.assertTrue(ok('/newsroom/nebius-group-n-v-announces-third-quarter-2024-financial-results'))
        self.assertFalse(ok('/newsroom/nebius-group-announces-date-of-third-quarter-2026-results-and-conference-call'))
        self.assertFalse(ok('/newsroom/nebius-secures-3-5-billion-financing-facility-with-citi'))

class Publication(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=str(Path(self.tmp.name)/'db.sqlite')
        with monitor.connect(self.path) as db: signals.schema(db)
        flash._attempts.clear()
    def source(self,url,ticker,detected=DETECTED,body=None):
        sha=hashlib.sha256((body or url).encode()).hexdigest()
        with monitor.connect(self.path) as db:
            db.execute('INSERT OR REPLACE INTO sources(url,ticker,discovered_at,sha256) VALUES(?,?,?,?)',(url,ticker,detected,sha))
            db.execute('INSERT OR REPLACE INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',(url,ticker,detected))
            if body:
                db.execute('INSERT OR REPLACE INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',(url,sha,detected,body,len(body)))
    def fetcher(self,table=None,links=(LETTER,PDF)):
        calls=[]
        def fetch(url,ticker):
            calls.append(url)
            assert ticker=='NBIS'
            if url==NB_PAGE: return ('<html>'+''.join(f'<a href="{l}">x</a>' for l in links)+'</html>').encode(),'text/html'
            return b'%PDF-1.4 '+url.encode(),'application/pdf'
        fetch.calls=calls
        return fetch
    def extract(self,table):
        def extract(content):
            return table if PDF.encode() in content else 'Shareholder letter without the results table. '*5
        return extract
    def test_nebius_page_then_pdf_published_with_the_detection_clock(self):
        self.source(NB_PAGE,'NBIS')
        table=fixture('nebius-results-q226.txt').replace('Q2 2026','Q3 2026').replace('2025 2026 Change','2025 2026 Change')
        fetch=self.fetcher()
        with mock.patch.object(monitor,'extract_pdf_text',self.extract(table)):
            self.assertEqual(flash.run_once(self.path,NOW,fetch),1)
        with monitor.connect(self.path) as db:
            [item]=flash.public_feed(db,'2026-11-05T00:00:00+00:00')
        self.assertEqual((item['ticker'],item['period'],item['kind'],item['url']),('NBIS','Q3 2026','earnings',NB_PAGE))
        self.assertEqual(item['researchId'],'ir-flash-'+item['id'])
        self.assertEqual(item['facts'][0],{'key':'revenue','ja':'売上高','en':'Revenue','value':'$582.3M','comparisons':{'yearAgo':'$105.1M'}})
        self.assertEqual(item['publishedAt'],'2026-11-12T13:00:05.000+00:00')
        self.assertEqual(item['titleJa'],'NBIS Q3 2026決算：売上高$582.3M、純損益$-190.4M')
        self.assertIn('detectionToPublicMs',item)
        # the letter PDF is tried first and skipped; the release PDF is the one used
        self.assertEqual(fetch.calls,[NB_PAGE,LETTER,PDF])
    def test_matches_the_nebius_calendar_entry(self):
        self.source(NB_PAGE,'NBIS')
        table=fixture('nebius-results-q226.txt').replace('Q2 2026','Q3 2026')
        with mock.patch.object(monitor,'extract_pdf_text',self.extract(table)):
            flash.run_once(self.path,NOW,self.fetcher())
        with monitor.connect(self.path) as db:
            items=flash.public_feed(db,'2026-11-05T00:00:00+00:00')
        event={'id':'nbis-q3-2026-call','kind':'earnings','ticker':'NBIS','phase':'call','at':datetime(2026,11,12,13,0,tzinfo=timezone.utc)}
        public=release_watch.match(event,{'resultBriefs':items})
        self.assertIsNotNone(public)
    def test_not_republished_and_a_missing_pdf_is_retried_politely(self):
        self.source(NB_PAGE,'NBIS')
        fetch=self.fetcher(links=())
        with mock.patch.object(monitor,'extract_pdf_text',self.extract('')):
            self.assertEqual(flash.run_once(self.path,NOW,fetch),0)
            self.assertEqual(flash.run_once(self.path,NOW,fetch),0)   # inside the retry wait: no second fetch
        self.assertEqual(fetch.calls,[NB_PAGE])
    def test_unchanged_release_is_idempotent_and_a_correction_replaces(self):
        self.source(NB_PAGE,'NBIS')
        table=fixture('nebius-results-q226.txt').replace('Q2 2026','Q3 2026')
        fetch=self.fetcher()
        with mock.patch.object(monitor,'extract_pdf_text',self.extract(table)):
            self.assertEqual(flash.run_once(self.path,NOW,fetch),1)
        with monitor.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM issuer_result_publications').fetchone()[0],1)
    def test_coreweave_from_the_stored_8k_exhibit(self):
        body='EX-99.1 '+fixture('coreweave-results-q326.txt')
        self.source(CR_URL,'CRWV','2026-11-10T21:05:58+00:00',body)
        now=datetime(2026,11,12,9,0,tzinfo=timezone.utc)
        self.assertEqual(flash.run_once(self.path,now,self.fetcher()),1)
        self.assertEqual(flash.run_once(self.path,now,self.fetcher()),0)
        with monitor.connect(self.path) as db:
            [item]=flash.public_feed(db,'2026-11-05T00:00:00+00:00')
            self.assertEqual([f['value'] for f in item['facts']],['$3.661B','$-1.27','$-709M','$207M','$2.256B','$13.0B-$13.3B'])
            merged=market_results.public_feed(db,reference=now,earnings_hours=24*7)
        self.assertEqual([i['researchId'] for i in merged],[item['researchId']])
    def test_old_or_unrelated_sources_are_ignored(self):
        body='EX-99.1 '+fixture('coreweave-results-q326.txt')
        self.source(CR_URL,'CRWV','2026-10-01T21:05:58+00:00',body)           # outside the 7-day window
        self.source('https://www.sec.gov/Archives/edgar/data/1769628/x/other.htm','CRWV',DETECTED,'no table here')
        self.source('https://nebius.com/newsroom/nebius-group-announces-date-of-third-quarter-2026-results-and-conference-call','NBIS')
        fetch=self.fetcher()
        self.assertEqual(flash.run_once(self.path,NOW,fetch),0)
        self.assertEqual(fetch.calls,[])

class Diagnostics(Publication):
    def test_health_shows_why_nothing_was_published_then_the_published_flash(self):
        flash.STATUS.clear()
        self.source(NB_PAGE,'NBIS')
        with mock.patch.object(monitor,'extract_pdf_text',self.extract('')):
            flash.run_once(self.path,NOW,self.fetcher(links=()))
        with monitor.connect(self.path) as db: info=flash.diagnostics(db)
        self.assertEqual([(w['ticker'],w['state'],w['reason']) for w in info['waiting']],[('NBIS','unreadable','results-pdf-not-linked-yet')])
        self.assertEqual(info['published'],0)
        flash._attempts.clear()
        table=fixture('nebius-results-q226.txt').replace('Q2 2026','Q3 2026')
        with mock.patch.object(monitor,'extract_pdf_text',self.extract(table)):
            flash.run_once(self.path,NOW,self.fetcher())
        with monitor.connect(self.path) as db: info=flash.diagnostics(db)
        self.assertEqual((info['published'],info['waiting'],info['latest'][0]['period']),(1,[],'Q3 2026'))

if __name__=='__main__': unittest.main()
