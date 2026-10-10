"""Synthetic issuer proof and closed attempts, never a production source repost."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import official_research as research
import official_research_editorial_recovery as recovery
import issuer_business_news as issuer
import signals

NOW = datetime(2026, 10, 4, 22, 30, tzinfo=timezone.utc)
TITLE = 'Oracle Announces Partnership with a Regional Arts Organization'
URL = 'https://www.prnewswire.com/news-releases/oracle-announces-synthetic-arts-partnership-123456789.html'
BODY = '\n'.join([
    'Oracle announced a partnership to support a regional arts organization during its restructuring.',
    'The support will allow the organization to restore its next concert season.',
    'The partnership enables the return of staff who were to be furloughed on October 18.',
    'Oracle said it intends to help address community needs through this partnership.',
    'Synthetic background on the regional organization and its community work. ' * 10,
    'UNRELATED DEMO FOOTER 21%',
])


class Clock(datetime):
    @classmethod
    def now(cls, tz=None):
        return (NOW - timedelta(seconds=1)).astimezone(tz or timezone.utc)


class OracleSymphonyRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'issuer.sqlite'
        self.manifest_path = Path(self.tmp.name) / 'reviewed.json'
        self.source = next(s for s in signals.SOURCES if s['id'] == 'prnewswire-public')
        self.observed = '2026-10-04T22:05:55.065+00:00'
        self.body_at = '2026-10-04T22:06:01.662567+00:00'
        self.published = '2026-10-04T22:00:00+00:00'
        self.sha, self.body_sha = recovery.digest(TITLE+'\n'+BODY), recovery.digest(BODY)
        self.metadata = {'issuer':'Oracle', 'issuerShort':'Oracle', 'distributor':'PR Newswire',
                         'url':URL, 'title':TITLE, 'publishedAt':self.published}
        with research.connect(self.path) as db:
            issuer.syndication.schema(db)
            signals.save(db, self.source, [{'url':URL, 'title':TITLE, 'text':BODY,
                'matches':{'ORCL':['Oracle']}, 'publishedAt':self.published, 'truncated':False}],
                {}, self.observed, 'synthetic', 1)
            db.execute('UPDATE signal_events SET id=1250')
            db.execute('INSERT INTO issuer_syndication_bodies VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (1250,self.sha,self.body_sha,BODY,json.dumps(self.metadata),self.body_at,
                 self.body_at,NOW.timestamp()+3600,1,None,'unsupported-facts','synthetic-etag',None))
            db.execute("INSERT INTO official_research_jobs VALUES(?,?,3,?,'synthetic-attempt-3','retry','changed-action-capacity')",
                       (1250,self.sha,NOW.timestamp()+3600))
            for attempt in range(1,4):
                payload = json.dumps({'syntheticRejectedAttempt':attempt})
                failed = f'2026-10-04T22:09:{20+attempt}.309796+00:00'
                lease = f'synthetic-attempt-{attempt}'
                db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                           (lease,1250,self.sha,failed,'changed-action-capacity','facts[0]',payload))
                db.execute('INSERT INTO official_research_attempt_body_proofs VALUES(?,?,?)',
                           (lease,self.sha,self.body_sha))
                db.execute('INSERT INTO signal_headline_translation_calls VALUES(?,?,?,?,?,?,?)',
                    (NOW.timestamp()-1300,'research:prnewswire-public',self.sha,'synthetic-model','failed','{}',lease))
        def item(ja,en,anchor):
            return {'ja':ja,'en':en,'anchors':[anchor]}
        self.pin = {'eventId':1250,'sourceId':'prnewswire-public','ticker':'ORCL','url':URL,'title':TITLE,
                    'eventSha':self.sha,'sourceRevision':self.sha,'publishedOn':None,
                    'publishedAt':self.published,'observedAt':self.observed,'bodyFetchedAt':self.body_at,
                    'bodyTextSha':self.body_sha,'bodyChars':len(BODY),'issuer':'Oracle',
                    'issuerBusinessPolicy':issuer.POLICY,'provenance':'issuer-business-document',
                    'reviewedFailure':{'reason':'changed-action-capacity','failedAt':failed,
                                       'payloadSha':recovery.digest(payload)},
                    'copy':{
                        'title':item('Oracle、地域の芸術団体への支援を発表',
                                     'Oracle announces support for a regional arts group','Oracle announced a partnership'),
                        'summary':item('Oracleは再建中の地域の芸術団体を支える提携を発表した。',
                                       'Oracle announced a partnership supporting a regional arts group during restructuring.',
                                       'Oracle announced a partnership'),
                        'facts':[
                            item('この支援により、次の公演シーズンを再開できるようになる。',
                                 'The support will enable the next concert season to return.','The support will allow'),
                            item('10月18日に休業予定だった職員の復帰が可能になる。',
                                 'Staff scheduled for furlough on October 18 will be able to return.','The partnership enables'),
                            item('Oracleは地域の課題解決を支援する意向を示した。',
                                 'Oracle expressed its intention to help with local needs.','Oracle said it intends')],
                        'purpose':item('再建中の地域の芸術団体を支援する。',
                                       'To support a regional arts group during restructuring.','Oracle announced a partnership')}}
        self.pin['failure'] = {**self.pin['reviewedFailure'],'attempts':3}
        self.pin['reviewedPayloadSha'] = recovery.digest(json.dumps(recovery.retained_note({'body':BODY},self.pin),ensure_ascii=False))
        self.enterContext(patch.object(recovery,'RETAINED_COPY_PATH',self.manifest_path))
        self.enterContext(patch.object(recovery,'RETAINED_COPY_SHA','temporary'))
        self.enterContext(patch.object(recovery,'datetime',Clock))
        self.enterContext(patch.object(issuer,'datetime',Clock))
        self.enterContext(patch.object(research,'prepare_story_body',side_effect=AssertionError('body fetch')))
        for target in ('socket.create_connection','socket.socket.connect'):
            self.enterContext(patch(target,side_effect=AssertionError('network forbidden')))
        self.write_manifest()

    def write_manifest(self):
        self.manifest_path.write_text(json.dumps({'policy':'reviewed-retained-announcement-v1',
            'startsAt':'2026-10-04T22:00:00+00:00','expiresAt':'2026-10-05T00:00:00+00:00',
            'announcements':[],'retryArticles':[self.pin]},ensure_ascii=False))
        recovery.RETAINED_COPY_SHA = hashlib.sha256(self.manifest_path.read_bytes()).hexdigest()

    def publish(self, validator=research.validate):
        with research.connect(self.path) as db:
            return recovery.publish_retained(db,NOW,validator)

    def test_zero_call_worker_publishes_normal_issuer_feed_and_preserves_all_histories(self):
        with research.connect(self.path) as db:
            history = recovery.retry_history(db,self.pin)
            source = recovery.retry_source_snapshot(db,self.pin)
        self.assertEqual(research.run_once(self.path,lambda *_:self.fail('provider'),{},NOW.timestamp()),'done')
        with research.connect(self.path) as db:
            self.assertEqual(recovery.retry_source_snapshot(db,self.pin),source)
            self.assertEqual(recovery.retry_history(db,self.pin),{**history,'job':{**history['job'],'state':'done'}})
            audit = db.execute('SELECT * FROM reviewed_retry_article_recoveries').fetchone()
            self.assertEqual(json.loads(audit['previous_history']),history)
            self.assertEqual(audit['source_body_at'],self.body_at)
            self.assertEqual(audit['failure_lease'],'synthetic-attempt-3')
            self.assertEqual(db.execute('SELECT count(*) FROM official_story_bodies').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM official_story_body_proofs').fetchone()[0],0)
            public = issuer.public_items(db,NOW)
            self.assertEqual(len(public),1)
            self.assertEqual(public[0]['id'],'1250')
            self.assertEqual(public[0]['title'],TITLE)  # The public head retains the source title.
            self.assertEqual(public[0]['translationJa'],self.pin['copy']['title']['ja'])
            self.assertEqual(public[0]['publishedAt'],self.published)
            self.assertEqual(public[0]['observedAt'],self.observed)
            self.assertIn('scheduled for furlough',public[0]['bodyEn'])
            self.assertIn('休業予定だった',public[0]['bodyJa'])
            for private in ('UNRELATED DEMO','21%','evidenceQuote','reviewedCopySha256','synthetic-attempt'):
                self.assertNotIn(private,json.dumps(public))
        self.assertFalse(self.publish())

    def test_wrong_source_document_metadata_fetch_or_closed_attempt_proof_refuses(self):
        mutations = (
            "UPDATE signal_documents SET text=text||' changed'",
            "UPDATE issuer_syndication_bodies SET body=body||' changed'",
            "UPDATE issuer_syndication_bodies SET metadata=json_set(metadata,'$.issuer','Another Corp.')",
            "UPDATE issuer_syndication_bodies SET fetched_at='2026-10-04T22:07:00+00:00'",
            "UPDATE issuer_syndication_bodies SET error='withdrawn'",
            "UPDATE official_research_jobs SET state='running'",
            "UPDATE official_research_jobs SET attempts=4",
            "UPDATE official_research_attempt_failures SET payload=payload||' ' WHERE lease='synthetic-attempt-3'",
            "DELETE FROM official_research_attempt_body_proofs WHERE lease='synthetic-attempt-3'",
            "UPDATE signal_headline_translation_calls SET state='running' WHERE lease='synthetic-attempt-2'",
            "UPDATE signal_headline_translation_calls SET state='done' WHERE lease='synthetic-attempt-3'",
        )
        for sql in mutations:
            with self.subTest(sql=sql):
                case=OracleSymphonyRecoveryTests();case.setUp()
                try:
                    with research.connect(case.path) as db: db.execute(sql)
                    self.assertFalse(case.publish())
                finally: case.doCleanups()

    def test_source_disable_and_unreviewed_route_refuse(self):
        # Other discovery tests reload signals; snapshot policy uses the live
        # module rather than this fixture's earlier imported source object.
        live_source = next(s for s in importlib.import_module('signals').SOURCES
                           if s['id'] == self.pin['sourceId'])
        with patch.dict(live_source,enabled=False): self.assertFalse(self.publish())
        self.pin['provenance']='signal-document';self.write_manifest()
        self.assertFalse(self.publish())
        self.pin['provenance']='issuer-business-document';self.pin['issuerBusinessPolicy']='wrong';self.write_manifest()
        self.assertFalse(self.publish())

    def test_validation_outside_writer_lock_and_complete_recheck(self):
        for sql in ("UPDATE issuer_syndication_bodies SET next_at=next_at+60",
                    "UPDATE signal_documents SET last_seen_at='2026-10-04T22:27:00+00:00'",
                    "UPDATE official_research_jobs SET next_at=next_at+60",
                    "UPDATE signal_headline_translation_calls SET usage='changed' WHERE lease='synthetic-attempt-3'"):
            with self.subTest(sql=sql):
                case=OracleSymphonyRecoveryTests();case.setUp()
                try:
                    def validate(*args):
                        with sqlite3.connect(case.path,timeout=0) as writer:
                            writer.execute('BEGIN IMMEDIATE');writer.execute(sql)
                        return research.validate(*args)
                    self.assertFalse(case.publish(validate))
                finally: case.doCleanups()

    def test_material_and_issuer_validators_are_not_bypassed(self):
        self.pin['copy']['summary']['en'] += ' It cost $99 million.'
        self.pin.pop('reviewedPayloadSha');self.write_manifest()
        self.assertEqual(self.publish(),'blocked')
        self.assertEqual(research.run_once(self.path,lambda *_:self.fail('provider'),{},NOW.timestamp()),'idle')
        case=OracleSymphonyRecoveryTests();case.setUp()
        try:
            with patch.object(issuer,'validate_paraphrase',side_effect=ValueError('source-copy-overlap')):
                self.assertEqual(case.publish(),'blocked')
        finally: case.doCleanups()

    def test_rollback_and_withdrawal_never_recreate_history(self):
        with research.connect(self.path) as db:
            before=recovery.retry_history(db,self.pin)
            db.execute("CREATE TRIGGER reject_publication BEFORE INSERT ON official_research_publications BEGIN SELECT RAISE(ABORT,'test rejected'); END")
        with self.assertRaisesRegex(sqlite3.IntegrityError,'test rejected'): self.publish()
        with research.connect(self.path) as db:
            self.assertEqual(recovery.retry_history(db,self.pin),before)
            self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retry_article_recoveries').fetchone()[0],0)
            db.execute('DROP TRIGGER reject_publication')
        self.assertTrue(self.publish())
        with research.connect(self.path) as db:
            db.execute('DELETE FROM official_research_publications')
            db.execute("UPDATE official_research_jobs SET state='retry'")
        self.assertFalse(self.publish())

    def test_current_public_source_and_copy_changes_revoke_visibility(self):
        self.assertTrue(self.publish())
        with research.connect(self.path) as db:
            saved=db.execute('SELECT payload FROM official_research_publications').fetchone()[0]
            payload=json.loads(saved);payload.pop('issuerBusinessPolicy')
            db.execute('UPDATE official_research_publications SET payload=?',(json.dumps(payload),))
            self.assertEqual(issuer.public_items(db,NOW),[])
            db.execute('UPDATE official_research_publications SET payload=?',(saved,))
            db.execute("UPDATE issuer_syndication_bodies SET body=body||' changed'")
            self.assertEqual(issuer.public_items(db,NOW),[])


if __name__=='__main__': unittest.main()
