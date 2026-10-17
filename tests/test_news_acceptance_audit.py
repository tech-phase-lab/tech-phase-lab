"""Acceptance accounting must not turn old, unobserved or failed work into success."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/audit'))
import news_acceptance as audit

START=audit.timestamp('2026-10-02T04:00:00Z')
END=audit.timestamp('2026-10-03T04:00:00Z')
ASOF=audit.timestamp('2026-10-03T05:00:00Z')


class AcceptanceAuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'audit.sqlite'
        self.db=sqlite3.connect(self.path);self.addCleanup(self.db.close)
        self.db.executescript('''
        CREATE TABLE signal_events(id INTEGER,source_id TEXT,url TEXT,sha TEXT,previous_sha TEXT,event_kind TEXT,published_at TEXT,published_on TEXT,observed_at TEXT);
        CREATE TABLE signal_headline_translations(source_id TEXT,url TEXT,sha TEXT,created_at TEXT);
        CREATE TABLE signal_headline_translation_calls(at REAL,source_id TEXT,sha TEXT,state TEXT);
        CREATE TABLE x_market_publications(source_id TEXT,url TEXT,sha TEXT,published_at TEXT);
        CREATE TABLE market_result_publications(source_id TEXT,url TEXT,sha TEXT,published_at TEXT);
        CREATE TABLE official_research_publications(event_id INTEGER,sha TEXT,public_at TEXT);
        CREATE TABLE signal_route_transitions(source_id TEXT,occurred_at TEXT,outcome TEXT,previous_kind TEXT,current_kind TEXT);
        CREATE TABLE incident_events(incident_key TEXT,revision INTEGER,at TEXT,event TEXT,error_code TEXT);
        CREATE TABLE official_research_attempt_failures(event_id INTEGER,sha TEXT,failed_at TEXT,reason TEXT,detail TEXT);
        ''')
    def event(self,i,posted='2026-10-02T04:01:00Z',observed='2026-10-02T04:01:30Z',kind='new',url=None,sha='a',previous=''):
        self.db.execute('INSERT INTO signal_events VALUES(?,?,?,?,?,?,?,?,?)',
            (i,'source',url or f'https://example.com/{i}',sha,previous,kind,posted,'2026-10-02',observed))
    def report(self,**kwargs):
        self.db.commit()
        return audit.read_report(self.path,start=START,end=END,as_of=ASOF,**kwargs)
    def test_new_publications_exclude_backfill_baselines_revisions_unknown_and_future(self):
        self.event(1)
        self.event(2,posted='2026-10-01T23:00:00Z')
        self.event(3,kind='baseline')
        self.event(4,kind='updated',previous='old')
        self.event(5,posted=None)
        self.event(6,posted='2026-10-02T04:03:00Z')
        self.event(7,observed='2026-10-03T04:00:00Z')
        self.event(8,url='https://example.com/1',sha='changed')
        r=self.report()
        self.assertEqual(r['newSourcePublications'],1)
        self.assertEqual(r['eventCounts'],{'new-source-publication':1,'historical-backfill':1,'baseline':1,'revision':2,'source-time-unknown':1,'clock-conflict':1})
        self.assertEqual(r['intakeLatencyAllNewCandidates']['medianSeconds'],30)
        self.assertEqual(r['acceptance'],'not-assessed')
    def test_source_clock_offsets_and_window_boundary_are_respected(self):
        self.event(1,posted='2026-10-02T13:00:00+09:00',observed='2026-10-02T04:00:05Z')
        self.event(2,posted='2026-10-03T04:00:00Z',observed='2026-10-03T04:00:00Z')
        self.assertEqual(self.report()['intakeLatencyAllNewCandidates']['maxSeconds'],5)
    def test_current_revision_outputs_are_not_browser_delivery(self):
        self.event(1)
        self.db.executemany('INSERT INTO signal_headline_translations VALUES(?,?,?,?)',[
            ('source','https://example.com/1','old','2026-10-02T04:01:35Z'),
            ('source','https://example.com/1','a','2026-10-02T04:02:00Z')])
        self.db.execute('INSERT INTO official_research_publications VALUES(?,?,?)',(1,'old','2026-10-02T04:03:00Z'))
        r=self.report();record=r['records'][0]
        self.assertEqual(record['detectionToStoredSeconds'],{'headlineJa':30})
        self.assertEqual(record['browserObservedAt'],{})
        self.assertIsNone(r['latency']['sourceToBrowser']['ja']['maxSeconds'])
    def test_browser_evidence_is_revision_language_and_clock_bound(self):
        self.event(1)
        def view(lang,time,sha='a'):
            return {'sourceId':'source','url':'https://example.com/1','sha':sha,'language':lang,'observedAt':time,'evidence':'browser capture file'}
        inventory={'sourceId':'source','method':'independent-source-inventory','evidence':'capture',
            'items':[{'url':'https://example.com/1','publishedAt':'2026-10-02T04:01:00Z','eligible':True}]}
        r=self.report(inventories=[inventory],observations=[view('ja','2026-10-02T04:02:00Z'),view('en','2026-10-02T04:02:10Z'),
            view('ja','2026-10-02T04:01:40Z','old'),view('en','2026-10-02T04:01:10Z'),view('ja','2026-10-03T04:02:00Z')])
        self.assertEqual(r['latency']['sourceToBrowser']['ja']['maxSeconds'],60)
        self.assertEqual(r['latency']['sourceToBrowser']['en']['maxSeconds'],70)
        self.assertEqual(len(r['invalidBrowserObservations']),3)
    def test_independent_inventory_can_identify_an_uningested_post(self):
        self.event(1)
        inventory={'sourceId':'source','windowStart':START.isoformat(),'windowEnd':END.isoformat(),
            'checkedAt':END.isoformat(),'complete':True,'method':'independent-source-inventory','evidence':'independent page capture',
            'items':[{'url':'https://example.com/1','publishedAt':'2026-10-02T04:01:00Z','eligible':True},
                     {'url':'https://example.com/missed','publishedAt':'2026-10-02T05:00:00Z','eligible':True},
                     {'url':'https://example.com/out-of-scope','publishedAt':'2026-10-02T05:00:00Z','eligible':False}]}
        r=self.report(inventories=[inventory],required_sources=['source','unseen-source'])
        self.assertEqual(r['independentInventories'][0]['missingFromIntake'],['https://example.com/missed'])
        self.assertEqual(r['sourcesWithoutCompleteInventory'],['unseen-source'])
        inventory['method']='copied-from-intake-db'
        self.assertEqual(self.report(inventories=[inventory])['independentInventories'][0]['coverage'],'unverified')
    def test_partial_inventory_unknown_eligibility_and_zero_events_never_pass(self):
        r=self.report(required_sources=['never-observed'])
        self.assertEqual(r['newSourcePublications'],0)
        self.assertEqual(r['sourcesWithoutCompleteInventory'],['never-observed'])
        self.assertEqual(r['acceptance'],'not-assessed')
        self.assertIsNone(r['latency']['sourceToDetection']['p95Seconds'])
        inventory={'sourceId':'source','windowStart':START.isoformat(),'windowEnd':END.isoformat(),
            'checkedAt':END.isoformat(),'complete':True,'method':'independent-source-inventory','evidence':'capture',
            'items':[{'url':'https://example.com/1','publishedAt':'2026-10-02T04:01:00Z','eligible':None}]}
        self.assertEqual(self.report(inventories=[inventory])['independentInventories'][0]['coverage'],'unverified')
        inventory['items']=[];inventory['windowEnd']='2026-10-02T05:00:00Z'
        self.assertEqual(self.report(inventories=[inventory])['independentInventories'][0]['coverage'],'unverified')
    def test_window_failures_survive_recovery_without_rolling_counter_subtraction(self):
        self.db.executemany('INSERT INTO incident_events VALUES(?,?,?,?,?)',[
            ('route',1,'2026-10-02T04:05:00Z','opened','http-500'),
            ('route',1,'2026-10-02T04:06:00Z','resolved',None),
            ('route',0,'2026-10-01T04:05:00Z','opened','timeout')])
        self.db.execute('INSERT INTO signal_headline_translation_calls VALUES(?,?,?,?)',
            (START.timestamp()+10,'research:source','a','failed'))
        self.db.execute('INSERT INTO official_research_attempt_failures VALUES(?,?,?,?,?)',
            (1,'a','2026-10-02T04:03:00Z','invalid-copy','summary'))
        r=self.report()
        self.assertEqual(len(r['timestampedHistory']['incident_events']),2)
        self.assertEqual(len(r['timestampedHistory']['translationCalls']),1)
        self.assertEqual(r['timestampedHistory']['official_research_attempt_failures'][0]['reason'],'invalid-copy')
        self.assertEqual(r['incidentsOpenAtWindowStart'][0]['error_code'],'timeout')

    def test_duplicate_rows_do_not_inflate_arrival_samples(self):
        self.event(1);self.event(2,url='https://example.com/1')
        r=self.report()
        self.assertEqual(r['newSourcePublications'],1)
        self.assertEqual(r['duplicateStoredEventIds'],[2])
        self.assertEqual(r['intakeLatencyAllNewCandidates']['count'],1)
    def test_unrelated_new_article_is_not_a_service_delivery_success(self):
        self.event(1)
        self.assertEqual(self.report()['newPublicationEligibilityCounts'],{'unreviewed':1})
        inventory={'sourceId':'source','method':'independent-source-inventory','evidence':'actual source review',
            'items':[{'url':'https://example.com/1','publishedAt':'2026-10-02T04:01:00Z','eligible':False}]}
        r=self.report(inventories=[inventory])
        self.assertEqual(r['newPublicationEligibilityCounts'],{'excluded':1})
        self.assertEqual(r['latency']['sourceToDetection']['count'],0)
        self.assertEqual(r['intakeLatencyAllNewCandidates']['count'],1)
        contrary=json.loads(json.dumps(inventory));contrary['items'][0]['eligible']=True
        r=self.report(inventories=[inventory,contrary])
        self.assertEqual(r['newPublicationEligibilityCounts'],{'conflicting-review':1})
        self.assertEqual(r['latency']['sourceToDetection']['count'],0)

    def test_read_only_snapshot_does_not_mutate_or_create_database(self):
        self.event(1);self.db.commit()
        before=hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.report()
        self.assertEqual(before,hashlib.sha256(self.path.read_bytes()).hexdigest())
        absent=Path(self.tmp.name)/'absent.sqlite'
        with self.assertRaises(sqlite3.OperationalError):
            audit.read_report(absent,start=START,end=END,as_of=ASOF)
        self.assertFalse(absent.exists())
    def test_missing_schema_is_unverified_not_empty_success(self):
        self.db.execute('DROP TABLE official_research_publications')
        self.assertIn('official_research_publications',self.report()['missingEvidenceTables'])
    def test_percentiles_have_sample_count_and_in_progress_window_clamps_future_rows(self):
        self.assertEqual(audit.distribution(range(1,21))['p95Seconds'],19)
        self.event(1);self.event(2,observed='2026-10-02T06:00:00Z')
        self.db.commit()
        r=audit.read_report(self.path,start=START,end=END,as_of=audit.timestamp('2026-10-02T05:00:00Z'))
        self.assertEqual(r['windowStatus'],'in-progress');self.assertEqual(len(r['records']),1)
        with self.assertRaises(ValueError):
            audit.read_report(self.path,start=END,end=START,as_of=ASOF)


if __name__=='__main__':
    unittest.main()
