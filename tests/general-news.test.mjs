import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { publicNewsPayload } from "../lib/research/general-news.ts";

const helper = new URL("../lib/research/general-news.ts", import.meta.url).href;
const source = (await readFile(new URL("../app/api/research/news/route.ts", import.meta.url), "utf8"))
  .replace('"@/lib/research/general-news"', JSON.stringify(helper));
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
    assert.equal(failure.status, 503);
    assert.deepEqual(await failure.json(), { ok: false, items: [] });
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
});
