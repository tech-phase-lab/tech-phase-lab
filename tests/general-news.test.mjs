import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { availableNewsPayload, publicNewsPayload } from "../lib/research/general-news.ts";

const helper = new URL("../lib/research/general-news.ts", import.meta.url).href;
const source = (await readFile(new URL("../app/api/research/news/route.ts", import.meta.url), "utf8"))
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
      assert.ok(update.bodyEn.includes(copy.en));
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
