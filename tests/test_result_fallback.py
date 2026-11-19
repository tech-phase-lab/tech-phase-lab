import contextlib
import hashlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import monitor
import signals
import deep_analysis
import earnings_announce
import issuer_result_flash as flash
import market_results
import result_fallback as rf

FX=Path(__file__).parent/'fixtures'
URL='https://www.sec.gov/Archives/edgar/data/1045810/000104581026000099/q3fy27pr.htm'
DETECTED='2026-11-17T21:22:40+00:00'
NOW=datetime(2026,11,17,21,30,tzinfo=timezone.utc)
# NVIDIA's Q3 FY27 release as the monitor stored it: the summary tables ($ in billions) and the outlook line.
RELEASE='EX-99.1 '+(FX/'nvidia-results-q3fy27.txt').read_text()
# The deep analysis of that release (English copy; the figures it states, as published at 21:25).
NOTE={'headline':{'ja':'NVIDIAの売上高は1158億ドル','en':'NVIDIA revenue was $115.8 billion, up 103% year over year.','evidenceIds':['0']},
      'points':[{'ja':'x','en':'GAAP diluted earnings per share were $2.70, and non-GAAP diluted EPS was $2.68.'},
                {'ja':'x','en':'Net income reached $65.3 billion; operating income was $77.5 billion.'},
                {'ja':'x','en':'Data Center revenue was $99.0 billion.'},
                {'ja':'x','en':'For the fourth quarter, revenue is expected to be $130.0 billion, plus or minus 3%.'}],
      'watch':{'ja':'x','en':'Whether gross margin holds.'}}

def facts(note, release=RELEASE):
    return [(f['key'],f['value']) for f in rf.verified_facts(note, release, 'NVDA')]

def fails(text, url=None):
    raise ValueError('columns-unrecognized')

class Figures(unittest.TestCase):
    def test_nvidia_q3fy27_figures_with_their_units(self):
        self.assertEqual(facts(NOTE),[('revenue','$115.8B'),('eps','$2.70'),('adjusted-eps','$2.68'),('net-income','$65.3B'),
                                      ('operating-income','$77.5B'),('guidance-revenue','$130.0B ± 3%')])
    def test_a_figure_the_release_does_not_hold_is_dropped(self):
        self.assertEqual(facts({'points':[{'en':'Revenue was $116.0 billion.'}]}),[])
        self.assertEqual(facts({'points':[{'en':'Net income was $64.9 billion.'}]}),[])          # the non-GAAP row, read as GAAP
        self.assertEqual(facts({'points':[{'en':'Revenue was $57.0 billion.'}]}),[])             # the year-ago column
        self.assertEqual(facts({'points':[{'en':'Data Center revenue was $115.8 billion.'}]}),[]) # a segment, not the total
    def test_a_figure_whose_unit_cannot_be_verified_is_dropped(self):
        self.assertEqual(facts({'points':[{'en':'Revenue was $115.8 million.'}]}),[])            # the table says billions
        self.assertEqual(facts({'points':[{'en':'Revenue was $115.8.'}]}),[])                    # no unit at all
        no_unit=RELEASE.replace('($ in billions, except earnings per share)','(except earnings per share)')
        self.assertEqual(facts({'points':[{'en':'Revenue was $115.8 billion.'}]},no_unit),[])
        two_units=RELEASE+'\nSegment information (in millions) Compute 115.8 12.4'
        self.assertEqual(facts({'points':[{'en':'Revenue was $115.8 billion.'}]},two_units),[])
    def test_two_different_values_for_one_figure_are_dropped(self):
        self.assertEqual(facts({'points':[{'en':'Revenue was $115.8 billion.'},{'en':'Revenue was $96.2 billion.'}]}),[])

