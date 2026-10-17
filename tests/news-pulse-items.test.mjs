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

test('validated brief compact headlines show review status once without changing old-client payload titles', () => {
  const suffixes={ja:'（短報・詳細確認中）',en:' (brief; details awaiting review)'};
  for(const scope of ['company','sector']) {
    const core=scope==='sector'?{ja:'証券会社による業界見通し',en:'Broker industry outlook'}:
      {ja:'NVIDIA、新たな供給能力を発表',en:'NVIDIA announces new capacity'};
    const compact=scope==='sector'?core:{ja:'NVIDIAの供給能力',en:'NVIDIA capacity'};
    const item={id:'8044',generalSource:1,brief:{version:1,scope,validFacts:1,pendingFacts:1},
      title:core.en+suffixes.en,translationJa:core.ja+suffixes.ja,
      shortTitleEn:compact.en+suffixes.en,shortTitleJa:compact.ja+suffixes.ja,
      url:'https://x.com/wallstengine/status/8044',publisher:scope==='sector'?'Reported industry news':'Wall St Engine',
      tickers:scope==='sector'?[]:['NVDA'],publishedAt:'2026-10-02T12:30:37.000Z',observedAt:'2026-10-02T12:49:12.663Z',
      bodyJa:core.ja,bodyEn:core.en};
    const feed=availableNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[item]});
    const original=structuredClone(feed);
    for(const lang of ['ja','en']) {
      const [pulse]=newsPulseItems(feed,lang);
      assert.equal(pulse.title,core[lang]);
      assert.equal(pulse.shortTitle,compact[lang]);
      assert.equal(pulse.body,core[lang]);
      assert.equal((JSON.stringify(pulse).match(/details awaiting review|詳細は確認中/gi)??[]).length,1);
      const projected={...item};
      delete projected.brief;
      delete projected.generalSource;
      const [older]=newsPulseItems({ok:true,enabled:false,items:[],officialUpdates:[projected]},lang);
      assert.equal(older.shortTitle,compact[lang]+suffixes[lang]);
      assert.equal(older.title,core[lang]+suffixes[lang]);
    }
    assert.deepEqual(feed,original);
    assert.equal(feed.officialUpdates[0].title,item.title);
    assert.equal(feed.officialUpdates[0].translationJa,item.translationJa);
    assert.equal(feed.officialUpdates[0].shortTitleJa,item.shortTitleJa);
    assert.equal(feed.officialUpdates[0].shortTitleEn,item.shortTitleEn);
  }
});

const market = (id, topic, publishedAt) => ({ id, topic, publishedAt,
  observedAt:'2026-10-02T06:00:00Z', url:`https://x.com/Barchart/status/${id}`,
  titleJa:'利回りは-0.01ポイント、3.45%。加入予定。',
  titleEn:'Yield -0.01 points to 3.45%. Scheduled to join.' });

test('home rotation includes published index, bond and oil news with exact bilingual copy', () => {
  const feed = {ok:true,enabled:false,items:[],officialUpdates:[{
    id:'4',tickers:['NBIS'],publisher:'NBIS',url:'https://nebius.com/newsroom/test',
    title:'NBIS official update',translationJa:'公式発表',publishedAt:'2026-10-01T00:00:00Z',observedAt:'2026-10-02T07:00:00Z'
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
    officialUpdates:[{id:'4',tickers:['NBIS'],publisher:'NBIS',url:'https://nebius.com/newsroom/test',title:'NBIS official',observedAt:'2026-10-02T02:00:00Z'}],
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
    title:'Newer NBIS official update',translationJa:'新しい公式発表',
    publishedOn:'2026-10-02',observedAt:'2026-10-02T12:00:00Z',
  }]});
  for(const lang of ['ja','en']) {
    const pulse=newsPulseItems(feed,lang);
    assert.deepEqual(pulse.map(x=>x.id),['official-1211','official-1210']);
    assert.equal(pulse[1].at,'2026-10-01');
    assert.equal(pulse[1].kind,'date');
  }
});

