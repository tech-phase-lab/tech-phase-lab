"""Offline real-service synthetic collection/scheduling replay; no manual recovery."""
from contextlib import ExitStack
from datetime import datetime,timedelta,timezone
from email.message import Message
import importlib.util
import io,json,os,sys,tempfile,time
from pathlib import Path
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT/'scripts/research'),str(ROOT/'tests')]
import official_research as research
import macro_source_news as parser
import macro_source_publication as macro
import general_source_news as news
import x_api
from test_macro_source_news import JOBS,CPI
signals=research.signals
spec=importlib.util.spec_from_file_location('macro_fresh_service',ROOT/'scripts/research/service.py')
service=importlib.util.module_from_spec(spec);spec.loader.exec_module(service)
assert service.signals is signals

ENV={'X_API_ENABLED':'true','X_BEARER_TOKEN':'synthetic-offline-token',
     'X_FILTERED_STREAM_ENABLED':'0','RESEARCH_SIGNALS_ENABLED':'1',
     'OFFICIAL_HEADLINE_TRANSLATION_ENABLED':'true','OPENAI_API_KEY':'synthetic-offline-key',
     'OFFICIAL_HEADLINE_TRANSLATION_MODEL':'gpt-4.1-mini','OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT':'1','OFFICIAL_HEADLINE_TRANSLATION_APPROVED_ON':'2026-09-30',
     'RESEARCH_AUTO_DRAFTS':'0','OFFICIAL_STORY_BODY_FETCH_ENABLED':'false'}
class Response:
 def __init__(self,payload):
  self.body=io.BytesIO(json.dumps(payload).encode());self.headers=Message();self.headers['Content-Type']='application/json'
 def __enter__(self):return self
 def __exit__(self,*_):self.body.close()
 def read(self,size):return self.body.read(size)


