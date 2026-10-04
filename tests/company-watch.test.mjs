import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {companyWatches,companyWatchForMember,watchMetricValue} from '../lib/research/company-watch.ts';
const pro={status:'signed-in',plan:'pro',accessExpiresAt:200};
test('every non-MU monitored company has its own complete bilingual earnings page',()=>{
 const providers=JSON.parse(fs.readFileSync(new URL('../lib/research/providers.json',import.meta.url)));
 assert.deepEqual(companyWatches.map(x=>x.ticker).sort(),providers.map(x=>x.ticker).filter(x=>x!=='MU').sort());
 assert.equal(new Set(companyWatches.map(x=>x.ticker)).size,21);
 for(const x of companyWatches){
  assert.equal(x.cards.length,4,x.ticker);assert.equal(x.tiles.length,3,x.ticker);
  assert.ok(x.releasedOn<=x.reviewedOn,x.ticker);if(x.periodEnd)assert.ok(x.periodEnd<=x.releasedOn,x.ticker);
  for(const c of x.cards){for(const p of [c.title,c.headline,c.detail,...c.points])assert.ok(p.ja.length&&p.en.length,x.ticker);}
  assert.ok(x.sources.every(s=>s.url.startsWith('https://')),x.ticker);
 }
});
test('paid insights never enter free, signed-out, unavailable or expired payloads across all 21 companies',()=>{
 for(const x of companyWatches){
  for(const m of [{...pro,plan:'free'},{...pro,status:'signed-out'},{...pro,status:'unavailable'},{...pro,accessExpiresAt:100},{...pro,accessExpiresAt:undefined}]){
   const payload=companyWatchForMember(x.ticker,m,100);assert.equal(payload.cards,null);
   assert.ok(!JSON.stringify(payload).includes(x.cards[2].detail.en));
  }
  assert.equal(companyWatchForMember(x.ticker,pro,100).cards.length,4);
 }
 assert.equal(companyWatchForMember('INVALID',pro,100),null);
});
test('currency, signs, accounting basis and non-US quote identifiers stay distinct',()=>{
 assert.equal(watchMetricValue(9.326,'eur-billion').ja,'93.26億ユーロ');
 assert.equal(watchMetricValue(79.3187,'krw-trillion').en,'₩79.319T');
 assert.equal(watchMetricValue(-2,'percent').ja,'-2%');
 const by=Object.fromEntries(companyWatches.map(x=>[x.ticker,x]));
 assert.equal(by.SKHY.exchange,'KRX');assert.equal(by.SKHY.quoteTicker,'000660');
 assert.equal(by.PLTR.exchange,'NASDAQ');
 assert.equal(by.ORCL.tiles[2].value.en,'−$5B');assert.equal(by.ORCL.period,'Q1 FY2027');assert.equal(by.ORCL.periodEnd,'2026-08-31');
 assert.equal(by.DELL.periodEnd,'2026-07-31');assert.equal(by.DELL.releasedOn,'2026-09-01');
 assert.match(by.NBIS.tiles[2].label.en,/continuing operations/);
 assert.match(by.CRDO.cards[2].points.map(x=>x.en).join(' '),/-3.7 pp/);
 assert.match(by.SNDK.cards[2].points[0].en,/-32.2%/);
});
