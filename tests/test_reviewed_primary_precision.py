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


class ReviewedPrimaryComparisonTests(unittest.TestCase):
    def setUp(self):
        self.case=ReviewedPrimaryPrecisionTests();self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.path=self.case.path;self.pin=self.case.pin
        p=self.pin
        self.body=self.case.body+'\nThe model detects 50% more methane emissions than human experts.\n'
        with research.connect(self.path) as db:
            original=dict(recovery.retained_candidate(db,p,rollout.NOW))
        copy=recovery.retained_note(original,p)
        copy['facts'][0]={'ja':'このモデルは人間の専門家より50％多いメタン排出を検出する。',
                         'en':'The model detects 50% more methane emissions than human experts.',
                         'evidenceQuote':'The model detects 50% more methane emissions than human experts.\n'}
        def span(item):
            q=item['evidenceQuote'];start=self.body.index(q)
            return {'ja':item['ja'],'en':item['en'],'evidenceSpan':
                    {'start':start,'end':start+len(q),'sha256':recovery.digest(q)}}
        p.update(eventId=1240,bodyTextSha=recovery.digest(self.body),bodyChars=len(self.body),
                 bodyRevisionSha=recovery.digest('document:'+self.body),
                 reviewedPayloadSha=recovery.digest(json.dumps(copy,ensure_ascii=False)))
        p['sourceRevision']=p['bodyRevisionSha']
        p['eventSha']=bridge.revision(p['title'],p['sourceRevision'],p['publishedOn'])
        p['copy']={**{k:span(copy[k]) for k in ('title','summary','purpose')},
                   'facts':[span(x) for x in copy['facts']]}
        unsafe=deepcopy(copy);unsafe['facts'][0]['ja']='このモデルは既知より50％多いメタン排出を検出する。'
        payload=json.dumps(unsafe,ensure_ascii=False)
        p['replacement'].update(reason='unsupported-comparison-baseline',bodySha=p['bodyRevisionSha'],
                                payloadSha=recovery.digest(payload),jobAttempts=3)
        self.expected=copy
        with research.connect(self.path) as db:
            db.execute('UPDATE sources SET sha256=?,extracted_text=?,extracted_chars=?',
                       (p['sourceRevision'],self.body,len(self.body)))
            db.execute('UPDATE source_revisions SET sha256=?,extracted_text=?,extracted_chars=?',
                       (p['sourceRevision'],self.body,len(self.body)))
            db.execute('UPDATE signal_events SET id=?,sha=?',(p['eventId'],p['eventSha']))
            db.execute('UPDATE official_research_publications SET event_id=?,sha=?,body_sha=?,payload=?',
                       (p['eventId'],p['eventSha'],p['bodyRevisionSha'],payload))
            db.execute('UPDATE official_research_jobs SET event_id=?,sha=?,attempts=3',
                       (p['eventId'],p['eventSha']))
            db.execute('UPDATE signal_headline_translation_calls SET sha=?',(p['eventSha'],))
            db.execute('UPDATE signal_headline_translations SET sha=?',(p['eventSha'],))
            for index in range(2):
                db.execute('INSERT INTO signal_headline_translation_calls VALUES(?,?,?,?,?,?,?)',
                           (rollout.NOW.timestamp()-7200-index,'research:'+p['sourceId'],p['eventSha'],
                            'test-model','failed','{}','earlier-failure-'+str(index)))
            self.old=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            self.history=self.case.case.case.snapshot(db)
        self.case.case.write_manifest()

    def publish(self,validator=research.validate):return self.case.publish(validator)

    def test_reviewed_comparison_restores_exact_windows_with_all_prior_calls(self):
        with research.connect(self.path) as db:
            row=dict(recovery.retained_candidate(db,self.pin,rollout.NOW))
            with self.assertRaisesRegex(ValueError,'unsupported-comparison-baseline'):
                research.validate(json.loads(self.old['payload']),self.body,row['title'])
            self.assertEqual(recovery.retained_note(row,self.pin),self.expected)
        self.assertEqual(research.run_once(self.path,lambda *_:self.fail('provider'),{},rollout.NOW.timestamp()),'done')
        with research.connect(self.path) as db:
            saved=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            note=json.loads(saved['payload'])
            self.assertEqual({k:note[k] for k in self.expected},self.expected)
            self.assertTrue(note['facts'][0]['evidenceQuote'].endswith('\n'))
            self.assertEqual(self.case.case.case.snapshot(db),self.history)
            archive=db.execute('SELECT * FROM reviewed_retained_announcement_replacements').fetchone()
            self.assertEqual(archive['reason'],'unsupported-comparison-baseline')
            self.assertEqual(json.loads(archive['previous_publication']),self.old)
            self.assertEqual(len(json.loads(archive['previous_calls'])),3)
            self.assertNotEqual(saved['public_at'],self.old['public_at'])
            self.assertEqual(saved['body_sha'],self.pin['bodyRevisionSha'])
            self.assertEqual(len(research.feed(db,rollout.NOW)),1)
        self.assertFalse(self.publish())

    def test_bad_span_or_reviewed_copy_hash_fails_closed(self):
        with research.connect(self.path) as db:
            row=dict(recovery.retained_candidate(db,self.pin,rollout.NOW))
        for key,value in [('start',True),('start',-1),('end',999999),('end',1),('sha256','changed')]:
            pin=deepcopy(self.pin);pin['copy']['title']['evidenceSpan'][key]=value
            with self.subTest(key=key,value=value),self.assertRaises(ValueError):recovery.retained_note(row,pin)
        for mutate in ('payload','provenance','quote-space'):
            pin=deepcopy(self.pin)
            if mutate=='payload':pin['copy']['summary']['en']+=' changed'
            elif mutate=='provenance':pin.pop('provenance')
            else:
                span=pin['copy']['facts'][0]['evidenceSpan'];span['end']-=1
                span['sha256']=recovery.digest(self.body[span['start']:span['end']])
            with self.subTest(mutate=mutate),self.assertRaises(ValueError):recovery.retained_note(row,pin)

    def test_latest_job_call_or_publication_change_blocks_replacement(self):
        for sql,restore in (
            ("UPDATE official_research_jobs SET attempts=4","UPDATE official_research_jobs SET attempts=3"),
            ("UPDATE official_research_jobs SET state='running'","UPDATE official_research_jobs SET state='done'"),
            ("UPDATE signal_headline_translation_calls SET state='running' WHERE lease='original-call'",
             "UPDATE signal_headline_translation_calls SET state='done' WHERE lease='original-call'")):
            with self.subTest(sql=sql):
                with research.connect(self.path) as db:db.execute(sql)
                self.assertFalse(self.publish())
                with research.connect(self.path) as db:db.execute(restore)
        with research.connect(self.path) as db:
            def validate(*args):
                self.assertFalse(db.in_transaction)
                with sqlite3.connect(self.path,timeout=0) as other:
                    other.execute("UPDATE official_research_jobs SET next_at=next_at+1")
                return research.validate(*args)
            self.assertFalse(recovery.publish_retained(db,rollout.NOW,validate))
            self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),self.old)

    def test_actual_summary_pin_is_the_newly_reviewed_exact_copy(self):
        data=json.loads(Path(recovery.__file__).with_name('reviewed_retained_announcements.json').read_text())
        pin=next(x for x in data['announcements'] if x.get('eventId')==1240)
        self.assertEqual(pin['reviewedPayloadSha'],'65dbaf91f551d5a401eede1afa38ab596085ebe0bf03696574871d1045bf6d4c')
        self.assertEqual(pin['replacement']['payloadSha'],'9afb945834bbffaa64d37e3022cf40b0db742f6a229482398aecdbd5c46042f8')
        self.assertEqual(pin['replacement']['jobAttempts'],3)
        self.assertEqual(pin['replacement']['reason'],'unsupported-comparison-baseline')
        self.assertNotEqual(pin['bodyRevisionSha'],pin['bodyTextSha'])
        units=[pin['copy'][k] for k in ('title','summary','purpose')]+pin['copy']['facts']
        self.assertEqual(len(units),8)
        self.assertTrue(all('evidenceSpan' in x and 'evidenceQuote' not in x for x in units))
        self.assertIn('人間の専門家より50％',pin['copy']['facts'][3]['ja'])
        self.assertIn('same speed and low cost as 3.7 Flash',pin['copy']['facts'][1]['en'])


if __name__=='__main__':unittest.main()