def replay(body,order, *, restart=False, negative=False, during_assessment=False, legacy_flash=False, missing_raw=False, withdraw=False, corrupt_body=False, parser_change=False, duplicate_after=False, interrupted=False, stale_during=False, generic_job=False, late_proof=False, adapter=macro, grammar_module=parser):
 with tempfile.TemporaryDirectory() as folder,ExitStack() as guards:
  guards.enter_context(patch.dict(os.environ,ENV))
  guards.enter_context(patch('socket.create_connection',side_effect=AssertionError('external forbidden')))
  guards.enter_context(patch('socket.socket.connect',side_effect=AssertionError('external forbidden')))
  path=Path(folder)/'db.sqlite';app=service.AutomaticMonitor(path,Path(folder)/'snapshot.json')
  source=next(s for s in signals.SOURCES if s['id']=='x-wallstengine')
  with service.monitor.connect(path) as db:
   assert source in signals.due(db,sources=[source])
  source_at=(datetime.now(timezone.utc)-timedelta(seconds=30)).isoformat(timespec='milliseconds')
  number='2109000000000000001' if 'JOBS REPORT' in body else '2109000000000000002'
  payload={'data':[{'id':number,'author_id':'900','text':body,'created_at':source_at}],
           'includes':{'users':[{'id':'900','username':'wallstengine'}]},'meta':{'result_count':1,'newest_id':number}}
  requests=[]
  class Opener:
   def open(self,request,**kwargs):
    acquired=app.db_lock.acquire(blocking=False)
    assert acquired,'transport under database lock';app.db_lock.release()
    requests.append(True)
    return Response(payload)
  # Inject only the HTTP opener into the actual collector's captured default.
  for name in ('prepare_x_query_window','require_x_polling_storage','reserve_x_api_request'):
   original=getattr(signals,name)
   def trace(*args,_original=original,_name=name,**kwargs):
    try:return _original(*args,**kwargs)
    except Exception as exc:print('PRECHECK ERROR',_name,type(exc).__name__,str(exc));raise
   guards.enter_context(patch.object(signals,name,side_effect=trace))
  original_acquire=signals.acquire
  def trace_acquire(*args,**kwargs):
   try:return original_acquire(*args,**kwargs)
   except Exception as exc:
    print('COLLECTOR ERROR',type(exc).__name__,str(exc));raise
  with patch.object(x_api.fetch_posts,'__defaults__',(lambda:Opener(),None)),patch.object(signals,'acquire',side_effect=trace_acquire):
   app.check_signal_source(source)
  if len(requests)!=1:
   with research.connect(path) as db:print("COLLECTION BLOCK",[dict(r) for r in db.execute("SELECT id,error FROM signal_routes")])
  assert len(requests)==1
  with research.connect(path) as db:
   raw=[dict(x) for x in db.execute('SELECT * FROM signal_x_acquisition')]
   collected_events=[dict(x) for x in db.execute('SELECT * FROM signal_events')]
   assert len(raw)==1 and raw[0]['text']==body
   assert raw[0]['sha']==news.digest(raw[0]['title']+'\n'+body)
  if missing_raw:
   with research.connect(path) as db:db.execute('DELETE FROM signal_x_acquisition')
  if generic_job:
   with research.connect(path) as db:
    event=dict(db.execute('SELECT * FROM signal_events LIMIT 1').fetchone())
    db.execute('INSERT INTO official_research_jobs VALUES(?,?,?,?,?,?,?)',
               (event['id'],event['sha'],1,0,'synthetic-ordinary-job','review','invalid-note'))
  calls=[];steps=[]
  collection_finished=time.monotonic()

  def positive(*args):
   calls.append(True)
   if interrupted:raise RuntimeError('synthetic transport interruption')
   if stale_during:
    with research.connect(path) as db:db.execute("UPDATE signal_x_acquisition SET sha='changed-during-assessment'")
   if during_assessment:
    service.market_results.run_once(path,signals.SOURCES)
   value={'disposition':'publish','reason':'material-company-development','facts':[{'ja':'モデルのコピーを公開しない。','en':'Never publish model wording.','evidenceId':'0'}]}
   if negative:value={'disposition':'review','reason':'not-material-business-news','facts':[]}
   return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(value)}]}]}
  def cycle(lane):
   app.stop_event.clear()
   wake=app.publication_wakes['results' if lane=='results' else 'official']
   with patch.object(wake,'wait',side_effect=lambda *_:app.stop_event.set()), \
        patch.object(research.run_once,'__defaults__',(positive,None,None)):
    (app.run_results if lane=='results' else app.run_official_research)()
   app.stop_event.clear()
   with research.connect(path) as db:
    steps.append({'lane':lane,'modelCalls':len(calls),'elapsedSinceCollectionMs':round((time.monotonic()-collection_finished)*1000,3),
      'jobs':[dict(x) for x in db.execute('SELECT event_id,state,attempts,failure_kind FROM official_research_jobs')],
      'reviews':[dict(x) for x in db.execute('SELECT * FROM general_source_semantic_reviews')],
      'fullPublicCount':len(news.public_items(db,datetime.now(timezone.utc))),
      'fullPublicItems':news.public_items(db,datetime.now(timezone.utc)),
      'flashPublicCount':len(service.market_results.public_feed(db)),
      'flashRecords':[dict(x) for x in db.execute('SELECT * FROM market_result_publications')],
      'auditCount':db.execute('SELECT count(*) FROM '+adapter.AUDIT_TABLE).fetchone()[0],
      'routeOwners':[dict(x) for x in db.execute('SELECT * FROM '+adapter.ROUTE_TABLE)],
      'rows':[{'eventId':x['id'],'recognized':adapter.recognized(x),'retained':adapter.retained(db,x,datetime.now(timezone.utc)) is not None,
         'ownership':adapter.ownership_reason(adapter.ownership_state(db,x,datetime.now(timezone.utc)))} for x in news.candidates(db,datetime.now(timezone.utc),include_review=True)]})
  if restart:
   app=service.AutomaticMonitor(path,Path(folder)/'restarted-before-workers.json')
  if legacy_flash:
   # Reproduce a pre-release writer with neither of the new routing checks;
   # all original result parsing/storage/clocks still run through the service.
   with patch.object(adapter,'reserve_fresh_result_route',return_value=False), \
        patch.object(adapter,'record_route_owner',return_value=False):
    cycle('results')
  if late_proof:
   with research.connect(path) as db:db.execute('DELETE FROM signal_x_acquisition')
   original_reserve=adapter.reserve_fresh_result_route
   delayed_once=[]
   def delayed(*args,**kwargs):
    if not delayed_once:
     delayed_once.append(True)
     assert original_reserve(*args,**kwargs) is False
     with research.connect(path) as writer:
      writer.execute('INSERT INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)',tuple(raw[0].values()))
     if late_proof!='proof-only':assert research.run_once(path,positive,ENV)=='done'
     return False
    return original_reserve(*args,**kwargs)
   guards.enter_context(patch.object(adapter,'reserve_fresh_result_route',side_effect=delayed))
  for lane in order:cycle(lane)
  if restart:
   app=service.AutomaticMonitor(path,Path(folder)/'restarted-after-workers.json')
   cycle('results');cycle('official')
  before_withdrawal=app.public_news()
  if duplicate_after:
   with research.connect(path) as db:
    columns=[row[1] for row in db.execute('PRAGMA table_info(signal_events)') if row[1]!='id']
    original=dict(db.execute('SELECT * FROM signal_events ORDER BY id LIMIT 1').fetchone())
    original['previous_sha']='synthetic-return-to-prior-bytes'
    db.execute('INSERT INTO signal_events('+','.join(columns)+') VALUES('+','.join('?' for _ in columns)+')',
               tuple(original[name] for name in columns))
  if corrupt_body:
   with research.connect(path) as db:db.execute("UPDATE signal_documents SET text=text || '\nUnsupported extra sentence.'")
  if parser_change:
   guards.enter_context(patch.object(grammar_module,'parse',side_effect=ValueError('unsupported-format')))
   # A parser change ships with a deployment, whose restart starts with an empty
   # public-news cache. Simulate that here; data changes invalidate it themselves.
   app.news_cache.clear()
  if withdraw:
   with research.connect(path) as db:db.execute("UPDATE signal_x_acquisition SET sha='changed-current-source'")
  if withdraw or corrupt_body or parser_change:
   cycle('results');cycle('official')

  full=app.public_news()
  with research.connect(path) as db:
   future=datetime.now(timezone.utc)+timedelta(hours=25)
   expiry={'fullPublicItems':news.public_items(db,future),
     'flashPublicItems':service.market_results.public_feed(db,reference=future),
     'macroRows':[{'eventId':row['id'],'recordedAudit':adapter.recorded(db,row),
                  'closedAttempt':adapter.closed_attempt(db,row),
                  'ownership':adapter.ownership_reason(adapter.ownership_state(db,row,future))}
                  for row in news.candidates(db,future,include_review=True)]}

  with research.connect(path) as db:
   final={'rawUnchanged':raw==[dict(x) for x in db.execute('SELECT * FROM signal_x_acquisition')],
    'callCount':db.execute("SELECT count(*) FROM signal_headline_translation_calls WHERE source_id LIKE 'research:%'").fetchone()[0],
    'apiReservationCount':db.execute('SELECT count(*) FROM signal_x_request_attempts').fetchone()[0]}
   publication_clocks=[dict(row) for row in db.execute('SELECT started_at,public_at,generation_ms FROM official_research_publications')]
  return {'format':'jobs' if 'JOBS REPORT' in body else 'cpi','order':order,'httpRequests':len(requests),
    'collectedRaw':raw,'collectedEvents':collected_events,'steps':steps,'publicationClocks':publication_clocks,'public':full,'beforeWithdrawal':before_withdrawal,'postExpiryRead':expiry,'final':final}


