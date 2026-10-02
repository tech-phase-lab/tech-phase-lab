import test from 'node:test';
import assert from 'node:assert/strict';
import { newsPulseItems } from '../lib/research/news-pulse-items.ts';

const market = (id, topic, publishedAt) => ({ id, topic, publishedAt,
  observedAt:'2026-10-02T06:00:00Z', url:`https://x.com/Barchart/status/${id}`,
  titleJa:'利回りは-0.01ポイント、3.45%。加入予定。',
  titleEn:'Yield -0.01 points to 3.45%. Scheduled to join.' });

test('home rotation includes published index, bond and oil news with exact bilingual copy', () => {
  const feed = {ok:true,enabled:false,items:[],officialUpdates:[{
    id:'4',tickers:['NBIS'],publisher:'NBIS',url:'https://nebius.com/newsroom/test',
    title:'Official update',translationJa:'公式発表',publishedAt:'2026-10-01T00:00:00Z',observedAt:'2026-10-02T07:00:00Z'
  }],marketUpdates:[market('1','index-membership','2026-10-02T00:24:57Z'),market('2','government-bonds','2026-10-02T00:00:00Z'),market('3','crude-oil','2026-10-01T23:00:00Z')]};
  const ja=newsPulseItems(feed,'ja'), en=newsPulseItems(feed,'en');
  assert.deepEqual(ja.map(x=>x.id),['market-1','market-2','market-3','official-4']);
  assert.deepEqual(ja.slice(0,3).map(x=>x.ticker),['指数','国債','原油']);
  assert.deepEqual(en.slice(0,3).map(x=>x.ticker),['INDICES','BONDS','OIL']);
  assert.equal(ja[0].title,feed.marketUpdates[0].titleJa);
  assert.equal(en[0].title,feed.marketUpdates[0].titleEn);
  assert.equal(ja[0].at,feed.marketUpdates[0].publishedAt);
  assert.equal(ja[0].kind,'published');
  assert.equal(ja[3].title,'公式発表');
});

test('home rotation keeps latest five across feeds and preserves unknown publication clocks', () => {
  assert.deepEqual(newsPulseItems(undefined,'ja'),[]);
  const feed={ok:true,enabled:true,items:[{id:'news',tickers:['MU'],title:'News',summaryJa:'ニュース',url:'https://example.com/news',publishedAt:'2026-10-02T01:00:00Z'}],
    officialUpdates:[{id:'4',tickers:['NBIS'],publisher:'NBIS',url:'https://nebius.com/newsroom/test',title:'Official',observedAt:'2026-10-02T02:00:00Z'}],
    marketUpdates:Array.from({length:6},(_,i)=>market(String(i),'crude-oil',`2026-10-01T0${i}:00:00Z`))};
  const items=newsPulseItems(feed,'en');
  assert.equal(items.length,5);
  assert.deepEqual(items.map(x=>x.id),['official-4','news','market-5','market-4','market-3']);
  assert.equal(items[0].kind,'observed');
});
