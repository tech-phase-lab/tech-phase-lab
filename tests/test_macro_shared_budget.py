"""Shared cap accounting for actual dispatch without changing call history."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

import test_macro_source_publication as fixture
import test_headline_translation as headlines
import test_x_market_news as markets
import macro_source_publication as macro
import official_research as research
import headline_translation as budget
import x_market_news


def dispatch_row(db, lease, reserved, dispatched):
    macro.schema(db)
    db.execute('INSERT INTO '+macro.ATTEMPT_TABLE+' VALUES(?,?,?,?,?,?,?,?,?)',
               ('https://x.com/synthetic/'+lease,lease,'synthetic',1,'body',lease,'model',
                budget.datetime.fromtimestamp(reserved,budget.timezone.utc).isoformat(),dispatched))


def old_call(db, now, lease='old-macro'):
    db.execute('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
               (now-90000,'research:x-wallstengine','old-sha','model','done',lease))
    dispatch_row(db,lease,now-90000,now-1)


class MacroSharedBudgetTests(unittest.TestCase):
    def test_each_physical_call_counts_and_dispatch_only_extends_its_window(self):
        db=sqlite3.connect(':memory:'); self.addCleanup(db.close); db.row_factory=sqlite3.Row
        # A legacy/malformed schema may lack the normal unique-lease constraint.
        db.execute('CREATE TABLE signal_headline_translation_calls(at REAL,source_id,sha,model,state,lease)')
        now=200000.0
        old_call(db,now,'shared-lease')
        db.execute('INSERT INTO signal_headline_translation_calls SELECT * FROM signal_headline_translation_calls')
        before=[tuple(r) for r in db.execute('SELECT * FROM signal_headline_translation_calls')]
        self.assertEqual(len(budget.budget_calls(db,now-86400)),2)
        self.assertTrue(all(r['at']==now-1 for r in budget.budget_calls(db,now-86400)))
        self.assertEqual([tuple(r) for r in db.execute('SELECT * FROM signal_headline_translation_calls')],before)
        db.execute('DELETE FROM signal_headline_translation_calls')
        self.assertEqual(len(budget.budget_calls(db,now-86400)),1) # Retain orphan consumption evidence.

    def test_invalid_clocks_count_conservatively_and_absent_table_is_read_only(self):
        db=sqlite3.connect(':memory:'); self.addCleanup(db.close); db.row_factory=sqlite3.Row
        db.execute('CREATE TABLE signal_headline_translation_calls(at REAL,source_id,sha,model,state,lease)')
        now=200000.0
        for lease,at in [('historical',1000),('negative',-1),('missing',None),('current',now-1)]:
            db.execute('INSERT INTO signal_headline_translation_calls VALUES(?,?,?,?,?,?)',(at,'x','sha','model','done',lease))
        db.commit(); db.execute('PRAGMA query_only=ON'); before=db.total_changes
        values=budget.budget_calls(db,now-86400)
        self.assertEqual({r['lease'] for r in values},{'current'})
        self.assertEqual(db.total_changes,before); self.assertFalse(macro.exists(db,macro.ATTEMPT_TABLE))
        db.execute('PRAGMA query_only=OFF')
        dispatch_row(db,'negative',110000,None)
        dispatch_row(db,'missing',110000,None)
        for lease,dispatched in [('bad-dispatch',-1),('text-dispatch','invalid'),('before-reserved',90000),('missing-closed-dispatch',None),('missing-state-and-dispatch',None)]:
            db.execute('INSERT INTO signal_headline_translation_calls VALUES(?,?,?,?,?,?)',(110000,'x','sha','model','done',lease))
            dispatch_row(db,lease,110000,dispatched)
        db.execute("UPDATE signal_headline_translation_calls SET state=NULL WHERE lease='missing-state-and-dispatch'")
        self.assertEqual(len(budget.budget_calls(db,now-86400)),8)

    def test_headline_claim_and_diagnostics_observe_delayed_dispatch(self):
        case=headlines.HeadlineTranslationTests();case.setUp();self.addCleanup(case.doCleanups)
        with budget.connect(case.path) as db:
            old_call(db,headlines.NOW)
            self.assertIsNone(budget.claim(db,[headlines.SOURCE],1,'synthetic-model',headlines.NOW))
            self.assertEqual(budget.diagnostics(db,now=headlines.NOW)['calls24Hours']['total'],1)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)

    def test_exposed_totals_preserve_legacy_output_and_include_delayed_status(self):
        case=headlines.HeadlineTranslationTests();case.setUp();self.addCleanup(case.doCleanups)
        with budget.connect(case.path) as db:
            for index,(offset,state) in enumerate([(-1,'done'),(-2,'failed'),(-3,'stale'),(-90000,'done'),(1,'done')]):
                db.execute('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
                           (headlines.NOW+offset,'ordinary','sha','model',state,'ordinary-'+str(index)))
            before=budget.diagnostics(db,now=headlines.NOW)
            self.assertEqual(before['calls24Hours'],{'total':3,'failed':1,'completed':1,'stale':1})
            macro.schema(db)
            self.assertEqual(budget.diagnostics(db,now=headlines.NOW),before)
            old_call(db,headlines.NOW)
            after=budget.diagnostics(db,now=headlines.NOW)
            self.assertEqual(after['calls24Hours'],{'total':4,'failed':1,'completed':2,'stale':1})
            after['calls24Hours']=before['calls24Hours']
            self.assertEqual(after,before)

    def test_research_claim_observes_delayed_dispatch(self):
        case=fixture.MacroPublicationTests();case.setUp();self.addCleanup(case.doCleanups)
        case.row()
        with research.connect(case.path) as db:
            old_call(db,fixture.NOW.timestamp())
            self.assertIsNone(research.claim(db,fixture.NOW,'synthetic-model',1))
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)

    def test_fresh_policy_shares_delayed_macro_dispatch_cap_and_normal_release(self):
        import test_attributed_policy_publication as policy_fixture
        case=policy_fixture.PolicyPublicationTests();case.setUp();self.addCleanup(case.doCleanups)
        row=case.seed()
        with research.connect(case.path) as db:old_call(db,policy_fixture.NOW.timestamp())
        env={**policy_fixture.fixture.ENV,'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT':'1'}
        self.assertEqual(case.run_once(lambda *_:self.fail('policy bypassed shared cap'),env=env),'idle')
        with research.connect(case.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT count(*) FROM '+macro.ATTEMPT_TABLE).fetchone()[0],1)
        at=policy_fixture.NOW+timedelta(hours=25)
        self.assertEqual(case.run_once(env=env,at=at),'done')
        with research.connect(case.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],2)
            self.assertEqual(len(budget.budget_calls(db,at.timestamp()-86400)),1)
            self.assertEqual(db.execute('SELECT count(*) FROM '+macro.ATTEMPT_TABLE).fetchone()[0],1)
            self.assertEqual(len(policy_fixture.news.public_items(db,at)),1)
            self.assertTrue(policy_fixture.policy.recorded(db,row))

    def test_x_news_observes_delayed_dispatch(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'db.sqlite'; now=budget.time.time()
            markets.MarketNewsTests().seed(path,'Japan 10-year government bond yield reaches its highest in over 30 years.',now)
            with budget.connect(path) as db:old_call(db,now)
            env={**markets.ENV,'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT':'1'}
            self.assertEqual(x_market_news.run_once(path,lambda *_:self.fail('cap bypass'),env,now),'budget')

    def test_concurrent_aged_reservations_cannot_both_dispatch_at_cap_one(self):
        case=fixture.MacroPublicationTests();case.setUp();self.addCleanup(case.doCleanups)
        rows=[case.row(fixture.JOBS,number=951),case.row(fixture.CPI,number=952)]
        for index,row in enumerate(rows):
            lease='pending-'+str(index)
            with research.connect(case.path) as db,db:
                db.execute('BEGIN IMMEDIATE')
                self.assertTrue(macro.record_route_owner(db,row,fixture.NOW))
                db.execute('INSERT INTO official_research_jobs VALUES(?,?,?,?,?,?,?)',
                           (row['id'],row['sha'],1,fixture.NOW.timestamp()+300,lease,'running',None))
                db.execute('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
                           (fixture.NOW.timestamp(),'research:'+row['source_id'],row['sha'],'model','running',lease))
                macro.reserve_assessment(db,row,lease,'model',fixture.NOW)
        barrier=threading.Barrier(2); at=fixture.NOW+timedelta(hours=25)
        def dispatch(index):
            barrier.wait(timeout=5)
            with research.connect(case.path) as db,db:
                db.execute('BEGIN IMMEDIATE')
                return macro.dispatch_assessment(db,rows[index],'pending-'+str(index),'model',at,1)
        with ThreadPoolExecutor(max_workers=2) as pool:values=list(pool.map(dispatch,range(2)))
        self.assertEqual(sorted(values),[False,True])
        with research.connect(case.path) as db:
            self.assertEqual(len(budget.budget_calls(db,at.timestamp()-86400)),1)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],2)


if __name__=='__main__':unittest.main()
