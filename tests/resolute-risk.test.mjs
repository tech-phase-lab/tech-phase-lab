import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {riskStars,riskAction,parseRiskFeed,latestRiskDate} from '../lib/resolute/risk.ts';
import {candidatesFromFeed,validateGeneration,collect,publish} from '../services/resolute-api/risk-job.mjs';
import {riskRequest,publicRiskFeed,hash} from '../services/resolute-api/risk-store.mjs';
import {OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';
const now=new Date('2026-10-12T22:00:00Z');
const body='NVIDIA warned that export restrictions across the semiconductor sector could affect earnings for several months. The restrictions are planned, not completed.';
const candidate={id:hash('https://investor.nvidia.com/test'),title:'NVIDIA warns of export restrictions',body,url:'https://investor.nvidia.com/test',publishedAt:'2026-10-12T20:00:00Z',source:'official'};
const generated={publishable:true,facts:{scope:'sector',duration:'months',impact:'possible'},evidence:{scope:'across the semiconductor sector',duration:'for several months',impact:'could affect earnings'},ja:{title:'NVIDIAが輸出規制の影響を警告',source:'NVIDIAの公式発表',content:'半導体業界への輸出規制が業績に影響する可能性があるとしています。',duration:'数か月'},en:{title:'NVIDIA warns of export restrictions',source:'NVIDIA announcement',content:'Planned export restrictions could affect earnings across the semiconductor sector.',duration:'Several months'}};
const article=validateGeneration(generated,candidate);
test('risk rubric is bounded, deterministic and rejects unknowns; high rating is a rule review, never a trade',()=>{assert.equal(article.stars,3);assert.equal(riskStars({source:'sns',scope:'company',duration:'days',impact:'opinion'}),1);assert.equal(riskStars({source:'official',scope:'market',duration:'years',impact:'confirmed'}),5);assert.equal(riskAction(4),'review');assert.equal(riskAction(3),'none');assert.throws(()=>riskStars({source:'official',scope:'unknown',duration:'years',impact:'confirmed'}));assert.throws(()=>riskAction(0));assert.throws(()=>parseRiskFeed({state:'ready',date:'2026-10-13',articles:[{...article,stars:5}],quotes:[]}));});
test('JST weekday publication boundary handles Monday before 7, weekends, and Friday after 7',()=>{assert.equal(latestRiskDate(new Date('2026-10-11T21:59:00Z')),'2026-10-09');assert.equal(latestRiskDate(new Date('2026-10-11T22:00:00Z')),'2026-10-12');assert.equal(latestRiskDate(new Date('2026-10-10T12:00:00Z')),'2026-10-09');});
test('unsupported duration, evidence and new numbers suppress generated copy',()=>{assert.equal(validateGeneration({...generated,facts:{...generated.facts,duration:'unknown'}},candidate),null);assert.equal(validateGeneration({...generated,evidence:{...generated.evidence,impact:'fabricated claim'}},candidate),null);assert.equal(validateGeneration({...generated,en:{...generated.en,content:'Profit falls 99%.'}},candidate),null);});
test('collector excludes stale, partial, positive-only and headline-only items and canonicalizes duplicates',()=>{const a={...candidate,bodyEn:body,bodyJa:'半導体の輸出規制で業績に影響する可能性があると警告しました。'};const feed={ok:true,enabled:true,items:[],officialUpdates:[a,{...a,url:a.url+'?utm_source=test'},{...a,id:'partial',brief:{}},{...a,publishedAt:'2020-01-01',url:a.url+'/old'},{...a,bodyEn:null,bodyJa:null,url:a.url+'/title'}]};const result=candidatesFromFeed(feed,now);assert.equal(result.length,1);assert.equal(result[0].source,'official');assert.equal(candidatesFromFeed({...feed,enabled:false},now).length,1);});
test('risk store enforces notification ownership, owner identity, publication stop, hidden stories, daily claims and scoped SQL',async()=>{
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const dump=await boot.dumpDataDir();await boot.close();const db=new PGlite({database:'resolute',loadDataDir:dump});const pool={async query(sql,args){const r=await db.query(sql,args);return{...r,rowCount:r.rows.length||r.affectedRows};}};
 const before=process.env.RESOLUTE_RISK_PUBLISH_APPROVED;process.env.RESOLUTE_RISK_PUBLISH_APPROVED='true';
 try{for(const f of ['001_entitlements.sql','009_risk.sql'])await db.exec(readFileSync(new URL('../db/resolute/'+f,import.meta.url),'utf8'));
 const req=(path,method='GET',value)=>new Request('https://service.test/internal/v1/risk'+path,{method,headers:{'Content-Type':'application/json'},...(value?{body:JSON.stringify(value)}:{})});
 assert.equal((await riskRequest(req(''),'user_paid',async()=>({canReceiveNotifications:false}),pool)).status,403);
 assert.equal((await riskRequest(req('/owner'),'user_other',async()=>({canReceiveNotifications:true}),pool)).status,403);
 assert.equal((await publicRiskFeed(pool,false,now)).state,'stopped');
 await db.exec('UPDATE resolute.risk_control SET enabled=true WHERE id');assert.equal((await publicRiskFeed(pool,false,now)).state,'failed');
 await collect(pool,{ok:true,enabled:true,items:[],officialUpdates:[{...candidate,bodyEn:body}]},now);
 let calls=0;const model=async()=>{calls++;return article;};assert.equal(await publish(pool,now,model),'ready');assert.equal(await publish(pool,now,model),'already-claimed');assert.equal(calls,1);
 assert.equal((await publicRiskFeed(pool,false,now)).articles.length,1);
 const hidden=await riskRequest(req('/owner','POST',{action:'hide',id:article.id}),OWNER_ACCOUNT_ID,async()=>({}),pool);assert.equal(hidden.status,200);assert.equal((await publicRiskFeed(pool,false,now)).state,'stopped');
 await db.exec('SET ROLE resolute_risk_writer');await assert.rejects(()=>db.query('UPDATE resolute.entitlements SET revoked_at=now()'),e=>e.code==='42501');await db.exec('RESET ROLE');
 const next=new Date('2026-10-13T22:00:00Z');await assert.rejects(()=>publish(pool,next,model),/RISK_JOB_FAILED/);assert.equal((await publicRiskFeed(pool,false,next)).state,'failed');
 }finally{if(before===undefined)delete process.env.RESOLUTE_RISK_PUBLISH_APPROVED;else process.env.RESOLUTE_RISK_PUBLISH_APPROVED=before;await db.close();}
});

test('official lane survives disabled general news without admitting disabled items or inventing dates',()=>{
 const a={...candidate,bodyEn:body};
 assert.equal(candidatesFromFeed({ok:true,enabled:false,items:[a],officialUpdates:[]},now).length,0);
 assert.equal(candidatesFromFeed({ok:true,enabled:false,items:[],officialUpdates:[{...a,publishedAt:undefined,publishedOn:'2026-10-12'}]},now).length,0);
 for(const feed of [
  {ok:false,enabled:false,items:[],officialUpdates:[a]},
  {ok:true,enabled:false,items:[]},
  {ok:true,enabled:false,items:[],officialUpdates:{}},
  {ok:true,enabled:'false',items:[],officialUpdates:[a]}
 ])assert.throws(()=>candidatesFromFeed(feed,now));
});

test('private date-only intake preserves dates and conservatively rejects future, stale and invalid dates',()=>{
 const item={...candidate,publishedAt:undefined,publishedOn:'2026-10-11',bodyEn:body};
 const feed=(a)=>({ok:true,enabled:false,items:[],officialUpdates:[a]});
 assert.equal(candidatesFromFeed(feed(item),now).length,0);
 const selected=candidatesFromFeed(feed(item),now,{allowDateOnly:true});
 assert.equal(selected.length,1);assert.equal(selected[0].publishedAt,'2026-10-11');
 assert.equal(validateGeneration(generated,selected[0]).publishedAt,'2026-10-11');
 for(const date of ['2026-10-13','2026-10-01','2026-02-30','not-a-date'])
  assert.equal(candidatesFromFeed(feed({...item,publishedOn:date}),now,{allowDateOnly:true}).length,0);
 assert.equal(candidatesFromFeed(feed({...item,publishedAt:'invalid'}),now,{allowDateOnly:true}).length,0);
});

test('positive announcements are not risk candidates solely because their body mentions a risk',()=>{
 const feed={ok:true,enabled:true,items:[{...candidate,title:'NVIDIA expands partnership for safe automated driving',bodyEn:body}]};
 assert.deepEqual(candidatesFromFeed(feed,now),[]);
});
