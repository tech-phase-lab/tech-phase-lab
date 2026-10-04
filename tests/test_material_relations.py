"""Typed relation acceptance and isolation from incidental source quantities."""
from copy import deepcopy
from dataclasses import replace
import json
from pathlib import Path
import sys
import sqlite3
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import material_relations as relation
import official_research as research
import test_official_research as fixture

CASES=json.loads((Path(__file__).resolve().parents[1]/'fixtures/material_relation_cases.json').read_text())['cases']

class MaterialRelationTests(unittest.TestCase):
    def test_independent_typed_acceptance_packet(self):
        for case in CASES:
            with self.subTest(case=case['id']):
                action=lambda:relation.validate_item(case['ja'],case['en'],case['quote'],case['body'],source_span=case.get('sourceSpan'))
                if case['expected']=='ACCEPT':action()
                else:
                    with self.assertRaisesRegex(ValueError,relation.FAILURE):action()

    def test_every_dimension_must_match_one_complete_source_fact(self):
        # A cross-product oracle isolates matching from grammar recognition:
        # each source pair contains every requested scalar independently, but
        # no record has the complete claimed relation. This covers every type.
        dimensions={
            'count': ('initiative', ('6',), 'stated', (), ()),
            'testing': ('universities', ('6',), 'planned', (), ('testing','lessons')),
            'memory': ('released-capacity', ('200','tib','gt'), 'projected', ('rollout-complete',), ()),
            'memory-range': ('estimated-capacity-range', ('200','tib','1','pib'), 'projected', (), ()),
            'coverage': ('red-team', ('external',), 'tested', (), ('fraud',)),
            'measurement': ('batch-collection', ('52',), 'fixed', (), ()),
            'effect': ('interval-time', ('52',), 'joint', (('K','8'),), ('staged-publication','extended-eligibility')),
            'scalar': ('queue-wait', ('52',), 'observed', (), ()),
        }
        for kind,(measure,value,status,conditions,scope) in dimensions.items():
            claim=relation.Fact(kind,'cedar',measure,value,status,conditions,scope,0,100)
            self.assertTrue(relation.source_satisfies(claim,claim,'cedar'))
            alternatives={'entity':'birch','measure':'other-measure','value':('99',),
                          'status':'negated','conditions':('different-condition',),'scope':('other-object',)}
            for key,other in alternatives.items():
                with self.subTest(kind=kind,dimension=key):
                    first=replace(claim,**{key:other})
                    # A second fact offers this dimension but another mismatch.
                    second=replace(claim,**({'value':('98',)} if key!='value' else {'status':'negated'}))
                    self.assertFalse(any(relation.source_satisfies(claim,f,'cedar') for f in (first,second)))

    def test_only_explicit_scope_narrowing_is_allowed(self):
        source=relation.Fact('coverage','cedar','red-team',('external',),'tested',(),('fraud','privacy'),0,100)
        narrow=replace(source,scope=('fraud',))
        self.assertTrue(relation.source_satisfies(narrow,source,'cedar'))
        self.assertFalse(relation.source_satisfies(replace(narrow,status='verified'),source,'cedar'))
        self.assertFalse(relation.source_satisfies(replace(narrow,value=('internal',)),source,'cedar'))
        self.assertFalse(relation.source_satisfies(replace(source,scope=('fraud','privacy','autonomy')),source,'cedar'))
        measured=relation.Fact('measurement','cedar','batch-collection',('52',),'fixed',(),(),0,100)
        self.assertTrue(relation.source_satisfies(replace(measured,value=()),measured,'cedar'))
        self.assertFalse(relation.source_satisfies(replace(measured,value=(),conditions=('negative',)),measured,'cedar'))

    def test_uncached_source_parse_once_and_exact_success_reuse(self):
        with patch.object(research,'_validation_success',research.ValidationSuccess()):
            with patch.object(relation,'source_context',wraps=relation.source_context) as parse:
                research.validate(deepcopy(fixture.NOTE),fixture.BODY,fixture.TITLE)
                research.validate(deepcopy(fixture.NOTE),fixture.BODY,fixture.TITLE)
                self.assertEqual(parse.call_count,1)
                with patch.object(relation,'extract',wraps=relation.extract):
                    research.validate(deepcopy(fixture.NOTE),fixture.BODY,fixture.TITLE)
                self.assertEqual(parse.call_count,2)

    def test_whitespace_equivalent_evidence_keeps_original_binding(self):
        body='Cedar Trust supports\n6 campus initiatives.'
        quote='Cedar Trust supports 6 campus initiatives.'
        relation.validate_item('Cedar Trustは6件の大学事業を支援する。',quote,quote,body)
        with self.assertRaisesRegex(ValueError,relation.FAILURE):
            relation.validate_item('Cedar Trustは9件の大学事業を支援する。',quote.replace('6','9'),quote,body)

    def test_stale_context_cannot_authorize_changed_source(self):
        old='Cedar Trust supports 6 campus initiatives.'
        new='Cedar Trust supports 8 campus initiatives.'
        context=relation.source_context(old)
        with self.assertRaisesRegex(ValueError,relation.FAILURE):
            relation.validate_item('Cedar Trustは6件の大学事業を支援する。',old,new,new,context)

    def test_other_measures_cannot_lend_numbers_to_fixed_weight_results(self):
        body='With weights fixed, the Spruce engine reduced batch-collection time by 52%. Queue wait fell by 37.5%.'
        with self.assertRaisesRegex(ValueError,relation.FAILURE):
            relation.validate_item('Spruceエンジンは固定重みでバッチ収集時間を37.5%短縮した。',
                                  'With weights fixed, the Spruce engine cut batch-collection time by 37.5%.',body,body)

