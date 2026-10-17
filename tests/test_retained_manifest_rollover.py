"""Manifest edits must not resurrect consumed, withdrawn retained publications."""
from copy import deepcopy
from datetime import datetime, timezone
import json
import unittest

import official_research as research
import official_research_editorial_recovery as recovery
import test_reviewed_rollout_correction as retained_fixture
import test_skhynix_reviewed_recovery as retry_fixture


class RetainedManifestRolloverTests(unittest.TestCase):
    def setUp(self):
        self.fx=retained_fixture.ReviewedRolloutCorrectionTests();self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)
        self.path=self.fx.path;self.pin=self.fx.pin
        self.pin.pop('replacement')
        self.manifest={'policy':'reviewed-retained-announcement-v1',
            'startsAt':'2026-10-04T00:00:00+00:00','expiresAt':'2026-10-05T00:00:00+00:00',
            'announcements':[self.pin],'retryArticles':[]}
        with research.connect(self.path) as db:db.execute('DELETE FROM official_research_publications')
        self.write_manifest()
        self.assertTrue(self.fx.publish())
        self.old_sha=recovery.RETAINED_COPY_SHA
        with research.connect(self.path) as db:
            self.publication=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            self.audit=dict(db.execute('SELECT * FROM reviewed_retained_announcement_recoveries').fetchone())

    def write_manifest(self):
        recovery.RETAINED_COPY_PATH.write_text(json.dumps(self.manifest,ensure_ascii=False))
        recovery.RETAINED_COPY_SHA=recovery.digest(recovery.RETAINED_COPY_PATH.read_text())

    def unrelated_manifest_update(self):
        unrelated=deepcopy(self.pin)
        unrelated['url']='https://blog.google/products-and-platforms/products/gemini/synthetic-unrelated-review/'
        self.manifest['announcements'].append(unrelated)
        self.write_manifest()
        self.assertNotEqual(recovery.RETAINED_COPY_SHA,self.old_sha)

    def remove_publication(self):
        with research.connect(self.path) as db:db.execute('DELETE FROM official_research_publications')

    def assert_stays_removed(self):
        self.assertFalse(self.fx.publish())
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_recoveries').fetchone()[0],1)
            self.assertEqual(dict(db.execute('SELECT * FROM reviewed_retained_announcement_recoveries').fetchone()),self.audit)

    def test_unrelated_manifest_update_preserves_live_copy_old_metadata_and_audit(self):
        self.unrelated_manifest_update()
        with research.connect(self.path) as db:before='\n'.join(db.iterdump())
        self.assertFalse(self.fx.publish())
        with research.connect(self.path) as db:
            self.assertEqual('\n'.join(db.iterdump()),before)
            saved=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            self.assertEqual(saved,self.publication)
            self.assertEqual(json.loads(saved['payload'])['reviewedCopySha256'],self.old_sha)
            rows=research.candidates(db,retained_fixture.NOW,read_only=True)
            self.assertEqual(len(research.validated_publications(db,rows)),1)

    def test_publication_removed_before_or_after_checksum_rollover_stays_removed(self):
        self.remove_publication()
        self.assert_stays_removed()
        self.unrelated_manifest_update()
        self.assert_stays_removed()

    def test_stale_source_and_later_reinstatement_do_not_recreate_withdrawn_copy(self):
        self.unrelated_manifest_update();self.remove_publication()
        with research.connect(self.path) as db:db.execute("UPDATE sources SET status='held'")
        self.assert_stays_removed()
        with research.connect(self.path) as db:db.execute("UPDATE sources SET status='new'")
        self.assert_stays_removed()
        with research.connect(self.path) as db:
            original=db.execute('SELECT sha256 FROM sources').fetchone()[0]
            db.execute("UPDATE sources SET sha256='unfetched-revision'")
        self.assert_stays_removed()
        with research.connect(self.path) as db:db.execute('UPDATE sources SET sha256=?',(original,))
        self.assert_stays_removed()

    def test_genuine_new_body_revision_is_not_consumed_by_old_recovery(self):
        self.unrelated_manifest_update();self.remove_publication()
        body=retained_fixture.BODY+'\nAdditional synthetic engineering context.\n'
        self.pin.update(bodyTextSha=recovery.digest(body),bodyChars=len(body))
        with research.connect(self.path) as db:
            db.execute('UPDATE official_story_bodies SET body=?,body_sha=?',(body,self.pin['bodyTextSha']))
            db.execute('UPDATE official_story_body_proofs SET body_sha=?',(self.pin['bodyTextSha'],))
        self.write_manifest()
        self.assertTrue(self.fx.publish())
        with research.connect(self.path) as db:
            audits=[dict(row) for row in db.execute('SELECT * FROM reviewed_retained_announcement_recoveries')]
            self.assertEqual(len(audits),2)
            self.assertIn(self.audit,audits)
            self.assertEqual(db.execute('SELECT body_sha FROM official_research_publications').fetchone()[0],self.pin['bodyTextSha'])

    def test_genuine_new_source_event_revision_is_not_consumed_by_old_recovery(self):
        self.unrelated_manifest_update();self.remove_publication()
        revision=recovery.digest('new synthetic acquisition revision')
        self.pin['sourceRevision']=revision
        self.pin['eventSha']=research.bridge.revision(self.pin['title'],revision,self.pin['publishedOn'])
        # Normal collector events get a new ID for the new acquisition version.
        self.pin['eventId']=1234
        with research.connect(self.path) as db:
            db.execute('UPDATE sources SET sha256=?',(revision,))
            db.execute('UPDATE source_revisions SET sha256=?',(revision,))
            research.bridge.sync(db,retained_fixture.NOW)
            latest=db.execute('SELECT id,sha FROM signal_events ORDER BY id DESC LIMIT 1').fetchone()
            self.assertEqual((latest['id'],latest['sha']),(1234,self.pin['eventSha']))
            db.execute('UPDATE official_story_bodies SET event_id=?,sha=?',(1234,self.pin['eventSha']))
            db.execute('UPDATE official_story_body_proofs SET event_id=?,sha=?',(1234,self.pin['eventSha']))
        self.write_manifest()
        self.assertTrue(self.fx.publish())
        with research.connect(self.path) as db:
            audits=[dict(row) for row in db.execute('SELECT * FROM reviewed_retained_announcement_recoveries')]
            self.assertEqual(len(audits),2)
            self.assertIn(self.audit,audits)
            self.assertEqual(db.execute('SELECT event_id FROM official_research_publications').fetchone()[0],1234)

    def test_explicit_replacement_is_not_blocked_by_cross_manifest_consumption(self):
        # Cross-manifest consumption must not overrule explicit source-reviewed
        # replacement of a currently present, exactly pinned prior publication.
        self.unrelated_manifest_update()
        old=dict(self.publication)
        self.pin['replacement']={'reason':'reviewed-evidence-precision',
            'payloadSha':recovery.digest(old['payload']),'bodySha':old['body_sha'],
            'startedAt':old['started_at'],'publicAt':old['public_at'],
            'generationMs':old['generation_ms'],'jobAttempts':1}
        self.pin['copy']['facts'][2]['ja']='個人アカウント向けGemsのサポートは11月から終了となる。'
        with research.connect(self.path) as db:
            # Align this synthetic fixture with the inherited matching-call
            # guard. This does not prove real editorial correction chaining.
            db.execute('UPDATE signal_headline_translation_calls SET at=?',
                (datetime.fromisoformat(old['started_at']).timestamp(),))
        self.write_manifest()
        self.assertTrue(self.fx.publish())
        with research.connect(self.path) as db:
            archive=json.loads(db.execute('SELECT previous_publication FROM reviewed_retained_announcement_replacements').fetchone()[0])
            self.assertEqual(archive,old)
        self.remove_publication();self.assertFalse(self.fx.publish())


