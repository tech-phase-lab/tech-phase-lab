import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { availableNewsPayload, publicNewsPayload, boundedOfficialHistory } from "../lib/research/general-news.ts";

const helper = new URL("../lib/research/general-news.ts", import.meta.url).href;
const source = (await readFile(new URL("../app/api/research/news/route.ts", import.meta.url), "utf8"))
  .replace('"@/lib/research/public-news-response"', JSON.stringify(new URL("../lib/research/public-news-response.ts", import.meta.url).href))
  .replace('"@/lib/research/general-news"', JSON.stringify(helper))
  .replace('"@/lib/research/official-result-events"', JSON.stringify(new URL("../lib/research/official-result-events.ts", import.meta.url).href))
  .replace('"@/lib/research/result-news"', JSON.stringify(new URL("../lib/research/result-news.ts", import.meta.url).href))
  .replace("'@/lib/research/mu-latest'", JSON.stringify(new URL("../lib/research/mu-latest.ts", import.meta.url).href));
const { GET } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64"));
const item = { id: "a".repeat(64), title: "Synthetic report", url: "https://publisher.example/report", publisher: "Publisher", tickers: ["MU"],
  publishedAt: "2026-09-28T00:00:00Z", observedAt: "2026-09-28T00:01:00Z", approvedAt: "2026-09-28T00:02:00Z",
  summaryJa: "これは合成テスト用の確認済みニュース要約です。", summaryEn: "This is a reviewed synthetic news summary.",
  impactJa: "合成テストでは事業への影響を両面と評価しています。", impactEn: "The synthetic test assesses mixed business impact.",
  impactLabel: "mixed", confidence: "medium" };

test('one rejected story does not suppress valid stories in any news section', () => {
  const official = {id:'42',title:'Official update',url:'https://x.com/nebiusai/status/12345',publisher:'Nebius',tickers:['NBIS'],observedAt:'2026-09-28T09:00:00Z'};
  const market = {id:'43',titleJa:'指数への追加予定',titleEn:'Scheduled index addition',url:'https://x.com/TrendSpider/status/43',topic:'index-membership',publishedAt:'2026-09-28T09:00:00Z',observedAt:'2026-09-28T09:01:00Z'};
  const data = availableNewsPayload({ok:true,enabled:true,items:[{...item,summaryEn:null},item],
    officialUpdates:[{...official,url:'https://evil.example/post'},official],
    marketUpdates:[{...market,topic:'crude-oil'},market],resultBriefs:[{id:'invalid'}]});
  assert.deepEqual(data.items,[item]);
  assert.deepEqual(data.officialUpdates,[official]);
  assert.deepEqual(data.marketUpdates,[market]);
  assert.deepEqual(data.resultBriefs,[]);
  assert.throws(()=>availableNewsPayload({ok:false,enabled:true,items:[item]}));
  assert.deepEqual(availableNewsPayload({ok:true,enabled:false,items:[item]}).items,[]);
  assert.deepEqual(availableNewsPayload({ok:true,enabled:true,items:[item],marketUpdates:{invalid:true}}).items,[item]);
});

