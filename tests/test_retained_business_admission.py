"""Retained-only admission and reconciliation; every upstream/model call is fake."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import io
import os
from email.message import Message
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import general_source_news as news
import official_research as research
import signals
import x_api
import x_stream
from test_general_source_news import CEO, CEO_COPY, ROUNDUP, ENV, response

NOW=datetime(2026,10,3,8,tzinfo=timezone.utc)
SOURCE=next(s for s in signals.SOURCES if s['id']=='x-wallstengine')
TIP=next(s for s in signals.SOURCES if s['id']=='x-tipranks')
PUBLISHED=(NOW-timedelta(days=2)).isoformat()
FIRST=(NOW-timedelta(days=2)+timedelta(seconds=28)).isoformat()
LAST=(NOW-timedelta(hours=1)).isoformat()


class RetainedBusinessAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'db.sqlite'
        with research.connect(self.path):pass

    def raw(self, text=CEO, number=1044, source=SOURCE, account='wallstengine', **changes):
        title=' '.join(text.split())[:500]
        row={'source_id':source['id'],'url':f'https://x.com/{account}/status/{number}',
             'sha':news.digest(title+'\n'+text),'title':title,'text':text,'published_at':PUBLISHED,
             'first_seen_at':FIRST,'last_seen_at':LAST,'truncated':0,'selected_for_processing':0}
        row.update(changes)
        with research.connect(self.path) as db:
            db.execute('INSERT OR REPLACE INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)',tuple(row.values()))
        return row

    def document(self, raw, **changes):
        values={key:raw[key] for key in ('source_id','url','sha','title','text','first_seen_at','last_seen_at')}
        values.update(changes)
        with research.connect(self.path) as db:
            db.execute('INSERT OR REPLACE INTO signal_documents VALUES(?,?,?,?,?,?,?)',tuple(values.values()))

    def admit(self):
        with research.connect(self.path) as db:return news.admit_retained(db,NOW)

    def intake(self):
        db=sqlite3.connect(self.path.resolve().as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
        try:
            db.execute('PRAGMA query_only=ON')
            return news.retained_intake(db,NOW,include_records=True)
        finally:db.close()

    def run_once(self, transport=None, env=ENV):
        with patch.object(research,'prepare_story_body',return_value='idle'),patch.object(research,'datetime') as clock:
            clock.fromtimestamp.side_effect=datetime.fromtimestamp;clock.now.return_value=NOW
            return research.run_once(self.path,transport or (lambda *_:response(CEO_COPY)),env,NOW.timestamp())

    def test_raw_only_worker_keeps_clocks_and_reuses_one_budgeted_job(self):
        raw=self.raw()
        before=self.intake()
        self.assertEqual(before['counts']['acquisitionOnlyGapRows'],1)
        self.assertEqual(before['records'][0]['disposition'],'awaiting-admission')
        self.assertEqual(self.run_once(),'done')
        with research.connect(self.path) as db:
            event=dict(db.execute('SELECT * FROM signal_events').fetchone())
            self.assertEqual(event['published_at'],PUBLISHED);self.assertEqual(event['observed_at'],FIRST)
            self.assertEqual(dict(db.execute('SELECT * FROM signal_x_acquisition').fetchone()),raw)
            self.assertEqual(db.execute('SELECT last_seen_at FROM signal_documents').fetchone()[0],LAST)
            self.assertEqual(len(news.public_items(db,NOW)),1)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
        after=self.intake()
        self.assertEqual(after['counts']['acquisitionOnlyGapRows'],0)
        self.assertEqual(after['counts']['validatedPublicationRows'],1)
        self.assertEqual(after['records'][0]['eventId'],event['id'])
        self.assertEqual(self.run_once(lambda *_:self.fail('duplicate model call')),'idle')
        self.assertEqual(self.admit()['inserted'],0)

    def test_all_supported_categories_and_unveil_prefilter(self):
        bodies=[('Micron $MU signed an agreement to supply memory for a new industrial project.','contract'),
                ('Micron $MU plans to acquire SensorWorks following regulatory approval.','acquisition'),
                ('Micron $MU unveils a new memory product for data center servers.','product'),
                ('Micron $MU will expand capacity at its existing manufacturing facility.','capacity'),
                (CEO,'management-outlook'),(ROUNDUP,'broker-commentary')]
        for number,(body,_) in enumerate(bodies):self.raw(body,number=number+1)
        self.assertEqual(self.admit()['inserted'],len(bodies))
        with research.connect(self.path) as db:
            self.assertEqual({r['category'] for r in news.candidates(db,NOW)},{category for _,category in bodies})
        self.assertEqual(self.admit()['inserted'],0)

    def test_author_response_to_retained_event_and_bilingual_publication(self):
        body='Micron $MU unveils a new memory product for data center servers.'
        payload={'includes':{'users':[{'id':'1','username':'wallstengine'}]},
                 'data':[{'id':'8888','author_id':'1','text':body,'created_at':PUBLISHED}],
                 'meta':{'newest_id':'8888'}}
        class Response(io.BytesIO):
            headers=Message()
        Response.headers['Content-Type']='application/json'
        class Opener:
            def open(inner,request,timeout):
                self.assertIn('from%3Awallstengine',request.full_url)
                return Response(json.dumps(payload).encode())
        with patch.dict(os.environ,{'X_API_ENABLED':'true','X_BEARER_TOKEN':'synthetic','X_FILTERED_STREAM_ENABLED':'false'}):
            acquired=x_api.fetch_posts(SOURCE,list(signals.ALIASES),lambda:Opener())
        self.assertEqual(acquired['_items'],[])
        self.assertEqual(len(acquired['_acquired_posts']),1)
        with research.connect(self.path) as db:
            signals.save(db,SOURCE,[],acquired,FIRST,signals.fingerprint(SOURCE,list(signals.ALIASES)),1)
        facts=[{'ja':'マイクロンはデータセンター向けサーバー用の新しいメモリー製品を発表した。',
                'en':'Micron introduced new memory hardware intended for servers in data centers.','evidenceId':'0'}]
        self.assertEqual(self.run_once(lambda *_:response(facts)),'done')
        with research.connect(self.path) as db:
            items=news.public_items(db,NOW)
            self.assertEqual(len(items),1)
            self.assertIn(facts[0]['ja'],items[0]['bodyJa']);self.assertIn(facts[0]['en'],items[0]['bodyEn'])
            self.assertEqual(items[0]['publishedAt'],PUBLISHED);self.assertEqual(items[0]['observedAt'],FIRST)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_events').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],1)
        self.assertEqual(self.intake()['counts']['validatedPublicationRows'],1)

    def test_author_query_keeps_faby_scope_and_four_route_limits(self):
        terms=('"price target" OR "target price" OR "PT to" OR earnings OR "quarterly results" OR '
               '"financial results" OR results OR highlights OR EPS OR 決算 OR initiated OR upgraded OR '
               'downgraded OR ADP OR CPI OR PPI OR PCE OR FOMC OR NFP OR GDP OR payrolls OR "jobs report" OR '
               '"unemployment rate" OR "hourly earnings" OR funding OR financing OR fundraising OR '
               '"capital raise" OR "capital raising" OR convertible OR 資金調達 OR 転換社債')
        query='(from:wallstengine OR from:tipranks OR (from:FABYMETAL4 ('+terms+'))) -is:retweet -is:reply'
        query=query.replace(' OR \"quarterly results\" OR \"financial results\"','').replace(' OR 転換社債',' OR 転換社債 OR buyback OR buybacks OR repurchase OR repurchases OR 自社株買い')
        self.assertEqual(SOURCE['query'],query);self.assertEqual(len(query),508)
        self.assertEqual(SOURCE['maxResults'],30);self.assertEqual(SOURCE['intervalSeconds'],30)
        self.assertEqual(len(x_stream.manifest()),4)
        self.assertFalse(TIP['enabled'])
        self.assertEqual(signals.X_API_DAILY_REQUEST_LIMIT_DEFAULT,100)
        old={**SOURCE,'query':'(from:wallstengine OR from:tipranks OR from:FABYMETAL4) ('+terms+') -is:retweet -is:reply'}
        tickers=list(signals.ALIASES)
        with research.connect(self.path) as db:
            cursor={'sinceId':'7777','queryGeneration':x_api.query_generation(old)}
            signals.save(db,old,[],{'cursor_update':json.dumps(cursor)},FIRST,signals.fingerprint(old,tickers),1)
            self.assertEqual(json.loads(signals.validators_for(db,old,tickers)['index_state']),cursor)
            self.assertEqual(signals.validators_for(db,SOURCE,tickers),{})

    def test_unknown_financial_actions_are_retained_for_review_without_model_flood(self):
        self.raw('Micron $MU at $250 (was $200), Northstar Research sees durable memory demand.',number=3)
        self.raw('Micron $MU price target raised to $250 from $200 at Northstar Research.',number=4)
        self.assertEqual(self.run_once(lambda *_:self.fail('unsupported post reached model')),'idle')
        report=self.intake()
        self.assertEqual(report['counts']['retainedRevisionRows'],2)
        self.assertEqual(report['counts']['reviewRequiredRows'],2)
        self.assertEqual(report['counts']['excludedRows'],0)
        self.assertEqual(report['records'][0]['disposition'],'review-required')

    def test_current_same_sha_document_without_event_is_not_skipped(self):
        raw=self.raw();self.document(raw)
        with patch.object(signals,'save_evidence',side_effect=AssertionError('must not replay acquisition')):
            self.assertEqual(self.admit()['inserted'],1)

    def test_existing_event_is_restored_without_changing_its_identity_or_clocks(self):
        self.raw();self.admit()
        with research.connect(self.path) as db:
            before=dict(db.execute('SELECT * FROM signal_events').fetchone())
            db.execute('DELETE FROM signal_documents')
        self.assertEqual(self.admit(),{'inserted':0,'restored':1,'limit':news.ADMISSION_LIMIT})
        with research.connect(self.path) as db:
            self.assertEqual(dict(db.execute('SELECT * FROM signal_events').fetchone()),before)

    def test_existing_event_metadata_and_document_integrity_cannot_be_shadowed(self):
        raw=self.raw();self.admit()
        with research.connect(self.path) as db:
            db.execute("UPDATE signal_events SET tickers_json='[\"MSFT\"]'")
        self.assertEqual(self.admit()['inserted'],0)
        self.assertIn('existing-event-evidence-mismatch',self.intake()['reasons'])
        with research.connect(self.path) as db:db.execute('DELETE FROM signal_events')
        self.document(raw,text='corrupt current document')
        self.assertEqual(self.admit()['inserted'],0)
        self.assertIn('document-evidence-integrity-mismatch',self.intake()['reasons'])

    def test_latest_correction_without_material_cue_blocks_old_raw_before_event(self):
        raw=self.raw();self.document(raw)
        self.raw('Correction: the earlier post is withdrawn and should not be relied upon.',first_seen_at=(NOW-timedelta(minutes=5)).isoformat(),last_seen_at=(NOW-timedelta(minutes=5)).isoformat())
        self.assertEqual(self.admit()['inserted'],0)
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_events').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT sha FROM signal_documents').fetchone()[0],raw['sha'])
        self.assertIn('superseded-or-missing-revision',self.intake()['reasons'])
        self.assertIn('retracted-or-corrected-evidence',self.intake()['reasons'])

    def test_newer_document_tied_future_and_invalid_heads_fail_closed(self):
        for clock in [(NOW-timedelta(minutes=1)).isoformat(),LAST,(NOW+timedelta(minutes=1)).isoformat(),'invalid']:
            with self.subTest(clock=clock):
                raw=self.raw();self.document(raw,sha='different-sha',text='Correction: withdrawn.',last_seen_at=clock)
                self.assertEqual(self.admit()['inserted'],0)
                with research.connect(self.path) as db:
                    self.assertEqual(db.execute('SELECT sha FROM signal_documents').fetchone()[0],'different-sha')
                    db.execute('DELETE FROM signal_documents');db.execute('DELETE FROM signal_x_acquisition')

    def test_cross_route_correction_is_authoritative(self):
        self.raw(source=TIP,account='TipRanks')
        self.raw('Correction: the report is withdrawn.',account='tipranks',
                 first_seen_at=(NOW-timedelta(minutes=1)).isoformat(),last_seen_at=(NOW-timedelta(minutes=1)).isoformat())
        self.assertEqual(self.admit()['inserted'],0)

    def test_older_document_replaced_with_raw_clocks_not_admission_time(self):
        raw=self.raw();self.document(raw,sha='old-sha',text='Older source revision.',last_seen_at=FIRST)
        self.assertEqual(self.admit()['inserted'],1)
        with research.connect(self.path) as db:
            document=db.execute('SELECT * FROM signal_documents').fetchone()
            self.assertEqual(document['sha'],raw['sha']);self.assertEqual(document['last_seen_at'],LAST)
            self.assertEqual(document['first_seen_at'],FIRST)

    def test_source_reversion_reuses_event_but_old_raw_never_revives_on_its_own(self):
        raw=self.raw();self.admit()
        with research.connect(self.path) as db:original=dict(db.execute('SELECT * FROM signal_events').fetchone())
        correction=self.raw('Correction: the earlier post is withdrawn and should not be relied upon.',first_seen_at=(NOW-timedelta(minutes=5)).isoformat(),last_seen_at=(NOW-timedelta(minutes=5)).isoformat())
        self.document(correction)
        self.assertEqual(self.admit()['restored'],0)
        raw=self.raw(last_seen_at=(NOW-timedelta(minutes=1)).isoformat())
        self.assertEqual(self.admit()['restored'],1)
        with research.connect(self.path) as db:
            self.assertEqual(dict(db.execute('SELECT * FROM signal_events').fetchone()),original)
            self.assertEqual(news.candidates(db,NOW)[0]['sha'],raw['sha'])

    def test_migrated_and_earlier_duplicate_do_not_displace_existing_job(self):
        self.raw(account='TipRanks');self.assertEqual(self.run_once(),'done')
        with research.connect(self.path) as db:
            event=dict(db.execute('SELECT * FROM signal_events').fetchone())
            job=dict(db.execute('SELECT * FROM official_research_jobs').fetchone())
            publication=dict(db.execute('SELECT * FROM official_research_publications').fetchone())
        self.raw(source=TIP,account='tipranks',first_seen_at=(NOW-timedelta(days=2)+timedelta(seconds=5)).isoformat())
        self.raw(number=2000,first_seen_at=(NOW-timedelta(days=2)+timedelta(seconds=1)).isoformat())
        self.assertEqual(self.admit()['inserted'],0)
        with research.connect(self.path) as db:
            self.assertEqual(dict(db.execute('SELECT * FROM signal_events').fetchone()),event)
            self.assertEqual(dict(db.execute('SELECT * FROM official_research_jobs').fetchone()),job)
            self.assertEqual(dict(db.execute('SELECT * FROM official_research_publications').fetchone()),publication)
            self.assertEqual(news.candidates(db,NOW)[0]['id'],event['id'])
        self.assertEqual(self.intake()['counts']['deduplicatedRows'],1)

    def test_concurrent_admission_creates_one_event(self):
        self.raw()
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:self.admit(),range(2)))
        self.assertEqual(sum(result['inserted'] for result in results),1)

    def test_revision_change_during_transport_revokes_new_publication(self):
        self.raw()
        def change(*_):
            self.raw('Correction: the report is withdrawn.',first_seen_at=(NOW-timedelta(minutes=1)).isoformat(),last_seen_at=(NOW-timedelta(minutes=1)).isoformat())
            return response(CEO_COPY)
        self.assertEqual(self.run_once(change),'stale')
        with research.connect(self.path) as db:self.assertEqual(news.public_items(db,NOW),[])

    def test_rejections_never_create_events(self):
        cases=[{'text':'Micron $MU launches a webinar. Register now for our course.'},
               {'text':'Microsoft $MU launches a cloud service for new industrial customers.'},
               {'account':'FABYMETAL4'}, {'truncated':1}, {'sha':'bad'},
               {'first_seen_at':'2026-10-01'}, {'last_seen_at':PUBLISHED},
               {'published_at':(NOW-timedelta(days=8)).isoformat()},
               {'text':'Micron $MU price target raised to $200 from $150 at TD Cowen.'}]
        for number,case in enumerate(cases):self.raw(number=number+1,**case)
        self.assertEqual(self.admit()['inserted'],0)
        counts=self.intake()['counts']
        self.assertEqual(counts['excludedRows']+counts['reviewRequiredRows']+counts['independentRouteRows'],len(cases))

    def test_record_limit_does_not_hide_intake_gap_and_batch_is_bounded(self):
        for number in range(55):
            self.raw(text=f'Micron $MU unveils a new memory product called Model {number} for industrial customers.',number=number+1)
        before=self.intake()
        self.assertEqual(before['counts']['acquisitionOnlyGapRows'],55)
        self.assertEqual(len(before['records']),news.INTAKE_RECORD_LIMIT)
        self.assertTrue(before['recordsTruncated'])
        self.assertEqual(self.admit()['inserted'],news.ADMISSION_LIMIT)
        self.assertEqual(self.intake()['counts']['acquisitionOnlyGapRows'],5)
        self.assertEqual(self.admit()['inserted'],5)

    def test_disabled_and_shared_cap_never_make_provider_or_x_calls(self):
        self.raw()
        with patch.object(x_api,'fetch_posts',side_effect=AssertionError('live X')):
            self.assertEqual(self.run_once(lambda *_:self.fail('disabled model'),{**ENV,'OFFICIAL_HEADLINE_TRANSLATION_ENABLED':'false'}),'disabled')
            with research.connect(self.path) as db:
                self.assertEqual(db.execute('SELECT count(*) FROM signal_events').fetchone()[0],0)
                db.executemany('INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)',
                    [(NOW.timestamp(),'existing','sha','approved','failed',str(i)) for i in range(200)])
            self.assertEqual(self.run_once(lambda *_:self.fail('model cap exceeded')),'idle')
            with research.connect(self.path) as db:
                self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],200)
                self.assertEqual(db.execute('SELECT count(*) FROM signal_events').fetchone()[0],1)


if __name__=='__main__':unittest.main()
