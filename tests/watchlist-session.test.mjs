import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteForSession } from '../lib/research/watchlist-session.ts';
const q={ticker:'MU',price:100,change:2,percentChange:2.04,currency:'USD',asOf:'2026-10-07T20:00:00Z',session:'closed',source:'twelve-data',delayed:false,history:[{at:'2026-10-07T19:59:00Z',price:99},{at:'2026-10-07T20:00:00Z',price:100}]};
test('missing sessions remain missing rather than borrowing another session price',()=>{
 assert.equal(quoteForSession(undefined,'MU','regular'),null);
 assert.equal(quoteForSession(q,'MU','regular'),null);
 assert.equal(quoteForSession(q,'MU','pre'),null);
 assert.equal(quoteForSession(q,'MU','closed'),q);
 assert.equal(quoteForSession(q,'MU','auto'),q);
});
test('pre-market uses only its own observed snapshot and never the regular chart',()=>{
 const extended={price:101,percentChange:1,asOf:'2026-10-08T12:00:00Z',session:'pre'};
 const pre=quoteForSession({...q,extended},'MU','pre');
 assert.equal(pre.price,101);assert.equal(pre.asOf,extended.asOf);assert.equal(pre.history,undefined);assert.equal(pre.change,null);
 assert.equal(quoteForSession({...q,extended:{...extended,price:NaN}},'MU','pre'),null);
 assert.equal(quoteForSession({...q,extended:{...extended,session:'post'}},'MU','pre'),null);
});
