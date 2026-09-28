import assert from "node:assert/strict";
import test from "node:test";

import { GET, POST } from "../app/api/research/editor/route.ts";

const authorization = "Bearer editor-token-at-least-24-characters";

test("news editor forwards only authenticated explicit actions", async () => {
  const previousUrl = process.env.RESEARCH_MONITOR_URL;
  const previousFetch = globalThis.fetch;
  process.env.RESEARCH_MONITOR_URL = "https://monitor.example.com";
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ ok: true, items: [] }); };
  try {
    const body = action => JSON.stringify({ action, payload: { articleId: "saved-id", revision: "current" } });
    assert.equal((await POST(new Request("http://localhost/api/research/editor", { method: "POST", body: body("news-draft") }))).status, 401);
    assert.equal(calls.length, 0);
    await GET(new Request("http://localhost/api/research/editor?kind=news", { headers: { Authorization: authorization } }));
    assert.equal(new URL(calls[0].url).pathname, "/admin/news");
    for (const action of ["generate", "retry", "draft", "review"]) {
      const result = await POST(new Request("http://localhost/api/research/editor", { method: "POST", headers: { Authorization: authorization }, body: body(`news-${action}`) }));
      assert.equal(result.status, 200);
      const sent = calls.at(-1);
      assert.equal(new URL(sent.url).pathname, `/admin/news/${action}`);
      assert.equal(sent.init.headers.Authorization, authorization);
      assert.deepEqual(JSON.parse(sent.init.body), { articleId: "saved-id", revision: "current" });
      assert.equal(result.headers.get("Cache-Control"), "no-store");
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.RESEARCH_MONITOR_URL;
    else process.env.RESEARCH_MONITOR_URL = previousUrl;
  }
});

test("editor proxy rejects monitor URLs with embedded credentials", async () => {
  const previousUrl = process.env.RESEARCH_MONITOR_URL;
  const previousFetch = globalThis.fetch;
  process.env.RESEARCH_MONITOR_URL = "https://user:password@monitor.example.com";
  let called = false;
  globalThis.fetch = async () => { called = true; return Response.json({ ok: true }); };
  try {
    const response = await GET(new Request("http://localhost/api/research/editor?kind=news", {
      headers: { Authorization: authorization },
    }));
    assert.equal(response.status, 503);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.RESEARCH_MONITOR_URL;
    else process.env.RESEARCH_MONITOR_URL = previousUrl;
  }
});

test("private signals forward filters and require editor credentials", async () => {
  const previousUrl = process.env.RESEARCH_MONITOR_URL;
  const previousFetch = globalThis.fetch;
  process.env.RESEARCH_MONITOR_URL = "http://127.0.0.1:8765";
  const requests = [];
  globalThis.fetch = async (url, init) => { requests.push({ url: String(url), init }); return Response.json({ ok: true, items: [] }); };
  try {
    const unauth = await GET(new Request("http://localhost/api/research/editor?kind=signals"));
    assert.equal(unauth.status, 401);
    assert.equal(requests.length, 0);
    const response = await GET(new Request("http://localhost/api/research/editor?kind=signals&view=changed&ticker=NBIS", { headers: { Authorization: authorization } }));
    assert.equal(response.status, 200);
    const url = new URL(requests[0].url);
    assert.equal(url.pathname, "/admin/signals");
    assert.equal(url.searchParams.get("ticker"), "NBIS");
    assert.equal(url.searchParams.get("view"), "changed");
    assert.equal(requests[0].init.headers.Authorization, authorization);
    const invalid = await GET(new Request("http://localhost/api/research/editor?kind=signals&view=approved", { headers: { Authorization: authorization } }));
    assert.equal(invalid.status, 400);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.RESEARCH_MONITOR_URL;
    else process.env.RESEARCH_MONITOR_URL = previousUrl;
  }
});

test("editor proxy validates and forwards annual review filters", async () => {
  const previousUrl = process.env.RESEARCH_MONITOR_URL;
  const previousFetch = globalThis.fetch;
  process.env.RESEARCH_MONITOR_URL = "http://127.0.0.1:8765";
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json({
      ok: true,
      view: "invalid",
      filteredTotal: 0,
      counts: {},
      items: [],
    });
  };
  try {
    const response = await GET(new Request(
      "http://localhost/api/research/editor?kind=annual&view=invalid&limit=200",
      { headers: { Authorization: authorization } },
    ));
    assert.equal(response.status, 200);
    assert.equal(requests.length, 1);
    const forwarded = new URL(requests[0].url);
    assert.equal(forwarded.pathname, "/admin/annual-briefs");
    assert.equal(forwarded.searchParams.get("view"), "invalid");
    assert.equal(forwarded.searchParams.get("limit"), "50");
    assert.equal(requests[0].init.headers.Authorization, authorization);

    const invalid = await GET(new Request(
      "http://localhost/api/research/editor?kind=annual&view=unknown",
      { headers: { Authorization: authorization } },
    ));
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, "invalid-review-filter");
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.RESEARCH_MONITOR_URL;
    else process.env.RESEARCH_MONITOR_URL = previousUrl;
  }
});

test("manual columns proxy authenticates actions and bounds archive pagination", async () => {
  const saved = { url: process.env.RESEARCH_MONITOR_URL, fetch: globalThis.fetch };
  process.env.RESEARCH_MONITOR_URL = "https://monitor.example";
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: new URL(url), init }); return Response.json({ ok: true, items: [] }); };
  try {
    assert.equal((await GET(new Request("https://example.test/api/research/editor?kind=posts"))).status, 401);
    assert.equal(calls.length, 0);
    assert.equal((await GET(new Request("https://example.test/api/research/editor?kind=posts&offset=20", { headers: { Authorization: authorization } }))).status, 200);
    assert.equal(calls[0].url.pathname, "/admin/posts");
    assert.equal(calls[0].url.searchParams.get("offset"), "20");
    for (const offset of ["-1", "Infinity", "0.5", "100001"]) assert.equal((await GET(new Request(`https://example.test/api/research/editor?kind=posts&offset=${offset}`, { headers: { Authorization: authorization } }))).status, 400);
    for (const action of ["draft", "review"]) {
      const body = JSON.stringify({ action: `post-${action}`, payload: { id: "synthetic-column-0001", version: 1 } });
      assert.equal((await POST(new Request("https://example.test/api/research/editor", { method: "POST", body }))).status, 401);
      assert.equal((await POST(new Request("https://example.test/api/research/editor", { method: "POST", headers: { Authorization: authorization }, body }))).status, 200);
      assert.equal(calls.at(-1).url.pathname, `/admin/posts/${action}`);
    }
  } finally { globalThis.fetch = saved.fetch; if (saved.url === undefined) delete process.env.RESEARCH_MONITOR_URL; else process.env.RESEARCH_MONITOR_URL = saved.url; }
});
