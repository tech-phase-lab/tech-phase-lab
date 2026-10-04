"""Isolated macro audit, materiality, ownership and lifecycle regressions."""
from copy import deepcopy
from datetime import timedelta
import json
import unittest
from unittest.mock import patch

import test_retained_business_admission as fixture
from test_macro_source_news import JOBS, CPI
import general_source_news as news
import official_research as research
import macro_source_publication as macro
import market_results

NOW = fixture.NOW
START = NOW - timedelta(seconds=30)
FAILED = NOW - timedelta(seconds=20)


def positive():
    return {'disposition':'publish','reason':'material-company-development',
            'facts':[{'ja':'モデルの文面は公開しない。','en':'Model wording must never be public.','evidenceId':'1'}]}


def response(value=None):
    return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(value or positive())}]}]}


class MacroPublicationTests(unittest.TestCase):
    setUp = fixture.RetainedBusinessAdmissionTests.setUp
    raw = fixture.RetainedBusinessAdmissionTests.raw
    admit = fixture.RetainedBusinessAdmissionTests.admit
    run_once = fixture.RetainedBusinessAdmissionTests.run_once

    def row(self, body=JOBS, number=901, **changes):
        self.raw(body,number=number,**changes)
        self.admit()
        with research.connect(self.path) as db:
            return next(row for row in news.candidates(db,NOW,include_review=True) if row['url'].endswith('/'+str(number)))

    def hold(self, body=JOBS, number=901, **changes):
        row=self.row(body,number,**changes)
        lease='macro-'+str(number)
        raw=json.dumps(positive(),ensure_ascii=False)
        with research.connect(self.path) as db:
            db.execute('INSERT INTO official_research_jobs VALUES(?,?,?,?,?,?,?)',
                       (row['id'],row['sha'],1,NOW.timestamp()+300,lease,'review','invalid-note'))
            db.execute('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
                       (START.timestamp(),'research:'+row['source_id'],row['sha'],fixture.ENV['OFFICIAL_HEADLINE_TRANSLATION_MODEL'],'failed',lease))
            db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                       (lease,row['id'],row['sha'],FAILED.isoformat(),'invalid-note','',raw))
            db.execute('INSERT INTO official_research_attempt_body_proofs VALUES(?,?,?)',(lease,row['sha'],row['body_sha']))
            news.save_semantic_review(db,row,lease,START.isoformat(),FAILED.isoformat(),'unsubstantiated-model-output')
        return row

    def active_times(self):
        return {'published_at':(NOW-timedelta(hours=1)).isoformat(),
                'first_seen_at':(NOW-timedelta(hours=1)+timedelta(seconds=28)).isoformat(),
                'last_seen_at':(NOW-timedelta(minutes=1)).isoformat()}

    def market(self,row):
        with research.connect(self.path) as db:
            market_results.schema(db)
            db.execute("UPDATE signal_events SET tickers_json='[\"ECON\"]' WHERE id=?",(row['id'],))
            value=market_results.projection(row['body'],['ECON'])
            value.update({'id':str(row['id']),'url':row['url'],'publisher':'Wall St Engine',
                          'publishedAt':row['published_at'],'observedAt':row['observed_at'],
                          'researchId':'x-result-'+str(row['id'])})
            published=(news.reconciliation.instant(row['observed_at'])+timedelta(seconds=1)).isoformat()
            db.execute('INSERT INTO market_result_publications VALUES(?,?,?,?,?,?,?)',
                       (row['id'],row['source_id'],row['url'],row['sha'],json.dumps(value),published,0))
            return dict(db.execute('SELECT * FROM market_result_publications WHERE event_id=?',(row['id'],)).fetchone())

    def recover(self, **kwargs):
        with research.connect(self.path) as db:
            return macro.publish_held(db,NOW,clock=kwargs.get('clock',lambda:NOW))

    def feed(self, at=NOW):
        with research.connect(self.path) as db:
            return news.public_items(db,at)

    def mutate(self, sql, parameters=()):
        with research.connect(self.path) as db:db.execute(sql,parameters)

    def test_held_correction_preserves_original_history_clocks_and_budget(self):
        row=self.hold()
        with research.connect(self.path) as db:
            before=macro.artifacts(db,row)
            source=macro.source_snapshot(db,row,NOW)
        with patch('socket.create_connection',side_effect=AssertionError('network forbidden')):
            self.assertEqual(self.recover(),'done')
        with research.connect(self.path) as db:
            self.assertEqual(macro.artifacts(db,row),before)
            self.assertEqual(macro.source_snapshot(db,row,NOW),source)
            self.assertIsNone(news.semantic_review(db,row,NOW))
            saved=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            self.assertEqual(saved['started_at'],NOW.isoformat())
            self.assertEqual(saved['public_at'],NOW.isoformat())
            self.assertNotEqual(saved['public_at'],FAILED.isoformat())
            self.assertEqual(db.execute('SELECT state FROM official_research_jobs').fetchone()[0],'review')
            audit=db.execute('SELECT * FROM '+macro.AUDIT_TABLE).fetchone()
            self.assertEqual(audit['derived_at'],saved['public_at'])
            self.assertEqual(audit['original_artifacts'],macro.encoded(before))
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
        item=self.feed()[0]
        self.assertEqual(item['publishedAt'],fixture.PUBLISHED)
        self.assertEqual(item['observedAt'],fixture.FIRST)
        self.assertEqual(item['tickers'],[])
        self.assertIn('nonfarm payrolls +31K',item['title'])
        self.assertEqual(len(item['bodyEn'].split('\n\n')),8)
        self.assertNotIn('Model wording',str(item))
        self.assertIsNone(self.recover())
        self.assertEqual(self.run_once(lambda *_:self.fail('paid retry')),'idle')

    def test_zero_call_held_correction_does_not_require_enabled_provider_config(self):
        self.hold()
        self.assertEqual(self.run_once(lambda *_:self.fail('provider invoked'),env={}), 'done')
        self.assertEqual(len(self.feed()), 1)

    def test_fresh_positive_uses_one_existing_assessment_and_exact_source_copy(self):
        self.raw(JOBS)
        calls=[]
        def provider(payload,key):
            calls.append(payload)
            self.assertIn(macro.POLICY,payload['instructions'])
            return response()
        self.assertEqual(self.run_once(provider),'done')
        self.assertEqual(len(calls),1)
        item=self.feed()[0]
        self.assertIn('+31,000人',item['translationJa'])
        self.assertNotIn('モデルの文面',str(item))
        with research.connect(self.path) as db:
            audit=db.execute('SELECT * FROM '+macro.AUDIT_TABLE).fetchone()
            self.assertEqual(audit['mode'],'fresh-assessment')
            self.assertEqual(json.loads(audit['original_response']),positive())
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_attempt_failures').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_attempt_body_proofs').fetchone()[0],1)
        self.assertEqual(self.run_once(lambda *_:self.fail('second assessment')),'idle')

    def test_fresh_explicit_negative_remains_terminal_without_macro_publication(self):
        self.raw(CPI)
        value={'disposition':'review','reason':'not-material-business-news','facts':[]}
        self.assertEqual(self.run_once(lambda *_:response(value)),'review')
        self.assertEqual(self.feed(),[])
        self.assertIsNone(self.recover())
        self.assertEqual(self.run_once(lambda *_:self.fail('negative review retried')),'idle')

    def test_historical_missing_or_negative_materiality_never_uses_numeric_match(self):
        for payload in (None, '{}', json.dumps({'disposition':'review','reason':'not-material-business-news','facts':[]}),
                        json.dumps({**positive(),'reason':'insufficient-source-evidence'})):
            with self.subTest(payload=payload):
                case=MacroPublicationTests();case.setUp()
                try:
                    row=case.hold()
                    case.mutate('UPDATE official_research_attempt_failures SET payload=? WHERE event_id=?',(payload,row['id']))
                    self.assertIsNone(case.recover());self.assertEqual(case.feed(),[])
                finally:case.doCleanups()

    def test_explicit_review_reason_has_priority_over_positive_failure_envelope(self):
        for reason in ('not-material-business-news','insufficient-source-evidence','ambiguous-actor-or-action','unsupported-buyback-structure'):
            case=MacroPublicationTests();case.setUp()
            try:
                row=case.hold()
                case.mutate('UPDATE general_source_semantic_reviews SET reason=? WHERE event_id=?',(reason,row['id']))
                self.assertIsNone(case.recover());self.assertEqual(case.feed(),[])
            finally:case.doCleanups()

    def test_missing_or_changed_closed_proofs_cannot_release_hold(self):
        changes=[("DELETE FROM official_research_attempt_body_proofs",()),
                 ("UPDATE official_research_attempt_body_proofs SET body_sha='bad'",()),
                 ("UPDATE official_research_jobs SET state='running'",()),
                 ("UPDATE official_research_jobs SET attempts=2",()),
                 ("UPDATE signal_headline_translation_calls SET state='done'",()),
                 ("UPDATE official_research_attempt_failures SET failed_at=?",((NOW+timedelta(seconds=1)).isoformat(),)),
                 ("UPDATE signal_headline_translation_calls SET source_id='research:unapproved'",())]
        for sql,params in changes:
            with self.subTest(sql=sql):
                case=MacroPublicationTests();case.setUp()
                try:
                    case.hold();case.mutate(sql,params)
                    self.assertIsNone(case.recover());self.assertEqual(case.feed(),[])
                finally:case.doCleanups()

    def test_multiple_closed_calls_or_failures_are_ambiguous(self):
        self.hold()
        self.mutate('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) SELECT at,source_id,sha,model,state,lease||"-extra" FROM signal_headline_translation_calls')
        self.assertIsNone(self.recover())

    def test_public_read_revokes_on_every_identity_history_audit_copy_change(self):
        changes=["UPDATE signal_documents SET text=text||' changed'",
                 "UPDATE official_research_attempt_body_proofs SET body_sha='different'",
                 "UPDATE official_research_attempt_failures SET detail='changed'",
                 "UPDATE signal_headline_translation_calls SET usage='changed'",
                 "UPDATE official_research_jobs SET attempts=2",
                 "UPDATE general_source_semantic_reviews SET reason='not-material-business-news'",
                 "UPDATE source_macro_news_derivations SET policy_version=99",
                 "UPDATE source_macro_news_derivations SET original_response='{}'",
                 "UPDATE official_research_publications SET payload='{}'",
                 "DELETE FROM source_macro_news_derivations"]
        for sql in changes:
            with self.subTest(sql=sql):
                case=MacroPublicationTests();case.setUp()
                try:
                    case.hold();self.assertEqual(case.recover(),'done');self.assertEqual(len(case.feed()),1)
                    case.mutate(sql);self.assertEqual(case.feed(),[])
                    self.assertNotEqual(case.run_once(lambda *_:self.fail('damaged audit authorized paid retry')),'done')
                finally:case.doCleanups()

    def test_only_exact_millisecond_review_precision_gets_bounded_order_tolerance(self):
        cases=[(FAILED.replace(microsecond=456789),FAILED.replace(microsecond=456000).isoformat(timespec='milliseconds'),True),
               (FAILED.replace(microsecond=456789),FAILED.replace(microsecond=455000).isoformat(timespec='milliseconds'),False),
               (FAILED.replace(microsecond=456789),FAILED.replace(microsecond=456000).isoformat(timespec='microseconds'),False),
               (NOW.replace(microsecond=500),NOW.isoformat(timespec='milliseconds'),False)]
        for failed,decided,allowed in cases:
            with self.subTest(failed=failed,decided=decided):
                case=MacroPublicationTests();case.setUp()
                try:
                    row=case.hold()
                    case.mutate('UPDATE official_research_attempt_failures SET failed_at=?',(failed.isoformat(),))
                    case.mutate('UPDATE general_source_semantic_reviews SET decided_at=?',(decided,))
                    with research.connect(case.path) as db:before=macro.artifacts(db,row)
                    self.assertEqual(case.recover(),'done' if allowed else None)
                    self.assertEqual(len(case.feed()),int(allowed))
                    with research.connect(case.path) as db:self.assertEqual(macro.artifacts(db,row),before)
                finally:case.doCleanups()

    def test_older_revision_calls_are_part_of_immutable_attempt_history(self):
        row=self.hold()
        with research.connect(self.path) as db:
            db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                       ('older',row['id'],'older-sha',(START-timedelta(seconds=10)).isoformat(),'provider-unavailable','older',None))
            db.execute('INSERT INTO official_research_attempt_body_proofs VALUES(?,?,?)',('older','older-sha','older-body'))
            db.execute('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
                       ((START-timedelta(seconds=20)).timestamp(),'research:'+row['source_id'],'older-sha','older-model','failed','older'))
            original=macro.artifacts(db,row)
            self.assertEqual(len(original['calls']),2)
        self.assertEqual(self.recover(),'done')
        self.assertEqual(len(self.feed()),1)
        self.mutate("UPDATE signal_headline_translation_calls SET usage='changed older history' WHERE lease='older'")
        self.assertEqual(self.feed(),[])

    def test_fresh_conflicting_body_proof_closes_terminal_without_paid_retry(self):
        self.raw(JOBS)
        calls=[]
        def provider(*_):
            calls.append(1)
            with research.connect(self.path) as db:
                row=news.candidates(db,NOW)[0]
                lease=db.execute('SELECT lease FROM official_research_jobs').fetchone()[0]
                db.execute('INSERT INTO official_research_attempt_body_proofs VALUES(?,?,?)',(lease,row['sha'],'conflicting-body'))
            return response()
        self.assertEqual(self.run_once(provider),'review')
        self.assertEqual(self.feed(),[])
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT state,failure_kind FROM official_research_jobs').fetchone()[:],
                             ('review','source-event-identity-mismatch'))
            self.assertEqual(db.execute('SELECT state FROM signal_headline_translation_calls').fetchone()[0],'failed')
            self.assertEqual(db.execute('SELECT body_sha FROM official_research_attempt_body_proofs').fetchone()[0],'conflicting-body')
            failure=db.execute('SELECT payload FROM official_research_attempt_failures').fetchone()[0]
            self.assertEqual(json.loads(failure),positive())
            self.assertEqual(db.execute('SELECT count(*) FROM '+macro.AUDIT_TABLE).fetchone()[0],0)
            db.execute('UPDATE official_research_jobs SET next_at=0')
        self.assertEqual(self.run_once(lambda *_:self.fail('proof conflict retried')),'idle')
        self.assertEqual(calls,[1])

    def test_existing_negative_review_is_never_rewritten_by_fresh_audit_hold(self):
        self.raw(JOBS)
        original=[]
        def provider(*_):
            with research.connect(self.path) as db:
                row=news.candidates(db,NOW)[0]
                lease=db.execute('SELECT lease FROM official_research_jobs').fetchone()[0]
                news.save_semantic_review(db,row,lease,NOW.isoformat(),NOW.isoformat(),'not-material-business-news')
                original.append(dict(db.execute('SELECT * FROM general_source_semantic_reviews').fetchone()))
            return response()
        self.assertEqual(self.run_once(provider),'review')
        self.assertEqual(self.feed(),[])
        with research.connect(self.path) as db:
            self.assertEqual(dict(db.execute('SELECT * FROM general_source_semantic_reviews').fetchone()),original[0])
        self.assertEqual(self.run_once(lambda *_:self.fail('negative review retried')),'idle')
        self.assertIsNone(self.recover())

    def test_fresh_original_response_is_bound_to_independent_immutable_proof(self):
        self.raw(CPI)
        self.assertEqual(self.run_once(lambda *_:response()),'done')
        self.assertEqual(len(self.feed()),1)
        revised=positive();revised['facts'][0]['en']='Different but still positive model wording.'
        self.mutate('UPDATE '+macro.AUDIT_TABLE+' SET original_response=?',(json.dumps(revised),))
        self.assertEqual(self.feed(),[])
        self.assertEqual(self.run_once(lambda *_:self.fail('raw response edit retried')),'idle')
        with research.connect(self.path) as db:
            proof=db.execute('SELECT * FROM source_macro_assessment_proofs').fetchone()
            self.assertEqual(json.loads(proof['raw_response']),positive())
            self.assertEqual(proof['raw_response_sha'],news.digest(proof['raw_response']))

    def test_damaged_fresh_audit_is_diagnosed_as_held_not_automatic_pending(self):
        self.raw(CPI)
        self.assertEqual(self.run_once(lambda *_:response()),'done')
        self.mutate('DELETE FROM '+macro.AUDIT_TABLE)
        with research.connect(self.path) as db:
            rows=news.candidates(db,NOW)
            status=research.delivery_diagnostics(db,NOW,rows,set())
            self.assertEqual(status['publicationHeld'],1)
            self.assertEqual(status['automaticPending'],0)
            self.assertEqual(status['publicationHoldReasons'],{'source-event-identity-mismatch':1})

    def test_same_byte_reobservation_preserves_publication_and_original_clocks(self):
        row=self.hold();self.recover();before=self.feed()[0]
        later=NOW+timedelta(minutes=1)
        self.mutate('UPDATE signal_x_acquisition SET last_seen_at=?,selected_for_processing=1',(later.isoformat(),))
        self.mutate('UPDATE signal_documents SET last_seen_at=?',(later.isoformat(),))
        self.assertEqual(self.feed(later),[before])
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT public_at FROM official_research_publications').fetchone()[0],NOW.isoformat())
            self.assertEqual(macro.source_snapshot(db,row,later)['retained']['first_seen_at'],fixture.FIRST)

    def test_genuine_source_revision_or_withdrawal_revokes_immediately(self):
        self.hold();self.recover()
        later=NOW+timedelta(seconds=1)
        self.raw('Correction: the earlier report is withdrawn and should not be relied upon.',number=901,
                 first_seen_at=later.isoformat(),last_seen_at=later.isoformat(),published_at=later.isoformat())
        self.assertEqual(self.feed(later),[])

    def test_new_duplicate_representative_before_commit_prevents_publication(self):
        self.hold()
        ticks=[]
        def clock():
            ticks.append(1)
            if len(ticks)==2:
                self.raw(JOBS,number=899,account='TipRanks',published_at=fixture.PUBLISHED,
                         first_seen_at=(NOW-timedelta(days=2)+timedelta(seconds=10)).isoformat())
                self.admit()
            return NOW
        self.assertEqual(self.recover(clock=clock),'stale')
        self.assertEqual(self.feed(),[])

    def test_atomic_history_mutation_between_prepare_and_commit_is_stale(self):
        self.hold();ticks=[]
        def clock():
            ticks.append(1)
            if len(ticks)==2:self.mutate("UPDATE official_research_attempt_failures SET detail='concurrent'")
            return NOW
        self.assertEqual(self.recover(clock=clock),'stale')
        self.assertEqual(self.feed(),[])

    def test_valid_active_same_url_result_keeps_independent_route_ownership(self):
        row=self.hold(**self.active_times())
        self.market(row)
        self.assertIsNone(self.recover());self.assertEqual(self.feed(),[])
        with research.connect(self.path) as db:
            self.assertEqual(len(market_results.public_feed(db,NOW)),1)
            record=macro.diagnostics(db,NOW)['records'][0]
            self.assertTrue(record['blockedByIndependentOwner'])
            self.assertEqual(record['ownershipReason'],'active-market-result-within-public-page')

    def test_verified_expired_result_allows_one_detailed_note_and_preserves_history(self):
        row=self.hold()
        history=self.market(row)
        self.assertEqual(self.recover(),'done')
        self.assertEqual(len(self.feed()),1)
        with research.connect(self.path) as db:
            self.assertEqual(market_results.public_feed(db,NOW),[])
            self.assertEqual(dict(db.execute('SELECT * FROM market_result_publications').fetchone()),history)
            audit=json.loads(db.execute('SELECT source_snapshot FROM '+macro.AUDIT_TABLE).fetchone()[0])
            self.assertEqual(audit['independent_history']['market'][0]['record'],history)
            record=macro.diagnostics(db,NOW)['records'][0]
            self.assertFalse(record['blockedByIndependentOwner'])
            self.assertEqual(record['ownershipReason'],'verified-expired-market-history')
        self.assertEqual(len(self.feed()[0]['bodyEn'].split('\n\n')),8)
        self.mutate('UPDATE market_result_publications SET processing_ms=1')
        self.assertEqual(self.feed(),[])  # Archived independent history is immutable too.

    def test_active_expired_active_projection_has_only_one_representation(self):
        row=self.hold(**self.active_times());self.market(row)
        later=NOW+timedelta(hours=25)
        with research.connect(self.path) as db:
            self.assertEqual(macro.ownership_state(db,row,NOW)['market'][0]['status'],'active')
            self.assertIsNone(macro.publish_held(db,NOW,clock=lambda:NOW))
            self.assertEqual(macro.publish_held(db,later,clock=lambda:later),'done')
            for reference,expected in ((NOW,'active'),(later,'expired'),(NOW,'active')):
                # Reference-time replay tests classification without rewriting
                # the source or historical first-publication clocks.
                self.assertEqual(macro.ownership_state(db,row,reference)['market'][0]['status'],expected)
                notes=news.public_items(db,reference)
                flashes=market_results.public_feed(db,reference)
                urls=[item['url'] for item in [*notes,*flashes]]
                self.assertEqual(urls.count(row['url']),1)
        self.assertEqual(self.feed(later)[0]['publishedAt'],row['published_at'])

    def test_result_expiry_matches_sqlite_submillisecond_window_exactly(self):
        for source in (NOW-timedelta(hours=24),(NOW-timedelta(hours=24)).replace(microsecond=123456)):
            for offset in (-1,0,1,100,499,500,501,999,1000):
                with self.subTest(source=source,offset=offset):
                    case=MacroPublicationTests();case.setUp()
                    try:
                        row=case.hold(published_at=source.isoformat(),
                                      first_seen_at=(source+timedelta(seconds=28)).isoformat(),
                                      last_seen_at=(source+timedelta(seconds=29)).isoformat())
                        case.market(row)
                        reference=source+timedelta(hours=24,microseconds=offset)
                        with research.connect(case.path) as db:
                            flashes=market_results.public_feed(db,reference)
                            ownership=macro.ownership_state(db,row,reference)
                            expected='active' if flashes else 'expired'
                            self.assertEqual(ownership['market'][0]['status'],expected)
                            self.assertEqual(macro.publish_held(db,reference,clock=lambda:reference),
                                             None if flashes else 'done')
                            self.assertEqual(len(news.public_items(db,reference))+len(market_results.public_feed(db,reference)),1)
                    finally:case.doCleanups()

    def test_unverified_expired_history_is_guarded_with_a_diagnostic_reason(self):
        row=self.hold();self.market(row)
        self.mutate("UPDATE market_result_publications SET payload='{}'")
        self.assertIsNone(self.recover())
        with research.connect(self.path) as db:
            diagnostic=macro.diagnostics(db,NOW)['records'][0]
            self.assertEqual(diagnostic['ownershipReason'],'unverified-historical-market-result')
            self.assertTrue(diagnostic['blockedByIndependentOwner'])
        self.assertEqual(self.feed(),[])

    def test_malformed_historical_clock_holds_before_and_after_publication(self):
        for recovered in (False,True):
            with self.subTest(recovered=recovered):
                case=MacroPublicationTests();case.setUp()
                try:
                    row=case.hold();case.market(row)
                    if recovered:self.assertEqual(case.recover(),'done')
                    case.mutate("UPDATE market_result_publications SET published_at='0001-01-01T00:00:00+00:00'")
                    self.assertIsNone(case.recover())
                    self.assertEqual(case.feed(),[])
                    with research.connect(case.path) as db:
                        self.assertEqual(macro.ownership_state(db,row,NOW)['market'][0]['status'],'unverified')
                    case.hold(CPI,number=902)
                    self.assertEqual(case.recover(),'done')
                    self.assertEqual(len(case.feed()),1)
                    self.assertIn('Eurozone',case.feed()[0]['title'])
                finally:case.doCleanups()

    def test_active_flash_outside_twenty_item_cap_is_not_claimed_visible(self):
        row=self.hold(**self.active_times());self.market(row)
        for index in range(20):
            times=self.active_times()
            times['published_at']=(NOW-timedelta(minutes=50)+timedelta(seconds=index)).isoformat()
            times['first_seen_at']=(NOW-timedelta(minutes=49)+timedelta(seconds=index)).isoformat()
            later=self.row(JOBS.replace('+31K','+'+str(100+index)+'K'),number=1000+index,**times)
            self.market(later)
        with research.connect(self.path) as db:
            self.assertEqual(len(market_results.public_feed(db,NOW)),20)
            status=macro.diagnostics(db,NOW)
            record=next(item for item in status['records'] if item['eventId']==row['id'])
            self.assertEqual(record['ownershipReason'],'active-market-result-outside-public-page')
            self.assertFalse(record['marketRecords'][0]['withinPublicPageSelection'])
            self.assertEqual(status['publicResultLimit'],20)
            self.assertFalse(status['browserDeliveryVerified'])
        self.assertIsNone(self.recover())

    def test_fresh_owned_source_never_consumes_assessment_budget(self):
        row=self.row(**self.active_times());self.market(row)
        self.assertEqual(self.run_once(lambda *_:self.fail('independent owner spent assessment budget')),'idle')
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],0)

    def test_owner_appearing_during_assessment_closes_once_without_publication(self):
        row=self.row(**self.active_times())
        def provider(*_):
            self.market(row)
            return response()
        self.assertEqual(self.run_once(provider),'stale')
        self.assertEqual(self.feed(),[])
        self.mutate('DELETE FROM market_result_publications')
        self.assertEqual(self.run_once(lambda *_:self.fail('closed source repeated')),'idle')

    def test_unsupported_earlier_hold_does_not_block_later_supported_report(self):
        self.hold('A calendar report lists upcoming inflation news and a central-bank event.',number=901)
        self.hold(CPI,number=902)
        self.assertEqual(self.recover(),'done')
        self.assertIn('Eurozone',self.feed()[0]['title'])
        self.assertIsNone(self.recover())

    def test_strict_marker_types_and_entire_source_derivation_are_required(self):
        row=self.hold();self.recover()
        with research.connect(self.path) as db:
            note=json.loads(db.execute('SELECT payload FROM official_research_publications').fetchone()[0])
        for mutation in ({**note,'generalSourceVersion':True},
                         {**note,macro.MARKER:{'version':True,'parserVersion':1}},
                         {**note,'macroTitles':{'ja':'偽の見出し','en':'Fake headline'}}):
            with self.assertRaises(ValueError):macro.validate_note(mutation,row)


if __name__=='__main__':unittest.main()