const brokerFact = {
  ja: 'JPMorganの見方として報じられた内容：メモリー供給は2028年まで逼迫が続くと見込む。',
  en: 'Reported view of JPMorgan: Memory supply is expected to stay constrained through 2028.',
};
const reported = {
  id:'1244',generalSource:1,tickers:['MU'],publisher:'Reported company news',
  url:'https://x.com/wallstengine/status/2106377353018626530',
  title:'MU: Broker business and industry outlook',translationJa:'MU：証券会社による事業・業界見通し',
  publishedAt:'2026-10-03T13:34:30.000Z',observedAt:'2026-10-03T13:34:43.668Z',
  bodyJa:[brokerFact.ja,...['顧客との受注協議はすでに2031年分にまで及んでいる。','HBMのビット需要は+63%の伸びを見込む。','非HBMサーバーDRAMについては+37%と推計している。','CY27のHBM混合平均販売単価（ASP）は前年比+54%と見込む。','Micronの長期供給契約による売上高カバー率>35%（2030年まで）は保守的な可能性があるとみる。','アジアのメモリー同業他社は長期契約で生産能力の50%+をカバーしている。'].map(x=>'JPMorganの見方として報じられた内容：'+x)].join('\n\n'),
  bodyEn:[brokerFact.en,...['Customer order talks already reach into 2031.','HBM bit demand is forecast to expand by +63%.','Non-HBM server DRAM is estimated at +37%.','The blended HBM ASP for CY27 is forecast at +54% YoY.','Micron’s >35% revenue coverage under long-term supply agreements through 2030 could prove conservative.','Asian memory peers have LTAs covering 50%+ of capacity.'].map(x=>'Reported view of JPMorgan: '+x)].join('\n\n'),
};
const oneOfficial = item => ({ok:true,enabled:false,items:[],officialUpdates:[item]});

test('header uses a concise attributed headline while the full bilingual body stays untouched', () => {
  const feed=availableNewsPayload(oneOfficial(reported)), before=structuredClone(feed);
  for (const lang of ['ja','en']) {
    const [pulse]=newsPulseItems(feed,lang);
    assert.equal(pulse.summary,lang==='ja'?'JPMorgan：2028年までメモリー逼迫予想':'JPMorgan sees tight memory supply through 2028');
    assert.ok(pulse.body.includes('2031'));
    assert.equal((pulse.body.match(/JPMorgan/g)??[]).length,7);
    for(const figure of ['+63%','+37%','CY27','+54%','>35%','2030','50%+']) assert.ok(pulse.body.includes(figure));
    assert.ok(!pulse.summary.includes('2031'));
    assert.equal(pulse.at,reported.publishedAt);
    assert.equal(pulse.kind,'published');
  }
  assert.deepEqual(feed,before);
});

test('a header summary never splits decimal points, broker initials, source periods or a longer evidence paragraph', () => {
  const en='Reported view of J.P. Morgan: U.S. demand is forecast to grow 3.45% in CY27; coverage >35% through 2030 could be conservative.';
  const ja='J.P. Morganの見方として報じられた内容：CY27の需要は3.45%増を見込み、2030年までのカバー率>35%は保守的な可能性がある。';
  for (const lang of ['ja','en']) {
    const text=lang==='ja'?ja:en;
    const item={...reported,bodyJa:ja,bodyEn:en};
    const sourceOnly=newsPulseItems(oneOfficial(item),lang)[0];
    assert.equal(sourceOnly.summary,lang==='ja'?'証券会社の業界見通し':'Broker industry outlook');
    assert.ok(sourceOnly.body.includes(text));
    for (const body of ['x'.repeat(181)+'\n\nA short later paragraph.', 'Incomplete header\ncontinued fact.']) {
      const [pulse]=newsPulseItems(oneOfficial({...item,bodyJa:body,bodyEn:body}),lang);
      assert.equal(pulse.summary,lang==='ja'?'証券会社の業界見通し':'Broker industry outlook');
    }
    const compact=lang==='ja'?'供給は2028年まで逼迫の見通し':'Supply seen constrained through 2028';
    const [pulse]=newsPulseItems(oneOfficial({...item,[lang==='ja'?'shortTitleJa':'shortTitleEn']:compact}),lang);
    assert.ok(pulse.headlines.includes(compact));
  }
});

