import io
import json
import os
import sys
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import earnings_selfcheck as selfcheck
import earnings_gapcheck as gapcheck

def verdicts(failing):
    return lambda t: {'ticker':t,'verdict':'FAIL' if t in failing else 'PASS','figures':3,'reason':'secret-looking text must never be printed'}

NO_GAPS={'siteChecked':True,'gaps':[],'checked':3}

class SelfCheck(unittest.TestCase):
    def setUp(self):
        patch=mock.patch.object(selfcheck.gapcheck,'run',return_value=NO_GAPS); patch.start(); self.addCleanup(patch.stop)
    def test_disabled_without_the_flag_and_touches_nothing(self):
        out=io.StringIO()
        with mock.patch.dict(os.environ,{},clear=True), mock.patch.object(selfcheck.backtest,'check_company',side_effect=AssertionError('must not run')), redirect_stdout(out):
            self.assertEqual(selfcheck.main(),0)
        self.assertTrue(out.getvalue().startswith('DISABLED'))
    def test_prints_only_flags_counts_and_tickers(self):
        out=io.StringIO()
        with mock.patch.dict(os.environ,{'EARNINGS_SELFCHECK':'true'},clear=True), mock.patch.object(selfcheck.backtest,'check_company',verdicts({'ARM'})), \
                mock.patch.object(selfcheck.backtest,'WATCH',['ARM','NVDA','NBIS']), redirect_stdout(out):
            code=selfcheck.main()
        self.assertEqual(code,0)  # ARM has no parser: failing is expected, not a regression
        line=json.loads(out.getvalue())
        self.assertEqual((line['ok'],line['passed'],line['total'],line['failing'],line['regressions']),(True,2,3,['ARM'],[]))
        self.assertNotIn('secret',out.getvalue())
    def test_a_company_with_a_parser_that_fails_makes_the_run_fail(self):
        out=io.StringIO()
        with mock.patch.dict(os.environ,{'EARNINGS_SELFCHECK':'true'},clear=True), mock.patch.object(selfcheck.backtest,'check_company',verdicts({'NVDA'})), \
                mock.patch.object(selfcheck.backtest,'WATCH',['ARM','NVDA']), redirect_stdout(out):
            code=selfcheck.main()
        self.assertEqual(code,1)
        self.assertEqual(json.loads(out.getvalue())['regressions'],['NVDA'])
    def test_user_agent_taken_from_the_environment(self):
        old=selfcheck.backtest.UA
        try:
            with mock.patch.dict(os.environ,{'EARNINGS_SELFCHECK':'true','RESEARCH_USER_AGENT':'Tech Phase test contact'},clear=True), \
                    mock.patch.object(selfcheck.backtest,'check_company',verdicts(set())), mock.patch.object(selfcheck.backtest,'WATCH',['NVDA']), redirect_stdout(io.StringIO()):
                selfcheck.main()
            self.assertEqual(selfcheck.backtest.UA,'Tech Phase test contact')
        finally: selfcheck.backtest.UA=old

    def run_with(self,gap):
        out=io.StringIO()
        with mock.patch.dict(os.environ,{'EARNINGS_SELFCHECK':'true'},clear=True), mock.patch.object(selfcheck.backtest,'check_company',verdicts(set())), \
                mock.patch.object(selfcheck.backtest,'WATCH',['NVDA']), mock.patch.object(selfcheck.gapcheck,'run',return_value=gap), redirect_stdout(out):
            code=selfcheck.main()
        return code,json.loads(out.getvalue())
    def test_a_filing_without_a_result_on_the_site_fails_the_run(self):
        code,line=self.run_with({'siteChecked':True,'gaps':['AMAT'],'checked':50})
        self.assertEqual((code,line['ok'],line['gaps'],line['regressions']),(1,False,['AMAT'],[]))
    def test_an_unreadable_site_cannot_be_judged_and_fails_the_run(self):
        code,line=self.run_with({'siteChecked':False,'gaps':[],'checked':0})
        self.assertEqual((code,line['siteChecked']),(1,False))
    def test_no_gap_passes(self):
        code,line=self.run_with(NO_GAPS)
        self.assertEqual((code,line['ok'],line['gaps']),(0,True,[]))

