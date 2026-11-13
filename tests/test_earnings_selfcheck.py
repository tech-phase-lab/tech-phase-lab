import io
import json
import os
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import earnings_selfcheck as selfcheck

def verdicts(failing):
    return lambda t: {'ticker':t,'verdict':'FAIL' if t in failing else 'PASS','figures':3,'reason':'secret-looking text must never be printed'}

class SelfCheck(unittest.TestCase):
    def test_disabled_without_the_flag_and_touches_nothing(self):
        out=io.StringIO()
        with mock.patch.dict(os.environ,{},clear=True), mock.patch.object(selfcheck.backtest,'check_company',side_effect=AssertionError('must not run')), redirect_stdout(out):
            self.assertEqual(selfcheck.main(),0)
        self.assertTrue(out.getvalue().startswith('DISABLED'))
    def test_prints_only_flags_counts_and_tickers(self):
        out=io.StringIO()
        with mock.patch.dict(os.environ,{'EARNINGS_SELFCHECK':'true'},clear=True), mock.patch.object(selfcheck.backtest,'check_company',verdicts({'MU'})), \
                mock.patch.object(selfcheck.backtest,'WATCH',['MU','NVDA','NBIS']), redirect_stdout(out):
            code=selfcheck.main()
        self.assertEqual(code,0)  # MU has no parser: failing is expected, not a regression
        line=json.loads(out.getvalue())
        self.assertEqual((line['ok'],line['passed'],line['total'],line['failing'],line['regressions']),(True,2,3,['MU'],[]))
        self.assertNotIn('secret',out.getvalue())
    def test_a_company_with_a_parser_that_fails_makes_the_run_fail(self):
        out=io.StringIO()
        with mock.patch.dict(os.environ,{'EARNINGS_SELFCHECK':'true'},clear=True), mock.patch.object(selfcheck.backtest,'check_company',verdicts({'NVDA'})), \
                mock.patch.object(selfcheck.backtest,'WATCH',['MU','NVDA']), redirect_stdout(out):
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

if __name__=='__main__': unittest.main()
