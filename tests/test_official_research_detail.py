"""Selected research proof is bounded and immutable, separate from acquisition."""
from copy import deepcopy
from datetime import timedelta
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import test_official_research as fixture
import official_research as research
import official_research_detail as proof
import signal_source_detail

NOW, BODY, NOTE, URL, TITLE = fixture.NOW, fixture.BODY, fixture.NOTE, fixture.URL, fixture.TITLE
sha = lambda value: hashlib.sha256(value.encode()).hexdigest()


class OfficialResearchDetailTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'proof.sqlite'
        self.raw_sha = sha('raw-source-revision')
        with research.connect(self.path) as db:
            db.execute('INSERT INTO sources(url,ticker,title,published_on,discovered_at,sha256,body_sha256) VALUES(?,?,?,?,?,?,?)',
                       (URL, 'NBIS', TITLE, '2026-10-01', NOW.isoformat(), self.raw_sha, sha(BODY)))
            db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',(URL,'NBIS',NOW.isoformat()))
            db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',
                       (URL,self.raw_sha,NOW.isoformat(),BODY,len(BODY)))
            self.row = research.candidates(db,NOW)[0]
        self.payload = json.dumps(NOTE,ensure_ascii=False)
        self.save_publication()

    def save_publication(self):
        with research.connect(self.path) as db:
            db.execute('INSERT OR REPLACE INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                (self.row['id'],self.row['sha'],self.row['body_sha'],self.payload,
                 json.dumps([NOTE['title']['evidenceQuote']]),NOW.isoformat(),'raw-invalid-stored-clock',12))

    def read(self, **kwargs):
        return proof.detail(self.path, self.row['id'], kwargs.pop('source',self.row['sha']), kwargs.pop('body',self.row['body_sha']),reference=NOW,**kwargs)

    def cache_body(self):
        teaser = 'Short acquisition teaser. ' * 5
        with research.connect(self.path) as db:
            db.execute('UPDATE sources SET body_sha256=?',(sha(teaser),))
            db.execute('UPDATE source_revisions SET extracted_text=?,extracted_chars=?',(teaser,len(teaser)))
            db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,?)',
                       (self.row['id'],self.row['sha'],sha(BODY),BODY,NOW.isoformat(),0,None))
            db.execute('INSERT INTO official_story_body_proofs VALUES(?,?,?,?,?,?,?,?,?)',
                       (self.row['id'],self.row['sha'],sha(BODY),NOW.isoformat(),URL,TITLE,'2026-10-01','test-v1',sha('raw fetched page')))
            self.row = research.candidates(db,NOW)[0]
        self.save_publication()
        return teaser

    def failure(self):
        value=deepcopy(NOTE)
        value['facts'][0]['ja']='保存された誤った数値99%。'
        value['privateProviderArguments']={'headers':'SECRET-PROVIDER-HEADER'}
        value['facts'][0]['private']='SECRET-FIELD'
        payload=json.dumps(value,ensure_ascii=False)
        with research.connect(self.path) as db:
            db.execute('INSERT INTO official_research_jobs VALUES(?,?,?,?,?,?,?)',
                       (self.row['id'],self.row['sha'],3,0,'private-lease','retry','unsupported-number'))
            db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                       ('private-lease',self.row['id'],self.row['sha'],NOW.isoformat(),'unsupported-number','SECRET-PROVIDER-DETAIL',payload))
            db.execute('INSERT INTO official_research_attempt_body_proofs VALUES(?,?,?)',
                       ('private-lease',self.row['sha'],self.row['body_sha']))
        return value

    def test_current_research_body_is_distinct_from_short_acquisition_document(self):
        teaser=self.cache_body()
        result=self.read()
        original=signal_source_detail.detail(self.path,self.row['id'])
        self.assertEqual(result['status'],'current')
        self.assertEqual(original['text'],teaser)
        self.assertEqual(result['acquisition']['chars'],len(teaser))
        self.assertEqual(result['acquisition']['bodyTextSha256'],sha(teaser))
        self.assertFalse(result['acquisition']['matchesResearchBody'])
        self.assertFalse(result['acquisition']['textIncluded'])
        body=result['researchBody']
        self.assertEqual(body['text'],BODY)
        self.assertEqual(body['bodyTextSha256'],sha(BODY))
        self.assertEqual(body['revisionSha'],self.row['body_sha'])
        self.assertFalse(body['truncated'])
        self.assertEqual(body['recordedAcquisitionProof']['sourceUrl'],URL)
        self.assertEqual(body['recordedAcquisitionProof']['rawContentSha'],sha('raw fetched page'))

    def test_saved_invalid_copy_and_raw_stored_clock_are_separate_from_validation(self):
        value=deepcopy(NOTE);value['facts'][0]['ja']='  元の誤った数値99%。  '
        self.payload=json.dumps({**value,'provider':{'secret':'SECRET-PROVIDER'}},ensure_ascii=False)
        self.save_publication()
        result=self.read()['publication']
        self.assertEqual(result['validation']['status'],'invalid')
        self.assertEqual(result['storedClocks']['publicAt']['text'],'raw-invalid-stored-clock')
        self.assertIsNone(result['storedClocks']['firstValidatedAt'])
        self.assertIsNone(result['storedClocks']['firstRenderedAt'])
        self.assertEqual(result['copy']['payloadSha256'],sha(self.payload))
        field=next(item for item in result['copy']['fields'] if item['field']=='facts[0]')
        self.assertEqual(field['ja']['text'],value['facts'][0]['ja'])
        self.assertEqual(field['savedEvidenceQuote']['text'],value['facts'][0]['evidenceQuote'])
        self.assertTrue(field['savedEvidenceQuote']['literalCurrentResearchBody'])
        self.assertNotIn('SECRET-',json.dumps(result))

    def test_latest_failed_copy_requires_current_job_lease_and_attempt_body_proof(self):
        self.cache_body();value=self.failure();result=self.read()
        failed=result['latestFailure'];published=result['publication']['copy']
        self.assertEqual(failed['status'],'current-attempt-body-proven')
        field=next(item for item in failed['copy']['fields'] if item['field']=='facts[0]')
        self.assertEqual(field['ja']['text'],value['facts'][0]['ja'])
        saved_field=next(item for item in published['fields'] if item['field']=='facts[0]')
        self.assertEqual(saved_field['ja']['text'],NOTE['facts'][0]['ja'])
        for sql in ("UPDATE official_research_jobs SET state='done'",
                    "UPDATE official_research_jobs SET lease='other'",
                    "UPDATE official_research_jobs SET sha='other'",
                    "UPDATE official_research_attempt_failures SET sha='other'",
                    "UPDATE official_research_attempt_body_proofs SET source_sha='other'",
                    "UPDATE official_research_attempt_body_proofs SET body_sha='other'",
                    "UPDATE official_research_attempt_failures SET failed_at='2026-10-01T15:39:00+00:99'",
                    'DELETE FROM official_research_attempt_body_proofs'):
            with self.subTest(sql=sql), sqlite3.connect(self.path) as db:
                db.execute('SAVEPOINT probe');db.execute(sql);db.commit()
                # Snapshot/restore rows so each mutation independently removes proof.
                result=self.read()
                self.assertEqual(result['latestFailure']['status'],'unavailable')
                self.assertIsNone(result['latestFailure']['copy'])
                db.execute('DELETE FROM official_research_jobs');db.execute('DELETE FROM official_research_attempt_failures');db.execute('DELETE FROM official_research_attempt_body_proofs');db.commit()
                self.failure()
        encoded=json.dumps(self.read(),ensure_ascii=False)
        self.assertNotIn('SECRET-',encoded);self.assertNotIn('private-lease',encoded)

    def test_changed_selection_source_body_or_status_never_discloses_copy(self):
        self.assertIsNone(self.read(source='a'*64)['researchBody'])
        self.assertIsNone(self.read(body='b'*64)['publication'])
        with sqlite3.connect(self.path) as db:db.execute("UPDATE sources SET status='held'")
        self.assertIsNone(self.read())

    def test_unhashed_source_body_mutation_and_cached_body_mutation_fail_closed(self):
        with sqlite3.connect(self.path) as db:db.execute("UPDATE source_revisions SET extracted_text=extracted_text || ' changed'")
        result=self.read();self.assertIsNone(result['researchBody']);self.assertIsNone(result['publication'])
        self.cache_body()
        with sqlite3.connect(self.path) as db:db.execute("UPDATE official_story_bodies SET body=body || ' changed'")
        result=self.read();self.assertEqual(result['status'],'research-body-integrity-mismatch');self.assertIsNone(result['researchBody'])

    def test_stale_saved_publication_cannot_be_presented_as_current_body_copy(self):
        with sqlite3.connect(self.path) as db:db.execute("UPDATE official_research_publications SET body_sha=?",('a'*64,))
        result=self.read();self.assertEqual(result['researchBody']['text'],BODY)
        self.assertFalse(result['publication']['currentRevision']);self.assertIsNone(result['publication']['copy'])

    def test_limits_are_explicit_and_unknown_payload_fields_never_escape(self):
        value=deepcopy(NOTE);value['facts']*=4;value['facts'][0]['ja']='長'*3000
        result=proof.selected_copy(json.dumps(value,ensure_ascii=False),self.row)
        self.assertEqual(result['omittedFacts'],0)
        self.assertFalse(result['complete'])
        field=next(item for item in result['fields'] if item['field']=='facts[0]')
        self.assertEqual(len(field['ja']['text']),proof.MAX_COPY_CHARS);self.assertTrue(field['ja']['truncated'])
        self.assertEqual(proof.selected_copy('x'*(proof.MAX_PAYLOAD_BYTES+1),self.row)['status'],'payload-limit')
        self.cache_body()
        huge='X'*(proof.MAX_BODY_CHARS+1)
        with sqlite3.connect(self.path) as db:
            db.execute('UPDATE official_story_bodies SET body=?,body_sha=?',(huge,sha(huge)))
        result=self.read(body=sha(huge))
        self.assertEqual(result['status'],'body-limit');self.assertEqual(result['omittedResearchBodyChars'],len(huge))
        self.assertIsNone(result['researchBody']);self.assertLess(len(json.dumps(result)),3000)

    def test_read_only_no_schema_generation_external_requests_or_row_mutation(self):
        self.cache_body();self.failure()
        with sqlite3.connect(self.path) as db:before=list(db.iterdump())
        with patch.object(research,'schema',side_effect=AssertionError('schema')), \
             patch.object(research,'run_once',side_effect=AssertionError('generation')), \
             patch.object(research.bridge,'sync',side_effect=AssertionError('sync')), \
             patch.object(research.signals,'fetch',side_effect=AssertionError('network')), \
             patch.object(research.brief_generator,'request_response',side_effect=AssertionError('model')):
            self.assertEqual(self.read()['status'],'current')
        with sqlite3.connect(self.path) as db:self.assertEqual(list(db.iterdump()),before)
        def write(db,*_args,**_kwargs):db.execute('DELETE FROM official_research_jobs')
        with patch.object(research,'candidates',side_effect=write),self.assertRaises(sqlite3.OperationalError):self.read()

    def test_invalid_requests_and_missing_database_never_create_data(self):
        for value in (None,'secret','a'*63,'A'*64,'a'*65,True):
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'invalid-revision-hash'):self.read(source=value)
        missing=Path(self.tmp.name)/'missing.sqlite'
        with self.assertRaises(sqlite3.OperationalError):proof.detail(missing,1,'a'*64,'b'*64)
        self.assertFalse(missing.exists())

    def test_http_existing_editor_auth_and_exact_revision_parameters_are_required(self):
        import service
        detail=Mock(return_value={'eventId':1,'status':'current','readOnly':True})
        server=service.ThreadingHTTPServer(('127.0.0.1',0),service.Handler)
        server.app=SimpleNamespace(official_research_detail=detail)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{server.server_port}/admin/official-research'
        query=f'?eventId=1&expectedSourceSha={"a"*64}&expectedBodySha={"b"*64}'
        try:
            with patch.dict(os.environ,{'RESEARCH_EDITOR_TOKEN':'synthetic-editor-token','RESEARCH_API_TOKEN':'synthetic-api-token'}):
                for token in (None,'wrong-token','synthetic-api-token'):
                    with self.assertRaises(HTTPError) as error:
                        urlopen(Request(base+query,headers={'Authorization':'Bearer '+token} if token else {}),timeout=2)
                    self.assertEqual(error.exception.code,401)
                detail.assert_not_called()
                headers={'Authorization':'Bearer synthetic-editor-token'}
                with urlopen(Request(base+query,headers=headers),timeout=2) as response:
                    self.assertTrue(json.loads(response.read())['detail']['readOnly'])
                    self.assertEqual(response.headers['Cache-Control'],'no-store')
                detail.assert_called_once_with('1','a'*64,'b'*64)
                for bad in ('?eventId=1',query+'&eventId=2',query+'&expectedSourceSha='+('c'*64),query.replace('expectedBodySha=','wrongBody=')):
                    with self.assertRaises(HTTPError) as error:urlopen(Request(base+bad,headers=headers),timeout=2)
                    self.assertEqual(error.exception.code,400)
                self.assertEqual(detail.call_count,1)
                with self.assertRaises(HTTPError) as error:urlopen(Request(base+query,method='POST',data=b'{}',headers=headers),timeout=2)
                self.assertEqual(error.exception.code,404)
        finally:server.shutdown();server.server_close();thread.join(timeout=2)

    def test_structured_1246_derivation_metadata_is_allowlisted_and_read_only(self):
        import test_buyback_structured_publication as structured_tests
        case=structured_tests.StructuredBuybackPublicationTests();case.setUp();self.addCleanup(case.doCleanups)
        case.seed(structured_tests.RETAINED['body'],2106523440635363385,'NVDA',event_id=1246)
        row=case.rows()[0];case.failed_history(row)
        self.assertEqual(case.publish(),'done')
        with sqlite3.connect(case.path) as db:before=list(db.iterdump())
        result=proof.detail(case.path,1246,row['sha'],row['body_sha'],reference=structured_tests.NOW)
        self.assertEqual(result['status'],'current')
        audit=result['publication']['derivation']
        self.assertEqual(set(audit),{'kind','version','storedDerivedAt','currentAuditValidated','firstValidatedAt','firstRenderedAt'})
        self.assertEqual(audit['kind'],'source-structured-buyback');self.assertEqual(audit['version'],1)
        self.assertTrue(audit['currentAuditValidated'])
        self.assertEqual(audit['storedDerivedAt']['text'],structured_tests.NOW.isoformat())
        self.assertIsNone(audit['firstValidatedAt']);self.assertIsNone(audit['firstRenderedAt'])
        self.assertEqual(result['latestFailure']['status'],'unavailable')
        with sqlite3.connect(case.path) as db:
            saved_facts=json.loads(db.execute('SELECT payload FROM official_research_publications WHERE event_id=1246').fetchone()[0])['facts']
        self.assertEqual([field['ja']['text'] for field in result['publication']['copy']['fields']], [fact['ja'] for fact in saved_facts])
        self.assertNotIn('synthetic-old-model',json.dumps(result));self.assertNotIn('original_artifacts',json.dumps(result))
        with sqlite3.connect(case.path) as db:self.assertEqual(list(db.iterdump()),before)

    def test_newer_attempt_and_stale_acquisition_proof_do_not_borrow_old_proof(self):
        self.cache_body();self.failure()
        with sqlite3.connect(self.path) as db:
            db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                       ('newer-unbound',self.row['id'],self.row['sha'],NOW.isoformat(),'unsupported-number','detail',self.payload))
            db.execute("UPDATE official_story_body_proofs SET source_title='different source title'")
        result=self.read()
        self.assertEqual(result['latestFailure']['status'],'unavailable');self.assertIsNone(result['latestFailure']['copy'])
        self.assertIsNone(result['researchBody']['recordedAcquisitionProof'])

    def test_completeness_fails_closed_for_missing_malformed_or_truncated_segments(self):
        mutations = (
            lambda note: note.pop('purpose'),
            lambda note: note.update(facts=None),
            lambda note: note.update(facts=[]),
            lambda note: note['facts'].__setitem__(0,None),
            lambda note: note['facts'][0].pop('ja'),
            lambda note: note['facts'][0].pop('evidenceQuote'),
            lambda note: note['facts'][0].update(evidenceQuote={'not':'a string'}),
            lambda note: note['facts'][0].update(evidenceQuote=''),
            lambda note: note['facts'][0].update(evidenceId='unknown-filtered-id'),
        )
        for mutate in mutations:
            note=deepcopy(NOTE);mutate(note)
            with self.subTest(note=note):
                self.assertFalse(proof.selected_copy(json.dumps(note),self.row)['complete'])
        self.assertTrue(proof.selected_copy(json.dumps(NOTE),self.row)['complete'])
        long_quote='e'*2000
        row={**self.row,'general_source':True,'body':long_quote,'units':[{'id':'known','quote':long_quote}]}
        note={'facts':[{'ja':'日本語','en':'English','evidenceId':'known'}]}
        result=proof.selected_copy(json.dumps(note),row)
        self.assertFalse(result['complete']);self.assertTrue(result['fields'][0]['resolvedCurrentEvidence']['truncated'])
        row['units'][0]['quote']='short quote';row['body']='short quote'
        self.assertTrue(proof.selected_copy(json.dumps(note),row)['complete'])
