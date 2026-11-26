import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ANONYMOUS_PER_MINUTE,SITE_TICKERS,clientAddress,createAddressLimiter,tickerAllowed} from '../lib/research/market-guard.ts';

// Owner, Nov 26: the public price APIs must not let visitors make Twelve Data read any symbol at any rate (a stock's facts cost 70 credits
// for a company nobody opened). Known symbols and a per-address limit for visitors; members keep their watchlists; the owner everything.
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const SEC=new Set(['AAPL','BRK-B','SPY']);

test('ticker allowlist: visitors and costly reads known symbols only; members any symbol for one-credit reads; the owner everything',()=>{
 // Visitors: the SEC list and the site's own lists, nothing else.
 assert.equal(tickerAllowed('AAPL','anonymous','light',SEC),true);
 assert.equal(tickerAllowed('BRK.B','anonymous','light',SEC),true,'a share class written with a dot');
 assert.equal(tickerAllowed('NVDA','anonymous','heavy',null),true,'the site\'s own companies without the SEC list');
 assert.equal(tickerAllowed('SOXL','anonymous','light',null),true,'leveraged ETFs');
 for(const t of ['DJI','NDX','SPX'])assert.equal(tickerAllowed(t,'anonymous','light',null),true,t);
 // Trust-series ETFs the SEC company list does not name one by one.
 for(const t of ['VOO','IWM','TLT','QQQ','SCHD','TQQQ','IBIT'])assert.equal(tickerAllowed(t,'anonymous','light',null),true,t);
 assert.equal(tickerAllowed('ZZZQX','anonymous','light',SEC),false);
 assert.equal(tickerAllowed('ZZZQX','anonymous','heavy',SEC),false);
 assert.equal(tickerAllowed('USD/JPY','anonymous','light',null,t=>t==='USD/JPY'),true,'the route\'s own board symbols');
 // Members: any symbol for quotes, charts and closes; facts and consensus only for known ones.
 assert.equal(tickerAllowed('ZZZQX','member','light',null),true);
 assert.equal(tickerAllowed('ZZZQX','member','heavy',SEC),false);
 assert.equal(tickerAllowed('AAPL','member','heavy',SEC),true);
 // The owner's accounts: every symbol, every read, whatever the lists.
 assert.equal(tickerAllowed('ZZZQX','owner','heavy',null),true);
 assert.equal(tickerAllowed('ZZZQX','owner','light',null),true);
 // Every index page symbol and every site list is covered.
 const page=read('app/research/market/index/[id]/page.tsx');
 for(const [,symbol] of page.matchAll(/symbol: "([A-Z]+)"/g))assert.ok(SITE_TICKERS.has(symbol),symbol);
 assert.ok(SITE_TICKERS.size>500);
});

test('rate limit: per address and per minute for visitors, heavy reads tighter, an address never blocks another',()=>{
 let t=Date.parse('2026-11-26T00:00:00Z');
 const allow=createAddressLimiter(ANONYMOUS_PER_MINUTE,()=>t);
 for(let i=0;i<ANONYMOUS_PER_MINUTE.light;i++){assert.equal(allow('203.0.113.5','light'),true);t+=100;}
 assert.equal(allow('203.0.113.5','light'),false);
 assert.equal(allow('203.0.113.6','light'),true,'another address');
 for(let i=0;i<ANONYMOUS_PER_MINUTE.heavy;i++)assert.equal(allow('203.0.113.5','heavy'),true);
 assert.equal(allow('203.0.113.5','heavy'),false);
 t+=60_000;assert.equal(allow('203.0.113.5','light'),true,'a minute later');assert.equal(allow('203.0.113.5','heavy'),true);
 // A watchlist polled every 15 seconds with a stock page open (quotes 4, chart 1, closes 1, facts 1 a minute) stays far below.
 // Many people behind one shared mobile address still fit.
 assert.equal(ANONYMOUS_PER_MINUTE.light,300);assert.ok(ANONYMOUS_PER_MINUTE.heavy>=5);
 assert.equal(clientAddress(new Headers({'x-forwarded-for':'198.51.100.7, 10.0.0.1'})),'198.51.100.7');
 assert.equal(clientAddress(new Headers({'x-vercel-forwarded-for':'2001:db8::1'})),'2001:db8::1');
 assert.equal(clientAddress(new Headers({'x-forwarded-for':'<script>'})),'unknown');
});

test('each public price route asks who is calling before it reads, and an answer with symbols left out is never cached',()=>{
 for(const [route,cost] of [['market/quotes','light'],['market/chart','light'],['market/period-bases','light'],['market/facts','heavy'],['earnings-consensus','heavy']]){
  const src=read(`app/api/research/${route}/route.ts`);
  assert.match(src,new RegExp(`marketAccess\\(request, "${cost}"`),route);
  assert.match(src,/if \(access instanceof Response\) return access;/,route);
  // The check comes before any provider read.
  const check=src.indexOf('marketAccess(request'),load=src.search(/await load\w+\(|await loadEpsConsensus/);
  assert.ok(check>0&&check<load,route);
 }
 assert.match(read('app/api/research/market/quotes/route.ts'),/partial \? \{ "Cache-Control": "no-store" \}/);
 const access=read('lib/research/market-access.ts');
 assert.match(access,/isOwnerAccount\(userId\) \? "owner"/);
 assert.match(access,/status: 429/);
});
