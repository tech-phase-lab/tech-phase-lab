"""Read-only metadata stays bounded and distinguishes cross-lane dispositions."""
from datetime import datetime
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import general_source_news as general
import issuer_business_news as issuer_news
import issuer_syndication as issuer
import news_pipeline_diagnostics as pipeline
import official_research as research
import official_research_diagnostics as diagnostics
import signals
from test_issuer_business_news import BODY,TITLE,URL,SOURCE,markup,NOW,PUBLISHED,OBSERVED
from test_retained_business_admission import RetainedBusinessAdmissionTests
from test_business_failed_diagnostics import BusinessFailedDiagnosticsTests

class PipelineDiagnosticsTests(unittest.TestCase):
    raw=RetainedBusinessAdmissionTests.raw
    seed=BusinessFailedDiagnosticsTests.seed
    general_row=BusinessFailedDiagnosticsTests.general_row
    reject=BusinessFailedDiagnosticsTests.reject
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'db.sqlite'
        with research.connect(self.path) as db:issuer.schema(db)
    def snapshot(self):
        db=sqlite3.connect(self.path.resolve().as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
        try:
            db.execute('PRAGMA query_only=ON')
            with patch.object(signals,'fetch',side_effect=AssertionError('fetch')):
                return pipeline.snapshot(db,NOW)
        finally:db.close()
    def prepare(self):
        with research.connect(self.path) as db:
            signals.save(db,SOURCE,[{'url':URL,'title':TITLE,'text':TITLE,'matches':{'NBIS':['Nebius']},'publishedAt':PUBLISHED,'truncated':False}],{},OBSERVED,'fixture',1)
        issuer.run_once(self.path,NOW,request=lambda *_:{'body':markup(BODY,TITLE,URL,'Nebius')})
    def test_only_specific_model_identifier_is_read(self):
        env={'OFFICIAL_HEADLINE_TRANSLATION_MODEL':'gpt-4.1-mini','OPENAI_API_KEY':'never-expose-me'}
        with patch.dict(os.environ,env,clear=True):
            value=self.snapshot()
            self.assertEqual(value['configuredModel'],'gpt-4.1-mini')
            self.assertNotIn('never-expose-me',json.dumps(value))
        with patch.dict(os.environ,{'OFFICIAL_HEADLINE_TRANSLATION_MODEL':'sk-secret'},clear=True):
            self.assertIsNone(pipeline.configured_model())
    def test_issuer_preparation_reason_is_cross_laned_not_extra_missing(self):
        self.prepare()
        value=self.snapshot()['issuerPreparation'];row=value['records'][0]
        self.assertEqual(value['counts'],{'unsupported-facts':1})
        self.assertEqual(row['generationDisposition'],'generation-pending')
        self.assertEqual(row['generationEligibilityReason'],'eligible')
        self.assertEqual(row['companyRoleEvidence']['role'],'monitored-issuer')
        self.assertEqual(row['url'],URL)
        self.assertNotIn('body',row)
    def test_unknown_raw_wording_is_visible_and_coverage_is_separate(self):
        self.raw('Micron $MU has sent engineering samples to selected customers.')
        value=self.snapshot()
        self.assertEqual(value['retainedIntake']['counts']['retainedRevisionRows'],1)
        self.assertFalse(value['retainedIntake']['coverage']['completeUpstreamCoverage'])
        self.assertTrue(value['retainedIntake']['coverage']['retentionTargetIsSoft'])
        coverage=value['acquisitionCoverage']['x-wallstengine']
        self.assertEqual(coverage['assessmentCoverage'],'not-measured-by-acquisition')
        self.assertTrue(coverage['historicalOmissionsBeforeTrackingUnknown'])
        self.assertNotIn('nextToken',json.dumps(value));self.assertNotIn('queryText',json.dumps(value))
    def test_combined_metadata_has_utf8_byte_bound_and_omission_count(self):
        bulky={'records':[{'title':'あ'*4000} for _ in range(50)],'counts':{'total':50}}
        with research.connect(self.path) as db,patch.object(pipeline,'issuer_preparation',return_value=json.loads(json.dumps(bulky))),patch.object(general,'retained_intake',return_value=json.loads(json.dumps(bulky))):
            value=pipeline.snapshot(db,NOW)
        self.assertLessEqual(len(json.dumps(value,ensure_ascii=False).encode()),60000)
        self.assertEqual(value['retainedIntake']['counts']['total'],50)
        self.assertGreater(value['retainedIntake']['responseOmittedRecords'],0)
    def test_existing_editor_checks_render_metadata_without_lane_count_changes(self):
        with patch.object(general,'datetime',wraps=datetime) as clock:
            clock.now.return_value=NOW
            row=self.general_row();self.reject(row)
            value=diagnostics.queue(self.path,reference=NOW)
        self.assertEqual(value['counts']['pending'],1)
        checks=value['items'][0]['latestFailure']['validation']['issues'][0]['checks']
        self.assertEqual(sum(c.get('check')=='editor-only-news-pipeline-metadata' for c in checks),1)
        self.assertTrue(value['readOnly'])

del RetainedBusinessAdmissionTests, BusinessFailedDiagnosticsTests

if __name__=='__main__':unittest.main()
