import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { GET, POST } from "../app/api/research/editor/route.ts";

const authorization = "Bearer synthetic-editor-token-at-least-24-characters";
const values = { kind: "official-research", retainedSourceId: "x-wallstengine", retainedUrl: "https://x.com/wallstengine/status/2106737247274065925", expectedSourceSha: "a".repeat(64) };
const base = "https://example.test/api/research/editor";
const request = (query = new URLSearchParams(values), auth = authorization) => new Request(`${base}?${query}`, { headers: auth ? { Authorization: auth } : {} });
async function withFetch(run) {
  const saved = { fetch: globalThis.fetch, url: process.env.RESEARCH_MONITOR_URL }; const calls = [];
  process.env.RESEARCH_MONITOR_URL = "https://monitor.example";
  globalThis.fetch = async (url, init) => { calls.push({ url: new URL(url), init }); return Response.json({ ok: true, detail: { sourceSha: values.expectedSourceSha } }); };
  try { await run(calls); } finally { globalThis.fetch = saved.fetch; if (saved.url === undefined) delete process.env.RESEARCH_MONITOR_URL; else process.env.RESEARCH_MONITOR_URL = saved.url; }
}
test("one retained selector uses existing authenticated GET without event/body/cursor or default queue args", async () => withFetch(async calls => {
  assert.equal((await GET(request(undefined, null))).status, 401); assert.equal(calls.length, 0);
  const response = await GET(request()); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls[0].url.pathname, "/admin/official-research");
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), { retainedSourceId: values.retainedSourceId, retainedUrl: values.retainedUrl, expectedSourceSha: values.expectedSourceSha });
  assert.equal(calls[0].init.headers.Authorization, authorization); assert.equal(calls[0].init.method ?? "GET", "GET");
  assert.equal(calls[0].init.cache, "no-store");
  for (const action of ["retained-source-detail", "retained-source-repair"]) assert.equal((await POST(new Request(base, { method: "POST", headers: { Authorization: authorization }, body: JSON.stringify({ action, payload: values }) }))).status, 400);
  assert.equal(calls.length, 1);
}));
test("malformed, duplicate, mixed or unbounded retained keys fail before upstream reads", async () => withFetch(async calls => {
  const invalid = [];
  for (const key of Object.keys(values)) { const query = new URLSearchParams(values); query.append(key, values[key]); invalid.push(query); const missing = new URLSearchParams(values); missing.delete(key); invalid.push(missing); }
  for (const [key, value] of Object.entries({ kind: "signals", retainedSourceId: "../private", retainedUrl: values.retainedUrl + "?provider=all", expectedSourceSha: "A".repeat(64) })) { const query = new URLSearchParams(values); query.set(key, value); invalid.push(query); }
  for (const key of ["eventId", "expectedBodySha", "beforeEventId", "terminalBeforeEventId", "limit", "view", "includeAll", "offset"]) { const query = new URLSearchParams(values); query.set(key, "1"); invalid.push(query); }
  for (const url of [values.retainedUrl.replace("x.com", "evil.example"), values.retainedUrl.replace("x.com", "user@x.com"), values.retainedUrl.replace("x.com", "x.com:443"), values.retainedUrl + "#fragment", values.retainedUrl + "\n"]) { const query = new URLSearchParams(values); query.set("retainedUrl", url); invalid.push(query); }
  for (const query of invalid) assert.equal((await GET(request(query))).status, 400, String(query));
  assert.equal(calls.length, 0);
}));

const ownerSource = readFileSync(new URL("../app/api/research/editor-owner/route.ts", import.meta.url), "utf8")
  .replace('import { getMembership } from "@/lib/membership/server";', 'const getMembership = async () => globalThis.__retainedOwner.member;')
  .replace('import { GET as readEditor, POST as writeEditor } from "../editor/route";', 'const readEditor = request => globalThis.__retainedOwner.read(request); const writeEditor = readEditor;');
const owner = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(ownerSource)).toString("base64"));
test("retained fields never bypass existing verified owner session or cross-origin rules", async () => {
  const saved = process.env.RESEARCH_EDITOR_TOKEN; process.env.RESEARCH_EDITOR_TOKEN = "synthetic-server-only-editor-token";
  const calls = []; globalThis.__retainedOwner = { member: null, read: async request => { calls.push(request); return Response.json({ ok: true }, { headers: { Authorization: "secret", "Set-Cookie": "secret" } }); } };
  try {
    const url = "https://example.test/api/research/editor-owner?" + new URLSearchParams(values);
    for (const member of [null, { status: "signed-out", isAdmin: true }, { status: "signed-in", isAdmin: false }, { status: "signed-in", plan: "pro", isAdmin: false }]) {
      globalThis.__retainedOwner.member = member;
      const response = await owner.GET(new Request(url, { headers: { Authorization: authorization, "x-owner": "true" } }));
      assert.ok([403, 503].includes(response.status));
    }
    assert.equal(calls.length, 0);
    globalThis.__retainedOwner.member = { status: "signed-in", isAdmin: true };
    assert.equal((await owner.GET(new Request(url, { headers: { origin: "https://other.example" } }))).status, 403);
    assert.equal(calls.length, 0);
    const response = await owner.GET(new Request(url)); assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.equal(response.headers.get("Vary"), "Cookie");
    assert.equal(response.headers.get("Authorization"), null); assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(calls[0].headers.get("Authorization"), "Bearer synthetic-server-only-editor-token");
    assert.doesNotMatch(await response.text(), /secret|token/);
  } finally { delete globalThis.__retainedOwner; if (saved === undefined) delete process.env.RESEARCH_EDITOR_TOKEN; else process.env.RESEARCH_EDITOR_TOKEN = saved; }
});