class FreshMacroServiceTests(unittest.TestCase):
 def test_both_real_worker_orders_deliver_complete_reports_once(self):
  for body in (JOBS,CPI):
   for order in (['results','official','official'],['official','results','official']):
    with self.subTest(body=body[:25],order=order):
     value=replay(body,order)
     self.assertEqual(value['httpRequests'],1)
     self.assertEqual(value['final'],{'rawUnchanged':True,'callCount':1,'apiReservationCount':1})
     self.assertEqual(len(value['public']['officialUpdates']),1)
     self.assertEqual(value['public']['resultBriefs'],[])
     item=value['public']['officialUpdates'][0];raw=value['collectedRaw'][0]
     copy=parser.derive(body)
     self.assertEqual(item['bodyJa'],'\n\n'.join(copy['bodyJa'].splitlines()))
     self.assertEqual(item['bodyEn'],'\n\n'.join(copy['bodyEn'].splitlines()))
     self.assertEqual(item['translationJa'],copy['titleJa'])
     self.assertEqual(item['title'],copy['titleEn'])
     self.assertEqual(item['tickers'],[])
     self.assertEqual(item['publishedAt'],raw['published_at'])
     self.assertEqual(item['observedAt'],raw['first_seen_at'])
     self.assertEqual(value['steps'][-1]['jobs'][0]['attempts'],1)
     self.assertEqual(value['steps'][-1]['jobs'][0]['state'],'done')
     self.assertEqual(len(value['postExpiryRead']['fullPublicItems']),1)
     if 'JOBS REPORT' in body:self.assertEqual(len(value['collectedEvents']),1)
     else:self.assertEqual(value['collectedEvents'],[]) # Real raw-only admission, not a seeded event.

 def test_restart_before_and_after_assessment_preserves_one_call_and_full_detail(self):
  for body in (JOBS,CPI):
   for order in (['results','official'],['official','results']):
    with self.subTest(body=body[:25],order=order):
     value=replay(body,order,restart=True)
     self.assertEqual(value['final'],{'rawUnchanged':True,'callCount':1,'apiReservationCount':1})
     self.assertEqual(len(value['public']['officialUpdates']),1)
     self.assertEqual(value['public']['resultBriefs'],[])
     self.assertEqual(value['steps'][-1]['auditCount'],1)

 def test_results_worker_during_assessment_cannot_create_competing_flash(self):
  value=replay(JOBS,['official','results','official'],during_assessment=True)
  self.assertEqual(value['final']['callCount'],1)
  self.assertEqual(len(value['public']['officialUpdates']),1)
  self.assertEqual(value['public']['resultBriefs'],[])

 def test_negative_assessment_remains_review_without_fallback_flash_or_retry(self):
  for body in (JOBS,CPI):
   for order in (['results','official','results','official'],['official','results','official']):
    with self.subTest(body=body[:25],order=order):
     value=replay(body,order,negative=True,restart=True)
     self.assertEqual(value['final']['callCount'],1)
     self.assertEqual(value['public']['officialUpdates'],[])
     self.assertEqual(value['public']['resultBriefs'],[])
     self.assertEqual(value['steps'][-1]['jobs'][0]['state'],'review')
     self.assertEqual(value['steps'][-1]['auditCount'],0)
     reviews=[step['reviews'][0] for step in value['steps'] if step['reviews']]
     self.assertTrue(reviews)
     self.assertTrue(all(review==reviews[0] for review in reviews))
     self.assertEqual(reviews[0]['reason'],'not-material-business-news')

 def test_partial_and_unsupported_tail_keep_the_existing_flash_route(self):
  for body in ('U.S. NFP +31K (Est. +95K)', JOBS+'\nUnsupported extra sentence.'):
   with self.subTest(body=body[:30]):
    value=replay(body,['results'])
    self.assertEqual(value['final']['callCount'],0)
    self.assertEqual(len(value['public']['resultBriefs']),1)
    self.assertEqual(value['public']['officialUpdates'],[])

 def test_missing_raw_legacy_source_does_not_get_new_detail_authority(self):
  value=replay(JOBS,['results','official'],missing_raw=True)
  self.assertEqual(value['final']['callCount'],0)
  self.assertEqual(value['public']['officialUpdates'],[])
  self.assertEqual(len(value['public']['resultBriefs']),1)

 def test_existing_pre_release_flash_is_unchanged_and_still_guarded(self):
  value=replay(JOBS,['official','results','official'],legacy_flash=True)
  self.assertEqual(value['final']['callCount'],0)
  self.assertEqual(value['public']['officialUpdates'],[])
  self.assertEqual(len(value['public']['resultBriefs']),1)
  self.assertEqual(value['steps'][0]['flashPublicCount'],1)
  self.assertEqual(value['steps'][0]['flashRecords'],value['steps'][-1]['flashRecords'])
  self.assertTrue(value['final']['rawUnchanged'])

 def test_body_corruption_and_parser_rejection_do_not_reopen_flash_after_audit(self):
  for change in ('corrupt_body','parser_change'):
   with self.subTest(change=change):
    value=replay(JOBS,['official','results'],**{change:True})
    self.assertEqual(len(value['beforeWithdrawal']['officialUpdates']),1)
    self.assertEqual(value['public']['officialUpdates'],[])
    self.assertEqual(value['public']['resultBriefs'],[])
    self.assertEqual(value['final']['callCount'],1)

 def test_negative_or_interrupted_route_stays_owned_after_lost_body_or_parser(self):
  for change in ('corrupt_body','parser_change'):
   with self.subTest(change=change):
    value=replay(JOBS,['results','official'],negative=True,**{change:True})
    self.assertEqual(value['public']['officialUpdates'],[])
    self.assertEqual(value['public']['resultBriefs'],[])
    self.assertEqual(value['final']['callCount'],1)
    self.assertEqual(value['steps'][-1]['jobs'][0]['state'],'review')

 def test_duplicate_event_for_same_origin_revision_cannot_escape_route_owner(self):
  for negative in (False,True):
   with self.subTest(negative=negative):
    value=replay(JOBS,['official'],negative=negative,duplicate_after=True,withdraw=True,restart=True)
    self.assertEqual(value['public']['officialUpdates'],[])
    self.assertEqual(value['public']['resultBriefs'],[])
    self.assertEqual(value['final']['callCount'],1)

 def test_interrupted_and_stale_attempts_retain_denial_only_route_receipt(self):
  for mode in ('interrupted','stale_during'):
   with self.subTest(mode=mode):
    value=replay(JOBS,['official','results','official'],restart=True,**{mode:True})
    self.assertEqual(value['public']['officialUpdates'],[])
    self.assertEqual(value['public']['resultBriefs'],[])
    self.assertEqual(value['final']['callCount'],1)
    owners=[step['routeOwners'][0] for step in value['steps'] if step['routeOwners']]
    self.assertTrue(owners)
    self.assertTrue(all(owner==owners[0] for owner in owners))

 def test_generic_job_does_not_claim_partial_format_for_macro_route(self):
  value=replay('U.S. NFP +31K (Est. +95K)',['results'],generic_job=True)
  self.assertEqual(len(value['public']['resultBriefs']),1)
  self.assertEqual(value['steps'][-1]['routeOwners'],[])

 def test_route_receipt_is_revision_specific_and_not_publication_authority(self):
  import test_macro_source_publication as fixtures
  case=fixtures.MacroPublicationTests();case.setUp();self.addCleanup(case.doCleanups)
  old=case.row()
  with research.connect(case.path) as db,db:
   db.execute('BEGIN IMMEDIATE')
   self.assertTrue(macro.record_route_owner(db,old,fixtures.NOW))
   before=dict(db.execute('SELECT * FROM '+macro.ROUTE_TABLE).fetchone())
  case.raw(JOBS.replace('+31K','+32K'),number=901,first_seen_at=fixtures.NOW.isoformat(),last_seen_at=fixtures.NOW.isoformat())
  case.admit()
  with research.connect(case.path) as db,db:
   new=next(row for row in news.candidates(db,fixtures.NOW,include_review=True) if row['sha']!=old['sha'])
   self.assertFalse(macro.route_owned(db,new))
   db.execute('BEGIN IMMEDIATE')
   self.assertTrue(macro.record_route_owner(db,new,fixtures.NOW))
   self.assertEqual(db.execute('SELECT count(*) FROM '+macro.ROUTE_TABLE).fetchone()[0],2)
   self.assertEqual(dict(db.execute('SELECT * FROM '+macro.ROUTE_TABLE+' WHERE sha=?',(old['sha'],)).fetchone()),before)
   self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0],0)
   self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],0)

 def test_results_first_receipt_precedes_materiality_and_is_immutable(self):
  value=replay(JOBS,['results','official','results'],restart=True)
  first=value['steps'][0]
  self.assertEqual(first['modelCalls'],0)
  self.assertEqual(first['fullPublicCount'],0)
  self.assertEqual(len(first['routeOwners']),1)
  self.assertEqual(first['routeOwners'],value['steps'][-1]['routeOwners'])
  self.assertEqual(first['routeOwners'][0]['sha'],value['collectedRaw'][0]['sha'])

 def test_source_and_config_races_do_not_insert_stale_route_receipts(self):
  import test_macro_source_publication as fixtures
  for change in ('source','config'):
   with self.subTest(change=change):
    case=fixtures.MacroPublicationTests();case.setUp();self.addCleanup(case.doCleanups)
    row=case.row();original=macro.fresh_route_candidate;seen=[]
    source=next(item for item in signals.SOURCES if item['id']==row['source_id'])
    with ExitStack() as guards,research.connect(case.path) as db:
     def during(*args,**kwargs):
      value=original(*args,**kwargs)
      if value is not None and not seen:
       seen.append(True)
       if change=='source':args[0].execute("UPDATE signal_documents SET sha='changed-current-source'")
       else:guards.enter_context(patch.dict(source,{'accounts':[]}))
      return value
     with patch.object(macro,'fresh_route_candidate',side_effect=during):
      self.assertTrue(macro.reserve_fresh_result_route(db,row,fixtures.NOW))
     self.assertEqual(len(seen),1)
     self.assertEqual(db.execute('SELECT count(*) FROM '+macro.ROUTE_TABLE).fetchone()[0],0)
     self.assertEqual(db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0],0)
     self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],0)

 def test_stale_false_route_decision_cannot_race_a_newly_committed_detail(self):
  for mode in (True,'proof-only'):
   with self.subTest(mode=mode):
    value=replay(JOBS,['results','official','results'],late_proof=mode)
    self.assertEqual(value['final'],{'rawUnchanged':True,'callCount':1,'apiReservationCount':1})
    self.assertEqual(len(value['public']['officialUpdates']),1)
    self.assertEqual(value['public']['resultBriefs'],[])
    self.assertEqual(value['steps'][-1]['auditCount'],1)
    self.assertEqual(len(value['steps'][-1]['routeOwners']),1)

 def test_current_raw_revision_change_withdraws_detail_without_paid_retry(self):
  value=replay(JOBS,['results','official'],withdraw=True)
  self.assertEqual(len(value['beforeWithdrawal']['officialUpdates']),1)
  self.assertEqual(value['public']['officialUpdates'],[])
  self.assertEqual(value['public']['resultBriefs'],[])
  self.assertEqual(value['final']['callCount'],1)


if __name__=='__main__':unittest.main()
