import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {thermometerSession,readThermometer,refreshThermometer,safeThermometerSnapshot} from '../lib/resolute/thermometer-runtime.ts';
const now=new Date('2026-10-26T21:00:00Z');
const reading=(index)=>({status:'ready',version:'daily-close-v1',index,asOf:'2026-10-26',referenceFrom:'2016-10-26',observations:2500,score:50,band:2,drawdownPercent:-10,deviationPercent:5,drawdownPercentile:30,deviationPercentile:70});
const snapshot=()=>({asOf:'2026-10-26',nas100:reading('nas100'),sox:reading('sox'),vix:{status:'ready',asOf:'2026-10-26',level:20,percentile:55}});
test('eligible close observes summer/winter time, shortened days, holidays and coverage boundaries',()=>{
 for(const [at,expected] of [
 ['2026-10-26T20:59:59Z','2026-10-23'],['2026-10-26T21:00:00Z','2026-10-26'],
 ['2026-11-02T21:59:59Z','2026-10-30'],['2026-11-02T22:00:00Z','2026-11-02'],
 ['2026-11-27T18:59:59Z','2026-11-25'],['2026-11-27T19:00:00Z','2026-11-27'],
 ['2026-11-26T23:00:00Z','2026-11-25'],['2026-10-25T23:00:00Z','2026-10-23'],
 ['2028-01-03T22:00:00Z',null],['bad',null]])assert.equal(thermometerSession(new Date(at)),expected,at);
});
test('persisted snapshots reject mismatched dates and sanitize each index independently',()=>{
 const input=snapshot();input.secret='never forward';input.nas100.extra='never forward';
 let safe=safeThermometerSnapshot(input,'2026-10-26');assert.equal(safe.secret,undefined);assert.equal(safe.nas100.extra,undefined);
 input.sox.version='unknown';safe=safeThermometerSnapshot(input,'2026-10-26');assert.equal(safe.sox.status,'unavailable');assert.equal(safe.nas100.status,'ready');
 assert.equal(safeThermometerSnapshot(input,'2026-10-27').nas100.reason,'stale-data');
 for(const bad of [null,[],{},'text'])assert.equal(safeThermometerSnapshot(bad,'2026-10-26').nas100.status,'unavailable');
});
test('SQL persistence survives a new reader; new session hides old rows and errors fail closed',async()=>{
 const db=new PGlite();
 try {
 await db.exec(await readFile('scripts/resolute/thermometer-schema.sql','utf8'));
 await db.query('INSERT INTO resolute_thermometer_snapshots(session_date,snapshot) VALUES ($1,$2::jsonb)',['2026-10-26',JSON.stringify(snapshot())]);
 let saved=await readThermometer(db,now);assert.equal(saved.nas100.status,'ready');assert.equal(saved.validUntil,Date.parse('2026-10-27T21:00:00Z'));
 const data=await db.dumpDataDir();const reopened=new PGlite({loadDataDir:data});
 try {assert.equal((await readThermometer(reopened,now)).sox.status,'ready');}finally{await reopened.close();}
 assert.equal((await readThermometer(db,new Date('2026-10-27T21:00:00Z'))).nas100.reason,'stale-data');
 assert.equal((await readThermometer({query:async()=>{throw Error('private connection');}},now)).nas100.reason,'storage-unavailable');
 } finally {await db.close();}
});
test('worker stores partial failures once per session, never fetches on reads or while disabled',async()=>{
 const db=new PGlite();let calls=0,locks=0;
 const connection={query:async(sql,args)=>{if(sql.includes('pg_advisory_xact_lock')){locks++;return {rows:[]};}return db.query(sql,args);}};
 const cfg={enabled:true,apiKey:'private-fixture',instruments:{nas100:{symbol:'N',exchange:'X'},sox:{symbol:'S',exchange:'X'},vix:{symbol:'V',exchange:'X'}}};
 const fetcher=async()=>{calls++;return new Response('{}',{status:503});};
 try {
 await db.exec(await readFile('scripts/resolute/thermometer-schema.sql','utf8'));
 assert.equal((await refreshThermometer(connection,{...cfg,enabled:false},now,fetcher)).status,'disabled');assert.equal(calls,0);assert.equal(locks,0);
 assert.equal((await refreshThermometer(connection,cfg,now,fetcher)).status,'stored');assert.equal(calls,3);
 assert.equal((await refreshThermometer(connection,cfg,now,fetcher)).status,'already-attempted');assert.equal(calls,3);
 const row=await readThermometer(db,now);assert.equal(row.nas100.reason,'provider-error');assert.equal(calls,3);
 assert.doesNotMatch(JSON.stringify((await db.query('SELECT * FROM resolute_thermometer_snapshots')).rows),/private-fixture|apikey/);
 const previous=await refreshThermometer(connection,cfg,new Date('2026-10-23T21:00:00Z'),fetcher);assert.equal(previous.status,'already-attempted');assert.equal(calls,3);
 }finally{await db.close();}
});
test('failed persistence rolls back and never reports success or leaks provider credentials',async()=>{
 const statements=[];
 const db={query:async(sql)=>{statements.push(sql);if(sql.startsWith('INSERT'))throw Error('secret-database-url');return {rows:[]};}};
 await assert.rejects(refreshThermometer(db,{enabled:true,apiKey:'private-fixture',instruments:{}},now,async()=>{throw Error('must not fetch');}),/^Error: thermometer-refresh-failed$/);
 assert.equal(statements.at(-1),'ROLLBACK');
});
test('synthetic provider closes flow through calculation and durable SQL to independent display readings',async()=>{
 const db=new PGlite();
 const connection={query:(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,args)};
 const config={enabled:true,apiKey:'synthetic-only',instruments:{nas100:{symbol:'N',exchange:'TEST'},sox:{symbol:'S',exchange:'TEST'},vix:{symbol:'V',exchange:'TEST'}}};
 const values=[];
 for(let time=Date.parse('2013-01-01');time<=Date.parse('2026-10-26');time+=86400000){const date=new Date(time);if(![0,6].includes(date.getUTCDay()))values.push({datetime:date.toISOString().slice(0,10),close:'100'});}
 const fetcher=async(url)=>{
  const symbol=url.searchParams.get('symbol');
  if(symbol==='V')return new Response('{}',{status:503});
  const bars=values.map(v=>({...v}));bars.at(-1).close=symbol==='S'?'50':'200';
  return Response.json({status:'ok',meta:{symbol,exchange:'TEST',type:'Index',interval:'1day'},values:bars});
 };
 try {
  await db.exec(await readFile('scripts/resolute/thermometer-schema.sql','utf8'));
  assert.equal((await refreshThermometer(connection,config,now,fetcher)).status,'stored');
  const result=await readThermometer(db,now);
  assert.equal(result.nas100.band,4);assert.equal(result.sox.band,0);assert.equal(result.vix.reason,'provider-error');
  assert.equal(result.asOf,'2026-10-26');
 }finally{await db.close();}
});
