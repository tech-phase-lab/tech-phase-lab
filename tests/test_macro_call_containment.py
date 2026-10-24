"""Real collector and worker regressions for one macro reservation/dispatch."""
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from test_macro_fresh_service import ENV, Response, service, signals, x_api, JOBS, CPI
from test_macro_source_publication import response
import macro_source_publication as macro
import official_research as research
import general_source_news as news


class MacroCallContainmentTests(unittest.TestCase):
    def setUp(self):
        self.guards = ExitStack(); self.addCleanup(self.guards.close)
        self.guards.enter_context(patch.dict('os.environ', ENV))
        self.guards.enter_context(patch('socket.create_connection', side_effect=AssertionError('external forbidden')))
        self.guards.enter_context(patch('socket.socket.connect', side_effect=AssertionError('external forbidden')))
        self.folder = Path(self.guards.enter_context(tempfile.TemporaryDirectory()))
        self.path = self.folder/'db.sqlite'
        self.app = service.AutomaticMonitor(self.path, self.folder/'snapshot.json')
        self.source = next(s for s in signals.SOURCES if s['id']=='x-wallstengine')
        self.invocations = 0

    def collect(self, body=JOBS):
        with service.monitor.connect(self.path) as db:
            signals.due(db, sources=[self.source])
        at = (datetime.now(timezone.utc)-timedelta(seconds=30)).isoformat(timespec='milliseconds')
        payload = {'data':[{'id':'2109000000000000401','author_id':'900','text':body,'created_at':at}],
                   'includes':{'users':[{'id':'900','username':'wallstengine'}]},'meta':{'result_count':1}}
        class Opener:
            def open(_, *args, **kwargs): return Response(payload)
        with patch.object(x_api.fetch_posts, '__defaults__', (lambda:Opener(), None)):
            self.app.check_signal_source(self.source)
        self.now = (datetime.now(timezone.utc)+timedelta(seconds=1)).replace(microsecond=0)
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_x_acquisition').fetchone()[0], 1)
            news.admit_retained(db, self.now)
            self.row = news.candidates(db, self.now, include_review=True)[0]

    def provider(self, *_):
        self.invocations += 1
        return response()

    def worker(self, at=None, provider=None, *, restart=False, lane='official'):
        at = at or self.now
        if restart:
            self.app = service.AutomaticMonitor(self.path, self.folder/'restarted.json')
        self.app.stop_event.clear()
        wake = self.app.publication_wakes['official' if lane=='official' else 'results']
        with patch.object(wake, 'wait', side_effect=lambda *_:self.app.stop_event.set()), \
             patch.object(research.run_once, '__defaults__', (provider or self.provider, ENV, at.timestamp())), \
             patch.object(research, 'datetime') as clock:
            clock.fromtimestamp.side_effect = datetime.fromtimestamp
            clock.now.return_value = at
            (self.app.run_official_research if lane=='official' else self.app.run_results)()
        self.app.stop_event.clear()

    def once(self, at=None, provider=None):
        at = at or self.now
        with patch.object(research, 'datetime') as clock:
            clock.fromtimestamp.side_effect = datetime.fromtimestamp
            clock.now.return_value = at
            return research.run_once(self.path, provider or self.provider, ENV, at.timestamp())

    def state(self, at=None):
        with research.connect(self.path) as db:
            return {'calls':[dict(r) for r in db.execute('SELECT * FROM signal_headline_translation_calls')],
                    'jobs':[dict(r) for r in db.execute('SELECT * FROM official_research_jobs')],
                    'attempts':[dict(r) for r in db.execute('SELECT * FROM '+macro.ATTEMPT_TABLE)],
                    'audits':db.execute('SELECT count(*) FROM '+macro.AUDIT_TABLE).fetchone()[0],
                    'public':news.public_items(db, at or self.now),
                    'flash':service.market_results.public_feed(db, reference=at or self.now)}

    def test_duplicate_current_call_or_attempt_count_cannot_publish(self):
        self.collect()
        def duplicate(*args):
            with research.connect(self.path) as db:
                db.execute("INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) "
                           "SELECT at,source_id,sha,model,'done',lease||'-duplicate' FROM signal_headline_translation_calls")
            return self.provider(*args)
        self.assertEqual(self.once(provider=duplicate), 'review')
        state = self.state(); self.assertEqual(len(state['calls']), 2)
        self.assertEqual(state['public'], []); self.assertEqual(state['audits'], 0)
        self.worker(restart=True)
        self.assertEqual(self.invocations, 1)

    def test_attempt_count_alone_is_rejected(self):
        self.collect()
        def duplicate(*args):
            with research.connect(self.path) as db:
                db.execute('UPDATE official_research_jobs SET attempts=2')
            return self.provider(*args)
        self.assertEqual(self.once(provider=duplicate), 'review')
        self.assertEqual(self.state()['public'], [])
        self.assertEqual(self.invocations, 1)

    def test_added_call_after_publication_withdraws_without_paid_replacement(self):
        self.collect(); self.worker()
        self.assertEqual(len(self.state()['public']),1)
        with research.connect(self.path) as db:
            db.execute("INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) "
                       "SELECT at,source_id,sha,model,'done',lease||'-duplicate' FROM signal_headline_translation_calls")
        before=self.state()['calls']
        self.assertEqual(self.state()['public'],[])
        self.worker(restart=True)
        self.assertEqual(self.invocations,1); self.assertEqual(self.state()['calls'],before)

    def test_pending_reservation_rechecks_source_model_and_dispatch_identity(self):
        self.collect()
        with research.connect(self.path) as db:
            row,lease=research.claim(db,self.now,ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],1)
            before=dict(db.execute('SELECT * FROM signal_headline_translation_calls').fetchone())
            self.assertIsNone(research.claim(db,self.now,'different-model',1))
        with research.connect(self.path) as db,db:
            db.execute('BEGIN IMMEDIATE')
            self.assertFalse(macro.dispatch_assessment(db,row,'wrong-lease',ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],self.now,1))
            db.execute("UPDATE signal_documents SET sha='changed-source'")
            self.assertFalse(macro.dispatch_assessment(db,row,lease,ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],self.now,1))
        self.worker(restart=True)
        self.assertEqual(self.invocations,0); self.assertEqual(self.state()['calls'],[before])
        self.assertIsNone(self.state()['attempts'][0]['dispatched_at'])

    def test_audit_loss_and_parser_change_never_reopen_consumed_revision(self):
        self.collect(); self.worker()
        self.assertEqual(len(self.state()['public']), 1)
        with research.connect(self.path) as db: db.execute('DELETE FROM '+macro.AUDIT_TABLE)
        before = self.state()['calls']
        with patch.object(macro.macro, 'parse', side_effect=ValueError('unsupported-format')):
            self.assertEqual(self.state()['public'], [])
            self.worker(restart=True)
        self.assertEqual(self.invocations, 1); self.assertEqual(self.state()['calls'], before)

    def test_audit_rollback_then_natural_lease_expiry_does_not_retry(self):
        self.collect()
        with patch.object(macro, 'insert_audit', side_effect=RuntimeError('synthetic-audit-abort')):
            with self.assertRaisesRegex(RuntimeError, 'synthetic-audit-abort'): self.once()
        before = self.state(); self.assertEqual(before['jobs'][0]['state'], 'running')
        self.assertIsNotNone(before['attempts'][0]['dispatched_at'])
        with research.connect(self.path) as db:
            self.assertFalse(macro.closed_attempt(db,self.row,self.now))
            self.assertTrue(macro.closed_attempt(db,self.row,self.now+timedelta(seconds=301)))
            self.assertEqual(research.publication_hold_reason(db,self.row,self.now+timedelta(seconds=301)),
                             'source-event-identity-mismatch')
        self.worker(self.now+timedelta(seconds=301), restart=True)
        self.assertEqual(self.invocations, 1); self.assertEqual(self.state()['calls'], before['calls'])
        self.assertEqual(self.state()['jobs'], before['jobs']); self.assertEqual(self.state()['public'], [])

    def test_audit_rollback_with_deleted_job_or_call_keeps_dispatch_receipt(self):
        self.collect()
        with patch.object(macro, 'insert_audit', side_effect=RuntimeError('synthetic-audit-abort')):
            with self.assertRaises(RuntimeError): self.once()
        with research.connect(self.path) as db:
            db.execute('DELETE FROM official_research_jobs')
        self.worker(restart=True); self.assertEqual(self.invocations, 1)
        with research.connect(self.path) as db:
            db.execute('DELETE FROM signal_headline_translation_calls')
        self.worker(restart=True); self.assertEqual(self.invocations, 1)
        self.assertEqual(self.state()['public'], [])

    def test_expired_undispatched_reservation_resumes_original_call_and_start(self):
        self.collect(CPI)
        with research.connect(self.path) as db:
            row, lease = research.claim(db,self.now,ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],1)
            self.assertFalse(macro.closed_attempt(db,row,self.now))
            self.assertIsNone(macro.attempt_record(db,row)['dispatched_at'])
        before = self.state(); self.assertEqual(self.invocations, 0)
        resumed = self.now+timedelta(seconds=301)
        self.worker(resumed,restart=True)
        after = self.state(resumed)
        self.assertEqual(self.invocations, 1); self.assertEqual(len(after['calls']), 1)
        self.assertEqual(after['calls'][0]['at'],before['calls'][0]['at'])
        self.assertEqual(after['calls'][0]['lease'],lease); self.assertEqual(after['jobs'][0]['attempts'],1)
        self.assertEqual(after['attempts'][0]['dispatched_at'],resumed.timestamp())
        self.assertEqual(len(after['public']),1)
        with research.connect(self.path) as db:
            saved=db.execute('SELECT started_at,public_at FROM official_research_publications').fetchone()
            self.assertEqual(saved['started_at'],self.now.isoformat())
            self.assertEqual(saved['public_at'],resumed.isoformat(timespec='milliseconds'))
        self.worker(resumed,restart=True); self.assertEqual(self.invocations,1)

    def test_aged_reservation_waits_for_current_capacity_then_counts_real_dispatch(self):
        self.collect(CPI)
        with research.connect(self.path) as db:
            research.claim(db,self.now,ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],1)
        original=self.state()['calls'][0]
        full_at=self.now+timedelta(hours=25)
        with research.connect(self.path) as db:
            db.execute("INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) "
                       "VALUES(?,?,?,?,?,?)",(full_at.timestamp()-60,'other-source','other-sha','other-model','done','other-lease'))
        self.worker(full_at,restart=True); self.assertEqual(self.invocations,0)
        self.assertIsNone(self.state()['attempts'][0]['dispatched_at'])
        available_at=full_at+timedelta(hours=25)
        def observe(*args):
            with research.connect(self.path) as db:
                self.assertFalse(macro.closed_attempt(db,self.row,available_at))
                self.assertIsNone(research.publication_hold_reason(db,self.row,available_at))
                budget=research.headline_translation.budget_calls(db,available_at.timestamp()-86400)
                self.assertEqual(len(budget),1)
                self.assertEqual(budget[0]['at'],available_at.timestamp())
            return self.provider(*args)
        self.worker(available_at,provider=observe,restart=True)
        self.assertEqual(self.invocations,1)
        after=self.state(available_at)
        self.assertEqual(len(after['public']),1)
        self.assertEqual(after['calls'][0]['at'],original['at'])
        with research.connect(self.path) as db:
            self.assertEqual(research.headline_translation.diagnostics(db,now=available_at.timestamp())['calls24Hours']['total'],1)

    def test_call_model_change_before_dispatch_holds(self):
        self.collect()
        original=research.retry_feedback
        def change(db,row,excerpts):
            result=original(db,row,excerpts)
            db.execute("UPDATE signal_headline_translation_calls SET model='changed-reservation-model'")
            return result
        with patch.object(research,'retry_feedback',side_effect=change):self.worker()
        self.assertEqual(self.invocations,0)
        self.assertIsNone(self.state()['attempts'][0]['dispatched_at'])

    def test_configuration_disable_after_claim_preserves_unconsumed_reservation(self):
        self.collect()
        def disable(*_):
            self.guards.enter_context(patch.dict(ENV,{'OFFICIAL_HEADLINE_TRANSLATION_ENABLED':'false'}))
            return []
        with patch.object(research,'retry_feedback',side_effect=disable):self.worker()
        self.assertEqual(self.invocations,0)
        self.assertIsNone(self.state()['attempts'][0]['dispatched_at'])

    def test_coordinated_call_and_receipt_mutation_after_dispatch_cannot_publish(self):
        self.collect()
        def mutate(*args):
            with research.connect(self.path) as db:
                db.execute("UPDATE signal_headline_translation_calls SET model='changed-together'")
                db.execute("UPDATE "+macro.ATTEMPT_TABLE+" SET model='changed-together'")
            return self.provider(*args)
        self.assertEqual(self.once(provider=mutate),'review')
        self.assertEqual(self.invocations,1); self.assertEqual(self.state()['public'],[])
        self.worker(restart=True); self.assertEqual(self.invocations,1)

    def test_running_legacy_job_without_call_or_receipt_keeps_original_history(self):
        self.collect()
        with research.connect(self.path) as db:
            research.claim(db,self.now,ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],1)
            db.execute('DELETE FROM '+macro.ATTEMPT_TABLE)
            db.execute('DELETE FROM signal_headline_translation_calls')
        before=self.state()
        self.worker(self.now+timedelta(seconds=301),restart=True)
        self.assertEqual(self.invocations,0); self.assertEqual(self.state(),before)

    def test_dispatch_commit_crash_before_transport_stays_consumed(self):
        self.collect()
        with research.connect(self.path) as db:
            row,lease=research.claim(db,self.now,ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],1)
        with research.connect(self.path) as db,db:
            db.execute('BEGIN IMMEDIATE')
            self.assertTrue(macro.dispatch_assessment(db,row,lease,ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],self.now,1))
            self.assertFalse(macro.dispatch_assessment(db,row,lease,ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],self.now,1))
        self.worker(self.now+timedelta(seconds=301),restart=True)
        self.assertEqual(self.invocations,0); self.assertEqual(len(self.state()['calls']),1)
        self.assertEqual(self.state()['public'],[])

    def test_ambiguous_legacy_running_call_is_held_without_fabricating_dispatch(self):
        self.collect()
        with research.connect(self.path) as db:
            research.claim(db,self.now,ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],1)
            db.execute('DELETE FROM '+macro.ATTEMPT_TABLE)
        before=self.state(); self.worker(self.now+timedelta(seconds=301),restart=True)
        self.assertEqual(self.invocations,0); self.assertEqual(self.state(),before)

    def test_failed_dispatched_request_never_retries_after_budget_window(self):
        self.collect()
        def interrupted(*_):
            self.invocations+=1
            raise RuntimeError('synthetic provider interruption')
        self.assertEqual(self.once(provider=interrupted),'retry')
        before=self.state()['calls']
        self.worker(self.now+timedelta(hours=25),restart=True)
        self.assertEqual(self.invocations,1); self.assertEqual(self.state()['calls'],before)

    def test_new_source_sha_is_eligible_and_same_origin_duplicate_is_not(self):
        self.collect(); self.worker()
        with research.connect(self.path) as db:
            columns=[r[1] for r in db.execute('PRAGMA table_info(signal_events)') if r[1]!='id']
            event=dict(db.execute('SELECT * FROM signal_events').fetchone())
            event['previous_sha']='synthetic-return-to-identical-source'
            db.execute('INSERT INTO signal_events('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')',
                       tuple(event[key] for key in columns))
        self.worker(self.now+timedelta(hours=25),restart=True)
        self.assertEqual(self.invocations,1)
        # A new retained revision is a separate identity. The collector never
        # edits old acquisition bytes; retain both revisions in this fixture.
        with research.connect(self.path) as db:
            raw=dict(db.execute('SELECT * FROM signal_x_acquisition').fetchone())
            raw['text']=JOBS.replace('+31K','+32K'); raw['title']=' '.join(raw['text'].split())[:500]
            raw['sha']=news.digest(raw['title']+'\n'+raw['text'])
            raw['first_seen_at']=datetime.now(timezone.utc).isoformat()
            raw['last_seen_at']=raw['first_seen_at']; raw['selected_for_processing']=0
            db.execute('INSERT INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)',tuple(raw.values()))
        self.worker(self.now+timedelta(hours=25),restart=True)
        self.assertEqual(self.invocations,2)
        self.assertEqual(len(self.state(self.now+timedelta(hours=25))['calls']),2)

    def test_public_reads_remain_query_only_and_do_not_initialize_attempt_table(self):
        self.collect(); self.worker()
        expected=self.state()['public']
        with research.connect(self.path) as db:db.execute('DROP TABLE '+macro.ATTEMPT_TABLE)
        with service.monitor.connect(self.path) as db:
            db.execute('PRAGMA query_only=ON'); before=db.total_changes
            actual=news.public_items(db,self.now)
            self.assertEqual(actual,expected)
            self.assertEqual(db.total_changes,before)
            self.assertFalse(macro.exists(db,macro.ATTEMPT_TABLE))


if __name__=='__main__':unittest.main()
