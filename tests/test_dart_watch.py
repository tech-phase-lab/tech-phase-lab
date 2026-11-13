import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import dart_watch as dart
import earnings_announce as announce
import monitor
import signals

AT=datetime(2026,10,28,0,0,tzinfo=timezone.utc)
EVENTS=[{'id':'skhy-3q26-call','kind':'earnings','ticker':'SKHY','phase':'call','at':AT},
        {'id':'nvda','kind':'earnings','ticker':'NVDA','phase':'call','at':AT}]
def rss(*items):
    body=''.join(f'<item><title>{t}</title><link>{l}</link></item>' for t,l in items)
    return f'<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>DART</title>{body}</channel></rss>'.encode()
NOTICE=('SK하이닉스 - 영업(잠정)실적(공정공시)','https://dart.fss.or.kr/api/link.jsp?rcpNo=20261028000123')

class Links(unittest.TestCase):
    def test_only_sk_hynix_results_notices_with_dart_links(self):
        body=rss(NOTICE,('SK하이닉스 - 현금ㆍ현물배당결정','https://dart.fss.or.kr/api/link.jsp?rcpNo=20261028000124'),   # another SK hynix notice
                 ('삼성전자 - 영업(잠정)실적(공정공시)','https://dart.fss.or.kr/api/link.jsp?rcpNo=20261028000125'),           # another company
                 ('SK하이닉스 - 영업(잠정)실적(공정공시)','https://evil.example/api/link.jsp?rcpNo=1'),                      # not DART
                 ('SK hynix - 영업(잠정)실적(공정공시)','http://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261028000126'))      # http -> https
        self.assertEqual(dart.notice_links(body),[(NOTICE[0],NOTICE[1]),('SK hynix - 영업(잠정)실적(공정공시)','https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261028000126')])
    def test_hostile_or_broken_bodies_give_nothing(self):
        for body in (b'',b'not xml',b'<!DOCTYPE x [<!ENTITY a "b">]><rss/>',rss(NOTICE)+b'x'*dart.MAX_BYTES,None):
            self.assertEqual(dart.notice_links(body),[])

class Watch(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=str(Path(self.tmp.name)/'db.sqlite')
        with monitor.connect(self.path) as db: signals.schema(db)
        dart._last['at']=0.0
    def test_no_request_outside_the_window_and_one_line_inside_it(self):
        reader=mock.Mock(return_value=rss(NOTICE))
        for now in (AT-timedelta(minutes=61),AT+timedelta(hours=2,minutes=1),AT+timedelta(days=30)):
            self.assertEqual(dart.run_once(self.path,now,reader,EVENTS),0)
        reader.assert_not_called()                                         # nothing is requested outside the window
        now=AT+timedelta(minutes=2)
        self.assertEqual(dart.run_once(self.path,now,reader,EVENTS),1)
        reader.assert_called_once_with()                                   # only the RSS list is ever read: the notice itself never
        dart._last['at']=0.0
        self.assertEqual(dart.run_once(self.path,now,reader,EVENTS),0)    # the same notice is not added twice
        with monitor.connect(self.path) as db: [item]=announce.public_feed(db,'2026-10-01T00:00:00+00:00')
        self.assertEqual((item['ticker'],item['url'],item['facts'],item['titleJa'],item['period']),('SKHY',NOTICE[1],[],'SKHY 決算を発表しました','Latest'))
    def test_polling_is_paced_and_a_failure_changes_nothing(self):
        reader=mock.Mock(return_value=rss())
        now=AT+timedelta(minutes=1)
        dart.run_once(self.path,now,reader,EVENTS); dart.run_once(self.path,now,reader,EVENTS)
        self.assertEqual(reader.call_count,1)                              # at most one request per POLL_SECONDS
        dart._last['at']=0.0
        self.assertEqual(dart.run_once(self.path,now,mock.Mock(side_effect=OSError('down')),EVENTS),0)
    def test_only_sk_hynix_results_times_open_the_window(self):
        self.assertTrue(dart.in_window(AT,EVENTS))
        self.assertFalse(dart.in_window(AT,[EVENTS[1]]))                   # NVIDIA's call does not
        self.assertFalse(dart.in_window(AT,[{**EVENTS[0],'kind':'economic'}]))

if __name__=='__main__': unittest.main()