test('news API retains valid news when another article fails validation', async () => {
  const previous = {fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
  process.env.RESEARCH_MONITOR_URL='https://monitor.example.com';
  process.env.RESEARCH_MONITOR_TOKEN='synthetic-server-token';
  try {
    globalThis.fetch=async()=>Response.json({ok:true,enabled:true,items:[item,{...item,id:'invalid'}],marketUpdates:[{}]});
    const response=await GET();
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.enabled,true);
    assert.deepEqual(data.items,[item]);
    assert.deepEqual(data.marketUpdates,[]);
  } finally {
    globalThis.fetch=previous.fetch;
    for (const [key,value] of [['RESEARCH_MONITOR_URL',previous.url],['RESEARCH_MONITOR_TOKEN',previous.token]]) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});

test("public payload strips private source, evidence and reviewer data", () => {
  assert.deepEqual(publicNewsPayload({ ok: true, enabled: true, secret: "not public", items: [{ ...item, text: "private source", evidence: ["private"], reviewer: "editor" }] }),
    { ok: true, enabled: true, items: [item] });
  assert.deepEqual(publicNewsPayload({ ok: true, enabled: false, items: [item] }).items, []);
  for (const changes of [{ url: "javascript:alert(1)" }, { summaryEn: null }, { approvedAt: "invalid" },
    { impactLabel: "bullish" }, { impactLabel: "uncertain", confidence: "high" }]) {
    assert.throws(() => publicNewsPayload({ ok: true, enabled: true, items: [{ ...item, ...changes }] }));
  }
});

test("public route uses server credential and never caches failed or withdrawn news", async () => {
  const previous = { fetch: globalThis.fetch, url: process.env.RESEARCH_MONITOR_URL, token: process.env.RESEARCH_MONITOR_TOKEN };
  process.env.RESEARCH_MONITOR_URL = "https://monitor.example.com";
  process.env.RESEARCH_MONITOR_TOKEN = "synthetic-server-token";
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://monitor.example.com/news");
      assert.equal(init.headers.Authorization, "Bearer synthetic-server-token");
      return Response.json({ ok: true, enabled: true, items: [item] });
    };
    const result = await GET();
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("Cache-Control"), "no-store");
    assert.deepEqual((await result.json()).items, [item]);
    globalThis.fetch = async () => Response.json({ ok: true, enabled: false, items: [item] });
    assert.deepEqual((await (await GET()).json()).items, []);
    globalThis.fetch = async () => { throw new Error("private monitor detail"); };
    const failure = await GET();
    assert.equal(failure.status, 503);
    assert.equal(failure.headers.get("Cache-Control"), "no-store");
    const safe = await failure.json();
    assert.equal(safe.ok, false);
    assert.deepEqual(safe.items, []);
    assert.equal(safe.enabled, false);
    assert.equal(safe.officialUpdates, undefined);
    assert.equal(JSON.stringify(safe).includes("private monitor detail"), false);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [["RESEARCH_MONITOR_URL", previous.url], ["RESEARCH_MONITOR_TOKEN", previous.token]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("public route rejects monitor URLs with embedded credentials", async () => {
  const previous = { fetch: globalThis.fetch, url: process.env.RESEARCH_MONITOR_URL, token: process.env.RESEARCH_MONITOR_TOKEN };
  process.env.RESEARCH_MONITOR_URL = "https://user:password@monitor.example.com";
  process.env.RESEARCH_MONITOR_TOKEN = "synthetic-server-token";
  let called = false;
  globalThis.fetch = async () => { called = true; return Response.json({ ok: true, enabled: false, items: [] }); };
  try {
    const response = await GET();
    assert.equal(response.status, 503);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [["RESEARCH_MONITOR_URL", previous.url], ["RESEARCH_MONITOR_TOKEN", previous.token]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('official links remain available without paid news and exclude private content', () => {
 const update = {id:'42',title:'Official update',url:'https://x.com/nebiusai/status/12345',publisher:'Nebius',tickers:['NBIS'],observedAt:'2026-09-28T09:00:00Z'};
 const data=publicNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[{...update,excerpt:'PRIVATE'}]});
 assert.deepEqual(data.officialUpdates,[update]);
 assert.equal(JSON.stringify(data).includes('PRIVATE'),false);
 for (const url of ['https://x.com/impostor/status/12345','https://evil.example/post','javascript:alert(1)']) {
  assert.throws(()=>publicNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[{...update,url}]}));
 }
 const officialUrls=['https://blogs.arista.com/blog/update','https://investor.marvell.com/news/update',
  'https://racks.vertiv.com/update','https://pr.tsmc.com/english/news/1','https://www.palantir.com/q2-2026-letter/en/'];
 for (const url of officialUrls) assert.equal(publicNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[{...update,url}]}).officialUpdates[0].url,url);
});

test('official headlines count Unicode characters consistently with Python', () => {
 const update={id:'43',title:'🤖'.repeat(180),url:'https://x.com/nebiusai/status/12345',publisher:'Nebius',tickers:['NBIS'],observedAt:'2026-09-28T09:00:00Z'};
 assert.equal(publicNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[update]}).officialUpdates[0].title,update.title);
 assert.throws(()=>publicNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[{...update,title:update.title+'a'}]}));
});

test('official headline translations are optional, bounded and trimmed', () => {
 const update={id:'44',title:'Official update',url:'https://x.com/nebiusai/status/12345',publisher:'Nebius',tickers:['NBIS'],observedAt:'2026-09-28T09:00:00Z'};
 const translated={...update,translationJa:'  ネビウスが新しい基盤を発表  '};
 assert.equal(publicNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[translated]}).officialUpdates[0].translationJa,'ネビウスが新しい基盤を発表');
 for(const translationJa of ['', 'あ'.repeat(181)]) assert.throws(()=>publicNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[{...update,translationJa}]}));
});

