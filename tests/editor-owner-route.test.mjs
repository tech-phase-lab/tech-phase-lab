import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("../app/api/research/editor-owner/route.ts", import.meta.url), "utf8")
  .replace('import { getMembership } from "@/lib/membership/server";', 'const getMembership = async () => { globalThis.__editorOwner.checks++; if (globalThis.__editorOwner.error) throw Error("synthetic-provider-failure"); return globalThis.__editorOwner.member; };')
  .replace('import { GET as readEditor, POST as writeEditor } from "../editor/route";', 'const readEditor = request => globalThis.__editorOwner.relay(request); const writeEditor = readEditor;');
const route = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64"));
const owner = { status: "signed-in", isAdmin: true, userId: "synthetic-verified-owner" };
const secret = "synthetic-server-only-editor-token";
const url = "https://example.test/api/research/editor-owner";
function request(action = "news-review", payload = { reviewer: "browser-spoof", verified: true }, overrides = {}) {
  return new Request(url, { method: "POST", headers: { origin: "https://example.test", "content-type": "application/json", ...overrides.headers }, body: JSON.stringify({ action, payload }), ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "headers")) });
}
async function withState(run) {
  const previous = process.env.RESEARCH_EDITOR_TOKEN;
  const state = globalThis.__editorOwner = { member: owner, calls: [], checks: 0, error: false, relay: async request => {
    state.calls.push({ method: request.method, url: new URL(request.url), headers: request.headers, body: request.method === "POST" ? await request.json() : null });
    return Response.json({ ok: true, items: [] }, { headers: { "Set-Cookie": "upstream-must-not-be-forwarded", Authorization: "upstream-secret-must-not-be-forwarded" } });
  } };
  process.env.RESEARCH_EDITOR_TOKEN = secret;
  try { await run(state); }
  finally { if (previous === undefined) delete process.env.RESEARCH_EDITOR_TOKEN; else process.env.RESEARCH_EDITOR_TOKEN = previous; delete globalThis.__editorOwner; }
}

test("only an existing verified admin session authorizes owner editing, never a browser role or bearer", async () => withState(async state => {
  for (const member of [{ status: "signed-out", isAdmin: true }, { status: "unavailable", isAdmin: true }, { status: "signed-in", isAdmin: false, plan: "free" }, { status: "signed-in", isAdmin: false, plan: "pro" }, { status: "signed-in", isAdmin: "true" }]) {
    state.member = member;
    const headers = { authorization: `Bearer ${secret}`, cookie: "role=admin; isAdmin=true", "x-user-id": owner.userId };
    assert.equal((await route.GET(new Request(url + "?kind=news", { headers }))).status, 403);
    assert.equal((await route.POST(request("news-draft", {}, { headers }))).status, 403);
  }
  assert.equal(state.calls.length, 0);
}));

