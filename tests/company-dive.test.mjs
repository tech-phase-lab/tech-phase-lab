import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadCompanyDive,DIVES_DIR} from '../lib/research/company-dive-loader.ts';
import {DIVE_TICKERS,validateCompanyDive,companyDiveForMember} from '../lib/research/company-dive.ts';
import {diveMoney,divePerShare,diveScaled,diveUnit} from '../lib/research/dive-money.ts';
import {newerReport,knownReports} from '../lib/research/dive-staleness.ts';
import {companyWatchForMember} from '../lib/research/company-watch.ts';
import {OWNER_ACCOUNT_ID,PRODUCTION_OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';

const FIXTURES=new URL('./fixtures/dives/',import.meta.url).pathname;
const read=ticker=>JSON.parse(fs.readFileSync(path.join(FIXTURES,`${ticker}.json`),'utf8'));
const quiet={log:()=>{}};
/** A temporary dives folder holding `files` ({TICKER: object or raw text}). */
function folder(files){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dives-'));
 for(const [ticker,body] of Object.entries(files))fs.writeFileSync(path.join(dir,`${ticker}.json`),typeof body==='string'?body:JSON.stringify(body));
 return dir;
}

test('the loader reads one fixture per currency through parseDive and the strict rules',()=>{
 for(const [ticker,currency] of [['NBIS','USD'],['ASML','EUR'],['TSM','TWD'],['SKHY','KRW']]){
  const dive=loadCompanyDive(ticker,{dir:FIXTURES,...quiet});
  assert.ok(dive,ticker);assert.equal(dive.currency,currency);assert.equal(dive.ticker,ticker);
  assert.deepEqual(Object.keys(dive.summary.cards).sort(),['caution','change','growth','next']);
  assert.ok(dive.history.length>=4);assert.equal(dive.tiles.length,3);
 }
});

test('a missing file is silent; a broken file is dropped for that ticker only and the log names it',()=>{
 const broken=read('NBIS');delete broken.summary.cards.caution;
 const noEvidence=read('ASML');noEvidence.evidence=noEvidence.evidence.filter(e=>e.field!=='history[2].value');
 const wrongTicker=read('TSM');
 const dir=folder({NBIS:broken,ASML:noEvidence,SKHY:read('SKHY'),TSM:{...wrongTicker,ticker:'NVDA'},NVDA:'{not json'});
 const logs=[];const log=m=>logs.push(m);
 assert.equal(loadCompanyDive('NBIS',{dir,log}),null);
 assert.equal(loadCompanyDive('ASML',{dir,log}),null);
 assert.equal(loadCompanyDive('TSM',{dir,log}),null);
 assert.equal(loadCompanyDive('NVDA',{dir,log}),null);
 assert.ok(loadCompanyDive('SKHY',{dir,log}),'a good file next to broken ones still loads');
 assert.equal(loadCompanyDive('AMD',{dir,log}),null);
 assert.equal(loadCompanyDive('MU',{dir,log}),null,'MU keeps its live monitor dive');
 assert.equal(logs.length,4);
 assert.match(logs[0],/^\[company-dive\] NBIS: dropped.*card caution is missing/);
 assert.match(logs[1],/^\[company-dive\] ASML: dropped.*no evidence for history\.2\.value/);
 assert.match(logs[2],/^\[company-dive\] TSM: dropped.*does not match/);
 assert.match(logs[3],/^\[company-dive\] NVDA: dropped/);
 // The ticker whose file failed falls back to the legacy view, which still exists for every dive ticker.
 for(const ticker of DIVE_TICKERS)assert.ok(companyWatchForMember(ticker,{status:'signed-in',plan:'pro',accessExpiresAt:200},100),ticker);
});

test('the strict rules reject what parseDive alone would let through',()=>{
 const bad=(mutate,pattern)=>{const d=read('NBIS');mutate(d);assert.throws(()=>validateCompanyDive(d,'NBIS'),pattern);};
 bad(d=>{d.numbers.guidance.low=null;},/guidance\.low/);
 bad(d=>{d.history.reverse();},/oldest first/);
 bad(d=>{d.history=d.history.slice(0,3);},/4-12 earlier quarters/);
 bad(d=>{d.summary.cards.next.chips=[];},/1-3 chips/);
 bad(d=>{d.summary.cards.next.sections=d.summary.cards.next.sections.slice(0,2);},/3-4 sections/);
 bad(d=>{d.currency='JPY';},/currency/);
 bad(d=>{d.periodQuarter=5;},/periodQuarter/);
 bad(d=>{d.releasedOn='2026-09-01';},/dates must run/);
 bad(d=>{d.sources[0].url='http://example.com/x';},/https/);
 bad(d=>{d.tiles=[{label:{ja:'売上高',en:''},value:{ja:'1',en:'1'},note:{ja:'1',en:'1'}}];},/tiles\[0\]\.label\.en/);
 bad(d=>{d.summary.cards.growth.segment='nope';},/unknown segment/);
});

test('every committed dive file passes the check, matches its ticker and is not older than a release the site knew when it was reviewed',()=>{
 const files=fs.existsSync(DIVES_DIR)?fs.readdirSync(DIVES_DIR).filter(f=>f.endsWith('.json')):[];
 for(const file of files){
  const ticker=file.replace(/\.json$/,'');
  assert.ok(DIVE_TICKERS.includes(ticker),`${file} is not one of the 21 dive tickers`);
  const dive=validateCompanyDive(JSON.parse(fs.readFileSync(path.join(DIVES_DIR,file),'utf8')),ticker);
  const stale=newerReport(ticker,dive.releasedOn,Date.parse(`${dive.reviewedOn}T23:59:59Z`));
  assert.equal(stale,null,`${ticker} shows ${dive.period} (${dive.releasedOn}) but ${stale?.period??'a newer release'} came out on ${stale?.on}`);
 }
});

test('PRO gate: the deep dive is left out on the server for everyone but PRO and the owner accounts',()=>{
 const dive=loadCompanyDive('TSM',{dir:FIXTURES,...quiet});
 const secret=dive.summary.cards.caution.sections[2].text.ja;
 const pro={status:'signed-in',plan:'pro',accessExpiresAt:200,userId:'user_member'};
 for(const member of [{...pro,plan:'free'},{...pro,status:'signed-out'},{...pro,status:'unavailable'},{...pro,accessExpiresAt:100},{...pro,accessExpiresAt:undefined},{...pro,plan:'free',userId:null}]){
  const view=companyDiveForMember(dive,member,100);
  assert.equal(view.dive,null);
  const json=JSON.stringify(view);
  assert.ok(!json.includes(secret));assert.ok(!json.includes('"evidence"'));assert.ok(!json.includes('"history"'));
  assert.equal(view.period,'Q3 2026');assert.equal(view.tiles.length,3,'the top tiles are the same facts the legacy page shows to everyone');
 }
 assert.ok(JSON.stringify(companyDiveForMember(dive,pro,100)).includes(secret));
 // Owner accounts see everything in every environment, also while trying the app as FREE or after a lapsed plan.
 for(const userId of [OWNER_ACCOUNT_ID,PRODUCTION_OWNER_ACCOUNT_ID]){
  for(const member of [{status:'signed-in',plan:'free',userId},{status:'signed-in',plan:'pro',accessExpiresAt:1,userId}]){
   const view=companyDiveForMember(dive,member,100);
   assert.ok(view.dive,userId);assert.ok(JSON.stringify(view).includes(secret));
  }
  assert.equal(companyDiveForMember(dive,{status:'signed-out',plan:'free',userId},100).dive,null,'a signed-out session is never the owner');
 }
});

test('non-USD fixtures: TWD (TSM), EUR (ASML) and KRW (SKHY) keep their own currency and units',()=>{
 const tsm=loadCompanyDive('TSM',{dir:FIXTURES,...quiet});
 assert.equal(tsm.currency,'TWD');assert.equal(tsm.period,'Q3 2026');assert.equal(tsm.periodQuarter,3);
 assert.equal(tsm.tiles[0].value.ja,'10,460.9億台湾ドル');assert.equal(tsm.tiles[0].value.en,'NT$1,046.09B');
 assert.equal(diveUnit('TWD','ja'),'億台湾ドル');assert.equal(diveUnit('TWD','en'),'NT$B');
 assert.equal(divePerShare(tsm.numbers.adjustedEPS,'TWD','ja'),'17.45台湾ドル');
 const asml=loadCompanyDive('ASML',{dir:FIXTURES,...quiet});
 assert.equal(asml.tiles[0].value.ja,'93.26億ユーロ');assert.equal(asml.tiles[0].value.en,'€9.33B');
 assert.equal(asml.tiles[2].value.ja,'92〜98億ユーロ');assert.equal(asml.tiles[2].value.en,'€9.20B–€9.80B');
 const skhy=loadCompanyDive('SKHY',{dir:FIXTURES,...quiet});
 assert.equal(skhy.tiles[0].value.ja,'24.45兆ウォン','the file\'s own tiles are used as given');
 assert.equal(diveMoney(skhy.numbers.revenue.current,'KRW','ja'),'24.45兆ウォン');assert.equal(diveMoney(skhy.numbers.revenue.current,'KRW','en'),'₩24.45T');
 assert.equal(divePerShare(15782,'KRW','ja'),'15,782ウォン');assert.equal(diveScaled(22232000,'KRW','en'),'22.23');
 // The same units as the legacy figures (company-watch.ts watchMetricValue).
 assert.equal(diveMoney(9326,'EUR','ja'),'93.26億ユーロ');
 // USD keeps MU's style; small issuers read in millions in English.
 assert.equal(diveMoney(11315,'USD','ja'),'113.15億ドル');assert.equal(diveMoney(11320,'USD','en'),'$11.32B');
 assert.equal(diveMoney(582.3,'USD','en'),'$582.3M');assert.equal(diveMoney(-21,'USD','ja'),'−0.21億ドル');
 const nbis=loadCompanyDive('NBIS',{dir:FIXTURES,...quiet});
 assert.equal(nbis.tiles[2].value.ja,'14〜15.5億ドル');
});

test('staleness: a release the calendar or the SEC results data already knows is never shown as 直近',()=>{
 const reports=[{ticker:'NBIS',on:'2026-11-12',at:Date.parse('2026-11-12T14:22:11Z'),period:'Q3 2026',source:'sec-backfill'},{ticker:'NBIS',on:'2026-11-12',at:Date.parse('2026-11-12T13:00:00Z'),period:null,source:'calendar'},{ticker:'NBIS',on:'2027-02-18',at:Date.parse('2027-02-18T13:00:00Z'),period:null,source:'calendar'}];
 const now=Date.parse('2026-11-25T00:00:00Z');
 assert.deepEqual(newerReport('NBIS','2026-08-12',now,reports),{on:'2026-11-12',period:'Q3 2026',source:'sec-backfill'});
 assert.equal(newerReport('NBIS','2026-11-12',now,reports),null,'the same release');
 assert.equal(newerReport('NBIS','2026-11-10',now,reports),null,'within a week (time zones, call vs. release)');
 assert.equal(newerReport('NBIS','2026-11-12',Date.parse('2027-03-01T00:00:00Z'),reports).on,'2027-02-18');
 assert.equal(newerReport('NBIS','2026-11-12',Date.parse('2027-02-17T00:00:00Z'),reports),null,'a scheduled release that has not happened yet');
 // The real data: the committed calendar and SEC backfill know NBIS's November release, so the August legacy quarter is not 直近.
 assert.ok(knownReports().some(r=>r.ticker==='NBIS'&&r.source==='sec-backfill'));
 assert.equal(newerReport('NBIS','2026-08-12',now).on,'2026-11-12');
 assert.equal(newerReport('NVDA','2026-08-27',now).period,'Q3 FY2027');
});

test('the company page reads the dive file first, keeps the legacy view as the fallback and labels an old quarter',()=>{
 const page=fs.readFileSync(new URL('../app/research/companies/[ticker]/page.tsx',import.meta.url),'utf8');
 assert.match(page,/loadCompanyDive\(ticker\)/);assert.match(page,/companyDiveForMember\(file, verified\)/);
 assert.match(page,/const watch = dive \? null : companyWatchForMember/);assert.match(page,/newerReport\(ticker, shown\.releasedOn\)/);
 const view=fs.readFileSync(new URL('../app/research/companies/company-watch.tsx',import.meta.url),'utf8');
 assert.match(view,/'前回の決算'/);assert.match(view,/<EarningsDive /);
 const config=fs.readFileSync(new URL('../next.config.ts',import.meta.url),'utf8');
 assert.match(config,/lib\/research\/dives\/\*\.json/);
});
