"""Synthetic closed attempts exercise reviewed recovery without source reposts."""
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import threading
import unittest
from unittest.mock import patch

import official_research as research
import official_research_editorial_recovery as recovery
import test_reviewed_rollout_correction as fixture
import signals


class ReviewedRetryArticlesTests(unittest.TestCase):
    def setUp(self):
        outer_path, outer_sha = recovery.RETAINED_COPY_PATH, recovery.RETAINED_COPY_SHA
        def restore_outer():
            recovery.RETAINED_COPY_PATH, recovery.RETAINED_COPY_SHA = outer_path, outer_sha
        self.addCleanup(restore_outer)
        recovery.RETAINED_COPY_PATH = Path(recovery.__file__).with_name('reviewed_retained_announcements.json')
        recovery.RETAINED_COPY_SHA = recovery.digest(recovery.RETAINED_COPY_PATH.read_text())
        self.fixture = fixture.ReviewedRolloutCorrectionTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.path = self.fixture.path
        self.pin = deepcopy(self.fixture.pin)
        replacement = self.pin.pop('replacement')
        self.pin.update(provenance='primary-article', publishedAt=None)
        self.pin['reviewedFailure'] = dict(reason='changed-rollout-status',
            failedAt='2026-10-04T02:10:33+00:00', payloadSha=replacement['payloadSha'])
        self.pin['failure'] = dict(self.pin['reviewedFailure'], attempts=6,
            failedAt='2026-10-04T09:00:00+00:00')
        with research.connect(self.path) as db:
            original = self.fixture.old['payload']
            latest = original + ' '
            self.pin['failure']['payloadSha'] = recovery.digest(latest)
            db.execute('DELETE FROM official_research_publications')
            db.execute("UPDATE official_research_jobs SET state='retry',attempts=6,lease='latest',failure_kind='changed-rollout-status'")
            db.execute("UPDATE signal_headline_translation_calls SET state='failed'")
            db.execute('INSERT INTO signal_headline_translation_calls VALUES(?,?,?,?,?,?,?)',
                (fixture.NOW.timestamp()-3660, 'research:'+self.pin['sourceId'], self.pin['eventSha'],
                 'test-model','failed','{}','latest'))
            for lease, value, expected in [('original-call',original,self.pin['reviewedFailure']),
                                           ('latest',latest,self.pin['failure'])]:
                db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                    (lease,self.pin['eventId'],self.pin['eventSha'],expected['failedAt'],expected['reason'],'fact',value))
                db.execute('INSERT INTO official_research_attempt_body_proofs VALUES(?,?,?)',
                    (lease,self.pin['eventSha'],self.pin['bodyTextSha']))
        self.write_manifest()
        for owner, name in ((signals,'fetch'),(research.brief_generator,'request_response')):
            mocked=patch.object(owner,name,side_effect=AssertionError('provider call'))
            mocked.start();self.addCleanup(mocked.stop)

    def write_manifest(self):
        manifest={'policy':'reviewed-retained-announcement-v1','startsAt':'2026-10-04T00:00:00+00:00',
                  'expiresAt':'2026-10-05T00:00:00+00:00','announcements':[], 'retryArticles':[self.pin]}
        recovery.RETAINED_COPY_PATH.write_text(json.dumps(manifest,ensure_ascii=False))
        recovery.RETAINED_COPY_SHA=recovery.digest(recovery.RETAINED_COPY_PATH.read_text())

    def history(self,db):
        return recovery.retry_history(db,self.pin)

    def publish(self,validator=research.validate):
        with research.connect(self.path) as db:
            return recovery.publish_retained(db,fixture.NOW,validator)

    def test_closed_retry_publishes_once_and_archives_without_reset_or_paid_call(self):
        with research.connect(self.path) as db:
            old=self.history(db)
            source=recovery.retry_source_snapshot(db,self.pin)
        self.assertEqual(research.run_once(self.path,lambda *_:self.fail('provider'),{},fixture.NOW.timestamp()),'done')
        with research.connect(self.path) as db:
            audit=dict(db.execute('SELECT * FROM reviewed_retry_article_recoveries').fetchone())
            saved=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            self.assertEqual(json.loads(audit['previous_history']),old)
            current=self.history(db)
            self.assertEqual(current,{**old,'job':{**old['job'],'state':'done'}})
            self.assertEqual(recovery.retry_source_snapshot(db,self.pin),source)
            self.assertEqual(saved['public_at'],audit['public_at'])
            self.assertEqual(recovery.digest(saved['payload']),audit['payload_sha'])
            self.assertEqual(len(research.validated_publications(db,research.candidates(db,fixture.NOW))),1)
        self.assertFalse(self.publish())
        import service  # Defer this import; other tests reload signals during discovery.
        public=service.AutomaticMonitor(self.path,Path(self.fixture.tmp.name)/'snapshot.json').public_news()
        item=next(x for x in public['officialUpdates'] if x['id']=='1233')
        self.assertIn('世界展開を開始',item['bodyJa'])
        self.assertEqual(item['publishedOn'],self.pin['publishedOn'])

    def test_identity_job_failure_call_and_proof_changes_are_noops(self):
        changes=("UPDATE sources SET status='held'", "UPDATE sources SET title='Changed title'",
                 "UPDATE signal_events SET sha='retracted'", "UPDATE official_story_bodies SET body=body||' changed'",
                 "UPDATE official_story_body_proofs SET extractor_version='unverified'",
                 "UPDATE official_research_jobs SET state='running'", "UPDATE official_research_jobs SET attempts=7",
                 "UPDATE official_research_jobs SET lease='other'", "UPDATE official_research_jobs SET sha='changed'",
                 "UPDATE official_research_attempt_failures SET payload=payload||' changed' WHERE lease='latest'",
                 "UPDATE official_research_attempt_failures SET payload=payload||' changed' WHERE lease='original-call'",
                 "UPDATE official_research_attempt_failures SET failed_at='malformed' WHERE lease='original-call'",
                 "UPDATE official_research_attempt_failures SET failed_at='2026-10-04T09:00:00+00:00'",
                 "UPDATE signal_headline_translation_calls SET state='running' WHERE lease='latest'",
                 "UPDATE signal_headline_translation_calls SET source_id='wrong' WHERE lease='latest'",
                 "DELETE FROM official_research_attempt_body_proofs WHERE lease='latest'",
                 "UPDATE official_research_attempt_body_proofs SET body_sha='changed' WHERE lease='original-call'")
        for sql in changes:
            with self.subTest(sql=sql):
                case=ReviewedRetryArticlesTests();case.setUp()
                try:
                    with research.connect(case.path) as db:db.execute(sql)
                    self.assertFalse(case.publish())
                    with research.connect(case.path) as db:
                        self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0],0)
                        self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retry_article_recoveries').fetchone()[0],0)
                finally:case.doCleanups()

    def test_existing_publication_and_consumed_withdrawal_are_never_overwritten(self):
        self.assertTrue(self.publish())
        with research.connect(self.path) as db:
            before=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            db.execute("UPDATE official_research_jobs SET state='retry'")
        with patch.object(research,'candidates',side_effect=AssertionError('unneeded candidate scan')):
            self.assertFalse(self.publish())
        with research.connect(self.path) as db:
            self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),before)
            db.execute('DELETE FROM official_research_publications')
        self.assertFalse(self.publish())

    def test_close_failure_timestamps_archive_the_current_lease(self):
        older='2026-10-04T09:00:00.400701+00:00'
        newer='2026-10-04T09:00:00.400747+00:00'
        with research.connect(self.path) as db:
            original=dict(db.execute("SELECT * FROM official_research_attempt_failures WHERE lease='original-call'").fetchone())
            db.execute("DELETE FROM official_research_attempt_failures WHERE lease='original-call'")
            db.execute("UPDATE official_research_attempt_failures SET failed_at=? WHERE lease='latest'",(newer,))
            original['failed_at']=older
            db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',tuple(original.values()))
            self.assertEqual(db.execute('SELECT julianday(?)=julianday(?)',(older,newer)).fetchone()[0],1)
        self.pin['reviewedFailure']['failedAt']=older
        self.pin['failure']['failedAt']=newer
        self.write_manifest()
        self.assertTrue(self.publish())
        with research.connect(self.path) as db:
            audit=db.execute('SELECT * FROM reviewed_retry_article_recoveries').fetchone()
            self.assertEqual(audit['failure_lease'],'latest')
            self.assertEqual(audit['failure_payload_sha'],self.pin['failure']['payloadSha'])

    def test_signal_document_uses_normal_issuer_projection_and_equal_complete_body(self):
        p=self.pin; body=fixture.BODY
        p.update(eventId=1184,sourceId='nebius-blog',ticker='NBIS',
            url='https://nebius.com/blog/posts/synthetic-reviewed-retry',title='Nebius announces a service update',
            publishedOn=None,publishedAt='2026-09-30T00:00:00+00:00',provenance='signal-document')
        p['eventSha']=p['sourceRevision']=recovery.digest(p['title']+'\n'+body)
        p.pop('extractorVersion')
        with research.connect(self.path) as db:
            db.execute('DELETE FROM source_revisions');db.execute('DELETE FROM release_events');db.execute('DELETE FROM sources')
            db.execute('DELETE FROM official_story_body_proofs')
            db.execute('UPDATE signal_events SET id=?,source_id=?,url=?,sha=?,title=?,tickers_json=?,published_on=NULL,published_at=?',
                (p['eventId'],p['sourceId'],p['url'],p['eventSha'],p['title'],'["GOOGL","NBIS","NVDA"]',p['publishedAt']))
            db.execute('INSERT INTO signal_documents VALUES(?,?,?,?,?,?,?)',
                (p['sourceId'],p['url'],p['eventSha'],p['title'],body,p['observedAt'],p['observedAt']))
            db.execute('UPDATE official_story_bodies SET event_id=?,sha=?',(p['eventId'],p['eventSha']))
            db.execute('UPDATE official_research_jobs SET event_id=?,sha=?',(p['eventId'],p['eventSha']))
            db.execute('UPDATE official_research_attempt_failures SET event_id=?,sha=?',(p['eventId'],p['eventSha']))
            db.execute('UPDATE official_research_attempt_body_proofs SET source_sha=?',(p['eventSha'],))
            db.execute('UPDATE signal_headline_translation_calls SET source_id=?,sha=?',('research:'+p['sourceId'],p['eventSha']))
            self.assertEqual(research.candidates(db,fixture.NOW,read_only=True)[0]['ticker'],'NBIS')
        self.write_manifest()
        with research.connect(self.path) as db:
            def validate(*args):
                with sqlite3.connect(self.path,timeout=0) as other:
                    other.execute("UPDATE signal_documents SET text=text||' changed'")
                return research.validate(*args)
            self.assertFalse(recovery.publish_retained(db,fixture.NOW,validate))
            db.execute('UPDATE signal_documents SET text=?',(body,))
        self.assertTrue(self.publish())
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM official_story_body_proofs').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT source_revision FROM reviewed_retry_article_recoveries').fetchone()[0],p['eventSha'])

    def test_review_manifest_revocation_during_validation_is_a_noop(self):
        def validate(*args):
            result=research.validate(*args)
            recovery.RETAINED_COPY_PATH.write_text('{}')
            return result
        self.assertFalse(self.publish(validate))

    def test_invalid_reviewed_copy_blocks_paid_fallthrough(self):
        self.pin['copy']['summary']['en'] += ' Its cost is $999.'
        self.write_manifest()
        self.assertEqual(self.publish(),'blocked')
        with patch.object(research,'prepare_story_body',side_effect=AssertionError('body fetch')):
            self.assertEqual(research.run_once(self.path,lambda *_:self.fail('provider'),{},fixture.NOW.timestamp()),'idle')

    def test_second_writer_progress_and_snapshot_recheck_during_validation(self):
        for sql in ("UPDATE sources SET status='held'", "UPDATE official_research_jobs SET state='running'",
                    "UPDATE official_research_jobs SET next_at=next_at+60",
                    "UPDATE official_research_attempt_body_proofs SET body_sha='changed' WHERE lease='latest'",
                    "UPDATE signal_headline_translation_calls SET usage='changed' WHERE lease='latest'"):
            with self.subTest(sql=sql):
                case=ReviewedRetryArticlesTests();case.setUp()
                try:
                    with research.connect(case.path) as db:
                        def validate(*args):
                            self.assertFalse(db.in_transaction)
                            with sqlite3.connect(case.path,timeout=0) as other:
                                other.execute('BEGIN IMMEDIATE');other.execute(sql)
                            return research.validate(*args)
                        self.assertFalse(recovery.publish_retained(db,fixture.NOW,validate))
                        self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0],0)
                finally:case.doCleanups()

    def test_failed_audit_write_rolls_back_every_change(self):
        with research.connect(self.path) as db:
            before=self.history(db)
            db.execute("CREATE TRIGGER refuse BEFORE INSERT ON official_research_publications BEGIN SELECT RAISE(ABORT,'test refused'); END")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'test refused'):self.publish()
        with research.connect(self.path) as db:
            self.assertEqual(self.history(db),before)
            self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retry_article_recoveries').fetchone()[0],0)

    def test_two_publishers_racing_save_exactly_once(self):
        with research.connect(self.path) as db:db.execute('PRAGMA journal_mode=WAL')
        barrier=threading.Barrier(2);results=[];errors=[]
        def work():
            try:
                with sqlite3.connect(self.path,timeout=5) as db:
                    db.row_factory=sqlite3.Row
                    def validate(*args):
                        result=research.validate(*args);barrier.wait(timeout=5);return result
                    results.append(recovery.publish_retained(db,fixture.NOW,validate))
            except BaseException as exc:errors.append(exc)
        threads=[threading.Thread(target=work) for _ in range(2)]
        for thread in threads:thread.start()
        for thread in threads:thread.join(timeout=10)
        self.assertEqual(errors,[])
        self.assertCountEqual(results,[True,False])
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retry_article_recoveries').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],2)


if __name__=='__main__':unittest.main()
