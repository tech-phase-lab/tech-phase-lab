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

test('an old X post fetched again keeps its real posting time and leaves the top strip',async()=>{
  const { xPostedAt }=await import('../lib/research/news-time.ts');
  const { freshPulseItems }=await import('../lib/research/news-pulse-items.ts');
  // NBIS Platinum: posted Sep 23, resurfaced on Oct 8 with a fetch-time stamp.
  const url='https://x.com/nebiusai/status/2102879043238396244';
  assert.equal(new Date(xPostedAt(url)).toISOString(),'2026-09-23T21:53:28.168Z');
  const refetched={...update,url,publishedAt:'2026-10-08T16:20:00.000Z',observedAt:'2026-10-08T16:20:00.000Z'};
  assert.deepEqual(officialTime(refetched),{at:'2026-09-23T21:53:28.168Z',kind:'published'});
  assert.equal(officialTime({...update,url,publishedAt:'2026-09-23T21:53:30.000Z'}).at,'2026-09-23T21:53:30.000Z');
  assert.equal(xPostedAt('https://x.com/nebiusai/status/1'),null);
  const now=Date.parse('2026-10-08T16:30:00Z');
  const rows=[{id:'old',...officialTime(refetched)},{id:'seen',at:'2026-10-08T16:00:00Z',kind:'observed'},
    {id:'new',at:'2026-10-08T12:00:00Z',kind:'published'},{id:'day',at:'2026-10-06',kind:'date'},{id:'stale',at:'2026-10-05T10:00:00Z',kind:'published'}];
  assert.deepEqual(freshPulseItems(rows,now).map(row=>row.id),['new','day']);
});

test('dates stay the real release date and late finds are never NEW',async()=>{
  const { clockTime, lateDetection, NEWS_MAX_AGE_MS }=await import('../lib/research/news-time.ts');
  // A date-only release seen the next U.S. day keeps its own date, not the fetch time.
  assert.deepEqual(clockTime('2026-10-06','date','2026-10-07T13:00:00Z'),{at:'2026-10-06',kind:'date'});
  assert.deepEqual(clockTime('2026-10-06','date','2026-10-06T13:00:00Z'),{at:'2026-10-06T13:00:00Z',kind:'observed'});
  assert.equal(lateDetection('2026-10-08T12:00:00Z','2026-10-08T12:20:00Z'),false);
  assert.equal(lateDetection('2026-10-08T12:00:00Z','2026-10-08T12:45:00Z'),true);
  assert.equal(lateDetection('2026-10-08T12:00:00Z'),false);
  assert.equal(NEWS_MAX_AGE_MS,72*3_600_000);
  const { alertItems }=await import('../lib/research/alert-items.ts');
  const now=Date.parse('2026-10-08T12:00:00Z');
  const feed={marketUpdates:[{id:'new',titleJa:'新',publishedAt:'2026-10-07T12:00:00Z'},{id:'old',titleJa:'古',publishedAt:'2026-10-05T11:00:00Z'}]};
  assert.deepEqual(alertItems(feed,now).map(item=>item.id),['market:new']);
});
