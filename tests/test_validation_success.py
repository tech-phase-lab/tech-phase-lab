"""Exact success reuse never grants source eligibility or skips normalization."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import sys
from threading import Barrier, Lock
import unittest
from unittest.mock import patch

import test_official_research as fixture
import official_research as research
from validation_success import ValidationSuccess


class ValidationSuccessTests(unittest.TestCase):
    def setUp(self):
        reuse=patch.object(research,'_validation_success',ValidationSuccess())
        reuse.start();self.addCleanup(reuse.stop)

    def validate(self,note=None,body=fixture.BODY,title=fixture.TITLE):
        return research.validate(deepcopy(fixture.NOTE) if note is None else note,body,title)

    def test_hit_returns_callers_object_and_always_checks_source_identity(self):
        with patch.object(research,'validate_item',wraps=research.validate_item) as item:
            with patch.object(research,'validate_source_event',wraps=research.validate_source_event) as source:
                first=self.validate();second=deepcopy(fixture.NOTE)
                self.assertIs(self.validate(second),second)
                self.assertIsNot(first,second)
                self.assertIsNot(first['title'],second['title'])
                self.assertEqual(item.call_count,6)
                self.assertEqual(source.call_count,2)
                with patch.object(research,'validate_source_event',side_effect=ValueError('source-event-identity-mismatch')):
                    with self.assertRaisesRegex(ValueError,'source-event-identity-mismatch'):self.validate()

    def test_changed_full_body_title_payload_and_invalid_shape_miss(self):
        self.validate()
        for mutation in ('body','title','number','quote','shape'):
            with self.subTest(mutation=mutation):
                note=deepcopy(fixture.NOTE);body=fixture.BODY;title=fixture.TITLE
                if mutation=='body':body='Different source with no retained evidence.'
                elif mutation=='title':title='Nebius to acquire Inferize'
                elif mutation=='number':note['facts'][0]['en']+=' Revenue was $999 billion.'
                elif mutation=='quote':note['facts'][0]['evidenceQuote']='Unsupported statement that is absent from the source.'
                else:note['facts']=tuple(note['facts'])
                with self.assertRaises(ValueError):self.validate(note,body,title)
        # No body truncation or whitespace normalization is used in the key.
        with patch.object(research,'validate_item',wraps=research.validate_item) as item:
            self.validate(body=fixture.BODY+' Tail one.')
            self.validate(body=fixture.BODY+' Tail two.')
            self.assertEqual(item.call_count,12)

    def test_failure_is_rechecked_and_cannot_replace_prior_success(self):
        with patch.object(research,'validate_item',wraps=research.validate_item) as item:
            self.validate()
            bad=deepcopy(fixture.NOTE);bad['title']['en']+=' $999 billion'
            for _ in range(2):
                with self.assertRaises(ValueError):self.validate(deepcopy(bad))
            self.assertEqual(item.call_count,8)
            self.validate()
            self.assertEqual(item.call_count,8)

    def test_only_post_normalized_success_is_stored_without_mutable_output(self):
        malformed=deepcopy(fixture.NOTE)
        malformed['title']['ja']='NEbius、Inferizeを買収'
        with patch.object(research,'validate_item',wraps=research.validate_item) as item:
            for _ in range(2):
                note=deepcopy(malformed)
                self.assertIs(self.validate(note),note)
                self.assertEqual(note,fixture.NOTE)
            self.assertEqual(item.call_count,12)
            normalized=self.validate()
            self.assertEqual(item.call_count,12)
            normalized['title']['en']+=' $999 billion'
            self.assertEqual(self.validate(),fixture.NOTE)
            with self.assertRaises(ValueError):self.validate(normalized)
        for key in research._validation_success._entries:
            self.assertTrue(all(isinstance(part,str) for part in key))

    def test_nested_guard_version_and_process_changes_invalidate(self):
        quote='The model detects 50% more emissions than human experts.'
        bad=deepcopy(fixture.NOTE)
        bad['facts'][2]=fixture.copy('既知より50％多い排出を検出。',quote,quote)
        body=fixture.BODY+' '+quote
        with patch.object(research.factual_validation,'validate_comparison_baselines'):
            self.validate(deepcopy(bad),body)
            self.validate(deepcopy(bad),body)
        with self.assertRaisesRegex(ValueError,'unsupported-comparison-baseline'):
            self.validate(deepcopy(bad),body)
        with patch.object(research,'validate_item',wraps=research.validate_item) as item:
            self.validate();self.validate()
            with patch.object(research,'VALIDATION_REUSE_VERSION',0):self.validate()
            self.validate()
            with patch.object(research.os,'getpid',return_value=-1):self.validate()
            self.validate()
            self.assertEqual(item.call_count,30)

    def test_policy_changed_during_validation_does_not_store_success(self):
        original=research.validate_item
        def change(*args):
            research.VALIDATION_REUSE_VERSION+=1
            return original(*args)
        with patch.object(research,'VALIDATION_REUSE_VERSION',research.VALIDATION_REUSE_VERSION):
            with patch.object(research,'validate_item',side_effect=change):self.validate()
        self.assertEqual(len(research._validation_success._entries),0)

    def test_guard_restored_during_hit_revalidates_before_return(self):
        quote='The model detects 50% more emissions than human experts.'
        bad=deepcopy(fixture.NOTE)
        bad['facts'][2]=fixture.copy('既知より50％多い排出を検出。',quote,quote)
        body=fixture.BODY+' '+quote
        legacy=patch.object(research.factual_validation,'validate_comparison_baselines')
        legacy.start();self.addCleanup(legacy.stop)
        self.validate(deepcopy(bad),body)
        cache=research._validation_success;contains=cache.contains
        def restore_guard(key,policy):
            hit=contains(key,policy)
            self.assertTrue(hit)
            legacy.stop()
            return hit
        with patch.object(cache,'contains',side_effect=restore_guard):
            with self.assertRaisesRegex(ValueError,'unsupported-comparison-baseline'):
                self.validate(deepcopy(bad),body)
        with self.assertRaisesRegex(ValueError,'unsupported-comparison-baseline'):
            research.validate_item('fact',deepcopy(bad['facts'][2]),body,fixture.TITLE)

    def test_lowered_evidence_limit_invalidates_warm_success(self):
        self.validate()
        with patch.object(research,'MAX_EVIDENCE_CHARS',16):
            with self.assertRaisesRegex(ValueError,'unsupported-quote'):self.validate()
        self.assertEqual(self.validate(),fixture.NOTE)

    def test_entry_and_unicode_memory_bounds_evict_least_recent_success(self):
        policy=object();cache=ValidationSuccess(max_entries=2)
        keys=[cache.key({'text':str(i)},'本文😀'*30,'Title') for i in range(3)]
        for key in keys[:2]:
            self.assertFalse(cache.contains(key,policy));cache.remember(key,policy)
        self.assertTrue(cache.contains(keys[0],policy))
        cache.remember(keys[2],policy)
        self.assertFalse(cache.contains(keys[1],policy))
        self.assertEqual(len(cache._entries),2)
        cost=cache.cost(keys[0])
        self.assertGreaterEqual(cost,sys.getsizeof(keys[0])+sum(sys.getsizeof(v) for v in keys[0]))
        cache=ValidationSuccess(max_bytes=cost)
        cache.contains(keys[0],policy)
        for key in keys:cache.remember(key,policy)
        self.assertEqual(len(cache._entries),1)
        self.assertLessEqual(cache._bytes,cost)
        oversized=cache.key({},'😀'*10000,'Title')
        cache.remember(oversized,policy)
        self.assertFalse(cache.contains(oversized,policy))
        self.assertEqual(len(cache._entries),1)

    def test_old_inflight_policy_cannot_repopulate_new_namespace(self):
        cache=ValidationSuccess();key=cache.key({},'body','title')
        old,new=object(),object()
        cache.contains(key,old);cache.contains(key,new)
        cache.remember(key,old)
        self.assertFalse(cache.contains(key,new))

    def test_concurrent_misses_validate_outside_lock_then_hits_share_no_output(self):
        barrier=Barrier(4);original=research.validate_item;counter_lock=Lock();calls=0
        def synchronize(name,*args):
            nonlocal calls
            with counter_lock:calls+=1
            if name=='title':barrier.wait(timeout=5)
            return original(name,*args)
        with patch.object(research,'validate_item',new=synchronize):
            with ThreadPoolExecutor(max_workers=4) as pool:
                first=list(pool.map(lambda _:self.validate(),range(4)))
                self.assertEqual(calls,24)
                repeated=list(pool.map(lambda _:self.validate(),range(12)))
            self.assertEqual(calls,24)
        self.assertTrue(all(note==fixture.NOTE for note in first+repeated))
        self.assertEqual(len({id(note) for note in first+repeated}),16)
        cache=research._validation_success
        self.assertEqual(len(cache._entries),1)
        self.assertEqual(cache._bytes,sum(cache._entries.values()))


class ValidationSuccessPublicationTests(unittest.TestCase):
    def setUp(self):
        self.case=fixture.OfficialResearchTests()
        self.case.setUp();self.addCleanup(self.case.doCleanups)
        reuse=patch.object(research,'_validation_success',ValidationSuccess())
        reuse.start();self.addCleanup(reuse.stop)
        with research.connect(self.case.path) as db:
            self.rows=research.candidates(db,fixture.NOW)
            row=self.rows[0]
            db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                       (row['id'],row['sha'],row['body_sha'],json.dumps(fixture.NOTE),'[]',
                        fixture.NOW.isoformat(),fixture.NOW.isoformat(),1))

    def app(self):
        import service  # Discovery reloads signals; resolve only at execution.
        app=object.__new__(service.AutomaticMonitor);app.db_path=self.case.path
        return app

    def test_warm_public_news_and_retained_candidates_recheck_current_gates(self):
        app=self.app()
        with patch.object(research,'validate_item',wraps=research.validate_item) as item:
            baseline=app.public_news()
            self.assertEqual(len(baseline['officialResearch']),1)
            self.assertEqual(app.public_news(),baseline)
            self.assertEqual(item.call_count,6)
            with research.connect(self.case.path) as db:
                self.assertEqual(len(research.validated_publications(db,self.rows)),1)
                for sql in ("UPDATE sources SET status='held'",
                            "UPDATE sources SET status='rejected'",
                            "UPDATE sources SET sha256='revision-withdrawn'",
                            "UPDATE official_research_publications SET body_sha='withdrawn'",
                            'DELETE FROM official_research_publications'):
                    with self.subTest(sql=sql):
                        db.execute('SAVEPOINT changed');db.execute(sql)
                        self.assertEqual(research.validated_publications(db,self.rows),[])
                        db.execute('ROLLBACK TO changed');db.execute('RELEASE changed')
                self.assertEqual(item.call_count,6)
            with research.connect(self.case.path) as db:db.execute("UPDATE sources SET status='held'")
            self.assertEqual(app.public_news()['officialResearch'],[])
            self.assertEqual(app.public_news()['officialUpdates'],[])

    def test_warm_copy_does_not_hide_changed_body_or_invalid_saved_payload(self):
        app=self.app();self.assertEqual(len(app.public_news()['officialResearch']),1)
        bad=deepcopy(fixture.NOTE);bad['facts'][0]['en']+=' Revenue was $999 billion.'
        with research.connect(self.case.path) as db:
            db.execute('UPDATE official_research_publications SET payload=?',(json.dumps(bad),))
            self.assertEqual(research.validated_publications(db,self.rows),[])
        self.assertEqual(app.public_news()['officialResearch'],[])
        with research.connect(self.case.path) as db:
            db.execute('UPDATE official_research_publications SET payload=?',(json.dumps(fixture.NOTE),))
            db.execute("UPDATE source_revisions SET extracted_text='Different body without the retained quotes'")
        self.assertEqual(app.public_news()['officialResearch'],[])

    def test_warm_public_news_rechecks_removed_publication(self):
        app=self.app();self.assertEqual(len(app.public_news()['officialResearch']),1)
        with research.connect(self.case.path) as db:
            db.execute('DELETE FROM official_research_publications')
        self.assertEqual(app.public_news()['officialResearch'],[])

    def test_warm_public_news_rechecks_changed_source_revision(self):
        app=self.app();self.assertEqual(len(app.public_news()['officialResearch']),1)
        with research.connect(self.case.path) as db:
            db.execute("UPDATE sources SET sha256='changed-current-source'")
        self.assertEqual(app.public_news()['officialResearch'],[])


if __name__=='__main__':unittest.main()
