"""Synthetic feed/article evidence exercises exact one-cell editorial corrections."""
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

import official_research as research
import official_research_editorial_recovery as recovery
# Full discovery replaces sys.modules['signals'] in the service fixture. Bind
# normal candidates, lazy bridge imports and source mutations to one graph.
signals = research.signals


NOW = datetime(2026, 10, 4, 16, 30, tzinfo=timezone.utc)
MANIFEST = Path(recovery.__file__).with_name('reviewed_retained_announcements.json')
SOURCE = 'Microsoft announces updated corporate reporting information.'
QUOTES = ['Microsoft announced leadership changes effective today.',
          'Avery Reed will continue as CEO of Contoso and Morgan Lane will continue in the current role, both reporting to Casey Park.',
          'The company aims to support its business customers.']
BODY = '\n'.join(QUOTES) + '\n'
OLD_JA = 'ContosoのCEO Avery Reed氏とMorgan Lane氏は引き続きCasey Park氏に報告する。'
NEW_JA = 'Avery Reed氏はContosoのCEOを、Morgan Lane氏は現在の役職をそれぞれ継続し、両氏ともCasey Park氏に報告する。'
TABLES = ('sources', 'source_revisions', 'signal_events', 'signal_documents',
          'official_story_bodies', 'official_story_body_proofs', 'official_research_jobs',
          'signal_headline_translation_calls', 'official_research_attempt_failures',
          'official_research_attempt_body_proofs')


def pair(ja, en, quote):
    return {'ja': ja, 'en': en, 'evidenceQuote': quote}


class ReviewedSignalArticleAmendmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'synthetic.sqlite'
        self.enterContext(patch.dict(sys.modules, {'signals': signals}))
        self.enterContext(patch.object(signals, 'fetch', side_effect=AssertionError('network forbidden')))
        self.enterContext(patch.object(research.brief_generator, 'request_response', side_effect=AssertionError('provider forbidden')))
        self.pin = deepcopy(next(p for p in json.loads(MANIFEST.read_text())['announcements'] if p.get('eventId') == 1113))
        p = self.pin
        p.pop('allowSameBodyRefetch',None)
        p.update(eventId=42, url='https://blogs.microsoft.com/blog/2026/10/01/synthetic-amendment/',
                 title='Microsoft announces a leadership update', acquisitionChars=len(SOURCE),
                 acquisitionTextSha=recovery.digest(SOURCE), bodyTextSha=recovery.digest(BODY),
                 bodyChars=len(BODY), rawContentSha=recovery.digest('synthetic markup'),
                 bodyFetchedAt='2026-10-04T14:19:21.759607+00:00')
        p['eventSha'] = p['sourceRevision'] = recovery.digest(p['title'] + '\n' + SOURCE)
        lead = pair('Microsoftが本日付の経営体制の変更を発表した。', QUOTES[0], QUOTES[0])
        role = pair(OLD_JA, 'Avery Reed remains CEO of Contoso and Morgan Lane continues in the current role, both reporting to Casey Park.', QUOTES[1]+'\n')
        note = {'title': deepcopy(lead), 'summary': deepcopy(lead),
                'purpose': pair('法人顧客の支援を目指す。', QUOTES[2], QUOTES[2]),
                'facts': [deepcopy(lead), pair('Microsoftが経営体制の変更を発表した。', 'Microsoft announced leadership changes.', QUOTES[0]), role]}
        research.validate(note, BODY, p['title'])
        payload = json.dumps(note, ensure_ascii=False)
        p['replacement'].update(payloadSha=recovery.digest(payload), bodySha=p['bodyTextSha'])
        corrected = deepcopy(note); corrected['facts'][2]['ja'] = NEW_JA
        p['reviewedPayloadSha'] = recovery.digest(json.dumps(corrected, ensure_ascii=False))
        start = BODY.index(role['evidenceQuote'])
        p['amendment'].update(field='facts[2]', beforeSha=recovery.digest(OLD_JA), text=NEW_JA,
            evidenceSpan={'start':start,'end':start+len(role['evidenceQuote']),'sha256':recovery.digest(role['evidenceQuote'])})
        self.expected = corrected
        with research.connect(self.path) as db:
            db.execute('''INSERT INTO signal_events(id,source_id,url,sha,previous_sha,title,tickers_json,
                matches_json,event_kind,published_at,published_on,observed_at,excerpt,diff,truncated)
                VALUES(?,?,?,?,'',?,'["MSFT"]','{}','new',?,NULL,?,'','',0)''',
                (p['eventId'],p['sourceId'],p['url'],p['eventSha'],p['title'],p['publishedAt'],p['observedAt']))
            db.execute('INSERT INTO signal_documents VALUES(?,?,?,?,?,?,?)',
                (p['sourceId'],p['url'],p['sourceRevision'],p['title'],SOURCE,p['observedAt'],p['observedAt']))
            db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,NULL)',
                (p['eventId'],p['eventSha'],p['bodyTextSha'],BODY,p['bodyFetchedAt'],0))
            db.execute('INSERT INTO official_story_body_proofs VALUES(?,?,?,?,?,?,?,?,?)',
                (p['eventId'],p['eventSha'],p['bodyTextSha'],p['bodyFetchedAt'],p['url'],p['title'],
                 p['bodyPublishedOn'],p['extractorVersion'],p['rawContentSha']))
            r = p['replacement']
            db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                (p['eventId'],p['eventSha'],p['bodyTextSha'],payload,'[]',r['startedAt'],r['publicAt'],r['generationMs']))
            db.execute('INSERT INTO official_research_jobs VALUES(?,?,3,?,?,?,NULL)',
                (p['eventId'],p['eventSha'],NOW.timestamp()+300,'accepted-call','done'))
            db.execute('INSERT INTO signal_headline_translation_calls VALUES(?,?,?,?,?,?,?)',
                (datetime.fromisoformat(r['startedAt']).timestamp(),'research:'+p['sourceId'],p['eventSha'],
                 'synthetic-model','done','{}','accepted-call'))
            for index in range(2):
                lease = 'rejected-call-'+str(index)
                db.execute('INSERT INTO signal_headline_translation_calls VALUES(?,?,?,?,?,?,?)',
                    (NOW.timestamp()-8000-index,'research:'+p['sourceId'],p['eventSha'],'synthetic-model','failed','{}',lease))
                db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
                    (lease,p['eventId'],p['eventSha'],'2026-10-04T14:20:00+00:00','unsupported-number','synthetic','{"rejected":true}'))
                db.execute('INSERT INTO official_research_attempt_body_proofs VALUES(?,?,?)',
                    (lease,p['eventSha'],p['bodyTextSha']))
            self.old = dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            self.history = self.snapshot(db)
        self.manifest = Path(self.tmp.name) / 'reviewed.json'
        self.enterContext(patch.object(recovery, 'RETAINED_COPY_PATH', self.manifest))
        self.enterContext(patch.object(recovery, 'RETAINED_COPY_SHA', ''))
        self.write_manifest()

    def write_manifest(self):
        manifest={'policy':'reviewed-retained-announcement-v1','startsAt':'2026-10-04T00:00:00+00:00',
                  'expiresAt':'2026-10-05T00:00:00+00:00','announcements':[self.pin]}
        self.manifest.write_text(json.dumps(manifest,ensure_ascii=False))
        recovery.RETAINED_COPY_SHA=recovery.digest(self.manifest.read_text())

    def snapshot(self, db):
        return {table:[dict(row) for row in db.execute('SELECT * FROM '+table)] for table in TABLES}

    def publish(self, validator=research.validate):
        with research.connect(self.path) as db:
            return recovery.publish_retained(db, NOW, validator)

    def test_one_language_cell_changes_and_all_history_is_archived_once(self):
        self.assertEqual(research.run_once(self.path,lambda *_:self.fail('provider'),{},NOW.timestamp()),'done')
        with research.connect(self.path) as db:
            saved=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
            note=json.loads(saved['payload'])
            self.assertEqual({key:note[key] for key in self.expected}, self.expected)
            self.assertTrue(note['facts'][2]['evidenceQuote'].endswith('\n'))
            self.assertEqual(self.snapshot(db), self.history)
            archive=dict(db.execute('SELECT * FROM reviewed_retained_announcement_replacements').fetchone())
            self.assertEqual(json.loads(archive['previous_publication']),self.old)
            self.assertEqual(json.loads(archive['previous_job']),self.history['official_research_jobs'][0])
            self.assertEqual(json.loads(archive['previous_calls']),sorted(self.history['signal_headline_translation_calls'],key=lambda x:(x['at'],x['lease'])))
            self.assertEqual(saved['public_at'],archive['replaced_at'])
            self.assertNotEqual(saved['public_at'],self.old['public_at'])
            self.assertEqual(saved['body_sha'],self.pin['bodyTextSha'])
            self.assertEqual(db.execute('SELECT count(*) FROM sources').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM source_revisions').fetchone()[0],0)
            self.assertEqual([r[0]['id'] for r in research.validated_publications(db,research.candidates(db,NOW,read_only=True))],[42])
        self.assertFalse(self.publish())
        with research.connect(self.path) as db:db.execute('DELETE FROM official_research_publications')
        self.assertFalse(self.publish())

    def test_source_copy_clock_job_and_closed_call_mutations_fail_closed(self):
        changes=("UPDATE signal_events SET sha='changed'", "UPDATE signal_events SET title='changed'",
            "UPDATE signal_events SET published_at='2026-10-02T15:03:27+00:00'",
            "UPDATE signal_events SET observed_at='2026-10-02T15:05:14+00:00'",
            "UPDATE signal_events SET truncated=1", "UPDATE signal_documents SET text=text||' changed'",
            "UPDATE signal_documents SET sha='changed'", "DELETE FROM signal_documents",
            "UPDATE official_story_bodies SET body=body||' changed'", "UPDATE official_story_bodies SET error='unverified'",
            "UPDATE official_story_body_proofs SET raw_sha='changed'", "UPDATE official_story_body_proofs SET source_url='changed'",
            "UPDATE official_story_body_proofs SET extractor_version='changed'", "DELETE FROM official_story_body_proofs",
            "UPDATE official_research_publications SET payload=payload||' '", "UPDATE official_research_publications SET body_sha='changed'",
            "UPDATE official_research_publications SET started_at='2026-10-04T14:00:00+00:00'",
            "UPDATE official_research_publications SET public_at='2026-10-04T14:30:00+00:00'",
            "UPDATE official_research_publications SET generation_ms=generation_ms+1", "DELETE FROM official_research_publications",
            "UPDATE official_research_jobs SET attempts=4", "UPDATE official_research_jobs SET state='running'",
            "UPDATE official_research_jobs SET lease='changed'",
            "UPDATE signal_headline_translation_calls SET state='running' WHERE lease='accepted-call'",
            "UPDATE signal_headline_translation_calls SET state='running' WHERE lease='rejected-call-0'",
            "UPDATE signal_headline_translation_calls SET at=at+1 WHERE lease='accepted-call'")
        for sql in changes:
            with self.subTest(sql=sql):
                case=type(self)();case.setUp()
                try:
                    with research.connect(case.path) as db:db.execute(sql)
                    self.assertFalse(case.publish())
                    with research.connect(case.path) as db:
                        self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_replacements').fetchone()[0],0)
                finally:case.doCleanups()

    def test_same_body_refetch_preserves_original_publication_and_failure_clocks(self):
        refetch='2026-10-04T18:52:44.696874+00:00'
        reference=datetime(2026,10,4,19,5,tzinfo=timezone.utc)
        with research.connect(self.path) as db:
            db.execute('UPDATE official_story_bodies SET fetched_at=?',(refetch,))
            db.execute('UPDATE official_story_body_proofs SET fetched_at=?',(refetch,))
        with research.connect(self.path) as db:
            self.assertFalse(recovery.publish_retained(db,reference,research.validate))
        # A fresh review pins the later proof time for identical source/body
        # bytes; it does not revise when the old model/publication occurred.
        self.pin['bodyFetchedAt']=refetch;self.write_manifest()
        with research.connect(self.path) as db:
            before=self.snapshot(db)
            self.assertTrue(recovery.publish_retained(db,reference,research.validate))
            self.assertEqual(self.snapshot(db),before)
            archive=db.execute('SELECT previous_publication FROM reviewed_retained_announcement_replacements').fetchone()
            self.assertEqual(json.loads(archive[0]),self.old)
            audit=db.execute('SELECT * FROM reviewed_retained_announcement_recoveries').fetchone()
            self.assertEqual(audit['source_body_at'],refetch)
            self.assertEqual(audit['source_observed_at'],self.pin['observedAt'])

    def test_opted_in_identical_body_refetch_keeps_original_publication_clocks(self):
        refetch='2026-10-04T18:52:44.696874+00:00'
        reference=datetime(2026,10,4,19,5,tzinfo=timezone.utc)
        self.pin['allowSameBodyRefetch']=True;self.write_manifest()
        with research.connect(self.path) as db:
            db.execute('UPDATE official_story_bodies SET fetched_at=?',(refetch,))
            db.execute('UPDATE official_story_body_proofs SET fetched_at=?',(refetch,))
        with research.connect(self.path) as db:
            before=self.snapshot(db)
            self.assertTrue(recovery.publish_retained(db,reference,research.validate))
            self.assertEqual(self.snapshot(db),before)
            archive=db.execute('SELECT previous_publication FROM reviewed_retained_announcement_replacements').fetchone()
            self.assertEqual(json.loads(archive[0]),self.old)
            audit=db.execute('SELECT * FROM reviewed_retained_announcement_recoveries').fetchone()
            self.assertEqual(audit['source_body_at'],refetch)
            self.assertEqual(audit['source_observed_at'],self.pin['observedAt'])

    def test_same_body_refetch_requires_literal_opt_in_and_valid_monotonic_clock(self):
        reference=datetime(2026,10,4,19,5,tzinfo=timezone.utc)
        for opt_in,refetch in ((False,'2026-10-04T18:52:44+00:00'),
                              (1,'2026-10-04T18:52:44+00:00'),
                              ('true','2026-10-04T18:52:44+00:00'),
                              (True,'2026-10-04T14:00:00+00:00'),
                              (True,'2026-10-04T19:06:00+00:00'),
                              (True,'2026-10-04T18:52:44'),(True,'malformed'),(True,'')):
            with self.subTest(opt_in=opt_in,refetch=refetch):
                case=type(self)();case.setUp()
                try:
                    case.pin['allowSameBodyRefetch']=opt_in;case.write_manifest()
                    with research.connect(case.path) as db:
                        db.execute('UPDATE official_story_bodies SET fetched_at=?',(refetch,))
                        db.execute('UPDATE official_story_body_proofs SET fetched_at=?',(refetch,))
                    with research.connect(case.path) as db:
                        self.assertFalse(recovery.publish_retained(db,reference,research.validate))
                        self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),case.old)
                finally:case.doCleanups()

    def test_later_fetch_cannot_bypass_any_substantive_source_or_proof_pin(self):
        reference=datetime(2026,10,4,19,5,tzinfo=timezone.utc)
        changes=("UPDATE signal_documents SET text=text||' changed'",
                 "UPDATE signal_events SET observed_at='2026-10-01T16:00:00+00:00'",
                 "UPDATE official_story_bodies SET body=body||' changed'",
                 "UPDATE official_story_bodies SET body_sha='changed'",
                 "UPDATE official_story_body_proofs SET source_url='changed'",
                 "UPDATE official_story_body_proofs SET source_title='changed'",
                 "UPDATE official_story_body_proofs SET published_on='2026-10-02'",
                 "UPDATE official_story_body_proofs SET extractor_version='changed'",
                 "UPDATE official_story_body_proofs SET raw_sha='changed'",
                 "UPDATE official_story_body_proofs SET fetched_at='2026-10-04T18:54:00+00:00'")
        for sql in changes:
            with self.subTest(sql=sql):
                case=type(self)();case.setUp()
                try:
                    case.pin['allowSameBodyRefetch']=True;case.write_manifest()
                    with research.connect(case.path) as db:
                        db.execute("UPDATE official_story_bodies SET fetched_at='2026-10-04T18:52:44+00:00'")
                        db.execute("UPDATE official_story_body_proofs SET fetched_at='2026-10-04T18:52:44+00:00'")
                        db.execute(sql)
                    with research.connect(case.path) as db:
                        self.assertFalse(recovery.publish_retained(db,reference,research.validate))
                        self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),case.old)
                finally:case.doCleanups()

    def test_opt_in_requires_a_valid_reviewed_clock_within_source_history(self):
        reference=datetime(2026,10,4,19,5,tzinfo=timezone.utc)
        for reviewed in ('malformed','2026-10-04T14:19:21',
                         '2026-10-01T14:00:00+00:00','2026-10-04T19:06:00+00:00'):
            with self.subTest(reviewed=reviewed):
                case=type(self)();case.setUp()
                try:
                    case.pin.update(allowSameBodyRefetch=True,bodyFetchedAt=reviewed);case.write_manifest()
                    with research.connect(case.path) as db:
                        self.assertFalse(recovery.publish_retained(db,reference,research.validate))
                        self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),case.old)
                finally:case.doCleanups()

    def test_allowed_refetch_during_validation_still_prevents_commit(self):
        reference=datetime(2026,10,4,19,5,tzinfo=timezone.utc)
        self.pin['allowSameBodyRefetch']=True;self.write_manifest()
        with research.connect(self.path) as db:
            def validate(note,*args):
                self.assertFalse(db.in_transaction)
                if note['facts'][2]['ja']==NEW_JA:
                    with sqlite3.connect(self.path,timeout=0) as other:
                        other.execute("UPDATE official_story_bodies SET fetched_at='2026-10-04T18:52:44+00:00'")
                        other.execute("UPDATE official_story_body_proofs SET fetched_at='2026-10-04T18:52:44+00:00'")
                return research.validate(note,*args)
            self.assertFalse(recovery.publish_retained(db,reference,validate))
            self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),self.old)
            self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_replacements').fetchone()[0],0)

    def test_configuration_revocation_and_primary_ownership_prevent_fallback(self):
        for change in ('source-removed','flags-removed','hosts-removed','disabled','wrong-ticker','wrong-kind'):
            sources=signals.SOURCES;original=list(sources)
            current=[dict(source) for source in sources]
            source=next(source for source in current if source['id']==self.pin['sourceId'])
            if change=='source-removed':
                current=[source for source in current if source['id']!=self.pin['sourceId']]
            elif change=='flags-removed':
                source.pop('officialUpdates');source.pop('requireCurrentDocument')
            else:
                key,value={'hosts-removed':('allowedHosts',[]),'disabled':('enabled',False),
                           'wrong-ticker':('tickers',['NBIS']),'wrong-kind':('kind','other')}[change]
                source[key]=value
            try:
                # Default reader arguments retain this list object.
                sources[:]=current
                with self.subTest(change=change):self.assertFalse(self.publish())
            finally:
                sources[:]=original
        with research.connect(self.path) as db:
            db.execute('INSERT INTO sources(url,ticker,title,status,discovered_at) VALUES(?,?,?,?,?)',
                       (self.pin['url'],'MSFT',self.pin['title'],'held',self.pin['observedAt']))
        self.assertFalse(self.publish())

    def test_one_cell_and_evidence_hashes_are_required(self):
        with research.connect(self.path) as db:row=recovery.retained_candidate(db,self.pin,NOW)
        for key,value in (('field','summary'),('field','facts[4]'),('language','both'),
                          ('beforeSha','changed'),('text',NEW_JA+' changed')):
            pin=deepcopy(self.pin);pin['amendment'][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):recovery.retained_note(row,pin,self.old)
        for key,value in (('start',True),('start',-1),('end',len(BODY)+1),('sha256','changed')):
            pin=deepcopy(self.pin);pin['amendment']['evidenceSpan'][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):recovery.retained_note(row,pin,self.old)
        pin=deepcopy(self.pin);pin['amendment']['evidenceSpan']['end']-=1
        span=pin['amendment']['evidenceSpan'];span['sha256']=recovery.digest(BODY[span['start']:span['end']])
        with self.assertRaises(ValueError):recovery.retained_note(row,pin,self.old)
        for key,value in (('reviewedPayloadSha','changed'),('provenance','primary-source-revision')):
            pin=deepcopy(self.pin);pin[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):recovery.retained_note(row,pin,self.old)

    def test_second_writer_progress_and_exact_snapshots_are_rechecked(self):
        for sql in ("UPDATE signal_documents SET last_seen_at='2026-10-04T15:00:00+00:00'",
                    "UPDATE official_story_body_proofs SET raw_sha='changed'",
                    "UPDATE official_story_bodies SET next_at=next_at+1",
                    "UPDATE official_research_jobs SET next_at=next_at+1",
                    "UPDATE signal_headline_translation_calls SET usage='changed' WHERE lease='accepted-call'",
                    "UPDATE official_research_publications SET payload=payload||' '"):
            with self.subTest(sql=sql):
                case=type(self)();case.setUp()
                try:
                    with research.connect(case.path) as db:
                        def validate(note,*args):
                            self.assertFalse(db.in_transaction)
                            if note['facts'][2]['ja']==NEW_JA:
                                with sqlite3.connect(case.path,timeout=0) as other:
                                    other.execute('BEGIN IMMEDIATE');other.execute(sql)
                            return research.validate(note,*args)
                        self.assertFalse(recovery.publish_retained(db,NOW,validate))
                        self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_replacements').fetchone()[0],0)
                finally:case.doCleanups()

    def test_failed_archive_or_publication_write_rolls_back_every_change(self):
        for table,operation in (('official_research_publications','UPDATE'),('reviewed_retained_announcement_recoveries','INSERT')):
            with self.subTest(table=table):
                with research.connect(self.path) as db:
                    db.execute(f"CREATE TRIGGER refuse BEFORE {operation} ON {table} BEGIN SELECT RAISE(ABORT,'test refused'); END")
                with self.assertRaisesRegex(sqlite3.IntegrityError,'test refused'):self.publish()
                with research.connect(self.path) as db:
                    self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),self.old)
                    self.assertEqual(self.snapshot(db),self.history)
                    self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_replacements').fetchone()[0],0)
                    db.execute('DROP TRIGGER refuse')

    def test_concurrent_workers_archive_and_replace_once(self):
        barrier=threading.Barrier(2);results=[];errors=[]
        def work():
            try:
                with sqlite3.connect(self.path,timeout=5) as db:
                    db.row_factory=sqlite3.Row
                    def validate(note,*args):
                        result=research.validate(note,*args)
                        if note['facts'][2]['ja']==NEW_JA:barrier.wait(timeout=5)
                        return result
                    results.append(recovery.publish_retained(db,NOW,validate))
            except BaseException as exc:errors.append(exc)
        threads=[threading.Thread(target=work) for _ in range(2)]
        for thread in threads:thread.start()
        for thread in threads:thread.join(timeout=10)
        self.assertEqual(errors,[])
        self.assertCountEqual(results,[True,False])
        with research.connect(self.path) as db:
            self.assertEqual(self.snapshot(db),self.history)
            self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_replacements').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT count(*) FROM reviewed_retained_announcement_recoveries').fetchone()[0],1)

    def test_real_pin_contains_only_the_reviewed_cell_and_short_span(self):
        p=next(p for p in json.loads(MANIFEST.read_text())['announcements'] if p.get('eventId')==1113)
        self.assertNotIn('copy',p)
        self.assertEqual(p['provenance'],'signal-article')
        self.assertIs(p['allowSameBodyRefetch'],True)
        self.assertNotEqual(p['sourceRevision'],p['bodyTextSha'])
        self.assertEqual(p['replacement']['payloadSha'],'d5ff576fdea89cf8e3ea9c2c082c140cfe4b2d2021963491f3fd8ca2e4a20502')
        self.assertEqual(p['reviewedPayloadSha'],'769bf76d260aba59ea07792e26530dde733a16170fedafaf6f7387868bb19e63')
        self.assertEqual((p['amendment']['field'],p['amendment']['language']),('facts[4]','ja'))
        self.assertEqual((p['amendment']['evidenceSpan']['start'],p['amendment']['evidenceSpan']['end']),(0,1731))
        self.assertEqual(p['replacement']['jobAttempts'],3)
        self.assertIn('役職をそれぞれ継続し',p['amendment']['text'])
        self.assertNotIn('引き続きSatya',p['amendment']['text'])


class AmendmentDiscoveryIsolationTests(unittest.TestCase):
    def test_source_revocation_after_complete_discovery_imports(self):
        # Import the same complete graph as the aggregate runner, then run only
        # the revocation case. Do not recursively execute this regression.
        script='''
import copy,sys,unittest
unittest.defaultTestLoader.discover('tests',pattern='test_*.py')
import official_research as research
import test_reviewed_signal_article_amendment as amendment
assert amendment.signals is research.signals
module_before=sys.modules['signals']
sources=research.signals.SOURCES
objects_before=list(sources)
values_before=copy.deepcopy(sources)
case=amendment.ReviewedSignalArticleAmendmentTests(
    'test_configuration_revocation_and_primary_ownership_prevent_fallback')
result=unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite([case]))
assert sys.modules['signals'] is module_before
assert research.signals.SOURCES is sources and sources==values_before
assert all(left is right for left,right in zip(sources,objects_before))
raise SystemExit(not result.wasSuccessful())
'''
        result=subprocess.run([sys.executable,'-c',script],cwd=MANIFEST.parents[2],
            env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)


if __name__ == '__main__':unittest.main()
