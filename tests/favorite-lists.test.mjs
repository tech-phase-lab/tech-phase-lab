import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFavoriteLists, moveFavorite, usableFavoriteQuote } from '../lib/research/favorite-lists.ts';
test('lists preserve legacy favorites and named lists without mixing their membership', () => {
 const raw=JSON.stringify({lists:[{id:'default',name:'保有株',tickers:['OLD']},{id:'chips',name:'半導体',tickers:['MU','MU','NVDA']}],names:{MU:'Micron'}});
 const state=parseFavoriteLists(raw,'["AAPL","MSFT"]');
 assert.deepEqual(state.lists.map(x=>x.tickers),[['AAPL','MSFT'],['MU','NVDA']]);
 assert.equal(state.lists[0].name,'保有株');assert.equal(state.names.MU,'Micron');
 assert.deepEqual(parseFavoriteLists(raw,'["TSM"]').lists[0].tickers,['TSM']);
});
test('corrupt list data cannot discard legacy favorites or inject duplicate list identities',()=>{
 assert.deepEqual(parseFavoriteLists('bad','["MU"]').lists[0].tickers,['MU']);
 const state=parseFavoriteLists(JSON.stringify({lists:[{id:'x',name:'A',tickers:['MU']},{id:'x',name:'B',tickers:['NVDA']}]}),null);
 assert.equal(state.lists.length,2);assert.deepEqual(state.lists[1].tickers,['MU']);
});
test('manual reordering preserves each ticker and ignores out of range moves',()=>{
 assert.deepEqual(moveFavorite(['MU','TSM','NVDA'],'TSM',-1),['TSM','MU','NVDA']);
 assert.deepEqual(moveFavorite(['MU','TSM'],'MU',-1),['MU','TSM']);
});
test('quotes require matching ticker, valid clock and finite signed values',()=>{
 const q={ticker:'MU',price:100,change:-2,percentChange:-1.96,currency:'USD',asOf:'2026-10-07T13:30:00Z',session:'regular',delayed:false,source:'twelve-data'};
 assert.equal(usableFavoriteQuote(q,'MU'),true);assert.equal(usableFavoriteQuote(q,'NVDA'),false);
 assert.equal(usableFavoriteQuote({...q,price:NaN},'MU'),false);assert.equal(usableFavoriteQuote({...q,asOf:'invalid'},'MU'),false);
 assert.equal(usableFavoriteQuote({...q,change:null,percentChange:null},'MU'),true);
});

test('sorts both directions while keeping missing quotes last', async () => {
  const { sortFavorites } = await import('../lib/research/favorite-lists.ts');
  const quote = (ticker, percentChange) => ({ ticker, price: 10, percentChange, change: 1, currency:'USD', asOf:'2026-10-07T14:00:00Z',session:'regular',source:'twelve-data',delayed:false });
  const quotes = { MU:quote('MU',2), SNDK:quote('SNDK',-3) };
  assert.deepEqual(sortFavorites(['NONE','MU','SNDK'], quotes,'gainers'),['MU','SNDK','NONE']);
  assert.deepEqual(sortFavorites(['NONE','MU','SNDK'], quotes,'losers'),['SNDK','MU','NONE']);
});
test('rejects fabricated or unordered sparkline inputs and handles flat prices', async () => {
  const { sparklinePoints, parsePriceAlerts } = await import('../lib/research/favorite-lists.ts');
  const values = [{at:'2026-10-07T14:00:00Z',price:10},{at:'2026-10-07T14:01:00Z',price:10}];
  assert.equal(sparklinePoints(values), '2.00,20.00 98.00,20.00');
  assert.equal(sparklinePoints([...values].reverse()), '');
  assert.equal(sparklinePoints([{at:'invalid',price:5},values[1]]), '');
  assert.deepEqual(parsePriceAlerts([{ticker:'MU',price:-2,direction:'above',currency:'USD'}]), []);
});