test('ordinary source prose and partial-brief detail are never promoted into the header', () => {
  for(const lang of ['ja','en']) {
    const title=lang==='ja'?reported.translationJa:reported.title;
    assert.equal(newsPulseItems(oneOfficial({...reported,publisher:"Other source"}),lang)[0].summary,title);
    const brief={...reported,brief:{version:1,scope:'company',validFacts:1,pendingFacts:1},
      title:reported.title+' (brief; details awaiting review)',translationJa:reported.translationJa+'（短報・詳細確認中）'};
    assert.match(newsPulseItems(oneOfficial(brief),lang)[0].summary,/詳細確認中|details pending|pending/);
    assert.ok(!newsPulseItems(oneOfficial(brief),lang)[0].summary.includes('2028'));
  }
});

test('short Treasury news uses its approved complete compact headline without creating new details', () => {
  const item={...market('bond','government-bonds','2026-10-03T04:07:00Z'),
    titleJa:'米国10年物国債利回りが再び急上昇中',shortTitleJa:'米国10年物国債利回り急上昇',
    titleEn:'U.S. 10-Year Treasury Yield ripping again',shortTitleEn:'U.S. 10-year Treasury yield surges'};
  for(const lang of ['ja','en']) {
    const [pulse]=newsPulseItems({ok:true,enabled:false,items:[],marketUpdates:[item]},lang);
    assert.equal(pulse.summary,lang==='ja'?'米10年債利回り、再び急上昇':'U.S. 10Y yield surges again');
    assert.doesNotMatch(pulse.summary,/…|\.\.\./);
  }
});


test('unstructured buyback recap uses its honest headline rather than promoting a paragraph', () => {
  const first={
    ja:'報道によると、NVIDIAは前四半期に$20B弱の自社株を買い戻し、金額はフリーキャッシュフローの約92%に相当した。',
    en:'According to the report, During the previous quarter, NVIDIA bought back nearly $20B of its shares, an amount equivalent to about 92% of free cash flow.',
  };
  const context={
    ja:'投稿の承認額と残る承認枠は、2026-09-28の会社発表にも記載されている。',
    en:'The authorization and remaining-capacity amounts in the post also appear in the company release dated 2026-09-28.',
  };
  const item={id:'1246',generalSource:1,tickers:['NVDA'],publisher:'Reported company news',
    title:'NVDA: Reported buyback recap',translationJa:'NVDA：自社株買い実績の振り返り報道',
    url:'https://x.com/TrendSpider/status/2106523440635363385',publishedAt:'2026-10-03T23:15:00.000Z',observedAt:'2026-10-04T02:09:57.822Z',
    bodyJa:first.ja+'\n\n'+context.ja,bodyEn:first.en+'\n\n'+context.en};
  const feed=availableNewsPayload(oneOfficial(item)),before=structuredClone(feed);
  for(const lang of ['ja','en']) {
    const [pulse]=newsPulseItems(feed,lang);
    assert.equal(pulse.summary,lang==='ja'?'NVDA：自社株買い実績の報道':'NVDA: buyback recap report');
    assert.ok(pulse.body.includes(first[lang]));
    assert.ok(pulse.body.includes(context[lang]));
    assert.equal(pulse.at,item.publishedAt);assert.equal(pulse.kind,'published');
    assert.ok(!pulse.summary.includes('2026-09-28'));
    assert.equal(newsPulseItems(oneOfficial({...item,title:'NVDA: Reported buyback story'}),lang)[0].summary,
      lang==='ja'?item.translationJa:'NVDA: Reported buyback story');
  }
  assert.deepEqual(feed,before);
});
