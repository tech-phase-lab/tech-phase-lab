import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { publicNewsPayload } from "../lib/research/general-news.ts";

const helper = new URL("../lib/research/general-news.ts", import.meta.url).href;
const source = (await readFile(new URL("../app/api/research/news/route.ts", import.meta.url), "utf8"))
  .replace('"@/lib/research/general-news"', JSON.stringify(helper))
  .replace('"@/lib/research/official-result-events"', JSON.stringify(new URL("../lib/research/official-result-events.ts", import.meta.url).href))
  .replace("'@/lib/research/mu-latest'", JSON.stringify(new URL("../lib/research/mu-latest.ts", import.meta.url).href));
const { GET } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64"));
const item = { id: "a".repeat(64), title: "Synthetic report", url: "https://publisher.example/report", publisher: "Publisher", tickers: ["MU"],
  publishedAt: "2026-09-28T00:00:00Z", observedAt: "2026-09-28T00:01:00Z", approvedAt: "2026-09-28T00:02:00Z",
  summaryJa: "これは合成テスト用の確認済みニュース要約です。", summaryEn: "This is a reviewed synthetic news summary.",
  impactJa: "合成テストでは事業への影響を両面と評価しています。", impactEn: "The synthetic test assesses mixed business impact.",
  impactLabel: "mixed", confidence: "medium" };

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
    assert.equal(failure.status, 200);
    const safe = await failure.json();
    assert.deepEqual(safe.items, []);
    assert.equal(safe.enabled, false);
    assert.equal(safe.officialUpdates[0].researchId, "mu-q4-2026");
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
    assert.equal(response.status, 200);
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
