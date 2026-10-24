import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {watchEarningsPayload} from '../lib/research/watch-earnings.ts';
const copy={ja:'売上',en:'Revenue'};
const at='2026-10-05T00:00:00Z';
const raw={ok:true,status:'ready',snapshot:{revision:'a'.repeat(64),ticker:'MU',period:'FQ4 2026',periodOrder:8108,releasedOn:'2026-09-30',sourceUrl:'https://investors.micron.com/results',publishedAt:null,detectedAt:at,bodyReadyAt:at,preparedAt:at,publicAt:at,processingMs:0.2,sourceToDetectionMs:null,detectionToPublicMs:0,method:'deterministic-issuer-numbers',evidence:['PRIVATE RAW TEXT'],metrics:{secret:'private'},tiles:Array.from({length:3},()=>({label:copy,value:copy,note:copy})),cards:Array.from({length:4},()=>({title:copy,headline:{ja:'有料解説',en:'Paid insight'},points:[copy],detail:copy,sourceSection:'Quarterly highlights'}))}};
test('watch API strips paid analysis for free, expired, unavailable and spoofed membership',()=>{
 for(const m of [{status:'signed-out',plan:'pro',accessExpiresAt:200},{status:'signed-in',plan:'free',accessExpiresAt:200},{status:'unavailable',plan:'pro',accessExpiresAt:200},{status:'signed-in',plan:'pro',accessExpiresAt:100}]){
  const p=watchEarningsPayload(raw,m,100);assert.equal(p.snapshot.cards,null);assert.ok(!JSON.stringify(p).includes('Paid insight'));assert.ok(!JSON.stringify(p).includes('PRIVATE'));assert.ok(!JSON.stringify(p).includes('secret'));
 }
 const p=watchEarningsPayload(raw,{status:'signed-in',plan:'pro',accessExpiresAt:200},100);assert.equal(p.snapshot.cards.length,4);assert.equal(p.snapshot.publishedAt,null);assert.equal(p.snapshot.sourceToDetectionMs,null);
});
test('watch boundary rejects wrong company, source, quarter and clocks',()=>{
 for(const patch of [{ticker:'NVDA'},{sourceUrl:'https://evil.test/results'},{sourceUrl:'https://x@investors.micron.com/results'},{periodOrder:8109},{detectedAt:'2026-10-05'},{processingMs:-1},{method:'llm'}])assert.throws(()=>watchEarningsPayload({...raw,snapshot:{...raw.snapshot,...patch}},{status:'signed-out',plan:'free'}));
 assert.equal(watchEarningsPayload({ok:true,status:'waiting',snapshot:null},{status:'signed-out',plan:'free'}).snapshot,null);
});

test('watch API receives Clerk identity through the shared proxy',()=>{
 const proxy=readFileSync(new URL('../proxy.ts',import.meta.url),'utf8');
 assert.match(proxy, /"\/api\/research\/watch-earnings"/);
});
