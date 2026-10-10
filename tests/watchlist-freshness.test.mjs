import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteFreshness, quoteTimeText, freshnessLabel } from '../lib/research/watchlist-freshness.ts';
const now = Date.parse('2026-10-09T15:00:00Z');
const quote = (minutes, extra={}) => ({asOf:new Date(now-minutes*60_000).toISOString(),session:'regular',delayed:false,...extra});
test('live snapshots age out in an open tab and recover when replaced',()=>{
 const q=quote(4);
 assert.equal(quoteFreshness(q,now),'recent');
 assert.equal(quoteFreshness(q,now+120_000),'stale');
 assert.equal(quoteFreshness(quote(0),now+120_000),'recent');
 for(const session of ['regular','pre','post']) assert.equal(quoteFreshness(quote(6,{session}),now),'stale');
});
test('delayed feed has a separate tolerance; dated closes survive holidays',()=>{
 assert.equal(quoteFreshness(quote(15,{delayed:true}),now),'delayed');
 assert.equal(quoteFreshness(quote(21,{delayed:true}),now),'stale');
 assert.equal(quoteFreshness(quote(60*24*4,{session:'closed'}),now),'closed');
});
test('invalid or future timestamps never claim freshness; hydration is unknown',()=>{
 assert.equal(quoteFreshness(quote(-2),now),'invalid');
 assert.equal(quoteFreshness({...quote(0),asOf:'bad'},now),'invalid');
 assert.equal(quoteFreshness(quote(0),null),'unknown');
});
test('old quotes include the JST date, including across UTC date boundaries',()=>{
 const beforeJstMidnight='2026-10-09T14:59:00Z';
 assert.match(quoteTimeText(beforeJstMidnight,now),/10\/9/);
 assert.equal(quoteTimeText('2026-10-09T15:00:00Z',now),'00:00 JST');
 assert.match(quoteTimeText(beforeJstMidnight,now,'en'),/Oct 9/);
 assert.match(quoteTimeText('2025-10-09T14:59:00Z',now),/2025/);
 assert.equal(quoteTimeText('invalid',now),'—');
 assert.equal(freshnessLabel('stale','en'),'Last available');
});
