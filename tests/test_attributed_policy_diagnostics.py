"""Existing owner-only record, bounded booleans, no writes or provider disclosure."""
from contextlib import contextmanager
import json
import sqlite3
import unittest
from unittest.mock import patch
import test_attributed_policy_publication as fixture
import attributed_policy_diagnostics as diagnostic
import official_research_diagnostics as owner


class PolicyDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.case=fixture.PolicyPublicationTests();self.case.setUp();self.addCleanup(self.case.doCleanups)
        self.row=self.case.hold()

    @contextmanager
    def read(self):
        db=sqlite3.connect(self.case.path.resolve().as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
        db.execute('PRAGMA query_only=ON');db.execute('BEGIN')
        before=list(db.iterdump())
        try:
            yield db
            self.assertEqual(list(db.iterdump()),before);self.assertEqual(db.total_changes,0)
        finally:db.close()

    def probe(self):
        with self.read() as db,patch.object(fixture.policy,'publish_held',side_effect=AssertionError('writer forbidden')):
            return diagnostic.recovery_probe(db,self.row,fixture.NOW)

    def test_complete_preflight_does_not_authorize_or_write(self):
        value=self.probe();self.assertEqual(value['firstRefusal'],'preflight-passed-atomic-recheck-required')
        self.assertTrue(value['checks']['storedAssessmentExplicitPositive']);self.assertTrue(value['checks']['closedAttemptVerified'])
        self.assertFalse(value['publicationAuthorized']);self.assertFalse(value['atomicRecheckPerformed'])
        self.assertTrue(all(type(check) is bool for check in value['checks'].values()))
        self.assertEqual(self.case.feed(),[])

    def test_owner_existing_record_renders_bounded_probe(self):
        result=owner.queue(self.case.path,reference=fixture.NOW)
        item=next(item for item in result['terminalReviews']['items'] if item['eventId']==self.row['id'])
        checks=item['latestFailure']['validation']['issues'][0]['checks']
        probe=next(check for check in checks if check['check']=='editor-only-policy-recovery')
        self.assertEqual(probe['firstRefusal'],'preflight-passed-atomic-recheck-required')
        self.assertEqual(item['status'],'terminal-review')

    def test_secrets_provider_fields_source_copy_and_lease_are_not_serialized(self):
        self.case.mutate("UPDATE signal_headline_translation_calls SET model='private-model-secret',usage='private-usage-secret'")
        self.case.mutate("UPDATE official_research_attempt_failures SET detail='private-provider-secret'")
        encoded=json.dumps(self.probe(),ensure_ascii=False)
        for forbidden in ('private-','WHITE HOUSE','HASSETT','Private model copy','https://','sourceSha','bodySha','lease','output_tokens','raw_response','payload'):
            self.assertNotIn(forbidden,encoded)

    def test_missing_and_ambiguous_assessment_report_refusal(self):
        for value in (None,'{}',json.dumps({'facts':fixture.positive()['facts']}),json.dumps({'disposition':'review','reason':'not-material-business-news','facts':[]})):
            with self.subTest(value=value):
                self.case.mutate('UPDATE official_research_attempt_failures SET payload=?',(value,))
                probe=self.probe();self.assertIn(probe['firstRefusal'],{'stored-assessment-unavailable','stored-positive-assessment-unverified'})
        self.case.mutate("INSERT INTO official_research_attempt_failures SELECT lease||'extra',event_id,sha,failed_at,reason,detail,payload FROM official_research_attempt_failures")
        self.assertEqual(self.probe()['firstRefusal'],'current-failure-not-unique')

    def test_source_change_does_not_validate_stale_row(self):
        self.case.mutate("UPDATE signal_x_acquisition SET sha='new-current-revision'")
        self.assertEqual(self.probe()['firstRefusal'],'current-source-unverified')

    def test_missing_closed_call_or_body_proof_is_explained(self):
        self.case.mutate('DELETE FROM official_research_attempt_body_proofs')
        value=self.probe();self.assertEqual(value['firstRefusal'],'closed-attempt-proof-unverified')
        self.assertFalse(value['checks']['closedAttemptVerified'])
