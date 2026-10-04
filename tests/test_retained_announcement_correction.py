"""A reviewed correction archives the old model publication and call identity."""
from datetime import datetime, timedelta
import hashlib
import json
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch

import test_inline_article_enrichment as inline
import test_article_identity_containment as wrong
import official_research as research
import official_research_editorial_recovery as recovery

NOW=inline.NOW+timedelta(minutes=16)
TABLES=('sources','source_revisions','signal_events','release_events','official_research_jobs',
        'signal_headline_translation_calls','official_research_attempt_failures')


class RetainedAnnouncementCorrectionTests(unittest.TestCase):
    def setUp(self):
        inline.InlineArticleEnrichmentTests.setUp(self)
        self.started=inline.NOW-timedelta(minutes=3)
        with research.connect(self.path) as db:
            self.row=dict(db.execute('SELECT * FROM signal_events').fetchone())
            r=self.row;body=wrong.BAD['bodyEn'];sha=hashlib.sha256(body.encode()).hexdigest()
            db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,?)',
                       (r['id'],r['sha'],sha,body,self.started.isoformat(),0,None))
            db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                       (r['id'],r['sha'],sha,json.dumps(wrong.wrong_note(),ensure_ascii=False),
                        json.dumps([body]),self.started.isoformat(),(self.started+timedelta(seconds=11)).isoformat(),11000))
            db.execute('''INSERT INTO official_research_jobs
              (event_id,sha,attempts,next_at,lease,state,failure_kind) VALUES(?,?,?,?,?,?,?)''',
                       (r['id'],r['sha'],2,NOW.timestamp(),'wrong-body-call','done','classified-attempt'))
            for at,lease,state in ((self.started.timestamp()-60,'prior-failure','failed'),
                                   (self.started.timestamp(),'wrong-body-call','done')):
                db.execute('INSERT INTO signal_headline_translation_calls VALUES(?,?,?,?,?,?,?)',
                           (at,'research:'+r['source_id'],r['sha'],'test-model',state,'{"input_tokens":12}',lease))
            self.old=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            self.before=self.history(db)

    def history(self,db):
        return {table:[dict(row) for row in db.execute('SELECT * FROM '+table)] for table in TABLES}

    def acquire(self):
        self.assertEqual(research.prepare_story_body(self.path,NOW,lambda *_:{'body':inline.HTML}),'ready')

    def publish(self):
        with research.connect(self.path) as db:
            return recovery.publish_retained(db,NOW,research.validate)

    def test_old_publication_is_archived_only_after_exact_current_article_proof(self):
        self.assertFalse(self.publish())
        self.acquire()
        with research.connect(self.path) as db:
            row=research.candidates(db,NOW)[0]
            self.assertEqual(research.publication_hold_reason(db,row,NOW),'source-event-identity-mismatch')
            delivery=research.delivery_diagnostics(db,NOW,[row],set())
            self.assertEqual((delivery['automaticPending'],delivery['publicationHeld']),(0,1))
            self.assertEqual(delivery['publicationHoldReasons'],{'source-event-identity-mismatch':1})
        self.assertEqual(research.run_once(self.path,lambda *_:self.fail('model call'),{},NOW.timestamp()),'done')
        with research.connect(self.path) as db:
            archive=dict(db.execute('SELECT * FROM reviewed_retained_announcement_replacements').fetchone())
            self.assertEqual(json.loads(archive['previous_publication']),self.old)
            self.assertEqual(json.loads(archive['previous_job']),self.before['official_research_jobs'][0])
            self.assertEqual(json.loads(archive['previous_calls']),self.before['signal_headline_translation_calls'])
            self.assertEqual(archive['publication_call_lease'],'wrong-body-call')
            self.assertEqual(self.history(db),self.before)
            saved=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            self.assertEqual(saved['body_sha'],'f34631ef55ea4e22b1b01fda91db238c6f23966f899d6bafebc630a68220b07b')
            self.assertNotEqual(saved['public_at'],self.old['public_at'])
            self.assertEqual(saved['public_at'],archive['replaced_at'])
            note=json.loads(saved['payload']);self.assertEqual(note['reviewedCopySha256'],recovery.RETAINED_COPY_SHA)
            self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_recoveries').fetchone()[0],1)
        self.assertFalse(self.publish())
        import service  # Tests reload provider modules during discovery.
        public=service.AutomaticMonitor(self.path,Path(self.tmp.name)/'snapshot.json').public_news()
        item=next(item for item in public['officialUpdates'] if item['url']==inline.source.URL)
        self.assertIn('1500億ドル',item['bodyJa']);self.assertIn('2350億ドル',item['bodyJa'])
        self.assertIn('through fiscal year 2028',item['bodyEn'])
        self.assertNotIn('CUDA-Q',json.dumps(item))
        self.assertEqual(item['publishedOn'],'2026-09-28')
        self.assertEqual(datetime.fromisoformat(item['observedAt']),datetime.fromisoformat(self.row['observed_at']))
        self.assertEqual(len(public['officialResearch']),1)

    def test_valid_unrelated_revision_or_unbound_call_is_never_replaced(self):
        self.acquire()
        changes=[
            ("UPDATE official_research_publications SET sha='different'",()),
            ("UPDATE official_research_publications SET body_sha=?",(hashlib.sha256(inline.BODY.encode()).hexdigest(),)),
            ("UPDATE official_research_publications SET payload='{}'",()),
            ("UPDATE official_research_publications SET started_at='2026-10-03T00:00:00+00:00'",()),
            ("UPDATE official_research_jobs SET state='running'",()),
            ("UPDATE official_research_jobs SET lease='unbound'",()),
            ("UPDATE signal_headline_translation_calls SET state='failed' WHERE lease='wrong-body-call'",()),
            ("UPDATE official_story_body_proofs SET source_title='unrelated'",()),
            ("UPDATE official_story_body_proofs SET extractor_version='old'",()),
        ]
        for sql,args in changes:
            with self.subTest(sql=sql),research.connect(self.path) as db:
                db.execute('BEGIN');db.execute(sql,args)
                pin=json.loads(recovery.RETAINED_COPY_PATH.read_text())['announcements'][0]
                row=recovery.retained_candidate(db,pin,NOW)
                previous=db.execute('SELECT * FROM official_research_publications').fetchone()
                if row:
                    self.assertIsNone(recovery.replaceable_retained_publication(db,previous,row,pin,research.validate))
                db.rollback()
        with research.connect(self.path) as db:
            pin=json.loads(recovery.RETAINED_COPY_PATH.read_text())['announcements'][0]
            row=recovery.retained_candidate(db,pin,NOW)
            good=recovery.retained_note(row,pin)
            previous={**self.old,'payload':json.dumps(good)}
            self.assertIsNone(recovery.replaceable_retained_publication(db,previous,row,pin,research.validate))
            self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_replacements').fetchone()[0],0)

    def test_transaction_rolls_back_archive_if_publication_update_fails(self):
        self.acquire()
        with research.connect(self.path) as db:
            db.execute("CREATE TRIGGER refuse_publication_update BEFORE UPDATE ON official_research_publications BEGIN SELECT RAISE(ABORT,'test publication failure'); END")
        with self.assertRaisesRegex(Exception,'test publication failure'):
            self.publish()
        with research.connect(self.path) as db:
            self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),self.old)
            self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_replacements').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_recoveries').fetchone()[0],0)
            self.assertEqual(self.history(db),self.before)

    def test_validation_does_not_own_writer_and_atomic_save_rechecks_inputs(self):
        self.acquire()
        observed=[]
        with research.connect(self.path) as db:
            def validate(*args):
                self.assertFalse(db.in_transaction)
                with sqlite3.connect(self.path,timeout=0) as other:
                    other.execute('BEGIN IMMEDIATE')
                    other.execute('UPDATE official_research_jobs SET next_at=next_at')
                    observed.append('writer-progressed')
                return research.validate(*args)
            self.assertTrue(recovery.publish_retained(db,NOW,validate))
            self.assertEqual(observed,['writer-progressed','writer-progressed'])
            self.assertEqual(self.history(db),self.before)

    def test_concurrent_withdrawal_or_changed_snapshot_prevents_replacement(self):
        changes=(
            "UPDATE sources SET status='held'",
            "UPDATE sources SET status='rejected'",
            "UPDATE sources SET sha256='withdrawn-revision'",
            "UPDATE official_story_body_proofs SET source_title='different source'",
            "UPDATE official_story_bodies SET body_sha='different-body'",
            "UPDATE official_research_publications SET public_at='2026-10-04T02:07:00+00:00'",
            "UPDATE official_research_jobs SET lease='another-call'",
            "UPDATE signal_headline_translation_calls SET usage='{}'",
        )
        for sql in changes:
            with self.subTest(sql=sql):
                case=RetainedAnnouncementCorrectionTests();case.setUp()
                try:
                    case.acquire()
                    def validate(*args):
                        result=research.validate(*args)
                        with sqlite3.connect(case.path,timeout=0) as other:
                            other.execute('BEGIN IMMEDIATE');other.execute(sql)
                        return result
                    with research.connect(case.path) as db:
                        self.assertFalse(recovery.publish_retained(db,NOW,validate))
                        self.assertEqual(db.execute('SELECT payload FROM official_research_publications').fetchone()[0],case.old['payload'])
                        self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_replacements').fetchone()[0],0)
                        self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_recoveries').fetchone()[0],0)
                finally:
                    case.doCleanups()

    def test_valid_publication_or_ambiguous_completed_call_is_a_noop(self):
        self.acquire()
        with research.connect(self.path) as db:
            db.execute('INSERT INTO signal_headline_translation_calls VALUES(?,?,?,?,?,?,?)',
                       (self.started.timestamp(),'research:'+self.row['source_id'],self.row['sha'],
                        'test-model','done','{}','second-completed-call'))
            db.commit();before=list(db.iterdump())
            self.assertFalse(recovery.publish_retained(db,NOW,research.validate))
            self.assertEqual(list(db.iterdump()),before)

            pin=json.loads(recovery.RETAINED_COPY_PATH.read_text())['announcements'][0]
            row=recovery.retained_candidate(db,pin,NOW)
            note=recovery.retained_note(row,pin)
            db.execute('UPDATE official_research_publications SET body_sha=?,payload=?',
                       (pin['bodyTextSha'],json.dumps(note)))
            db.commit();before=list(db.iterdump())
            self.assertFalse(recovery.publish_retained(db,NOW,research.validate))
            self.assertEqual(list(db.iterdump()),before)

    def test_official_recovery_deduplicates_only_recap_authorization_projection(self):
        import test_buyback_structured_publication as recap_fixture
        import general_source_news as news
        self.acquire()
        recap=recap_fixture.StructuredBuybackPublicationTests()
        recap.path=self.path
        recap.seed(recap_fixture.RETAINED['body'],2106523440635363385,'NVDA',event_id=1246)
        recap.failed_history(recap.rows()[0])
        self.assertEqual(recap.publish(),'done')
        reference=recap_fixture.NOW+timedelta(minutes=2)
        with research.connect(self.path) as db:
            before=next(item for item in news.public_items(db,reference) if item['id']=='1246')
            self.assertIn('1500億ドル',before['bodyJa'])
            self.assertIn('200億ドル弱',before['bodyJa'])
            history=self.history(db)
            saved=dict(db.execute('SELECT * FROM official_research_publications WHERE event_id=1246').fetchone())
            derivation=[dict(row) for row in db.execute('SELECT * FROM source_structured_buyback_derivations')]
            with patch.object(recovery,'datetime') as clock:
                clock.now.return_value=recap_fixture.NOW+timedelta(minutes=1)
                self.assertTrue(recovery.publish_retained(db,reference,research.validate))
            after=next(item for item in news.public_items(db,reference) if item['id']=='1246')
            self.assertNotIn('1500億ドル',after['bodyJa'])
            self.assertIn('2026-09-28',after['bodyJa'])
            self.assertIn('200億ドル弱',after['bodyJa'])
            self.assertIn('約92%',after['bodyJa'])
            self.assertIn('nearly $20 billion',after['bodyEn'])
            self.assertIn('about 92%',after['bodyEn'])
            self.assertIn('company release dated 2026-09-28',after['bodyEn'])
            self.assertEqual(after['publishedAt'],before['publishedAt'])
            self.assertEqual(after['observedAt'],before['observedAt'])
            self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications WHERE event_id=1246').fetchone()),saved)
            self.assertEqual([dict(row) for row in db.execute('SELECT * FROM source_structured_buyback_derivations')],derivation)
            self.assertEqual(self.history(db),history)
            db.execute('SAVEPOINT withdrawn')
            db.execute("UPDATE sources SET status='held' WHERE url=?",(inline.source.URL,))
            withdrawn=next(item for item in news.public_items(db,reference) if item['id']=='1246')
            self.assertIn('1500億ドル',withdrawn['bodyJa'])
            self.assertIn('200億ドル弱',withdrawn['bodyJa'])
            self.assertNotIn('company release dated',withdrawn['bodyEn'])
            db.execute('ROLLBACK TO withdrawn');db.execute('RELEASE withdrawn')


if __name__=='__main__':unittest.main()