test('public news removes duplicate current stories and keeps missing official updates compatible', () => {
 const first={id:'45',title:'Current official update',url:'https://nebius.com/blog/current',publisher:'Nebius',tickers:['NBIS'],observedAt:'2026-09-28T09:00:00Z'};
 const duplicate={...first,id:'46',title:'Older duplicate'};
 const official=publicNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[first,duplicate]});
 assert.deepEqual(official.officialUpdates,[first]);
 assert.deepEqual(publicNewsPayload({ok:true,enabled:false,items:[]}),{ok:true,enabled:false,items:[]});
 const duplicateId={...item,url:'https://publisher.example/duplicate-id'};
 const duplicateUrl={...item,id:'b'.repeat(64)};
 const reviewed=publicNewsPayload({ok:true,enabled:true,items:[item,duplicateId,duplicateUrl]});
 assert.deepEqual(reviewed.items,[item]);
});

 test('reviewed MU flash allows only its exact SEC source and internal article', async () => {
 const {muFlash} = await import('../lib/research/mu-latest.ts');
 const payload = (update) => publicNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[update]});
 assert.equal(payload(muFlash).officialUpdates[0].researchId, 'mu-q4-2026');
 assert.throws(() => payload({...muFlash,url:muFlash.url+'?unreviewed=1'}));
 assert.throws(() => payload({...muFlash,researchId:'private-editor'}));
 });

test('issuer IR release headlines use the monitored company article rules', () => {
  const update = {id:'90',title:'NVIDIA announces quarterly financial results',
    url:'https://nvidianews.nvidia.com/news/nvidia-announces-financial-results',
    publisher:'NVIDIA IR',tickers:['NVDA'],observedAt:'2026-10-01T11:00:29Z',publishedOn:'2026-10-01'};
  const payload = v => ({ok:true,enabled:false,items:[],officialUpdates:[v]});
  assert.equal(publicNewsPayload(payload(update)).officialUpdates[0].url,update.url);
  for (const changed of [{tickers:['NBIS']}, {url:'https://nvidianews.nvidia.com/login'},
    {url:'https://evil.example/news/nvidia-announces-financial-results'},
    {url:update.url+'?redirect=elsewhere'}]) {
    assert.throws(()=>publicNewsPayload(payload({...update,...changed})));
  }
});

