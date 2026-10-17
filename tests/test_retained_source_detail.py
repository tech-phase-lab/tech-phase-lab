"""A bounded single retained post read never invents event/body provenance."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import retained_source_detail as proof
import service
import signals

NOW = datetime(2026, 10, 4, 14, tzinfo=timezone.utc)
PUBLISHED = '2026-10-04T13:24:35+00:00'
ACQUIRED = '2026-10-04T13:25:09+00:00'
LATER = '2026-10-04T13:30:00+00:00'
SOURCE = 'x-wallstengine'
URL = 'https://x.com/wallstengine/status/2106737247274065925'
TITLE = 'Retained original title'
BODY = '  Exact stored acquisition text.\r\n保存原文 🌟\nFinal retained paragraph.  '
SHA = proof.digest(TITLE + '\n' + BODY)
SCHEMA = '''CREATE TABLE signal_x_acquisition (
 source_id TEXT,url TEXT,sha TEXT,title TEXT,text TEXT,published_at TEXT,
 first_seen_at TEXT,last_seen_at TEXT,truncated INTEGER,selected_for_processing INTEGER,
 PRIMARY KEY(source_id,url,sha));
 CREATE TABLE signal_documents(source_id TEXT,url TEXT,sha TEXT,title TEXT,text TEXT,
 first_seen_at TEXT,last_seen_at TEXT,PRIMARY KEY(source_id,url));'''


class RetainedSourceDetailTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'retained.sqlite'
        with sqlite3.connect(self.path) as db:
            db.executescript(SCHEMA)
            db.execute('INSERT INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)',
                       (SOURCE, URL, SHA, TITLE, BODY, PUBLISHED, ACQUIRED, ACQUIRED, 0, 0))

    def read(self, **kwargs):
        return proof.detail(self.path, kwargs.pop('source', SOURCE), kwargs.pop('url', URL),
                            kwargs.pop('sha', SHA), reference=NOW, **kwargs)

    def insert(self, *, source=SOURCE, url=URL, body='Updated retained body', first=LATER, last=LATER):
        sha = proof.digest(TITLE+'\n'+body)
        with sqlite3.connect(self.path) as db:
            db.execute('INSERT INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)',
                       (source,url,sha,TITLE,body,PUBLISHED,first,last,0,0))
        return sha

    def test_current_no_event_exact_bytes_title_digest_original_clocks_and_separate_body(self):
        result = self.read()
        self.assertEqual(result['status'], 'current')
        self.assertEqual(result['text'].encode(), BODY.encode())
        self.assertEqual(result['title'], TITLE)
        self.assertEqual(result['bodySha256'], proof.digest(BODY))
        self.assertEqual(result['sourceSha'], SHA)
        self.assertEqual(result['currentOriginSha'], SHA)
        self.assertEqual(result['bodyChars'], len(BODY))
        self.assertEqual(result['bodyBytes'], len(BODY.encode()))
        self.assertEqual(result['omittedBodyChars'], 0)
        self.assertEqual(result['publishedAt'], {'value': PUBLISHED, 'omitted': False})
        self.assertEqual(result['firstSeenAt']['value'], ACQUIRED)
        self.assertEqual(result['lastSeenAt']['value'], ACQUIRED)
        self.assertFalse(result['researchBodyIncluded'])
        self.assertFalse(result['selectedForProcessing'])
        self.assertNotIn('eventId', result)

    def test_read_only_exact_database_bytes_schema_and_no_side_effect_calls(self):
        before = self.path.read_bytes()
        with sqlite3.connect(self.path) as db:
            schema = list(db.iterdump())
        with patch.object(signals, 'schema', side_effect=AssertionError('schema write')), \
             patch.object(signals, 'fetch', side_effect=AssertionError('network')):
            self.assertTrue(self.read()['currentRevision'])
        self.assertEqual(self.path.read_bytes(), before)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(list(db.iterdump()), schema)
        self.assertEqual(set(p.name for p in Path(self.tmp.name).iterdir()), {'retained.sqlite'})

    def test_live_wal_read_preserves_persistent_bytes_and_sees_new_committed_head(self):
        with sqlite3.connect(self.path) as writer:
            writer.execute('PRAGMA journal_mode=WAL')
            writer.execute('PRAGMA wal_autocheckpoint=0')
            writer.execute('UPDATE signal_x_acquisition SET last_seen_at=?',(LATER,));writer.commit()
            wal=Path(str(self.path)+'-wal')
            before=(self.path.read_bytes(),wal.read_bytes())
            result=self.read();self.assertEqual(result['lastSeenAt']['value'],LATER)
            self.assertEqual((self.path.read_bytes(),wal.read_bytes()),before)
            new_sha=proof.digest(TITLE+'\nnew WAL revision')
            writer.execute('INSERT INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)',
                           (SOURCE,URL,new_sha,TITLE,'new WAL revision',PUBLISHED,LATER,'2026-10-04T13:31:00Z',0,0));writer.commit()
            before=(self.path.read_bytes(),wal.read_bytes())
            self.assertEqual(self.read()['status'],'stale-selection')
            self.assertEqual((self.path.read_bytes(),wal.read_bytes()),before)
            # SQLite may update -shm reader marks to coordinate the live snapshot;
            # no schema, row, persistent database or WAL record changes occur.

    def test_stale_same_source_or_case_variant_does_not_disclose_old_or_replacement_body(self):
        for url in (URL, URL.replace('wallstengine', 'WallStEngine')):
            with self.subTest(url=url):
                newer = self.insert(url=url)
                result = self.read()
                self.assertEqual(result['status'], 'stale-selection')
                self.assertEqual(result['currentOriginSha'], newer)
                self.assertIsNone(result['text']); self.assertIsNone(result['bodySha256'])
                with sqlite3.connect(self.path) as db:
                    db.execute('DELETE FROM signal_x_acquisition WHERE sha=?', (newer,))

    def test_current_head_spans_approved_routes_but_not_different_authors_or_unknown_routes(self):
        self.insert(source='private-route')
        self.insert(url=URL.replace('wallstengine', 'tipranks'))
        self.assertEqual(self.read()['text'], BODY)
        tip = 'https://x.com/TipRanks/status/2106737247274065925'
        with sqlite3.connect(self.path) as db:
            db.execute('UPDATE signal_x_acquisition SET url=? WHERE sha=? AND source_id=?', (tip,SHA,SOURCE))
        newest = self.insert(source='x-tipranks',url=tip.replace('TipRanks','tipranks'))
        result=self.read(url=tip)
        self.assertEqual(result['status'],'stale-selection')
        self.assertEqual(result['currentOriginSha'],newest)

    def test_document_head_conflicts_and_quarantined_or_invalid_head_fail_closed(self):
        for revision, last in (('f'*64,LATER),('x-edit-quarantined:123',LATER),(SHA,'invalid-clock'),(SHA,'2026-10-05T00:00:00Z'),('f'*64,ACQUIRED)):
            with self.subTest(revision=revision,last=last), sqlite3.connect(self.path) as db:
                db.execute('DELETE FROM signal_documents')
                db.execute('INSERT INTO signal_documents VALUES(?,?,?,?,?,?,?)', (SOURCE,URL,revision,TITLE,'Not disclosed',ACQUIRED,last));db.commit()
                result=self.read();self.assertIsNone(result['text']);self.assertFalse(result['currentRevision'])

    def test_missing_record_old_sha_and_unapproved_source_author_hosts_are_not_disclosed(self):
        for kwargs in ({'sha':'f'*64},{'source':'unknown'},{'source':'prnewswire-public'},
                       {'url':URL.replace('wallstengine','barchart')},
                       {'sources':[{'id':SOURCE,'format':'x-api','accounts':['wallstengine'],'allowedHosts':['evil.example']}]},
                       {'sources':[{'id':SOURCE,'format':'rss','accounts':['wallstengine'],'allowedHosts':['x.com']}]},
                       {'sources':[{'id':SOURCE,'format':'x-api','accounts':[],'allowedHosts':['x.com']}]}):
            with self.subTest(kwargs=kwargs):self.assertIsNone(self.read(**kwargs))
        for source in (s for s in signals.SOURCES if s.get('format')=='x-api'):
            account=source['accounts'][0];url=f'https://x.com/{account}/status/123'
            revision=self.insert(source=source['id'],url=url)
            self.assertTrue(self.read(source=source['id'],url=url,sha=revision)['currentRevision'])

    def test_malformed_selectors_are_rejected_before_database_open(self):
        malformed=[{'source':s} for s in ('',None,True,'x;drop','x'*81)]
        malformed += [{'sha':s} for s in ('','A'*64,'a'*63,None,[],SHA+'\n')]
        malformed += [{'url':u} for u in (None,'https://x.com/wallstengine/status/0',URL+'\n',URL+'?x=1',URL+'#fragment',URL+'/',URL.replace('https','http'),URL.replace('x.com','x.com.evil.example'),URL.replace('x.com','x.com:443'),URL.replace('x.com','user@x.com'),URL.replace('x.com','twitter.com'),URL.replace('/wallstengine/','/%77allstengine/'))]
        with patch.object(proof.sqlite3,'connect',side_effect=AssertionError('must validate first')):
            for kwargs in malformed:
                with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):self.read(**kwargs)

    def test_integrity_mismatch_and_embedded_nul_are_not_replaced_by_public_text(self):
        for body in ('Different public English text', BODY+'\0hidden tail'):
            with sqlite3.connect(self.path) as db:db.execute('UPDATE signal_x_acquisition SET text=?',(body,))
            result=self.read();self.assertIsNone(result['text']);self.assertIsNone(result['bodySha256'])
            self.assertIn(result['status'],{'integrity-mismatch','invalid-stored-text'})

    def test_limits_are_explicit_and_no_partial_body_or_invented_digest_is_returned(self):
        for column,value,status in (('text','a'*(proof.MAX_BODY_CHARS+1),'body-limit'),('text','🌟'*(proof.MAX_BODY_CHARS+1),'body-limit'),('title','a'*(proof.MAX_TITLE_CHARS+1),'title-limit')):
            with self.subTest(column=column,value=len(value)),sqlite3.connect(self.path) as db:
                db.execute('UPDATE signal_x_acquisition SET title=?,text=?',(TITLE,BODY))
                db.execute(f'UPDATE signal_x_acquisition SET {column}=?',(value,));db.commit()
                result=self.read();self.assertEqual(result['status'],status)
                self.assertIsNone(result['text']);self.assertFalse(result['textIncluded']);self.assertIsNone(result['bodySha256'])
                self.assertEqual(result['returnedBodyChars'],0)

    def test_stored_truncation_is_not_hidden_and_raw_clocks_explicitly_omit(self):
        with sqlite3.connect(self.path) as db:
            db.execute('UPDATE signal_x_acquisition SET truncated=1,selected_for_processing=1,published_at=?',('x'*200,))
        result=self.read();self.assertEqual(result['text'],BODY)
        self.assertTrue(result['sourceTruncated']);self.assertTrue(result['selectedForProcessing'])
        self.assertEqual(result['publishedAt'],{'value':'x'*128,'omitted':True})

    def test_origin_row_and_vm_limits_fail_closed_without_bulk_bodies(self):
        with patch.object(proof,'MAX_ORIGIN_ROWS',0):
            result=self.read();self.assertEqual(result['status'],'origin-limit');self.assertIsNone(result['text'])
        with sqlite3.connect(self.path) as db:
            db.executemany('INSERT INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)',
                           [(SOURCE,f'https://x.com/wallstengine/status/{i}',SHA,TITLE,BODY,PUBLISHED,ACQUIRED,ACQUIRED,0,0) for i in range(1,1500)])
        with patch.object(proof,'MAX_VM_STEPS',0):
            result=self.read();self.assertEqual(result['status'],'query-limit');self.assertIsNone(result['text'])
        with sqlite3.connect(self.path) as db:
            for sql,args in [('SELECT sha FROM signal_x_acquisition WHERE source_id=? AND url=? AND sha=?',(SOURCE,URL,SHA)),('SELECT sha FROM signal_x_acquisition WHERE source_id=? AND url=? COLLATE NOCASE LIMIT 257',(SOURCE,URL))]:
                plan=str(db.execute('EXPLAIN QUERY PLAN '+sql,args).fetchall())
                self.assertIn('SEARCH',plan);self.assertNotIn('SCAN',plan)

    def test_missing_database_and_missing_or_partial_schema_are_not_initialized(self):
        missing=Path(self.tmp.name)/'missing.sqlite'
        with self.assertRaises(sqlite3.OperationalError):proof.detail(missing,SOURCE,URL,SHA,reference=NOW)
        self.assertFalse(missing.exists())
        for sql in ('DROP TABLE signal_documents','CREATE TABLE signal_documents(source_id TEXT,url TEXT)'):
            with sqlite3.connect(self.path) as db:db.execute(sql)
            before=self.path.read_bytes();result=self.read()
            self.assertEqual(result['status'],'schema-unavailable');self.assertIsNone(result['text'])
            self.assertEqual(self.path.read_bytes(),before)

    def test_existing_editor_authenticated_get_only_and_strict_single_selector(self):
        callback=Mock(side_effect=lambda *args:proof.detail(self.path,*args,reference=NOW))
        server=service.ThreadingHTTPServer(('127.0.0.1',0),service.Handler)
        server.app=SimpleNamespace(retained_source_detail=callback)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        base=f'http://127.0.0.1:{server.server_port}'
        token='synthetic-editor-token-at-least-24-characters'
        query=urlencode({'retainedSourceId':SOURCE,'retainedUrl':URL,'expectedSourceSha':SHA})
        def get(query,auth=token,path='/admin/official-research'):
            try:response=urlopen(Request(base+path+'?'+query,headers={'Authorization':'Bearer '+auth} if auth else {}))
            except HTTPError as error:response=error
            return response.code,json.loads(response.read()),response.headers
        with patch.dict(os.environ,{'RESEARCH_EDITOR_TOKEN':token,'RESEARCH_API_TOKEN':'public-token'}):
            for auth in (None,'public-token'):
                self.assertEqual(get(query,auth)[0],401)
            callback.assert_not_called()
            status,result,headers=get(query);self.assertEqual(status,200)
            self.assertEqual(result['detail']['text'],BODY);self.assertEqual(headers['Cache-Control'],'no-store')
            self.assertEqual(get(query.replace(SHA,'f'*64))[0],404)
            for suffix in ('&eventId=1','&limit=1','&expectedBodySha='+SHA,'&beforeEventId=1','&retainedSourceId='+SOURCE,'&unknown=1'):
                self.assertEqual(get(query+suffix)[0],400,suffix)
            for bad in (query.replace('retainedSourceId='+SOURCE,'retainedSourceId='),query.replace(SHA,'bad')):
                self.assertEqual(get(bad)[0],400)
            self.assertEqual(get(query,path='/admin/signals')[0],400)
            response=service.AutomaticMonitor.retained_source_detail(SimpleNamespace(db_path=self.path),SOURCE,URL,SHA)
            self.assertEqual(response['text'],BODY)