test("reloads and independent tabs reuse the session without exposing, saving, or extending credentials", async () => withState(async state => {
  for (let i = 0; i < 3; i++) {
    const response = await route.GET(new Request(url + "?kind=news"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("authorization"), null);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.doesNotMatch(await response.text(), /token|synthetic-server|Bearer/);
    assert.equal(state.calls[i].headers.get("authorization"), `Bearer ${secret}`);
    assert.equal(state.calls[i].headers.get("cookie"), null);
  }
  assert.equal(state.checks, 3);
  state.member = { status: "signed-out" };
  assert.equal((await route.GET(new Request(url))).status, 403);
  assert.equal((await route.POST(request())).status, 403);
  state.member = { ...owner, isAdmin: false };
  assert.equal((await route.GET(new Request(url))).status, 403);
  assert.equal(state.calls.length, 3);
}));

test("same-origin JSON is required for every mutation and cross-site reads are refused", async () => withState(async state => {
  for (const headers of [ { origin: "https://attacker.test" }, { origin: "null" }, { origin: "" }, { origin: "https://example.test.attacker.test" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { "content-type": "text/plain" }, { "content-type": "application/jsonp" } ]) {
    assert.equal((await route.POST(request("news-draft", {}, { headers }))).status, 403);
  }
  assert.equal((await route.POST(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).status, 403);
  assert.equal((await route.GET(new Request(url, { headers: { origin: "https://attacker.test" } }))).status, 403);
  assert.equal((await route.GET(new Request(url, { headers: { "sec-fetch-site": "cross-site" } }))).status, 403);
  assert.equal(state.calls.length, 0);
  assert.equal((await route.POST(request("news-draft", {}, { headers: { "content-type": "application/json; charset=utf-8", "sec-fetch-site": "same-origin" } }))).status, 200);
}));

test("read scope is limited to news, official-IR briefs and diagnostics; annual reports and posts remain denied", async () => withState(async state => {
  for (const query of ["", "?kind=news", "?kind=official-research&view=pending", "?kind=signals&eventId=123&limit=30"]) {
    assert.equal((await route.GET(new Request(url + query))).status, 200, query);
    assert.equal(state.calls.at(-1).url.search, query);
  }
  for (const query of ["?kind=posts", "?kind=annual", "?kind=", "?kind=anything", "?kind=news&kind=posts", "?kind=news&kind=news"]) assert.equal((await route.GET(new Request(url + query))).status, 403, query);
  assert.equal(state.calls.length, 4);
}));

test("write scope cannot expand to annual reports, posts, diagnostics or an arbitrary action", async () => withState(async state => {
  for (const action of ["annual-draft", "annual-review", "post-draft", "post-review", "official-research-retry", "signals-review", "__proto__", "constructor", null, {}, ["news-draft"]]) assert.equal((await route.POST(request(action))).status, 403, String(action));
  assert.equal(state.calls.length, 0);
  for (const action of ["generate", "draft", "review", "news-generate", "news-retry", "news-draft", "news-review"]) {
    const response = await route.POST(request(action));
    assert.equal(response.status, 200, action);
    const sent = state.calls.at(-1);
    assert.equal(sent.body.action, action);
    assert.equal(sent.headers.get("authorization"), `Bearer ${secret}`);
    assert.equal(sent.body.payload.reviewer, action === "review" || action === "news-review" ? owner.userId : "browser-spoof");
    assert.equal(sent.body.payload.verified, true);
  }
}));

test("malformed and oversized bodies fail before reaching the editor service", async () => withState(async state => {
  for (const payload of [null, [], "text", 42]) assert.equal((await route.POST(request("news-draft", payload))).status, 400);
  assert.equal((await route.POST(request("news-draft", {}, { body: "{" }))).status, 400);
  assert.equal((await route.POST(request("news-draft", { text: "あ".repeat(30_000) }))).status, 413);
  assert.equal(state.calls.length, 0);
}));

test("missing server setup and provider outages fail closed without response secret details", async () => withState(async state => {
  for (const value of [undefined, "short", "invalid secret with spaces".repeat(3)]) {
    if (value === undefined) delete process.env.RESEARCH_EDITOR_TOKEN; else process.env.RESEARCH_EDITOR_TOKEN = value;
    for (const response of [await route.GET(new Request(url)), await route.POST(request())]) {
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, error: "setup-required" });
    }
  }
  process.env.RESEARCH_EDITOR_TOKEN = secret;
  state.error = true;
  assert.equal((await route.GET(new Request(url))).status, 503);
  assert.equal((await route.POST(request())).status, 503);
  assert.equal(state.calls.length, 0);
}));

test("Clerk middleware covers only the added owner route while token APIs remain unchanged", () => {
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /"\/api\/research\/editor-owner"/);
  assert.doesNotMatch(proxy, /"\/api\/research\/editor"/);
  assert.doesNotMatch(source, /Set-Cookie|cookies\(|localStorage|sessionStorage|maxAge|expiresAt|createSession/);
});
