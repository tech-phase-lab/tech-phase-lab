"""Source-bound policy adapter; historical call metadata is synthetic offline data.

Actual 1247 source bytes/hash/clocks are retained, never a reconstruction of its
unavailable complete stored assessment, job, call or provider HTTP envelope.
"""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch

import test_retained_business_admission as fixture
import general_source_news as news
import official_research as research
import attributed_policy_publication as policy
import financing_policy_source as grammar
from test_financing_policy_source import FINANCE as FINANCING

NOW = datetime(2026,10,4,20,26,22,tzinfo=timezone.utc)
SOURCE_AT = '2026-10-02T13:54:00.000Z'
ACQUIRED = '2026-10-02T13:54:31.272+00:00'
BODY = 'WHITE HOUSE HASSETT: \n\nTHIS JOBS REPORT WAS ABOUT EXPECTED\n\nPRESIDENT IS COMMITTED TO CUTTING THE DEFICIT\n\nWE DO NOT WANT TO INFLATE OUR WAY OUT OF DEBT'
SOURCE_SHA = '51763f76686bf0ca9319379a621d3aa72a44c8a86397ce11eaa2421734c1c7b7'
BODY_SHA = '9afddc9eeefe442b6ac398aa99982ac09547fadd3c6bfd5a675b948da973c9f8'


def positive():
    return {'disposition':'publish','reason':'material-company-development',
            'facts':[{'ja':'非公開のモデル文面。','en':'Private model copy.','evidenceId':str(i)} for i in (1,2,3)]}


def response(value=None):
    return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(positive() if value is None else value)}]}]}


