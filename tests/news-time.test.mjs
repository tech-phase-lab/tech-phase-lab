import test from 'node:test';
import assert from 'node:assert/strict';
import { officialTime, recentPublication, shortNewsTime } from '../lib/research/news-time.ts';
import { publicNewsPayload } from '../lib/research/general-news.ts';
const update = {id:'1',title:'Example',url:'https://nebius.com/blog/example',publisher:'Nebius',tickers:['NBIS'],observedAt:'2026-09-29T08:00:00Z'};
const payload = value => publicNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[value]}).officialUpdates[0];
test('publication timestamps preserve source time and older feeds remain readable',()=>{
  assert.deepEqual(officialTime(payload(update)),{at:update.observedAt,kind:'observed'});
  const precise=payload({...update,publishedAt:'2026-09-29T16:02:00+09:00'});
  assert.equal(precise.publishedAt,'2026-09-29T07:02:00.000Z');
  assert.equal(shortNewsTime(precise.publishedAt,'published'),'9/29 16:02 JST');
  assert.equal(officialTime(payload({...update,publishedOn:'2026-09-28'})).kind,'date');
  assert.equal(shortNewsTime('2026-09-28','date'),'9/28');
  for(const value of ['2026-09-29','2026-09-29T12:00:00','invalid']) assert.throws(()=>payload({...update,publishedAt:value}));
  for(const value of ['2026-02-30','2026-09-29T00:00:00Z']) assert.throws(()=>payload({...update,publishedOn:value}));
});
test('NEW excludes rediscovered, date-only, future and expired stories',()=>{
  const now=Date.parse('2026-09-29T08:00:00Z');
  assert.equal(recentPublication('2026-09-29T07:30:00Z','published',now),true);
  for(const [at,kind] of [['2026-09-29T07:30:00Z','observed'],['2026-09-29','date'],['2026-09-29T07:00:00Z','published'],['2026-09-29T09:00:00Z','published'],['invalid','published']]) assert.equal(recentPublication(at,kind,now),false);
});

test('U.S. Eastern time follows daylight saving and is omitted for date-only items',async()=>{
  const { usEasternTime }=await import('../lib/research/news-time.ts');
  assert.equal(usEasternTime('2026-10-05T17:14:00Z','published'),'10/5 13:14 ET');
  assert.equal(usEasternTime('2026-12-05T17:14:00Z','published'),'12/5 12:14 ET');
  assert.equal(usEasternTime('2026-10-05','date'),null);
});
