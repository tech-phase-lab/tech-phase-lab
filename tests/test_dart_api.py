import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import dart_api as api
import dart_watch
import earnings_announce as announce
import issuer_result_flash as flash
import monitor
import signals

KEY='0123456789abcdef0123456789abcdef01234567'
AT=datetime(2026,10,28,0,0,tzinfo=timezone.utc)
EVENTS=[{'id':'skhy','kind':'earnings','ticker':'SKHY','phase':'call','at':AT}]
NOW=AT+timedelta(minutes=3)
NUMBER='20261028000123'
# A synthetic notice in the shape of the DART 영업(잠정)실적 table (millions of won): this period, previous quarter, change %, year-ago quarter, change %.
NOTICE_TEXT=('<TITLE>영업(잠정)실적(공정공시)</TITLE> SK하이닉스 1. 연결 재무제표 기준 영업(잠정)실적 (단위 : 백만원, %) 구분 당해실적 전기실적 증감율 전년동기 증감율 '
             '※ 당해실적 기간 2026.07.01 ~ 2026.09.30 '
             '매출액 104,615,483 79,318,746 31.9 24,448,929 327.9 영업이익 83,333,818 60,542,608 37.6 11,383,390 632.1 '
             '법인세비용차감전계속사업이익 50,708,500 122,708,355 (58.7) 14,790,428 242.8 당기순이익 39,775,593 93,922,593 (57.7) 12,597,538 215.7 지배기업 소유주지분 순이익 39,534,392')
def zipped(name,data):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as archive: archive.writestr(name,data)
    return out.getvalue()
CORP=zipped('CORPCODE.xml','<result><list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code></list>'
            '<list><corp_code>00164779</corp_code><corp_name>SK하이닉스</corp_name><stock_code>000660</stock_code></list></result>')

def fake(listing=((NUMBER,'영업(잠정)실적(공정공시)'),),text=NOTICE_TEXT,calls=None):
    def call(path,params,raw=False):
        if calls is not None: calls.append(path)
        if path=='corpCode.xml': return CORP
        if path=='list.json': return {'status':'000','list':[{'report_nm':n,'rcept_no':r,'corp_name':'SK하이닉스'} for r,n in listing]}
        if path=='document.xml':
            if text is None: raise ValueError('http-500')
            return zipped(f'{params["rcept_no"]}.xml',text)
        raise AssertionError(path)
    return call

class Key(unittest.TestCase):
    def setUp(self):
        api.STATE.update({'selfCheck':'pending','lastPoll':None,'corp':None,'documents':{}}); api.STATE.pop('lastAt',None)
    def test_without_a_valid_key_nothing_is_requested(self):
        for value in (None,'','   ','not-a-key','0123'*9):
            env={} if value is None else {'OPENDART_API_KEY':value}
            with mock.patch.dict(os.environ,env,clear=True), mock.patch('urllib.request.urlopen',side_effect=AssertionError('no network')) as network:
                self.assertEqual(api.run_once('x.sqlite',NOW,EVENTS),0)
                self.assertEqual(api.self_check(),'no-key')
                with self.assertRaisesRegex(ValueError,'no-key'): api.call('list.json',{})
                network.assert_not_called()
        with mock.patch.dict(os.environ,{'OPENDART_API_KEY':'zz'},clear=True): self.assertEqual(api.diagnostics()['key'],'invalid')
        with mock.patch.dict(os.environ,{},clear=True): self.assertEqual(api.diagnostics()['key'],'missing')
    def test_the_key_never_appears_in_an_error_a_code_or_the_diagnostics(self):
        errors=[urllib.error.HTTPError('https://opendart.fss.or.kr/api/list.json?crtfc_key='+KEY,500,'boom',{},None),
                urllib.error.URLError('https://opendart.fss.or.kr/api/list.json?crtfc_key='+KEY),TimeoutError('crtfc_key='+KEY),OSError('crtfc_key='+KEY)]
        with mock.patch.dict(os.environ,{'OPENDART_API_KEY':KEY},clear=True):
            for error in errors:
                with mock.patch('urllib.request.urlopen',side_effect=error):
                    with self.assertRaises(ValueError) as caught: api.call('list.json',{'corp_code':'1'})
                self.assertNotIn(KEY,str(caught.exception)); self.assertNotIn(KEY,repr(caught.exception)); self.assertIsNone(caught.exception.__cause__)
            self.assertNotIn(KEY,json.dumps(api.diagnostics()))
            api.self_check(lambda *a,**k:(_ for _ in ()).throw(ValueError('http-500')))
            self.assertNotIn(KEY,json.dumps(api.diagnostics()))
            self.assertEqual(api.diagnostics()['selfCheck'],'error:http-500')

