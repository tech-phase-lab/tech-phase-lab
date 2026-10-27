import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {handler,tokens,databaseConfig,validate} from '../services/financial-radar/core.mjs';
const auth={write:'w'.repeat(40),read:'r'.repeat(40)};
const row={genre:'ai-cloud',ticker:'NBIS',ocf_margin:-180,cover:2.5,revenue_growth:null,revenue_usd:1e9,period_end:'2025-12-31',previous_ocf_margin:null,previous_cover:null,needs_review:false,calculated_at:'2026-01-02T00:00:00Z',fcf_margin:-200,basis:'ttm',previous_period_end:null};
test('financial radar config fails closed and never consumes member DB credentials',()=>{
 assert.throws(()=>tokens({}));assert.throws(()=>tokens({TECH_PHASE_RADAR_WRITE_TOKEN:auth.write,TECH_PHASE_RADAR_READ_TOKEN:auth.write}));
 assert.throws(()=>databaseConfig({DATABASE_URL:'postgres://admin:password@localhost/test'}));
 const env={TECH_PHASE_RADAR_DATABASE_NAME:'test',TECH_PHASE_RADAR_DATABASE_URL:'postgres://tech_phase_radar_writer:password@postgres.railway.internal/test'};
 assert.equal(databaseConfig(env).ssl,false);
 assert.deepEqual(databaseConfig({...env,TECH_PHASE_RADAR_DATABASE_URL:env.TECH_PHASE_RADAR_DATABASE_URL.replace('postgres.railway.internal','db.example.com')}).ssl,{rejectUnauthorized:true});
 assert.throws(()=>databaseConfig({...env,TECH_PHASE_RADAR_DATABASE_URL:env.TECH_PHASE_RADAR_DATABASE_URL.replace('tech_phase_radar_writer','postgres')}));
 assert.throws(()=>databaseConfig({...env,TECH_PHASE_RADAR_DATABASE_NAME:'other'}));
 assert.equal(validate({...row,period_end:'2025-02-30'}),false);
 assert.equal(validate({...row,calculated_at:'2099-01-01T00:00:00Z'}),false);
});
test('financial radar HTTP auth, persistence, stale writes and existing table isolation',async()=>{
 const db=new PGlite();await db.exec("CREATE TABLE members_sentinel(id integer primary key); INSERT INTO members_sentinel VALUES(7);");
 const schema=readFileSync(new URL('../scripts/tech-phase/financial-radar-schema.sql',import.meta.url),'utf8');await db.exec(schema);await db.exec(schema);
 let calls=0;const pool={query:async(...args)=>{calls++;return db.query(...args);}};
 const server=http.createServer(handler(pool,auth));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}/v1/financial-radar`;
 const post=async(value,token=auth.write,headers={})=>fetch(base,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...headers},body:JSON.stringify(value)});
 try{
  assert.equal((await fetch(base+'?genre=ai-cloud')).status,401);
  assert.equal((await post(row,auth.read)).status,401);assert.equal(calls,0);
  assert.equal((await post(row,auth.write,{origin:'https://example.com'})).status,403);
  assert.equal((await post({...row,extra:'ignored?'})).status,400);
  assert.equal((await post({...row,cover:-1})).status,400);
  assert.equal((await post({...row,previous_ocf_margin:1})).status,400);
  assert.equal((await post({...row,fcf_margin:'x'.repeat(17000)})).status,413);
  assert.deepEqual(await(await post(row)).json(),{ok:true,saved:true});
  assert.deepEqual(await(await post(row)).json(),{ok:true,saved:false});
  assert.deepEqual(await(await post({...row,ocf_margin:99,calculated_at:'2026-01-01T00:00:00Z'})).json(),{ok:true,saved:false});
  const get=await fetch(base+'?genre=ai-cloud',{headers:{authorization:`Bearer ${auth.read}`}});
  const data=await get.json();assert.equal(data.items[0].ocf_margin,-180);assert.equal(data.items[0].period_end,'2025-12-31');assert.equal(data.items[0].revenue_growth,null);
  assert.equal((await fetch(base+'?genre=ai-cloud',{headers:{authorization:`Bearer ${auth.write}`}})).status,401);
  assert.equal((await fetch(base+'?genre=ai-cloud&genre=semis',{headers:{authorization:`Bearer ${auth.read}`}})).status,400);
  assert.equal((await db.query('SELECT id FROM members_sentinel')).rows[0].id,7);
  await db.exec('CREATE ROLE radar_test NOLOGIN; GRANT USAGE ON SCHEMA public TO radar_test; GRANT SELECT,INSERT,UPDATE ON tech_phase_financial_radar TO radar_test;');
  assert.equal((await db.query("SELECT has_table_privilege('radar_test','members_sentinel','SELECT') AS allowed")).rows[0].allowed,false);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await db.close();}
});
test('financial radar hides database errors and does not log raw exceptions',async()=>{
 const events=[];const server=http.createServer(handler({query:async()=>{throw Error('secret-value');}},auth,{log:e=>events.push(e)}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const r=await fetch(`http://127.0.0.1:${server.address().port}/v1/financial-radar?genre=semis`,{headers:{authorization:`Bearer ${auth.read}`}});assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'unavailable'});assert.deepEqual(events,['RADAR_REQUEST_FAILED']);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