class PolicyPublicationTests(unittest.TestCase):
    setUp = fixture.RetainedBusinessAdmissionTests.setUp
    raw = fixture.RetainedBusinessAdmissionTests.raw

    def seed(self,body=BODY,number=2106019871654133846):
        raw=self.raw(body,number=number,published_at=SOURCE_AT,first_seen_at=ACQUIRED,last_seen_at=ACQUIRED)
        with research.connect(self.path) as db:
            news.admit_retained(db,NOW)
            return next(row for row in news.candidates(db,NOW,include_review=True) if row['sha']==raw['sha'])

    def run_once(self,transport=None,env=fixture.ENV,at=NOW):
        with patch.object(research,'prepare_story_body',return_value='idle'),patch.object(research,'datetime') as clock:
            clock.fromtimestamp.side_effect=datetime.fromtimestamp;clock.now.return_value=at
            return research.run_once(self.path,transport or (lambda *_:response()),env,at.timestamp())

    def hold(self,body=BODY):
        row=self.seed(body)
        # Exercise the original real worker storage branch with the new adapter
        # disabled: completed -> parse schema -> generic invalid-note -> failed.
        with patch.object(policy,'recognized',return_value=False):
            self.assertEqual(self.run_once(at=NOW-timedelta(seconds=10)),'review')
        return row

    def recover(self,clock=None):
        with research.connect(self.path) as db:
            return policy.publish_held(db,NOW,clock=clock or (lambda:NOW))

    def feed(self):
        with research.connect(self.path) as db:return news.public_items(db,NOW)

    def mutate(self,sql,args=()):
        with research.connect(self.path) as db:db.execute(sql,args)

    def test_actual_raw_shape_recovery_preserves_history_clocks_and_zero_budget(self):
        row=self.hold()
        self.assertEqual(row['sha'],SOURCE_SHA);self.assertEqual(row['body_sha'],BODY_SHA)
        with research.connect(self.path) as db:
            before=policy.artifacts(db,row);source=policy.source_snapshot(db,row,NOW)
            self.assertEqual(before['failures'][0]['reason'],'invalid-note')
            self.assertEqual(json.loads(before['failures'][0]['payload']),positive())
        with patch('socket.create_connection',side_effect=AssertionError('no external calls')):
            self.assertEqual(self.run_once(lambda *_:self.fail('paid recovery'),env={}), 'done')
        item=self.feed()[0];copy=grammar.derive(BODY)
        for lang in ('Ja','En'):
            self.assertEqual(item['body'+lang],'\n\n'.join(fact[lang.lower()] for fact in copy['facts']))
        self.assertEqual(item['translationJa'],copy['titleJa']);self.assertEqual(item['title'],copy['titleEn'])
        self.assertEqual(item['publishedAt'],SOURCE_AT);self.assertEqual(item['observedAt'],ACQUIRED)
        self.assertEqual(item['tickers'],[]);self.assertEqual(item['publisher'],'Reported economic news');self.assertEqual(item['newsCategory'],'policy')
        self.assertEqual(len(item['bodyJa'].split('\n\n')),3)
        with research.connect(self.path) as db:
            self.assertEqual(policy.artifacts(db,row),before);self.assertEqual(policy.source_snapshot(db,row,NOW),source)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
            audit=dict(db.execute('SELECT * FROM '+policy.AUDIT_TABLE).fetchone())
            self.assertEqual(audit['mode'],'held-correction');self.assertEqual(audit['original_artifacts'],policy.encoded(before))
        self.assertIsNone(self.recover());self.assertEqual(self.run_once(lambda *_:self.fail('paid retry')),'idle')

    def test_fresh_one_assessment_no_ticker_mapping_and_no_model_copy(self):
        self.raw(BODY,published_at=SOURCE_AT,first_seen_at=ACQUIRED,last_seen_at=ACQUIRED)
        calls=[]
        def provider(payload,key):
            calls.append(payload);self.assertIn(policy.POLICY,payload['instructions']);return response()
        self.assertEqual(self.run_once(provider),'done');self.assertEqual(len(calls),1)
        self.assertNotIn('Private model copy',str(self.feed()))
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT mode FROM '+policy.AUDIT_TABLE).fetchone()[0],'fresh-assessment')
        self.assertEqual(self.run_once(lambda *_:self.fail('second assessment')),'idle')

    def test_financing_remains_unwired_and_unknown_policy_clauses_unsupported(self):
        for body in (FINANCING,BODY+'\nMORE CLAIMS',BODY.replace('HASSETT','OTHER'),BODY.replace('DO NOT WANT','WANT')):
            row=self.seed(body,number=900+len(body))
            self.assertFalse(policy.recognized(row))
            with self.assertRaises(ValueError):policy.derived_note(row)
            with research.connect(self.path) as db:self.assertIsNone(policy.fresh_route_candidate(db,row,NOW))

    def test_explicit_negative_is_terminal(self):
        self.seed();value={'disposition':'review','reason':'not-material-business-news','facts':[]}
        self.assertEqual(self.run_once(lambda *_:response(value)),'review');self.assertEqual(self.feed(),[])
        self.assertIsNone(self.recover());self.assertEqual(self.run_once(lambda *_:self.fail('negative retry')),'idle')

    def test_missing_negative_or_selected_fields_only_payload_never_recovers(self):
        for value in (None,'{}',json.dumps({'facts':positive()['facts']}),json.dumps({'disposition':'review','reason':'not-material-business-news','facts':[]})):
            case=PolicyPublicationTests();case.setUp()
            try:
                case.hold();case.mutate('UPDATE official_research_attempt_failures SET payload=?',(value,))
                self.assertIsNone(case.recover());self.assertEqual(case.feed(),[])
                self.assertEqual(case.run_once(lambda *_:self.fail('paid fallback')),'idle')
            finally:case.doCleanups()

    def test_exact_source_history_proof_loss_withholds_without_paid_fallthrough(self):
        edits=["DELETE FROM signal_x_acquisition", "UPDATE signal_documents SET text=text||' changed'",
               "UPDATE signal_x_acquisition SET truncated=1", "DELETE FROM official_research_attempt_body_proofs",
               "UPDATE official_research_attempt_body_proofs SET body_sha='bad'", "UPDATE official_research_jobs SET attempts=2",
               "UPDATE official_research_jobs SET state='stale'", "UPDATE signal_headline_translation_calls SET source_id='bad'",
               "UPDATE general_source_semantic_reviews SET reason='not-material-business-news'",
               "UPDATE official_research_attempt_failures SET reason='incomplete'",
               "INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) SELECT at,source_id,sha,model,state,lease||'x' FROM signal_headline_translation_calls"]
        for sql in edits:
            case=PolicyPublicationTests();case.setUp()
            try:
                case.hold();case.mutate(sql);self.assertIsNone(case.recover());self.assertEqual(case.feed(),[])
                case.run_once(lambda *_:self.fail('proof loss reopened paid route'))
            finally:case.doCleanups()

    def test_read_only_projection_revokes_changed_audit_history_or_source(self):
        edits=["DELETE FROM source_policy_news_derivations", "UPDATE source_policy_news_derivations SET original_response='{}'",
               "UPDATE official_research_attempt_failures SET detail='changed'", "UPDATE signal_headline_translation_calls SET usage='changed'",
               "UPDATE official_research_publications SET payload='{}'", "UPDATE signal_x_acquisition SET sha='new-revision'"]
        for sql in edits:
            case=PolicyPublicationTests();case.setUp()
            try:
                case.hold();self.assertEqual(case.recover(),'done');case.mutate(sql)
                db=sqlite3.connect(case.path.resolve().as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
                try:
                    db.execute('PRAGMA query_only=ON');self.assertEqual(news.public_items(db,NOW),[]);self.assertEqual(db.total_changes,0)
                finally:db.close()
                case.run_once(lambda *_:self.fail('invalid public proof retried'))
            finally:case.doCleanups()

    def test_stored_optional_metadata_is_preserved_without_equity_policy_tags(self):
        row=self.seed();self.mutate('UPDATE signal_events SET tickers_json=? WHERE id=?',('["MSFT"]',row['id']))
        self.assertEqual(self.run_once(),'done');item=self.feed()[0]
        self.assertEqual(item['tickers'],[]);self.assertEqual(item['url'],row['url'])
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT tickers_json FROM signal_events WHERE id=?',(row['id'],)).fetchone()[0],'["MSFT"]')
        self.assertNotIn('Microsoft',item['bodyEn'])

    def test_fresh_extra_call_or_attempt_holds_paid_response(self):
        for extra in ('attempt','call'):
            case=PolicyPublicationTests();case.setUp()
            try:
                case.seed()
                def provider(*_):
                    if extra=='attempt':case.mutate('UPDATE official_research_jobs SET attempts=2')
                    else:case.mutate("INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) SELECT at,source_id,sha,model,state,lease||'x' FROM signal_headline_translation_calls")
                    return response()
                self.assertEqual(case.run_once(provider),'review');self.assertEqual(case.feed(),[])
                case.run_once(lambda *_:self.fail('ambiguous call retry'))
            finally:case.doCleanups()

    def test_parser_change_plus_missing_audit_never_reopens_terminal_route(self):
        self.seed();self.assertEqual(self.run_once(),'done');self.mutate('DELETE FROM source_policy_news_derivations')
        with patch.object(grammar,'parse',side_effect=ValueError('unsupported')):
            self.assertEqual(self.feed(),[]);self.run_once(lambda *_:self.fail('parser retry'))

    def test_held_validates_outside_writer_lock_and_rechecks_concurrent_history(self):
        row=self.hold();original=policy.bind;seen=[]
        def bind(value,row):
            with research.connect(self.path) as writer:
                writer.execute('BEGIN IMMEDIATE');writer.execute("UPDATE official_research_attempt_failures SET detail='concurrent'")
            seen.append(True);return original(value,row)
        with patch.object(policy,'bind',side_effect=bind):self.assertEqual(self.recover(),'stale')
        self.assertTrue(seen);self.assertEqual(self.feed(),[])

    def test_audit_failure_rolls_back_publication(self):
        self.hold()
        with patch.object(policy,'insert_audit',side_effect=RuntimeError('rollback')):
            with self.assertRaisesRegex(RuntimeError,'rollback'):self.recover()
        with research.connect(self.path) as db:self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0],0)
        self.assertEqual(self.recover(),'done')

    def test_two_writers_publish_once(self):
        self.hold()
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:self.recover(),range(2)))
        self.assertEqual(results.count('done'),1)
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM '+policy.AUDIT_TABLE).fetchone()[0],1)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)

    def test_fresh_preflight_copy_validation_is_unlocked_and_history_recheck_is_atomic(self):
        self.seed();original=policy.fresh_preflight;seen=[]
        def preflight(db,*args):
            self.assertFalse(db.in_transaction)
            value=original(db,*args)
            with research.connect(self.path) as writer:
                writer.execute('BEGIN IMMEDIATE')
                writer.execute("UPDATE signal_headline_translation_calls SET usage='concurrent-change'")
            seen.append(True);return value
        with patch.object(policy,'fresh_preflight',side_effect=preflight):self.assertEqual(self.run_once(),'stale')
        self.assertTrue(seen);self.assertEqual(self.feed(),[])
        self.run_once(lambda *_:self.fail('changed preflight paid retry'))

    def test_fresh_rollback_expired_or_missing_job_does_not_pay_again(self):
        for delete_job in (False,True):
            case=PolicyPublicationTests();case.setUp()
            try:
                case.seed()
                with patch.object(policy,'insert_audit',side_effect=ValueError('audit rollback')):
                    with self.assertRaisesRegex(ValueError,'audit rollback'):case.run_once()
                case.mutate('DELETE FROM official_research_jobs' if delete_job else 'UPDATE official_research_jobs SET next_at=0')
                self.assertEqual(case.run_once(lambda *_:self.fail('rollback paid retry')),'idle')
                self.assertEqual(case.feed(),[])
            finally:case.doCleanups()

    def test_policy_version_change_during_held_preflight_refuses_commit(self):
        self.hold();original=policy.bind
        def bind(*args):
            note=original(*args);policy.VERSION+=1;return note
        try:
            with patch.object(policy,'bind',side_effect=bind):self.assertEqual(self.recover(),'stale')
        finally:policy.VERSION-=1
        self.assertEqual(self.feed(),[])

    def test_healthy_first_assessment_remains_running_not_publication_held(self):
        self.seed();observed=[]
        def provider(*_):
            with research.connect(self.path) as db:
                rows=research.candidates(db,NOW)
                observed.append(research.delivery_diagnostics(db,NOW,rows,[]))
            return response()
        self.assertEqual(self.run_once(provider),'done')
        self.assertEqual(observed[0]['publicationHeld'],0)
        self.assertEqual(observed[0]['running'],1)

    def test_concurrent_publication_after_fresh_preflight_is_not_overwritten(self):
        row=self.seed();original=policy.fresh_preflight;concurrent=[]
        def preflight(db,*args):
            value=original(db,*args)
            with research.connect(self.path) as writer:
                writer.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                    (row['id'],row['sha'],row['body_sha'],'concurrent-original','[]',NOW.isoformat(),NOW.isoformat(),11))
                concurrent.append(dict(writer.execute('SELECT * FROM official_research_publications').fetchone()))
            return value
        with patch.object(policy,'fresh_preflight',side_effect=preflight):self.assertEqual(self.run_once(),'stale')
        with research.connect(self.path) as db:
            self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),concurrent[0])
            self.assertEqual(db.execute('SELECT count(*) FROM '+policy.AUDIT_TABLE).fetchone()[0],0)
        self.run_once(lambda *_:self.fail('concurrent publication paid fallback'))

    def test_coherent_preflight_survives_aba_restore_without_mixed_state(self):
        self.seed();original=policy.fresh_attempt_valid
        def validate(db,*args):
            result=original(db,*args)
            for detail in ('transient','{}'):
                with research.connect(self.path) as writer:
                    writer.execute('UPDATE signal_headline_translation_calls SET usage=?',(detail,))
            return result
        with patch.object(policy,'fresh_attempt_valid',side_effect=validate):self.assertEqual(self.run_once(),'done')
        self.assertEqual(len(self.feed()),1)
        self.run_once(lambda *_:self.fail('ABA paid retry'))

    def test_unrelated_cache_and_feed_commits_do_not_starve_paid_assessment(self):
        self.seed();original=policy.fresh_attempt_valid;seen=[]
        def validate(db,*args):
            value=original(db,*args)
            with research.connect(self.path) as writer:
                writer.execute("INSERT INTO signal_index_state VALUES('unrelated-cache','new-state')")
            self.raw('Micron $MU signed an agreement to supply memory for a new industrial project.',number=123000,
                     published_at=SOURCE_AT,first_seen_at=ACQUIRED,last_seen_at=ACQUIRED)
            with research.connect(self.path) as writer:
                news.admit_retained(writer,NOW)
            seen.append(True);return value
        with patch.object(policy,'fresh_attempt_valid',side_effect=validate):self.assertEqual(self.run_once(),'done')
        self.assertTrue(seen);self.assertEqual(len(self.feed()),1)
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_events').fetchone()[0],2)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
