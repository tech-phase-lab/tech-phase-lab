"""Read-only owner explanations; no macro admission or publication changes."""
from contextlib import contextmanager
from datetime import timedelta
import json
import sqlite3
import unittest
from unittest.mock import patch

import test_macro_source_publication as fixtures
NOW, CPI = fixtures.NOW, fixtures.CPI
import macro_source_diagnostics as diagnostic
import macro_source_publication as publication
import official_research as research
import official_research_diagnostics as owner


class MacroRecoveryDiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.MacroPublicationTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.row = self.fixture.hold()

    @contextmanager
    def read(self):
        db = sqlite3.connect(self.fixture.path.resolve().as_uri() + '?mode=ro', uri=True)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        before = list(db.iterdump())
        try:
            yield db
            self.assertEqual(db.total_changes, 0)
            self.assertEqual(list(db.iterdump()), before)
        finally:
            db.close()

    def probe(self):
        with self.read() as db, patch.object(publication, 'publish_held', side_effect=AssertionError('writer forbidden')):
            return diagnostic.recovery_probe(db, self.row, NOW)

    def mutate(self, sql, args=()):
        with sqlite3.connect(self.fixture.path) as db:
            db.execute(sql, args)

    def test_eligible_diagnostic_is_read_only_and_does_not_authorize_publication(self):
        result = self.probe()
        self.assertEqual(result['firstRefusal'], 'eligible-awaiting-atomic-recheck')
        self.assertTrue(result['checks']['closedAttemptVerified'])
        self.assertTrue(result['checks']['originalPositiveEnvelope'])
        self.assertEqual(result['counts'], {'currentFailures':1,'currentCalls':1,'jobLeaseCalls':1,'jobLeaseBodyProofs':1})
        self.assertFalse(result['publicationAuthorized'])
        self.assertFalse(result['atomicRecheckPerformed'])
        self.assertEqual(self.fixture.feed(), [])

    def test_owner_queue_renders_probe_in_existing_selected_proof_without_changing_history(self):
        with self.read() as db:
            before = publication.artifacts(db, self.row)
        result = owner.queue(self.fixture.path, reference=NOW)
        item = next(item for item in result['terminalReviews']['items'] if item['eventId'] == self.row['id'])
        checks = item['latestFailure']['validation']['issues'][0]['checks']
        probe = next(value for value in checks if value['check'] == 'editor-only-macro-recovery')
        self.assertEqual(probe['firstRefusal'], 'eligible-awaiting-atomic-recheck')
        self.assertEqual(item['status'], 'terminal-review')
        with self.read() as db:
            self.assertEqual(publication.artifacts(db, self.row), before)

    def test_missing_body_proof_stays_diagnosable_without_disclosing_failed_copy(self):
        self.mutate('DELETE FROM official_research_attempt_body_proofs')
        result = owner.queue(self.fixture.path, reference=NOW)
        item = next(item for item in result['terminalReviews']['items'] if item['eventId'] == self.row['id'])
        self.assertEqual(item['latestFailure']['failedCopyContext'], 'unavailable')
        checks = item['latestFailure']['validation']['issues'][0]['checks']
        self.assertFalse(any(value['check'] == 'editor-only-current-failed-output' for value in checks))
        probe = next(value for value in checks if value['check'] == 'editor-only-macro-recovery')
        self.assertEqual(probe['firstRefusal'], 'closed-attempt-proof-unverified')
        self.assertEqual(probe['counts']['jobLeaseBodyProofs'], 0)

    def test_export_is_fixed_codes_counts_and_booleans_without_private_values(self):
        result = self.probe()
        raw = json.dumps(result)
        for value in ('macro-901', self.row['sha'], self.row['body_sha'], self.row['url'],
                      'Model wording', 'material-company-development', 'x-wallstengine'):
            self.assertNotIn(value, raw)
        self.assertLess(len(raw.encode()), 5000)
        def validate(value):
            if isinstance(value, dict):
                for item in value.values(): validate(item)
            else:
                self.assertIn(type(value), (str, bool, int, float, type(None)))
        validate(result)

    def test_first_refusal_order_audit_then_publication(self):
        self.assertEqual(self.fixture.recover(), 'done')
        result = self.probe()
        self.assertEqual(result['firstRefusal'], 'existing-current-audit')
        self.mutate('DELETE FROM ' + publication.AUDIT_TABLE)
        self.assertEqual(self.probe()['firstRefusal'], 'existing-publication-record')

    def test_current_failure_count_precedes_envelope_and_closed_proof(self):
        self.mutate("INSERT INTO official_research_attempt_failures SELECT 'other',event_id,sha,failed_at,reason,detail,NULL FROM official_research_attempt_failures")
        result = self.probe()
        self.assertEqual(result['firstRefusal'], 'current-failure-not-unique')
        self.assertEqual(result['counts']['currentFailures'], 2)

    def test_missing_or_oversize_response_has_exact_first_boundary(self):
        for value, reason in ((None, 'stored-response-unavailable'), ('x'*131073, 'stored-response-limit')):
            self.mutate('UPDATE official_research_attempt_failures SET payload=?', (value,))
            self.assertEqual(self.probe()['firstRefusal'], reason)

    def test_nonpositive_envelope_does_not_gain_authority_from_parseable_metrics(self):
        self.mutate('UPDATE official_research_attempt_failures SET payload=?',
                    (json.dumps({'disposition':'review','reason':'not-material','facts':[]}),))
        result = self.probe()
        self.assertEqual(result['firstRefusal'], 'closed-attempt-proof-unverified')
        self.assertFalse(result['checks']['originalPositiveEnvelope'])
        self.assertFalse(result['checks']['closedAttemptVerified'])

    def test_attempt_count_and_extra_same_source_sha_call_are_visible(self):
        self.mutate('UPDATE official_research_jobs SET attempts=2')
        result = self.probe()
        self.assertFalse(result['checks']['jobSingleAttempt'])
        self.assertEqual(result['firstRefusal'], 'closed-attempt-proof-unverified')
        self.mutate('UPDATE official_research_jobs SET attempts=1')
        self.mutate("INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) SELECT at,source_id,sha,model,state,'other-lease' FROM signal_headline_translation_calls")
        result = self.probe()
        self.assertEqual(result['counts']['currentCalls'], 2)
        self.assertEqual(result['counts']['jobLeaseCalls'], 1)
        self.assertFalse(result['checks']['closedAttemptVerified'])

    def test_unique_closed_call_exports_exact_bounded_clock_fields_only(self):
        self.mutate('UPDATE signal_headline_translation_calls SET at=at+0.001')
        result = self.probe()
        self.assertFalse(result['checks']['reviewStartMatchesCall'])
        clocks = result['matchedClocks']
        with self.read() as db:
            original = publication.artifacts(db, self.row)
        self.assertEqual(clocks['callStartEpochSeconds'], original['calls'][0]['at'])
        self.assertEqual(clocks['reviewStartedAt']['value'], original['review']['started_at'])
        self.assertEqual(clocks['reviewDecidedAt']['value'], original['review']['decided_at'])
        self.assertEqual(clocks['failureFailedAt']['value'], original['failures'][0]['failed_at'])
        self.assertFalse(clocks['jobStartEndRecorded'])
        self.assertFalse(clocks['callEndRecorded'])
        self.mutate("INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) SELECT at,source_id,sha,model,state,'ambiguous' FROM signal_headline_translation_calls")
        result = self.probe()
        self.assertEqual(result['counts']['currentCalls'], 2)
        self.assertNotIn('matchedClocks', result)
        self.assertFalse(result['checks']['matchedClockEvidenceAvailable'])

    def test_clock_state_proof_and_failure_reason_mismatches_are_boolean_only(self):
        mutations = [
            ("UPDATE signal_headline_translation_calls SET state='running'", 'callFailed'),
            ('UPDATE signal_headline_translation_calls SET at=at+0.001', 'reviewStartMatchesCall'),
            ("UPDATE official_research_attempt_body_proofs SET body_sha='changed'", 'bodyProofMatches'),
            ("UPDATE official_research_jobs SET failure_kind='invalid-copy'", 'failureReasonMatchesJob'),
            ("UPDATE general_source_semantic_reviews SET reason='not-material'", 'reviewReasonAllowed'),
            ("UPDATE general_source_semantic_reviews SET decided_at='invalid'", 'reviewDecisionClockValid'),
        ]
        for sql, check in mutations:
            with self.subTest(check=check), sqlite3.connect(self.fixture.path) as db:
                db.execute('BEGIN')
                db.execute(sql)
                db.row_factory = sqlite3.Row
                result = diagnostic.recovery_probe(db, self.row, NOW)
                self.assertEqual(result['firstRefusal'], 'closed-attempt-proof-unverified')
                self.assertFalse(result['checks'][check])
                db.rollback()

    def test_retained_identity_failure_is_distinct_from_closed_proof(self):
        self.mutate("UPDATE signal_x_acquisition SET first_seen_at=?", ((NOW-timedelta(minutes=5)).isoformat(),))
        result = self.probe()
        self.assertTrue(result['checks']['closedAttemptVerified'])
        self.assertEqual(result['firstRefusal'], 'retained-source-proof-unverified')

    def test_ownership_is_reported_even_when_earlier_closed_proof_fails(self):
        self.fixture.market(self.row)
        self.mutate('UPDATE official_research_jobs SET attempts=2')
        result = self.probe()
        self.assertEqual(result['firstRefusal'], 'closed-attempt-proof-unverified')
        self.assertEqual(result['ownership']['classification'], 'verified-expired-market-history')
        self.assertFalse(result['ownership']['blocked'])
        self.assertEqual(result['ownership']['currentProjection']['supported'], 1)

    def test_expired_eurozone_nonprojection_is_distinct_but_remains_guarded(self):
        row = self.fixture.hold(CPI, number=902)
        # Store a synthetic legacy result identity. No claim that its old copy
        # is valid; current projection must conclusively return None.
        with research.connect(self.fixture.path) as db:
            publication.market_results.schema(db)
            db.execute("UPDATE signal_events SET tickers_json='[\"ECON\"]' WHERE id=?", (row['id'],))
            value={'id':str(row['id']),'url':row['url'],'publisher':'Wall St Engine',
                   'publishedAt':row['published_at'],'observedAt':row['observed_at'],'researchId':'x-result-'+str(row['id'])}
            db.execute('INSERT INTO market_result_publications VALUES(?,?,?,?,?,?,?)',
                (row['id'],row['source_id'],row['url'],row['sha'],json.dumps(value),row['observed_at'],0))
        self.row = row
        result = self.probe()
        self.assertEqual(result['firstRefusal'], 'independent-ownership-held')
        self.assertEqual(result['ownership']['classification'], 'unverified-historical-market-result')
        self.assertEqual(result['ownership']['currentProjection'], {'supported':0,'notProjectable':1,'unavailable':0})
        self.assertTrue(result['ownership']['blocked'])
        self.assertEqual(result['ownership']['marketMetadata'],
                         {'sourceAndClocksMatch':1,'payloadIdentityMatches':1,'originalWindowEligible':1})
        self.mutate("UPDATE market_result_publications SET payload='{}'")
        self.assertEqual(self.probe()['ownership']['marketMetadata']['payloadIdentityMatches'], 0)
        self.assertEqual(self.fixture.recover(), 'done')  # The unrelated eligible jobs hold advances.
        self.assertIsNone(self.fixture.recover())
        self.assertFalse(any(item['url'] == row['url'] for item in self.fixture.feed()))

    def test_query_error_is_not_relabelled_as_nonprojectable_or_eligible(self):
        with patch.object(publication, 'ownership_state', side_effect=sqlite3.OperationalError('private detail')):
            result = self.probe()
        self.assertEqual(result['firstRefusal'], 'ownership-diagnostic-unavailable')
        self.assertEqual(result['ownership'], {'classification':'diagnostic-unavailable','blocked':True})
        self.assertNotIn('private detail', json.dumps(result))

    def test_unknown_format_is_not_given_macro_diagnostics(self):
        self.row = {**self.row, 'body':'All EST: 8:30 jobs report tomorrow'}
        self.assertIsNone(self.probe())


if __name__ == '__main__':
    unittest.main()