class Publication(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=str(Path(self.tmp.name)/'db.sqlite')
        sha=hashlib.sha256(RELEASE.encode()).hexdigest()
        with monitor.connect(self.path) as db:
            signals.schema(db); deep_analysis.schema(db); earnings_announce.schema(db)
            db.execute('INSERT INTO sources(url,ticker,discovered_at,sha256) VALUES(?,?,?,?)',(URL,'NVDA',DETECTED,sha))
            db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',(URL,'NVDA',DETECTED))
            db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',(URL,sha,DETECTED,RELEASE,len(RELEASE)))
            db.execute('INSERT INTO earnings_announcements VALUES(?,?,?,?,?,?,?)',(hashlib.sha256(URL.encode()).hexdigest(),'NVDA',URL,'Q3 2027','2026-11-17T21:22:40.000+00:00','2026-11-17T21:22:41.000+00:00',3))
            db.execute('''INSERT INTO deep_analyses(source_ref,kind,subject,source_sha,state,attempts,next_at,payload,created_at,published_at,source_url,source_title,version)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',(deep_analysis.stored_ref(URL,sha),'earnings','NVDA',sha,'done',1,0,json.dumps(NOTE),
              '2026-11-17T21:23:10+00:00','2026-11-17T21:25:02+00:00',URL,'NVIDIA Announces Financial Results for Third Quarter Fiscal 2027',deep_analysis.VERSION))
        flash.STATUS.clear()
    def feed(self, floor=True):
        with monitor.connect(self.path) as db:
            return [i for i in market_results.public_feed(db,reference=NOW,earnings_hours=24*7,floor=floor) if i['ticker']=='NVDA']
    def test_parser_failure_fills_the_row_then_the_parser_replaces_it(self):
        out=io.StringIO()
        with contextlib.redirect_stdout(out), mock.patch.dict(flash.PROFILES['NVDA'],{'parse':fails}):
            self.assertEqual(flash.run_once(self.path,NOW),0)
            self.assertEqual(flash.run_once(self.path,NOW),0)
            self.assertEqual(rf.run_once(self.path,NOW),1)
            self.assertEqual(rf.run_once(self.path,NOW),0)        # done once per analysis
        [item]=self.feed()
        self.assertTrue(item['researchId'].startswith('ir-fallback-'))
        self.assertEqual((item['period'],item['fallback'],item['method']),('Q3 2027',True,'deep-analysis-verified-figures'))
        self.assertEqual([f['value'] for f in item['facts']],['$115.8B','$2.70','$2.68','$65.3B','$77.5B','$130.0B ± 3%'])
        self.assertEqual(item['titleJa'],'NVDA Q3 2027決算：売上高$115.8B、EPS（希薄化後）$2.70')
        self.assertEqual(item['publishedAt'],'2026-11-17T21:22:40.000+00:00')   # the release's detection time
        self.assertEqual([i['researchId'][:12] for i in self.feed(floor=False)],['ir-announce-'])   # never in the alert feed
        # one log line per change of state, codes only (no figures, no address)
        lines=[json.loads(l) for l in out.getvalue().splitlines() if l.startswith('{')]
        self.assertEqual([(l['ticker'],l['state'],l['reason']) for l in lines],
                         [('NVDA','unreadable','columns-unrecognized'),('NVDA','fallback','deep-analysis-figures')])
        self.assertNotIn('115.8',out.getvalue()); self.assertNotIn('sec.gov',out.getvalue())
        # the parser reads the table later: its flash replaces the fallback
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(flash.run_once(self.path,NOW),1)
            rf.run_once(self.path,NOW)
        [item]=self.feed()
        self.assertTrue(item['researchId'].startswith('ir-flash-'))
        with monitor.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT state FROM issuer_result_fallbacks').fetchone()[0],'replaced')
            self.assertEqual(db.execute('SELECT state,parse_reason FROM issuer_result_attempts').fetchone()[:],('published','columns-unrecognized'))
    def test_few_figures_keep_the_announced_line_as_title(self):
        with monitor.connect(self.path) as db:
            db.execute('UPDATE deep_analyses SET payload=?',(json.dumps({'points':[{'en':'NVIDIA revenue was $115.8 billion.'}]}),))
        with contextlib.redirect_stdout(io.StringIO()), mock.patch.dict(flash.PROFILES['NVDA'],{'parse':fails}):
            flash.run_once(self.path,NOW); rf.run_once(self.path,NOW)
        [item]=self.feed()
        self.assertEqual((item['titleJa'],[f['value'] for f in item['facts']]),('NVDA 決算を発表しました',['$115.8B']))
    def test_no_verified_figure_leaves_the_announced_line(self):
        with monitor.connect(self.path) as db:
            db.execute('UPDATE deep_analyses SET payload=?',(json.dumps({'points':[{'en':'Revenue was $116.0 billion.'}]}),))
        with contextlib.redirect_stdout(io.StringIO()), mock.patch.dict(flash.PROFILES['NVDA'],{'parse':fails}):
            flash.run_once(self.path,NOW); rf.run_once(self.path,NOW)
        self.assertEqual([i['researchId'][:12] for i in self.feed()],['ir-announce-'])
        with monitor.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT state FROM issuer_result_fallbacks').fetchone()[0],'no-verified-figures')
    def test_reading_state_survives_a_restart(self):
        with contextlib.redirect_stdout(io.StringIO()), mock.patch.dict(flash.PROFILES['NVDA'],{'parse':fails}):
            flash.run_once(self.path,NOW)
        flash.STATUS.clear()                                   # the process restarted
        with monitor.connect(self.path) as db:
            health=flash.diagnostics(db)
        self.assertEqual([(w['ticker'],w['state'],w['reason']) for w in health['waiting']],[('NVDA','unreadable','columns-unrecognized')])
        self.assertEqual([(a['ticker'],a['state'],a['parseReason']) for a in health['attempts']],[('NVDA','unreadable','columns-unrecognized')])

class Gaps(unittest.TestCase):
    """A tracked company's announced release still without figures 30 minutes later writes one log line (codes only), then one when
    figures arrive."""
    setUp=Publication.setUp
    def lines(self, out):
        return [json.loads(l) for l in out.getvalue().splitlines() if l.startswith('{') and '"earnings-results-' in l]
    def test_one_line_when_figures_are_missing_and_one_when_they_arrive(self):
        later=datetime(2026,11,17,22,0,tzinfo=timezone.utc)
        out=io.StringIO()
        with contextlib.redirect_stdout(out), mock.patch.dict(flash.PROFILES['NVDA'],{'parse':fails}):
            flash.run_once(self.path,NOW)
            self.assertEqual(rf.report_gaps(self.path,NOW),0)            # 8 minutes after the announcement: still waiting
            self.assertEqual(rf.report_gaps(self.path,later),1)
            self.assertEqual(rf.report_gaps(self.path,later),0)          # once per release
        [line]=self.lines(out)
        self.assertEqual((line['event'],line['ticker'],line['reason'],line['period'],line['minutes']),
                         ('earnings-results-without-figures','NVDA','columns-unrecognized','Q3 2027',37))
        self.assertNotIn('sec.gov',out.getvalue())
        with monitor.connect(self.path) as db:
            self.assertEqual([(g['ticker'],g['state']) for g in flash.diagnostics(db)['gaps']],[('NVDA','without-figures')])
        out=io.StringIO()
        with contextlib.redirect_stdout(out):
            flash.run_once(self.path,later)
            self.assertEqual(rf.report_gaps(self.path,later),1)
            self.assertEqual(rf.report_gaps(self.path,later),0)
        self.assertEqual([(l['event'],l['ticker']) for l in self.lines(out)],[('earnings-results-figures-arrived','NVDA')])
    def test_a_release_read_in_time_writes_nothing(self):
        out=io.StringIO()
        with contextlib.redirect_stdout(out):
            flash.run_once(self.path,NOW)
            self.assertEqual(rf.report_gaps(self.path,datetime(2026,11,18,9,0,tzinfo=timezone.utc)),0)
        self.assertEqual(self.lines(out),[])
    def test_a_company_without_any_reading_says_so(self):
        with monitor.connect(self.path) as db:
            db.execute("UPDATE earnings_announcements SET ticker='QCOM'")
        out=io.StringIO()
        with contextlib.redirect_stdout(out):
            rf.report_gaps(self.path,datetime(2026,11,17,23,0,tzinfo=timezone.utc))
        self.assertEqual([(l['ticker'],l['reason']) for l in self.lines(out)],[('QCOM','not-attempted')])

if __name__=='__main__':
    unittest.main()