class MaterialHoldTests(fixture.OfficialResearchTests):
    # Only these extra tests are collected here; fixture's own tests run in
    # their original suite. Its local database and stub transport are reused.
    __unittest_skip__=False

    def wrong_note(self):
        quote='Cedar Trust supports 6 campus initiatives.'
        with research.connect(self.path) as db:
            db.execute('UPDATE source_revisions SET extracted_text=?,extracted_chars=?',(fixture.BODY+' '+quote,len(fixture.BODY+' '+quote)))
        note=deepcopy(fixture.NOTE)
        note['facts'][2]={'ja':'Cedar Trustは9件の大学事業を支援する。','en':'Cedar Trust supports 9 campus initiatives.','evidenceQuote':quote}
        return note

    def test_new_material_failure_enters_review_and_never_retries_a_model(self):
        note=self.wrong_note()
        response=lambda *_:{'status':'completed','output_text':json.dumps(note,ensure_ascii=False)}
        self.assertEqual(self.run_note(response),'review')
        with research.connect(self.path) as db:
            saved=dict(db.execute('SELECT * FROM official_research_attempt_failures').fetchone())
            job=dict(db.execute('SELECT * FROM official_research_jobs').fetchone())
            self.assertEqual(job['state'],'review')
            self.assertEqual(job['failure_kind'],relation.FAILURE)
        self.assertEqual(self.run_note(lambda *_:self.fail('paid retry')),'idle')
        with research.connect(self.path) as db:
            self.assertEqual(dict(db.execute('SELECT * FROM official_research_attempt_failures').fetchone()),saved)

    def test_non_note_semantic_disposition_keeps_existing_retry_lane(self):
        state=((),('',json.dumps({'disposition':'publish','reason':'material-company-development',
                                 'facts':[{'ja':'既存の別形式。','en':'Existing separate shape.','evidenceId':str(i)} for i in range(7)]})),())
        with patch.object(relation,'source_context',side_effect=AssertionError('non-note source scan')):
            self.assertIsNone(research.assess_material_failure(state,{'body':fixture.BODY}))

    def test_old_same_body_failure_is_held_without_rewriting_history(self):
        note=self.wrong_note()
        with research.connect(self.path) as db:
            row=research.candidates(db,fixture.NOW)[0]
            db.execute('INSERT INTO official_research_jobs VALUES(?,?,?,?,?,?,?)',(row['id'],row['sha'],5,0,'old-lease','retry','unsupported-number'))
            db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',('old-lease',row['id'],row['sha'],fixture.NOW.isoformat(),'unsupported-number','fact',json.dumps(note)))
            db.execute('INSERT INTO official_research_attempt_body_proofs VALUES(?,?,?)',('old-lease',row['sha'],row['body_sha']))
            before=[tuple(x) for x in db.execute('SELECT * FROM official_research_jobs')]
            self.assertEqual(research.material_failure_hold(db,row),relation.FAILURE)
            self.assertEqual(research.publication_hold_reason(db,row,fixture.NOW),relation.FAILURE)
        self.assertEqual(self.run_note(lambda *_:self.fail('paid retry')),'idle')
        with research.connect(self.path) as db:
            self.assertEqual([tuple(x) for x in db.execute('SELECT * FROM official_research_jobs')],before)


    def test_preflight_relation_work_does_not_hold_writer_lock(self):
        note=self.wrong_note()
        with research.connect(self.path) as db:
            row=research.candidates(db,fixture.NOW)[0]
            db.execute('CREATE TABLE writer_probe(value INTEGER)')
            db.execute('INSERT INTO official_research_jobs VALUES(?,?,?,?,?,?,?)',(row['id'],row['sha'],5,0,'old-lease','retry','unsupported-number'))
            db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',('old-lease',row['id'],row['sha'],fixture.NOW.isoformat(),'unsupported-number','fact',json.dumps(note)))
            db.execute('INSERT INTO official_research_attempt_body_proofs VALUES(?,?,?)',('old-lease',row['sha'],row['body_sha']))
        original=relation.source_context
        def parse(body):
            with sqlite3.connect(self.path,timeout=0) as other:
                other.execute('INSERT INTO writer_probe VALUES(1)')
            return original(body)
        with patch.object(relation,'source_context',side_effect=parse):
            self.assertEqual(self.run_note(lambda *_:self.fail('paid retry')),'idle')
        with sqlite3.connect(self.path) as db:
            self.assertGreater(db.execute('SELECT count(*) FROM writer_probe').fetchone()[0],0)

    def test_cold_saved_publication_parse_does_not_hold_writer_lock(self):
        self.assertEqual(self.run_note(),'done')
        with research.connect(self.path) as db:
            db.execute('CREATE TABLE writer_probe(value INTEGER)')
        research._validation_success.clear()
        original=relation.source_context
        def parse(body):
            with sqlite3.connect(self.path,timeout=0) as other:
                other.execute('INSERT INTO writer_probe VALUES(1)')
            return original(body)
        with patch.object(relation,'source_context',side_effect=parse):
            self.assertEqual(self.run_note(lambda *_:self.fail('paid retry')),'idle')
        with sqlite3.connect(self.path) as db:
            self.assertGreater(db.execute('SELECT count(*) FROM writer_probe').fetchone()[0],0)

    def test_saved_publication_mutation_after_preflight_cannot_authorize_retry(self):
        self.assertEqual(self.run_note(),'done')
        with research.connect(self.path) as db:
            valid=db.execute('SELECT payload FROM official_research_publications').fetchone()[0]
            db.execute("UPDATE official_research_publications SET payload='{}'")
        original=research.assess_claim_publication
        def assess(state,row,reference):
            answer=original(state,row,reference)
            if state:
                with sqlite3.connect(self.path,timeout=0) as other:
                    other.execute('UPDATE official_research_publications SET payload=?',(valid,))
                self.assertIsNone(answer)  # A permissive preflight must not survive changed bytes.
            return answer
        with patch.object(research,'assess_claim_publication',side_effect=assess):
            self.assertEqual(self.run_note(lambda *_:self.fail('paid retry')),'idle')
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)

    def test_oversized_copies_are_rejected_before_source_relation_work(self):
        note=deepcopy(fixture.NOTE);note['summary']['en']='x'*401
        with patch.object(relation,'source_context',side_effect=AssertionError('premature source scan')):
            with self.assertRaisesRegex(ValueError,'invalid-copy'):
                research.validate(note,fixture.BODY,fixture.TITLE)
            with self.assertRaisesRegex(ValueError,'invalid-copy'):
                research.validate_item('summary',note['summary'],fixture.BODY,fixture.TITLE)


    def test_snapshot_changes_before_claim_recheck_do_not_authorize_retry(self):
        for changed in ('job','proof','source'):
            with self.subTest(changed=changed):
                # Separate temporary fixture for each intentional race.
                case=fixture.OfficialResearchTests();case.setUp()
                try:
                    quote='Cedar Trust supports 6 campus initiatives.'
                    bad=deepcopy(fixture.NOTE);bad['facts'][2]={'ja':'Cedar Trustは9件の大学事業を支援する。','en':'Cedar Trust supports 9 campus initiatives.','evidenceQuote':quote}
                    with research.connect(case.path) as db:
                        db.execute('UPDATE source_revisions SET extracted_text=?,extracted_chars=?',(fixture.BODY+' '+quote,len(fixture.BODY+' '+quote)))
                        row=research.candidates(db,fixture.NOW)[0]
                        db.execute('INSERT INTO official_research_jobs VALUES(?,?,?,?,?,?,?)',(row['id'],row['sha'],5,0,'old-lease','retry','unsupported-number'))
                        db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',('old-lease',row['id'],row['sha'],fixture.NOW.isoformat(),'unsupported-number','fact',json.dumps(bad)))
                        db.execute('INSERT INTO official_research_attempt_body_proofs VALUES(?,?,?)',('old-lease',row['sha'],row['body_sha']))
                    original=research.assess_material_failure
                    def assess(state,current):
                        answer=original(state,current)
                        if state:
                            with sqlite3.connect(case.path,timeout=0) as other:
                                if changed=='job':other.execute('UPDATE official_research_jobs SET attempts=attempts+1')
                                elif changed=='proof':other.execute("UPDATE official_research_attempt_body_proofs SET body_sha='changed'")
                                else:other.execute("UPDATE sources SET sha256='changed'")
                        return answer
                    with patch.object(research,'assess_material_failure',side_effect=assess):
                        self.assertEqual(case.run_note(lambda *_:self.fail('paid retry')),'idle')
                    with sqlite3.connect(case.path) as db:
                        self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],0)
                        self.assertEqual(db.execute('SELECT lease FROM official_research_jobs').fetchone()[0],'old-lease')
                finally:case.doCleanups()

# Avoid repeating the31 unrelated inherited tests while retaining fixture setup.
for _name in dir(fixture.OfficialResearchTests):
    if _name.startswith('test_') and _name not in MaterialHoldTests.__dict__:
        setattr(MaterialHoldTests,_name,None)

if __name__=='__main__':unittest.main()