class Parse(unittest.TestCase):
    def test_figures_from_the_table_with_both_stated_changes(self):
        parsed=api.parse_prelim(NOTICE_TEXT)
        self.assertEqual(parsed['period'],'Q3 2026')
        self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],[('revenue','₩104.615483T','₩24.448929T'),('net-income','₩39.775593T','₩12.597538T'),('operating-income','₩83.333818T','₩11.38339T')])
        self.assertTrue(all('暫定' in f[3][0] and 'preliminary' in f[3][1] for f in parsed['facts']))
        keys=lambda text:[f[0] for f in api.parse_prelim(text)['facts']]
        with self.assertRaises(ValueError): api.parse_prelim(NOTICE_TEXT.replace('104,615,483','105,615,483'))      # revenue disagrees with its changes
        self.assertEqual(keys(NOTICE_TEXT.replace('83,333,818','84,333,818')),['revenue','net-income'])
        self.assertEqual(keys(NOTICE_TEXT.replace('39,775,593','38,775,593')),['revenue','operating-income'])
        for broken in (NOTICE_TEXT.replace('2026.09.30','2026.08.31'),NOTICE_TEXT.replace('백만원','천원'),NOTICE_TEXT.replace('영업(잠정)실적','영업실적'),
                       NOTICE_TEXT.replace('SK하이닉스','삼성전자'),''):
            with self.assertRaises(ValueError): api.parse_prelim(broken)

class Flow(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=str(Path(self.tmp.name)/'db.sqlite')
        with monitor.connect(self.path) as db: signals.schema(db)
        api.STATE.update({'selfCheck':'pending','lastPoll':None,'corp':None,'documents':{}}); api.STATE.pop('lastAt',None)
        self.env=mock.patch.dict(os.environ,{'OPENDART_API_KEY':KEY},clear=True); self.env.start(); self.addCleanup(self.env.stop)
    def feed(self):
        with monitor.connect(self.path) as db:
            return announce.public_feed(db,'2026-10-01T00:00:00+00:00'),flash.public_feed(db,'2026-10-01T00:00:00+00:00')
    def test_the_notice_then_its_figures_and_never_outside_the_window(self):
        calls=[]
        self.assertEqual(api.run_once(self.path,AT-timedelta(hours=3),EVENTS,fake(calls=calls)),0); self.assertEqual(calls,[])   # outside the window: no request
        self.assertEqual(api.run_once(self.path,NOW,EVENTS,fake(calls=calls)),2)
        self.assertEqual(calls,['corpCode.xml','list.json','document.xml'])
        lines,figures=self.feed()
        self.assertEqual([(i['ticker'],i['url'],i['facts']) for i in lines],[('SKHY','https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+NUMBER,[])])
        [item]=figures
        self.assertEqual((item['ticker'],item['period'],item['publisher']),('SKHY','Q3 2026','SK hynix IR (DART)'))
        self.assertEqual([(f['key'],f['value']) for f in item['facts']],[('revenue','₩104.615483T'),('net-income','₩39.775593T'),('operating-income','₩83.333818T')])
        api.STATE.pop('lastAt',None)
        self.assertEqual(api.run_once(self.path,NOW,EVENTS,fake(calls=calls)),0)    # nothing new, and the document is not fetched again
        self.assertEqual(calls.count('document.xml'),1)
    def test_the_line_stands_when_the_figures_cannot_be_read_and_other_notices_are_ignored(self):
        self.assertEqual(api.run_once(self.path,NOW,EVENTS,fake(text=None)),1)      # the document call fails: the line only
        lines,figures=self.feed(); self.assertEqual((len(lines),figures),(1,[]))
        api.STATE.update({'documents':{}}); api.STATE.pop('lastAt',None)
        self.assertEqual(api.run_once(self.path,NOW+timedelta(minutes=1),EVENTS,fake(listing=(('20261028000999','현금ㆍ현물배당결정'),))),0)
        self.assertEqual(api.diagnostics()['lastPoll'],'ok')
    def test_one_line_when_the_rss_and_the_api_both_see_the_notice(self):
        rss=('<?xml version="1.0"?><rss><channel><item><title>SK하이닉스 - 영업(잠정)실적(공정공시)</title><link>https://dart.fss.or.kr/api/link.jsp?rcpNo=%s</link></item></channel></rss>'%NUMBER).encode()
        dart_watch._last['at']=0.0
        self.assertEqual(dart_watch.run_once(self.path,NOW,lambda:rss,EVENTS),1)
        api.run_once(self.path,NOW,EVENTS,fake())
        lines,_=self.feed(); self.assertEqual(len(lines),1)
    def test_self_check_reads_the_october_notice_and_reports_a_code(self):
        self.assertEqual(api.self_check(fake()),'ok:3')
        self.assertEqual(api.diagnostics()['selfCheck'],'ok:3')
        api.STATE['corp']=None
        self.assertEqual(api.self_check(fake(listing=())),'notice-not-listed')
        api.STATE['corp']=None
        self.assertEqual(api.self_check(fake(text='정기보고서 매출액 1')),'error:notice-not-recognized')

if __name__=='__main__': unittest.main()