NOW=datetime(2026,11,13,12,0,tzinfo=timezone.utc)
def recent(*rows):
    return {'form':[r[0] for r in rows],'items':[r[1] for r in rows],'acceptanceDateTime':[r[2] for r in rows]}
PROVIDERS={t:{'supplementalSources':[{'format':'sec-json','cik':c}]} for t,c in (('AMAT','0000006951'),('MSFT','0000789019'),('XYZ','0000000001'))}

class GapCheck(unittest.TestCase):
    def run_gap(self,filings,briefs,site_ok=True,tickers=('AMAT','MSFT')):
        def fetch(url):
            if url.endswith('/api/research/news'):
                if not site_ok: raise OSError('down')
                return json.dumps({'ok':True,'resultBriefs':briefs})
            cik=url.rsplit('CIK',1)[1].split('.')[0]
            return json.dumps({'filings':{'recent':filings[cik]}})
        return gapcheck.run('Test contact@example.com',NOW,fetch,list(tickers),PROVIDERS)
    def test_item_202_filing_without_a_result_is_a_gap(self):
        filings={'0000006951':recent(('8-K','2.02,9.01','2026-11-12T21:02:46.000Z')),'0000789019':recent(('8-K','2.02,9.01','2026-10-28T20:04:00.000Z'))}
        out=self.run_gap(filings,[{'kind':'earnings','ticker':'NBIS','publishedAt':'2026-11-12T12:12:34.000+00:00'}])
        self.assertEqual(out,{'siteChecked':True,'gaps':['AMAT'],'checked':2})   # MSFT's filing is older than the window
    def test_a_result_or_announcement_on_the_site_closes_the_gap(self):
        filings={'0000006951':recent(('8-K','2.02,9.01','2026-11-12T21:02:46.000Z')),'0000789019':recent()}
        out=self.run_gap(filings,[{'kind':'earnings','ticker':'AMAT','publishedAt':'2026-11-12T21:03:01.000+00:00'}])
        self.assertEqual(out['gaps'],[])
    def test_other_items_other_forms_and_fresh_filings_are_not_gaps(self):
        filings={'0000006951':recent(('8-K','8.01,9.01','2026-11-12T21:02:46.000Z'),('4','','2026-11-12T21:02:46.000Z'),('8-K','2.02','2026-11-13T11:55:00.000Z')),'0000789019':recent()}
        self.assertEqual(self.run_gap(filings,[])['gaps'],[])   # the 2.02 filing is 5 minutes old: inside the grace period
    def test_an_old_result_does_not_cover_a_new_filing(self):
        filings={'0000006951':recent(('8-K','2.02','2026-11-12T21:02:46.000Z')),'0000789019':recent()}
        out=self.run_gap(filings,[{'kind':'earnings','ticker':'AMAT','publishedAt':'2026-08-14T21:00:00.000+00:00'}])
        self.assertEqual(out['gaps'],['AMAT'])
    def test_unreadable_site_and_unknown_company(self):
        filings={'0000006951':recent(('8-K','2.02','2026-11-12T21:02:46.000Z'))}
        self.assertEqual(self.run_gap(filings,[],site_ok=False),{'siteChecked':False,'gaps':[],'checked':0})
        self.assertEqual(self.run_gap(filings,[],tickers=('NOPE',))['checked'],0)
    def test_the_output_has_only_tickers_counts_and_flags(self):
        filings={'0000006951':recent(('8-K','2.02','2026-11-12T21:02:46.000Z')),'0000789019':recent()}
        out=self.run_gap(filings,[])
        self.assertEqual(set(out),{'siteChecked','gaps','checked'})
        self.assertTrue(all(isinstance(t,str) and t.isupper() for t in out['gaps']))

if __name__=='__main__': unittest.main()
