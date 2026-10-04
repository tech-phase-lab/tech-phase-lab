"""Primary revision IDs stay distinct from extracted-text fingerprints."""
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch

import official_release_bridge as bridge
import official_research as research
import official_research_editorial_recovery as recovery
import test_reviewed_precision_correction as precision
import test_reviewed_rollout_correction as rollout


class ReviewedPrimaryPrecisionTests(unittest.TestCase):
    def setUp(self):
        outer_path,outer_sha=recovery.RETAINED_COPY_PATH,recovery.RETAINED_COPY_SHA
        def restore():recovery.RETAINED_COPY_PATH,recovery.RETAINED_COPY_SHA=outer_path,outer_sha
        self.addCleanup(restore)
        recovery.RETAINED_COPY_PATH=Path(recovery.__file__).with_name('reviewed_retained_announcements.json')
        recovery.RETAINED_COPY_SHA=recovery.digest(recovery.RETAINED_COPY_PATH.read_text())
        self.case=precision.ReviewedPrecisionCorrectionTests();self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.path=self.case.path;self.pin=self.case.pin
        self.body=rollout.BODY+'\n'+('Synthetic engineering context preserves the exact retained article. '*22)
        p=self.pin
        p.update(eventId=1242,provenance='primary-source-revision',bodyTextSha=recovery.digest(self.body),
                 bodyChars=len(self.body),bodyRevisionSha=recovery.digest('acquired-document:'+self.body))
        p['sourceRevision']=p['bodyRevisionSha']
        p['eventSha']=bridge.revision(p['title'],p['sourceRevision'],p['publishedOn'])
        p.pop('extractorVersion')
        p['replacement']['bodySha']=p['bodyRevisionSha']
        with research.connect(self.path) as db:
            db.execute('DELETE FROM official_story_body_proofs');db.execute('DELETE FROM official_story_bodies')
            db.execute('DELETE FROM source_revisions')
            db.execute("UPDATE sources SET sha256=?,extracted_text=?,extracted_chars=?,content_type='text/html',extractor_version='synthetic-retained',source_mode='article'",
                       (p['sourceRevision'],self.body,len(self.body)))
            db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',
                       (p['url'],p['sourceRevision'],'2026-10-03T14:04:32.651+00:00',self.body,len(self.body)))
            db.execute('UPDATE signal_events SET id=?,sha=?',(p['eventId'],p['eventSha']))
            db.execute('UPDATE official_research_publications SET event_id=?,sha=?,body_sha=?',
                       (p['eventId'],p['eventSha'],p['bodyRevisionSha']))
            db.execute('UPDATE official_research_jobs SET event_id=?,sha=?',(p['eventId'],p['eventSha']))
            db.execute('UPDATE signal_headline_translation_calls SET sha=?',(p['eventSha'],))
            db.execute('UPDATE signal_headline_translations SET sha=?',(p['eventSha'],))
            self.old=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            self.history=self.case.case.snapshot(db)
        self.case.write_manifest()

    def publish(self,validator=research.validate):return self.case.case.publish(validator)

    def test_current_primary_revision_correction_projects_without_fabricated_cache(self):
        self.assertNotEqual(self.pin['bodyTextSha'],self.pin['bodyRevisionSha'])
        self.assertEqual(research.run_once(self.path,lambda *_:self.fail('provider'),{},rollout.NOW.timestamp()),'done')
        with research.connect(self.path) as db:
            saved=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            self.assertEqual(saved['body_sha'],self.pin['bodyRevisionSha'])
            self.assertEqual(self.case.case.snapshot(db),self.history)
            audit=db.execute('SELECT * FROM reviewed_retained_announcement_replacements').fetchone()
            self.assertEqual(json.loads(audit['previous_publication']),self.old)
            self.assertEqual(db.execute('SELECT count(*) FROM official_story_bodies').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM official_story_body_proofs').fetchone()[0],0)
            items=research.feed(db,rollout.NOW)
            self.assertEqual([x['id'] for x in items],['ir-result-1242'])
            self.assertEqual(items[0]['bodyReadyAt'],'2026-10-03T14:04:32.651+00:00')
        self.assertFalse(self.publish())
        import service  # Other discovery tests reload signals; keep this lazy.
        public=service.AutomaticMonitor(self.path,Path(self.case.case.tmp.name)/'snapshot.json').public_news()
        self.assertTrue(any(x['id']=='ir-result-1242' for x in public['officialResearch']))

    def test_changed_text_storage_identity_or_normal_candidate_is_rejected(self):
        changes=("UPDATE source_revisions SET extracted_text=extracted_text||' changed'",
                 "UPDATE sources SET sha256='changed'", "UPDATE sources SET status='held'",
                 "UPDATE sources SET error='unverified'", "UPDATE sources SET ticker='NVDA'",
                 "UPDATE official_research_publications SET body_sha='text-digest-not-revision'")
        for sql in changes:
            with self.subTest(sql=sql):
                case=ReviewedPrimaryPrecisionTests();case.setUp()
                try:
                    with research.connect(case.path) as db:db.execute(sql)
                    self.assertFalse(case.publish())
                finally:case.doCleanups()
        with patch.object(research,'candidates',return_value=[]):self.assertFalse(self.publish())

    def test_source_revision_and_publisher_changes_during_validation_block_commit(self):
        with research.connect(self.path) as db:
            def validate(*args):
                self.assertFalse(db.in_transaction)
                with sqlite3.connect(self.path,timeout=0) as other:
                    other.execute("UPDATE source_revisions SET observed_at='2026-10-04T01:00:00+00:00'")
                return research.validate(*args)
            self.assertFalse(recovery.publish_retained(db,rollout.NOW,validate))
            self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),self.old)
        with patch.object(bridge,'publishers',return_value=[]):self.assertFalse(self.publish())

    def test_concurrent_primary_issuer_change_is_rechecked(self):
        with research.connect(self.path) as db:
            def validate(*args):
                self.assertFalse(db.in_transaction)
                with sqlite3.connect(self.path,timeout=0) as other:
                    other.execute("UPDATE sources SET ticker='NVDA'")
                return research.validate(*args)
            self.assertFalse(recovery.publish_retained(db,rollout.NOW,validate))
            self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),self.old)

    def test_actual_googlebook_pin_keeps_date_attached_to_collaboration(self):
        data=json.loads(Path(recovery.__file__).with_name('reviewed_retained_announcements.json').read_text())
        pin=next(x for x in data['announcements'] if x.get('eventId')==1242)
        self.assertEqual(pin['provenance'],'primary-source-revision')
        self.assertEqual(pin['sourceRevision'],pin['bodyRevisionSha'])
        self.assertNotEqual(pin['bodyRevisionSha'],pin['bodyTextSha'])
        self.assertNotIn('extractorVersion',pin)
        self.assertIn('will team up with Google in November 2026',pin['copy']['summary']['en'])
        self.assertNotIn('launching',pin['copy']['summary']['en'])
        self.assertNotIn('発売',pin['copy']['summary']['ja'])
        self.assertEqual(pin['copy']['facts'][0]['anchors'],['Sep 29, 2026','This November, Henry is teaming up'])


if __name__=='__main__':unittest.main()
