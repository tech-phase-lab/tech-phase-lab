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
 assert.equal(quoteFreshness(quote(6),now),'stale');
});
test('a pre-market / after-hours print keeps its session label while that session lasts the same day, however old (owner, Nov 25: MRVL, GOOGL)',()=>{
 const post=Date.parse('2026-11-25T00:50:00Z'), pre=Date.parse('2026-11-18T14:20:00Z');
 const at=(t,minutes,session)=>({asOf:new Date(t-minutes*60_000).toISOString(),session,delayed:false});
 assert.equal(quoteFreshness(at(post,6,'post'),post),'recent');
 assert.equal(quoteFreshness(at(post,187,'post'),post),'recent');
 assert.equal(quoteFreshness(at(pre,300,'pre'),pre),'recent');
 assert.equal(quoteFreshness(at(pre,6,'post'),pre),'stale', 'not the session under way');
 assert.equal(quoteFreshness(at(post,26*60,'post'),post),'stale', "yesterday's");
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
test('old quotes include the JST date (ET date in English), including across UTC date boundaries',()=>{
 const beforeJstMidnight='2026-10-09T14:59:00Z';
 assert.match(quoteTimeText(beforeJstMidnight,now,'ja'),/10\/9/);
 assert.equal(quoteTimeText('2026-10-09T15:00:00Z',now,'ja'),'00:00 JST');
 assert.match(quoteTimeText('2025-10-09T14:59:00Z',now,'ja'),/2025/);
 assert.equal(quoteTimeText('invalid',now,'ja'),'—');
 // English (owner, Nov 17): `now` is 11:00 EDT on Oct 9 in New York, so a quote from earlier that day shows only its time.
 assert.equal(quoteTimeText(beforeJstMidnight,now,'en'),'10:59 ET');
 assert.equal(quoteTimeText('2026-10-09T03:59:00Z',now,'en'),'Oct 8 23:59 ET');
 assert.equal(quoteTimeText('2026-12-09T03:59:00Z',Date.parse('2026-12-09T15:00:00Z'),'en'),'Dec 8 22:59 ET', 'EST in December');
 assert.equal(freshnessLabel('stale','en'),'Last available');
});
