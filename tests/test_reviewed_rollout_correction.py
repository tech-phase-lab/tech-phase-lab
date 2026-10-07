"""Synthetic records test the pinned correction without republishing the article.

The real retained body and rejected payload remain in the private review evidence.
These small source passages exercise the same rollout guard and transaction.
"""
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import test_rollout_validation as rollout
import official_research as research
import official_research_editorial_recovery as recovery
import official_release_bridge as bridge
import signals


NOW = datetime(2026, 10, 4, 10, tzinfo=timezone.utc)
BODY = rollout.ROLLOUT + '\n' + rollout.REMOVAL
SOURCE = 'Synthetic acquisition teaser.'
HISTORY = ('sources', 'source_revisions', 'signal_events', 'release_events',
           'official_story_bodies', 'official_story_body_proofs',
           'official_research_jobs', 'signal_headline_translation_calls',
           'official_research_attempt_failures')


def synthetic_copy():
    def item(ja, en, anchor):
        return {'ja': ja, 'en': en, 'anchors': [anchor]}
    current = item('Geminiチャットでスキルの世界展開を開始した。',
                   'Skills began rolling out globally in Gemini chat.', 'Skills are already')
    return {'title': deepcopy(current), 'summary': deepcopy(current),
            'facts': [deepcopy(current),
                      item('Gemini Sparkではスキルをすでに利用できる。',
                           'Skills are already available in Gemini Spark.', 'Skills are already'),
                      item('個人アカウントのGemsは11月からサポート終了となる。',
                           'Gems support removal begins in November for personal accounts.', 'As we bring')],
            'purpose': item('スキルは特定のタスクに合わせた指示に使える。',
                            'Skills tailor instructions for specific tasks.', 'Skills are already')}


class ReviewedRolloutCorrectionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'test.sqlite'
        manifest = json.loads(recovery.RETAINED_COPY_PATH.read_text())
        self.pin = deepcopy(next(p for p in manifest['announcements'] if p.get('eventId') == 1233))
        self.pin.update(bodyTextSha=recovery.digest(BODY), bodyChars=len(BODY),
                        sourceRevision=recovery.digest(SOURCE), copy=synthetic_copy())
        self.pin['eventSha'] = bridge.revision(self.pin['title'], self.pin['sourceRevision'], self.pin['publishedOn'])
        p = self.pin
        with research.connect(self.path) as db:
            db.execute('''INSERT INTO sources(url,ticker,title,published_on,discovered_at,sha256,
              extracted_text,extracted_chars,body_sha256,content_type,source_mode)
              VALUES(?,?,?,?,?,?,?,?,?,'application/xml','inline')''',
                       (p['url'],p['ticker'],p['title'],p['publishedOn'],p['observedAt'],
                        p['sourceRevision'],SOURCE,len(SOURCE),p['sourceRevision']))
            db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',
                       (p['url'],p['sourceRevision'],p['observedAt'],SOURCE,len(SOURCE)))
            db.execute('UPDATE sources SET raw_sha256=?',(p['sourceRevision'],))
            db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',
                       (p['url'],p['ticker'],p['observedAt']))
            bridge.sync(db,NOW)
            db.execute('UPDATE signal_events SET id=1233')
            db.execute('INSERT INTO signal_headline_translations VALUES(?,?,?,?,?,?)',
                       (p['sourceId'],p['url'],p['eventSha'],'Geminiのスキルを紹介','test',p['observedAt']))
            body_at = (NOW-timedelta(minutes=5)).isoformat()
            db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,?)',
                       (1233,p['eventSha'],p['bodyTextSha'],BODY,body_at,0,None))
            db.execute('INSERT INTO official_story_body_proofs VALUES(?,?,?,?,?,?,?,?,?)',
                       (1233,p['eventSha'],p['bodyTextSha'],body_at,p['url'],p['title'],
                        p['publishedOn'],p['extractorVersion'],'test-raw-proof'))
            self.row = dict(recovery.retained_candidate(db,p,NOW))
            note = recovery.retained_note(self.row,p)
            note['facts'][0] = {'ja':rollout.WRONG_JA,'en':rollout.WRONG_EN,'evidenceQuote':rollout.ROLLOUT}
            payload = json.dumps(note,ensure_ascii=False)
            p['replacement'].update(payloadSha=recovery.digest(payload), bodySha=p['bodyTextSha'])
            r = p['replacement']
            db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                       (1233,p['eventSha'],p['bodyTextSha'],payload,'[]',r['startedAt'],r['publicAt'],r['generationMs']))
            db.execute('INSERT INTO official_research_jobs VALUES(?,?,?,?,?,?,?)',
                       (1233,p['eventSha'],1,NOW.timestamp()+3600,'original-call','done',None))
            db.execute('INSERT INTO signal_headline_translation_calls VALUES(?,?,?,?,?,?,?)',
                       (datetime.fromisoformat(r['startedAt']).timestamp(),'research:'+p['sourceId'],
                        p['eventSha'],'test-model','done','{}','original-call'))
            self.old = dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            self.history = self.snapshot(db)
        manifest['announcements'] = [p]
        path = Path(self.tmp.name)/'reviewed.json'
        path.write_text(json.dumps(manifest,ensure_ascii=False))
        for name,value in [('RETAINED_COPY_PATH',path),('RETAINED_COPY_SHA',recovery.digest(path.read_text()))]:
            patcher=patch.object(recovery,name,value);patcher.start();self.addCleanup(patcher.stop)

    def snapshot(self,db):
        return {table:[dict(row) for row in db.execute('SELECT * FROM '+table)] for table in HISTORY}

    def publish(self,validator=research.validate):
        with research.connect(self.path) as db:
            return recovery.publish_retained(db,NOW,validator)

    def test_exact_held_copy_is_corrected_once_without_calls_or_clock_loss(self):
        with research.connect(self.path) as db:
            self.assertEqual(research.publication_hold_reason(db,research.candidates(db,NOW)[0],NOW),rollout.guard.FAILURE)
        self.assertEqual(research.run_once(self.path,lambda *_:self.fail('paid call'),{},NOW.timestamp()),'done')
        with research.connect(self.path) as db:
            saved=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            archive=dict(db.execute('SELECT * FROM reviewed_retained_announcement_replacements').fetchone())
            self.assertEqual(archive['reason'],'changed-rollout-status')
            self.assertEqual(json.loads(archive['previous_publication']),self.old)
            self.assertEqual(json.loads(archive['previous_calls']),self.history['signal_headline_translation_calls'])
            self.assertEqual(json.loads(archive['previous_job']),self.history['official_research_jobs'][0])
            self.assertEqual(self.snapshot(db),self.history)
            self.assertEqual(saved['public_at'],archive['replaced_at'])
            self.assertNotEqual(saved['public_at'],self.old['public_at'])
            self.assertNotEqual(saved['started_at'],self.old['started_at'])
            self.assertEqual(len(research.validated_publications(db,research.candidates(db,NOW))),1)
        self.assertFalse(self.publish())
        import service  # Other tests reload signals during discovery.
        # Replay the historical fixture at its own observation time.
        with patch.object(service,'datetime',wraps=datetime) as service_clock:
            service_clock.now.return_value=NOW
            public=service.AutomaticMonitor(self.path,Path(self.tmp.name)/'snapshot.json').public_news()
        item=next(item for item in public['officialUpdates'] if item['id']=='1233')
        self.assertIn('世界展開を開始',item['bodyJa'])
        self.assertNotIn('will soon replace Gems globally',item['bodyEn'])
        self.assertEqual(item['publishedOn'],'2026-09-30')
        self.assertEqual(datetime.fromisoformat(item['observedAt']),datetime.fromisoformat(self.pin['observedAt']))

    def test_changed_identity_payload_history_or_absent_copy_never_replaces(self):
        changes=("UPDATE sources SET status='held'", "UPDATE sources SET sha256='changed'",
                 "UPDATE signal_events SET id=1240", "UPDATE signal_events SET sha='changed'",
                 "UPDATE official_story_bodies SET body=body||' changed'",
                 "UPDATE official_story_body_proofs SET extractor_version='old'",
                 "UPDATE official_research_publications SET payload=payload||' '",
                 "UPDATE official_research_publications SET public_at='2026-10-04T03:00:00+00:00'",
                 "UPDATE official_research_jobs SET attempts=2",
                 "UPDATE official_research_jobs SET state='running'",
                 "UPDATE signal_headline_translation_calls SET state='failed'",
                 "DELETE FROM official_research_publications")
        for sql in changes:
            with self.subTest(sql=sql):
                case=ReviewedRolloutCorrectionTests();case.setUp()
                try:
                    with research.connect(case.path) as db:db.execute(sql)
                    self.assertFalse(case.publish())
                    with research.connect(case.path) as db:
                        self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_replacements').fetchone()[0],0)
                        self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_recoveries').fetchone()[0],0)
                finally:case.doCleanups()

    def test_validation_is_outside_writer_and_concurrent_source_change_is_rechecked(self):
        with research.connect(self.path) as db:
            def validate(*args):
                self.assertFalse(db.in_transaction)
                with sqlite3.connect(self.path,timeout=0) as other:
                    other.execute('BEGIN IMMEDIATE')
                    other.execute("UPDATE sources SET status='held'")
                return research.validate(*args)
            self.assertFalse(recovery.publish_retained(db,NOW,validate))
            self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),self.old)
            self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_replacements').fetchone()[0],0)

    def test_invalid_replacement_or_failed_write_preserves_original(self):
        def reject_new(note,*args):
            if note['facts'][0]['en'] != rollout.WRONG_EN:raise ValueError('unsupported-number')
            return research.validate(note,*args)
        self.assertFalse(self.publish(reject_new))
        with research.connect(self.path) as db:
            db.execute("CREATE TRIGGER reject_change BEFORE UPDATE ON official_research_publications BEGIN SELECT RAISE(ABORT,'test refused'); END")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'test refused'):self.publish()
        with research.connect(self.path) as db:
            self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),self.old)
            self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_replacements').fetchone()[0],0)
            self.assertEqual(self.snapshot(db),self.history)


if __name__=='__main__':unittest.main()
