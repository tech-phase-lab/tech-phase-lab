import hashlib
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import monitor
import earnings_date_watch as watch

NBIS=('Amsterdam, October 30, 2026 — Nebius Group N.V. (“Nebius Group” or the “Company”; Nasdaq: NBIS), will release its third quarter 2026 '
      'financial results on Thursday, November 12, 2026, before market open. Nebius Group will also hold a conference call to discuss its results '
      'at 8:00 a.m. Eastern Time (5:00 a.m. Pacific Time / 2:00 p.m. Central European Time) on the same day. The registration link will be available.')
WIRE=('SANTA CLARA, Calif., Nov. 3, 2026 -- Acme Corp. (NASDAQ: ACME) today announced that it will report fiscal third quarter 2027 results '
      'after the market closes on Wednesday, November 18, 2026. Acme will host a conference call at 1:30 p.m. PT (4:30 p.m. ET) to discuss the results.')
def event(id,ticker,at,phase='call'): return {'id':id,'kind':'earnings','ticker':ticker,'phase':phase,'at':datetime.fromisoformat(at),'titleJa':'x'}
NOW=datetime(2026,11,12,9,0,tzinfo=timezone.utc)

class Notices(unittest.TestCase):
    def test_nebius_date_time_and_timing(self):
        n=watch.read_notice(NBIS)
        self.assertEqual(n,{'date':'2026-11-12','call':'2026-11-12T13:00:00+00:00','timing':'before-open'})
    def test_dateline_is_not_the_release_date_and_zones_must_agree(self):
        n=watch.read_notice(WIRE)
        self.assertEqual((n['date'],n['call'],n['timing']),('2026-11-18','2026-11-18T21:30:00+00:00','after-close'))
        clash=WIRE.replace('(4:30 p.m. ET)','(5:30 p.m. ET)')
        self.assertIsNone(watch.read_notice(clash)['call'])  # disagreeing times are not guessed
    def test_ambiguous_or_missing_dates_are_unreadable(self):
        for text,reason in ((NBIS.replace('November 12, 2026','soon'),'date-not-found'),
                            (NBIS+' The conference call will be rescheduled to November 13, 2026.','date-not-single')):
            with self.assertRaises(ValueError) as c: watch.read_notice(text)
            self.assertEqual(str(c.exception),reason)
    def test_compare_with_the_calendar(self):
        n=watch.read_notice(NBIS)
        self.assertEqual(watch.compare('NBIS',n,[event('a','NBIS','2026-11-12T13:00:00+00:00')]),'ok')
        self.assertEqual(watch.compare('NBIS',n,[event('a','NBIS','2026-11-12T12:00:00+00:00')]),'differs')   # the Nov 12 one-hour mistake
        self.assertEqual(watch.compare('NBIS',n,[event('a','NBIS','2026-11-13T13:00:00+00:00')]),'differs')
        self.assertEqual(watch.compare('NBIS',n,[]),'missing')

class Report(unittest.TestCase):
    def test_report_from_stored_notices(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
        path=str(Path(tmp.name)/'db.sqlite')
        with monitor.connect(path) as db:
            for url,ticker,title,text in (('https://nebius.com/newsroom/a','NBIS','Nebius Group announces date of third quarter 2026 results and conference call',NBIS),
                                          ('https://x.example/b','ACME','Acme to announce fiscal third quarter 2027 results',WIRE),
                                          ('https://x.example/c','NVDA','NVIDIA unveils a new GPU',NBIS)):
                sha=hashlib.sha256(text.encode()).hexdigest()
                db.execute('INSERT INTO sources(url,ticker,title,discovered_at,sha256) VALUES(?,?,?,?,?)',(url,ticker,title,'2026-10-30T12:00:00+00:00',sha))
                db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',(url,sha,'2026-10-30T12:00:01+00:00',text,len(text)))
            events=[event('a','NBIS','2026-11-12T12:00:00+00:00')]
            info=watch.diagnostics(db,NOW,events)
        self.assertEqual(info['checked'],2)   # the GPU headline is not a date notice
        states={r['ticker']:r['state'] for r in info['notices']}
        self.assertEqual(states,{'NBIS':'differs','ACME':'missing'})
        self.assertEqual(info['needAttention'],2)

if __name__=='__main__': unittest.main()