test('issuer research links reach news while premium purpose and raw evidence stay server-side', async () => {
  const previous={fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
  process.env.RESEARCH_MONITOR_URL='https://monitor.example.com';process.env.RESEARCH_MONITOR_TOKEN='synthetic-server-token';
  const url='https://nebius.com/newsroom/nebius-acquires-inferize-to-strengthen-nebius-token-factorys-production-inference-stack';
  const copy={ja:'Inferizeを買収',en:'Acquired Inferize'};
  try {
    globalThis.fetch=async()=>Response.json({ok:true,enabled:false,items:[],officialUpdates:[{id:'123',title:'Acquired Inferize',url,publisher:'NBIS IR',tickers:['NBIS'],observedAt:'2026-10-01T11:00:29Z'}],
      officialResearch:[{id:'ir-result-123',ticker:'NBIS',kind:'acquisition',title:copy,summary:copy,facts:[copy,copy,copy],purpose:{ja:'非公開の目的',en:'PRIVATE-PURPOSE'},url,sourceTitle:'Nebius acquires Inferize',publishedOn:'2026-10-01',dateBasis:'detection',publicAt:'2026-10-01T14:00:00Z',evidence:'PRIVATE-EVIDENCE'}]});
    const result=await (await GET()).json();
    const update=result.officialUpdates.find(x=>x.url===url);
    assert.equal(update.researchId,'ir-result-123');
    assert.equal(publicNewsPayload(result).officialUpdates.find(x=>x.url===url).researchId,'ir-result-123');
    assert.equal(JSON.stringify(result).includes('PRIVATE-'),false);
  } finally {
    globalThis.fetch=previous.fetch;
    for(const [key,value] of [['RESEARCH_MONITOR_URL',previous.url],['RESEARCH_MONITOR_TOKEN',previous.token]]) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});

test('long issuer titles and an invalid adjacent note cannot erase the public news feed', async () => {
  const previous = { fetch: globalThis.fetch, url: process.env.RESEARCH_MONITOR_URL, token: process.env.RESEARCH_MONITOR_TOKEN };
  process.env.RESEARCH_MONITOR_URL = 'https://monitor.example.com';
  process.env.RESEARCH_MONITOR_TOKEN = 'synthetic-server-token';
  const url = 'https://nebius.com/newsroom/nebius-acquires-inferize-to-strengthen-nebius-token-factorys-production-inference-stack';
  const headline = { id: '123', title: 'Acquired Inferize', translationJa: 'Inferizeを買収', url, publisher: 'NBIS IR', tickers: ['NBIS'], observedAt: '2026-10-01T11:00:29Z' };
  const copy = { ja: '確認済みの企業発表', en: 'A verified company announcement' };
  const note = { id: 'ir-result-123', ticker: 'NBIS', kind: 'acquisition', title: { ja: 'あ'.repeat(181), en: 'A'.repeat(181) },
    summary: copy, facts: [copy, copy, copy], purpose: { ja: '非公開の目的', en: 'PRIVATE-PURPOSE' },
    url, sourceTitle: 'Nebius acquires Inferize', publishedOn: '2026-10-01', dateBasis: 'detection', publicAt: '2026-10-01T14:00:00Z' };
  try {
    for (const officialResearch of [[note], [{ ...note, id: 'invalid' }, note]]) {
      globalThis.fetch = async () => Response.json({ ok: true, enabled: true, items: [item], officialUpdates: [headline], officialResearch });
      const response = await GET();
      assert.equal(response.status, 200);
      const result = publicNewsPayload(await response.json());
      assert.deepEqual(result.items, [item]);
      const update = result.officialUpdates.find(update => update.url === url);
      assert.equal(update.title, headline.title);
      assert.equal(update.translationJa, headline.translationJa);
      assert.equal(update.researchId, note.id);
      assert.equal(update.bodyEn, copy.en);
      assert.equal(update.bodyJa, copy.ja);
      assert.equal(JSON.stringify(result).includes('PRIVATE-PURPOSE'), false);
    }
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [['RESEARCH_MONITOR_URL', previous.url], ['RESEARCH_MONITOR_TOKEN', previous.token]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('live MU earnings replace the manually recovered flash', async () => {
  const previous={fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
  process.env.RESEARCH_MONITOR_URL='https://monitor.example.com';process.env.RESEARCH_MONITOR_TOKEN='synthetic-server-token';
  const url='https://investors.micron.com/news/press-release/2026/Micron-Technology-Inc--Reports-Record-Fiscal-Fourth-Quarter-and-Full-Year-2026-Results/default.aspx';
  const copy={ja:'Inferizeを買収',en:'Acquired Inferize'};
  try {
    globalThis.fetch=async()=>Response.json({ok:true,enabled:false,items:[],officialUpdates:[{id:'123',title:'Acquired Inferize',url,publisher:'NBIS IR',tickers:['MU'],observedAt:'2026-10-01T11:00:29Z'}],
      officialResearch:[{id:'ir-result-123',ticker:'MU',kind:'earnings',title:copy,summary:copy,facts:[copy,copy,copy],purpose:{ja:'非公開の目的',en:'PRIVATE-PURPOSE'},url,sourceTitle:'Nebius acquires Inferize',publishedOn:'2026-10-01',dateBasis:'detection',publicAt:'2026-10-01T14:00:00Z',evidence:'PRIVATE-EVIDENCE'}]});
    const result=await (await GET()).json();
    const update=result.officialUpdates.find(x=>x.url===url);
    assert.equal(update.researchId,'ir-result-123');
    assert.equal(result.officialUpdates.some(x=>x.researchId==='mu-q4-2026'),false);
    assert.equal(publicNewsPayload(result).officialUpdates.find(x=>x.url===url).researchId,'ir-result-123');
    assert.equal(JSON.stringify(result).includes('PRIVATE-'),false);
  } finally {
    globalThis.fetch=previous.fetch;
    for(const [key,value] of [['RESEARCH_MONITOR_URL',previous.url],['RESEARCH_MONITOR_TOKEN',previous.token]]) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});

test('scoped market updates preserve both languages and never expose private originals', () => {
 const market = { id:'123', url:'https://x.com/Barchart/status/123', topic:'government-bonds', titleJa:'日本の10年物国債利回りが上昇。', titleEn:'Japan 10-year bond yields rise.', publishedAt:'2026-10-02T00:00:00Z', observedAt:'2026-10-02T00:01:00Z' };
 assert.deepEqual(publicNewsPayload({ok:true,enabled:false,items:[],marketUpdates:[{...market,body:'private original'}]}).marketUpdates,[market]);
 for (const changes of [{url:'https://x.com/Other/status/123'},{topic:'index-membership'},{titleEn:''},{url:market.url+'?unreviewed=1'}]) {
   assert.throws(()=>publicNewsPayload({ok:true,enabled:false,items:[],marketUpdates:[{...market,...changes}]}));
 }
});

test('news API consolidates cross-publisher earnings without losing sources or conflicting figures', async () => {
  const previous = { fetch: globalThis.fetch, url: process.env.RESEARCH_MONITOR_URL, token: process.env.RESEARCH_MONITOR_TOKEN };
  process.env.RESEARCH_MONITOR_URL = 'https://monitor.example.com';
  process.env.RESEARCH_MONITOR_TOKEN = 'synthetic-server-token';
  const brief = { id: '801', researchId: 'x-result-801', kind: 'earnings', ticker: 'MU', period: 'Q4 2026',
    titleJa: 'MU決算：売上$10B', titleEn: 'MU earnings: revenue $10B', facts: [{ key: 'revenue', ja: '売上高', en: 'Revenue', value: '$10B' }],
    url: 'https://x.com/wallstengine/status/801', publisher: 'Wall St Engine', publishedAt: '2026-10-02T10:00:00Z', observedAt: '2026-10-02T10:00:01Z', publicAt: '2026-10-02T10:00:02Z', processingMs: 1, sourceToDetectionMs: 1000, detectionToPublicMs: 1000 };
  const correction = { ...brief, id: '802', researchId: 'x-result-802', publisher: 'TipRanks', url: 'https://x.com/TipRanks/status/802',
    titleJa: 'MU決算：売上$11B', titleEn: 'MU earnings: revenue $11B', facts: [{ ...brief.facts[0], value: '$11B' }],
    publishedAt: '2026-10-02T10:01:00Z', observedAt: '2026-10-02T10:01:01Z', publicAt: '2026-10-02T10:01:02Z' };
  try {
    globalThis.fetch = async () => Response.json({ ok: true, enabled: false, items: [], resultBriefs: [brief, correction] });
    const response = await GET();
    assert.equal(response.status, 200);
    const result = publicNewsPayload(await response.json());
    const merged = result.officialUpdates.filter(item => item.url.startsWith('https://x.com/'));
    assert.equal(merged.length, 1);
    assert.equal(merged[0].sources.length, 2);
    assert.ok(merged[0].bodyEn.includes('$10B'));
    assert.ok(merged[0].bodyEn.includes('$11B'));
    assert.ok(merged[0].bodyEn.includes('Wall St Engine'));
    assert.ok(merged[0].bodyEn.includes('TipRanks'));
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [['RESEARCH_MONITOR_URL', previous.url], ['RESEARCH_MONITOR_TOKEN', previous.token]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('news API ranks source dates before recent acquisition clocks when limiting the feed', async () => {
  const previous = {fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
  process.env.RESEARCH_MONITOR_URL='https://monitor.example.com';
  process.env.RESEARCH_MONITOR_TOKEN='synthetic-server-token';
  try {
    const officialUpdates = Array.from({length:100}, (_,i)=>({
      id:String(300+i),title:`Official update ${i}`,url:`https://nebius.com/blog/date-${i}`,
      publisher:'Nebius',tickers:['NBIS'],publishedOn:i === 0 ? '2026-09-28' : '2026-10-02',
      observedAt:i === 0 ? '2026-10-02T17:45:51.992Z' : '2026-10-02T01:00:00Z',
    }));
    globalThis.fetch=async()=>Response.json({ok:true,enabled:false,items:[],officialUpdates});
    const response=await GET();
    assert.equal(response.status,200);
    const updates=(await response.json()).officialUpdates;
    assert.equal(updates.length,100);
    assert.deepEqual(updates.slice(0,99).map(x=>x.id),officialUpdates.slice(1).map(x=>x.id));
    assert.equal(updates.some(x=>x.id==='300'),false);
    assert.equal(updates[99].researchId,'mu-q4-2026');
  } finally {
    globalThis.fetch=previous.fetch;
    for (const [key,value] of [['RESEARCH_MONITOR_URL',previous.url],['RESEARCH_MONITOR_TOKEN',previous.token]]) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});

test('verified issuer-syndication capacity contracts require explicit attribution and both languages', () => {
  const item = {id:'2468', title:'Delta Data Centers Signs Contract with Nebius for AI Data Center Capacity',
    translationJa:'Delta Data Centers、NebiusとAIデータセンター容量の契約を締結',
    url:'https://www.globenewswire.com/news-release/2026/09/30/1234567/0/en/delta-contracts-nebius.html',
    publisher:'Delta Data Centers Inc. / GlobeNewswire',tickers:['NBIS'],
    observedAt:'2026-09-30T12:19:12.432+00:00',publishedAt:'2026-09-30T12:17:00Z',
    bodyJa:'Delta Data Centersは容量契約を締結したと発表した。',
    bodyEn:'Delta Data Centers announced a capacity contract.',
    syndication:{policy:'issuer-capacity-contract-v1',issuer:'Delta Data Centers Inc.',distributor:'GlobeNewswire'}};
  const parse = v => publicNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[v]}).officialUpdates[0];
  const parsed = parse(item);
  assert.deepEqual(parsed.syndication,item.syndication);
  assert.equal(parsed.observedAt,item.observedAt);
  assert.equal(parsed.bodyEn,item.bodyEn);
  for (const change of [{syndication:undefined},{bodyJa:undefined},{bodyEn:undefined},
    {translationJa:undefined},{tickers:['NVDA']},{publisher:'Nebius'},
    {url:item.url+'?key=secret'},
    {syndication:{...item.syndication,issuer:'Different Issuer'},publisher:'Different Issuer / GlobeNewswire'},
    {syndication:{...item.syndication,policy:'unverified'}},
    {title:'Delta Data Centers Announces Debt Offering with Nebius'}]) {
    assert.throws(()=>parse({...item,...change}));
  }
});

test('recent history retains a source-bound older contract beyond twenty rows without making it NEW', async () => {
  const previous={fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
  process.env.RESEARCH_MONITOR_URL='https://monitor.example.com';
  process.env.RESEARCH_MONITOR_TOKEN='synthetic-server-token';
  try {
    const rows=Array.from({length:48},(_,i)=>({id:String(4000+i),title:`Company news ${i}`,
      url:`https://nebius.com/blog/history-${i}`,publisher:'Nebius',tickers:['NBIS'],
      publishedAt:new Date(Date.parse('2026-10-03T07:00:00Z')-i*3600000).toISOString(),
      observedAt:'2026-10-03T07:01:00Z',bodyJa:'会社が発表した内容。',bodyEn:'Company announcement.'}));
    const older={id:'1018',title:'AIB Data Centers Signs Contract with Nebius for AI Data Center Capacity',
      translationJa:'AIB Data Centers、NebiusとAIデータセンター容量の契約を締結',
      url:'https://www.globenewswire.com/news-release/2026/09/30/3371855/0/en/aib-data-centers-signs-contract-with-nebius-for-ai-data-center-capacity.html',
      publisher:'AIB Data Centers Inc. / GlobeNewswire',tickers:['NBIS'],publishedAt:'2026-09-30T12:17:00Z',
      observedAt:'2026-09-30T12:19:12.432+00:00',bodyJa:'AIB Data Centersが容量契約を発表した。',bodyEn:'AIB Data Centers announced a capacity contract.',
      syndication:{policy:'issuer-capacity-contract-v1',issuer:'AIB Data Centers Inc.',distributor:'GlobeNewswire'}};
    const history={limit:100,sourceEligible:49,returned:49,omitted:0,hasMore:false,byteLimited:false,coreOverTarget:false};
    globalThis.fetch=async()=>Response.json({ok:true,enabled:false,items:[],officialUpdates:[...rows,older],officialHistory:history});
    const response=await GET();assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(payload.officialUpdates.find(x=>x.id==='1018').observedAt,older.observedAt);
    assert.equal(payload.officialUpdates.find(x=>x.id==='1018').publishedAt,'2026-09-30T12:17:00.000Z');
    assert.ok(payload.officialUpdates.findIndex(x=>x.id==='1018')>20);
    assert.equal(payload.officialHistory.hasMore,false);
    const {officialTime,recentPublication}=await import('../lib/research/news-time.ts');
    const time=officialTime(payload.officialUpdates.find(x=>x.id==='1018'));
    assert.equal(recentPublication(time.at,time.kind,Date.parse('2026-10-03T08:00:00Z')),false);
  } finally {
    globalThis.fetch=previous.fetch;
    for (const [key,value] of [['RESEARCH_MONITOR_URL',previous.url],['RESEARCH_MONITOR_TOKEN',previous.token]]) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});

test('history overflow diagnostics survive sanitization without weakening count or response guards', async () => {
  const h={limit:100,sourceEligible:150,returned:0,omitted:150,hasMore:true,byteLimited:true,coreOverTarget:false};
  const payload=availableNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[],officialHistory:{...h,private:'SECRET'}});
  assert.deepEqual(payload.officialHistory,h);
  assert.throws(()=>publicNewsPayload({ok:true,enabled:false,items:[],officialUpdates:Array(101).fill({})}));
});


test('post-merge bilingual history is byte bounded without changing other public sections', () => {
  const rows=Array.from({length:100},(_,i)=>({id:String(i),title:'Company update',url:`https://nebius.com/blog/bytes-${i}`,
    publisher:'Nebius',tickers:['NBIS'],observedAt:'2026-10-03T08:00:00Z',bodyJa:'あ'.repeat(12000),bodyEn:'x'.repeat(12000)}));
  const input={ok:true,enabled:false,items:[],officialUpdates:rows,analystUpdates:[],marketUpdates:[]};
  const result=boundedOfficialHistory(input);
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).length<=450000);
  assert.ok(result.officialHistory.hasMore);assert.ok(result.officialHistory.byteLimited);
  assert.deepEqual(result.officialUpdates,rows.slice(0,result.officialUpdates.length));
  assert.deepEqual(result.analystUpdates,input.analystUpdates);assert.deepEqual(result.marketUpdates,input.marketUpdates);
  assert.equal(input.officialUpdates.length,100);
});


test('exact 499900-byte core survives optional new diagnostics without widening the hard guard', () => {
  const input={ok:true,enabled:false,items:[],officialUpdates:[],fixture:''};
  const size=v=>new TextEncoder().encode(JSON.stringify(v)).length;
  input.fixture='x'.repeat(499900-size(input));
  assert.equal(size(input),499900);
  const oldWarn=console.warn,warnings=[];
  try {
    console.warn=message=>warnings.push(message);
    const result=boundedOfficialHistory(input);
    assert.deepEqual(result,input);assert.equal(size(result),499900);
    assert.deepEqual(warnings,['news-history-diagnostics-omitted-response-limit']);
    assert.throws(()=>boundedOfficialHistory({...input,fixture:input.fixture+'x'.repeat(1000)}),/Oversized news core/);
  } finally {console.warn=oldWarn;}
});

test('verified semantic issuer policy stays bound to issuer, source, body and tracked subject', () => {
  const item = { id: '1250', title: 'Nebius Acquires Inferize to Expand Inference Capacity', translationJa: 'Nebius、Inferizeを買収',
    url: 'https://www.globenewswire.com/news-release/2026/09/30/9876543/0/en/nebius-acquires-inferize.html',
    publisher: 'Nebius / GlobeNewswire', tickers: ['NBIS'], observedAt: '2026-09-30T12:19:12Z', publishedAt: '2026-09-30T12:17:00Z',
    bodyJa: 'NebiusはInferizeを買収した。', bodyEn: 'Nebius completed its acquisition of Inferize.',
    syndication: { policy: 'issuer-business-news-v1', issuer: 'Nebius', distributor: 'GlobeNewswire' } };
  const feed = publicNewsPayload({ ok: true, enabled: false, items: [], officialUpdates: [item] });
  assert.equal(feed.officialUpdates[0].syndication.policy, 'issuer-business-news-v1');
  for (const change of [{ syndication: undefined }, { title: 'Unrelated issuer launches a product' },
    { tickers: ['UNTRACKED'] }, { bodyJa: undefined }, { publisher: 'X · Some Reporter' },
    { url: item.url + '?unverified=1' }, { title: 'Nebius conference presentation' }]) {
    assert.throws(() => publicNewsPayload({ ok: true, enabled: false, items: [], officialUpdates: [{ ...item, ...change }] }));
  }
});

test('keyword-free author response survives bounded assessment and the public news API', async () => {
  const { execFileSync } = await import('node:child_process');
  const script = `
import sys,json
sys.path[:0]=['tests','scripts/research']
import test_general_semantic_assessment as fixture
import official_research as research
import signals,x_api
case=fixture.GeneralSemanticAssessmentTests()
case.setUp()
try:
 payload={'includes':{'users':[{'id':'1','username':'wallstengine'}]},'data':[{'id':'1044','author_id':'1','text':fixture.BODY,'created_at':fixture.fixture.PUBLISHED}]}
 assert x_api.parse_response(fixture.fixture.SOURCE,payload,list(signals.ALIASES))==[]
 with research.connect(case.path) as db:
  signals.save(db,fixture.fixture.SOURCE,[],{'_acquired_posts':x_api.acquired_posts(fixture.fixture.SOURCE,payload)},fixture.fixture.FIRST,'synthetic',1)
 assert case.run_once(lambda *_:fixture.result())=='done'
 with research.connect(case.path) as db:
  items=signals.public_official_updates(db,reference=fixture.NOW)
  assert len(items)==1
 print(json.dumps(items))
finally:
 case.doCleanups()
`;
  const official = JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }));
  const previous = {fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
  process.env.RESEARCH_MONITOR_URL='https://monitor.example.com';
  process.env.RESEARCH_MONITOR_TOKEN='synthetic-server-token';
  try {
    globalThis.fetch=async()=>Response.json({ok:true,enabled:true,items:[],officialUpdates:official});
    const response=await GET();
    assert.equal(response.status,200);
    const result=await response.json();
    const story=result.officialUpdates.find(item=>item.url===official[0].url);
    assert.ok(story);
    assert.match(story.bodyJa,/サンプル提供/);
    assert.match(story.bodyEn,/providing samples/);
    assert.equal(Date.parse(story.publishedAt),Date.parse(official[0].publishedAt));
    assert.equal(Date.parse(story.observedAt),Date.parse(official[0].observedAt));
    assert.doesNotMatch(JSON.stringify(result),/semanticAssessment|evidenceQuote|api_key|bearer|sampling its next-generation/i);
  } finally {
    globalThis.fetch=previous.fetch;
    for(const [key,value] of [['RESEARCH_MONITOR_URL',previous.url],['RESEARCH_MONITOR_TOKEN',previous.token]]) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});


test('TrendSpider buyback stories retain their bounded publication marker through server and browser parsing', () => {
  const recap={id:'1246',generalSource:1,tickers:['NVDA'],publisher:'Reported company news',
    title:'NVDA: Reported buyback recap',translationJa:'NVDA：自社株買い実績の振り返り報道',
    url:'https://x.com/TrendSpider/status/2106523440635363385',publishedAt:'2026-10-03T23:15:00.000Z',observedAt:'2026-10-04T02:09:57.822Z',
    bodyJa:'報道によると、NVIDIAは前四半期に$20B弱の自社株を買い戻し、金額はフリーキャッシュフローの約92%に相当した。',
    bodyEn:'According to the report, NVIDIA bought back nearly $20B of its shares during the previous quarter, equivalent to about 92% of free cash flow.'};
  const wrap=row=>({ok:true,enabled:false,items:[],officialUpdates:[row]});
  for(const title of ['NVDA: Reported buyback recap','NVDA: Reported share buyback']) {
    const source={...recap,title};
    const server=publicNewsPayload(wrap(source));
    assert.deepEqual(server.officialUpdates,[source]);
    assert.deepEqual(availableNewsPayload(server),server);
  }
  for(const changes of [
    {generalSource:undefined},{publisher:'TrendSpider'},{title:'NVDA: Reported company development'},
    {title:'AAPL: Reported buyback recap'},{tickers:['NVDA','AAPL']},{tickers:['UNKNOWN']},
    {bodyJa:undefined},{bodyEn:undefined},{translationJa:undefined},
    {url:recap.url+'/photo/1'},{url:recap.url+'?draft=1'},{url:recap.url+'#other'},
    {url:recap.url.replace('TrendSpider','UnknownReporter')},
  ]) assert.deepEqual(availableNewsPayload(wrap({...recap,...changes})).officialUpdates,[]);
});
