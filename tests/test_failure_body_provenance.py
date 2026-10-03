"""Failed-output provenance remains explicit across refreshed issuer bodies."""
from datetime import timedelta
import json
import unittest
from unittest.mock import patch
import test_business_failed_diagnostics as fixtures
import test_general_source_news as general_fixture
import test_official_research as official_fixture
import official_research as research

class FailureBodyProvenanceTests(fixtures.BusinessFailedDiagnosticsTests):
    def test_old_issuer_copy_after_refresh_is_visible_but_unverified(self):
        row=self.issuer_row()
        self.reject(row,note=official_fixture.NOTE,failed_at=(fixtures.NOW-timedelta(seconds=5)).isoformat())
        result=self.queue()
        context=self.context(result)
        self.assertFalse(context['generationBodyVerified'])
        self.assertEqual(context['generationBodyProvenance'],'unverified-generation-body-not-recorded')
        self.assertIsNone(context['recordedGenerationBodySha'])
        self.assertTrue(any(f['selectedEvidenceIsLiteralCurrentBody'] for f in context['fields']))
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT state FROM official_research_jobs').fetchone()[0],'retry')
    def test_recorded_matching_or_different_generation_body_is_distinguished(self):
        row=self.issuer_row();lease=self.reject(row,note=official_fixture.NOTE)
        with research.connect(self.path) as db:
            db.execute('INSERT INTO official_research_attempt_body_proofs VALUES(?,?,?)',(lease,row['sha'],row['body_sha']))
        context=self.context(self.queue())
        self.assertTrue(context['generationBodyVerified'])
        self.assertEqual(context['generationBodyProvenance'],'verified-current-generation-body')
        with research.connect(self.path) as db:
            db.execute("UPDATE official_research_attempt_body_proofs SET body_sha='old-body-sha'")
        context=self.context(self.queue())
        self.assertFalse(context['generationBodyVerified'])
        self.assertEqual(context['generationBodyProvenance'],'generation-body-differs-from-current')
        self.assertEqual(context['recordedGenerationBodySha'],'old-body-sha')
    def test_future_failed_attempt_records_the_actual_selected_body_hash(self):
        row=self.general_row()
        note={'facts':json.loads(json.dumps(general_fixture.CEO_COPY))}
        note['facts'][1]['ja']=note['facts'][1]['ja'].replace('2028','2040')
        def response(*_):
            return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(note)}]}]}
        with patch.object(research,'prepare_story_body',return_value='idle'):
            self.assertEqual(research.run_once(self.path,response,general_fixture.ENV,fixtures.NOW.timestamp()),'retry')
        with research.connect(self.path) as db:
            proof=db.execute('SELECT * FROM official_research_attempt_body_proofs').fetchone()
            self.assertEqual((proof['source_sha'],proof['body_sha']),(row['sha'],row['body_sha']))
            self.assertEqual(proof['lease'],db.execute('SELECT lease FROM official_research_attempt_failures').fetchone()[0])

for _name in vars(fixtures.BusinessFailedDiagnosticsTests):
    if _name.startswith('test_'):setattr(FailureBodyProvenanceTests,_name,None)

if __name__=='__main__':unittest.main()