class CompletedRetryManifestRolloverTests(unittest.TestCase):
    def test_1139_keeps_prior_manifest_metadata_and_cannot_be_recreated(self):
        fx=retry_fixture.SkhynixReviewedRecoveryTests();fx.setUp()
        self.addCleanup(fx.doCleanups)
        self.assertTrue(fx.publish())
        old_sha=recovery.RETAINED_COPY_SHA
        saved=dict(fx.db.execute('SELECT * FROM official_research_publications').fetchone())
        audit=dict(fx.db.execute('SELECT * FROM reviewed_retry_article_recoveries').fetchone())
        manifest=json.loads(recovery.RETAINED_COPY_PATH.read_text())
        manifest['announcements']=[{'sourceId':'primary-ir-NVDA','url':'https://nvidianews.nvidia.com/synthetic-unrelated'}]
        recovery.RETAINED_COPY_PATH.write_text(json.dumps(manifest,ensure_ascii=False))
        recovery.RETAINED_COPY_SHA=recovery.digest(recovery.RETAINED_COPY_PATH.read_text())
        self.assertNotEqual(recovery.RETAINED_COPY_SHA,old_sha)
        before='\n'.join(fx.db.iterdump())
        self.assertFalse(fx.publish())
        self.assertEqual('\n'.join(fx.db.iterdump()),before)
        rows=research.candidates(fx.db,fx.reference,read_only=True)
        self.assertEqual(len(research.validated_publications(fx.db,rows)),1)
        self.assertEqual(json.loads(saved['payload'])['reviewedCopySha256'],old_sha)
        self.assertEqual(audit['manifest_sha'],old_sha)
        with fx.db:
            fx.db.execute('DELETE FROM official_research_publications')
            fx.db.execute("UPDATE official_research_jobs SET state='retry'")
        self.assertFalse(fx.publish())
        self.assertEqual(fx.db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0],0)
        self.assertEqual(dict(fx.db.execute('SELECT * FROM reviewed_retry_article_recoveries').fetchone()),audit)


if __name__=='__main__':unittest.main()
