import test from 'node:test';
import assert from 'node:assert/strict';
import { newsPulseItems } from '../lib/research/news-pulse-items.ts';
import { availableNewsPayload } from '../lib/research/general-news.ts';

test('previously unknown incoming story keeps compact bilingual copy through feed validation', () => {
  const incoming = {ok:true,enabled:false,items:[],officialUpdates:[{
    id:'98765',tickers:['NBIS'],publisher:'Nebius',url:'https://nebius.com/blog/new-unknown-story',
    title:'Nebius announces a new AI platform',translationJa:'ネビウスが新しいAI基盤を発表',
    shortTitleJa:'ネビウス、新AI基盤を発表',shortTitleEn:'Nebius announces new AI platform',
    observedAt:'2026-10-02T07:00:00Z'
  }]};
  const feed = availableNewsPayload(incoming);
  assert.equal(newsPulseItems(feed,'ja')[0].shortTitle,incoming.officialUpdates[0].shortTitleJa);
  assert.equal(newsPulseItems(feed,'en')[0].shortTitle,incoming.officialUpdates[0].shortTitleEn);
  assert.equal(newsPulseItems(feed,'ja')[0].title,incoming.officialUpdates[0].translationJa);
  incoming.officialUpdates[0].shortTitleJa = 'bad\0copy';
  const fallback = newsPulseItems(availableNewsPayload(incoming),'ja');
  assert.equal(fallback.length,1);
  assert.equal(fallback[0].shortTitle,incoming.officialUpdates[0].translationJa);
});

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
  assert.deepEqual(ja.slice(0,3).map(x=>x.ticker),['指数の組み入れ・除外','国債','原油']);
  assert.deepEqual(en.slice(0,3).map(x=>x.ticker),['Index membership','Government bonds','Crude oil']);
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


test('compact home headline is separate from the complete published headline', () => {
  const title='NVIDIA DOCAエージェントスキルでNVIDIA BlueField上のアプリケーション開発を加速';
  const item=newsPulseItems({ok:true,enabled:false,items:[],officialUpdates:[{
    id:'10',tickers:['NVDA'],publisher:'NVIDIA',title:'Build applications on NVIDIA BlueField faster with NVIDIA DOCA Agent Skills',translationJa:title,
    url:'https://developer.nvidia.com/blog/build-applications-on-nvidia-bluefield-faster-with-nvidia-doca-agent-skills/',observedAt:'2026-10-02T00:00:00Z'
  }]},'ja')[0];
  assert.equal(item.title,title);
  assert.equal(item.shortTitle,'DOCAスキルでBlueField開発を加速');
  assert.ok(item.shortTitle.length<item.title.length);
});

test('late acquired date-only source stays on its original day in both home languages', () => {
  const feed=availableNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[{
    id:'1210',tickers:['MSFT'],publisher:'Microsoft',
    url:'https://www.microsoft.com/en-us/security/blog/2026/10/01/insights-from-the-2026-microsoft-digital-defense-report/',
    title:'Insights from the 2026 Microsoft Digital Defense Report',translationJa:'2026年Microsoftデジタル防御レポートの知見',
    publishedOn:'2026-10-01',observedAt:'2026-10-02T17:45:51.992Z',
  },{
    id:'1211',tickers:['NBIS'],publisher:'Nebius',url:'https://nebius.com/blog/newer',
    title:'Newer official update',translationJa:'新しい公式発表',
    publishedOn:'2026-10-02',observedAt:'2026-10-02T12:00:00Z',
  }]});
  for(const lang of ['ja','en']) {
    const pulse=newsPulseItems(feed,lang);
    assert.deepEqual(pulse.map(x=>x.id),['official-1211','official-1210']);
    assert.equal(pulse[1].at,'2026-10-01');
    assert.equal(pulse[1].kind,'date');
  }
});
