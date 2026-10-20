import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {checkIntake} from '../services/resolute-api/rizel-intake-check.mjs';
const now=new Date('2026-10-20T00:00:00Z');
const article={title:'NVIDIA warned of export restrictions',bodyEn:'NVIDIA warned that export restrictions across the semiconductor sector could affect earnings for several months. The restrictions are planned, not completed.',url:'https://investor.nvidia.com/private-check',publishedAt:'2026-10-19T20:00:00Z'};
test('read-only diagnostic shares daily age, deduplication and limit rules without reporting source content',async()=>{
 let reads=0;
 const items=[article,{...article,url:article.url+'/duplicate'},...Array.from({length:4},(_,i)=>({...article,title:article.title+' '+i,url:article.url+'/'+i})),{...article,title:article.title+' old',url:article.url+'/old',publishedAt:'2026-10-14T00:00:00Z'}];
 const report=await checkIntake({now,readFeed:async()=>{reads++;return {ok:true,enabled:true,items};}});
 assert.equal(reads,1);assert.equal(report.candidateCount,3);assert.equal(report.state,'candidates-available');
 assert.equal(report.diagnostics.duplicateHeadline,1);assert.equal(report.diagnostics.outsideDailyWindow,1);assert.equal(report.diagnostics.overDailyLimit,2);
 assert.equal(report.aiCalls,0);assert.equal(report.writes,0);assert.equal(report.historicalReplay,false);
 for(const privateText of [article.title,article.bodyEn,article.url])assert.equal(JSON.stringify(report).includes(privateText),false);
 const empty=await checkIntake({now,readFeed:async()=>({ok:true,enabled:false,items:[article],officialUpdates:[]})});
 assert.equal(empty.state,'no-candidates');assert.equal(empty.candidateCount,0);
});
test('diagnostic rejects unavailable sources and CLI redacts configuration errors',async()=>{
 await assert.rejects(checkIntake({now,readFeed:async()=>({ok:false})}));
 for(const args of [[],['--read-only']]){
  const run=spawnSync(process.execPath,['--experimental-strip-types','services/resolute-api/rizel-intake-check.mjs',...args],{encoding:'utf8',env:{PATH:process.env.PATH,RESOLUTE_NEWS_ORIGIN:'https://secret:credential@example.test',RESOLUTE_NEWS_READ_TOKEN:'do-not-print-this-secret'}});
  assert.equal(run.status,1);assert.equal(run.stdout,'');assert.match(run.stderr,/RIZEL_INTAKE_CHECK_FAILED/);
  assert.doesNotMatch(run.stderr,/credential|do-not-print/);
 }
});
