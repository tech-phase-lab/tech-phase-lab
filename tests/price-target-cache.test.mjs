import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/api/research/price-targets/route.ts";

test("identical public price targets share a one-second edge cache without slowing page refresh", async () => {
  const priorUrl = process.env.RESEARCH_MONITOR_URL;
  const priorToken = process.env.RESEARCH_MONITOR_TOKEN;
  const priorFetch = globalThis.fetch;
  process.env.RESEARCH_MONITOR_URL = "https://monitor.example.com";
  process.env.RESEARCH_MONITOR_TOKEN = "test-only-token";
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return Response.json({ ok: true, items: [] });
  };
  try {
    const response = await GET();
    assert.equal(response.status, 200);
    assert.equal(request.url, "https://monitor.example.com/price-targets");
    assert.equal(request.options.headers.Authorization, "Bearer test-only-token");
    assert.equal(response.headers.get("Vercel-CDN-Cache-Control"), "public, s-maxage=1");
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=0, must-revalidate");
    assert.deepEqual(await response.json(), { ok: true, items: [] });

    globalThis.fetch = async () => Response.json({ ok: false }, { status: 503 });
    const failed = await GET();
    assert.equal(failed.status, 503);
    assert.equal(failed.headers.get("Cache-Control"), "no-store");
    assert.equal(failed.headers.get("Vercel-CDN-Cache-Control"), null);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorUrl === undefined) delete process.env.RESEARCH_MONITOR_URL;
    else process.env.RESEARCH_MONITOR_URL = priorUrl;
    if (priorToken === undefined) delete process.env.RESEARCH_MONITOR_TOKEN;
    else process.env.RESEARCH_MONITOR_TOKEN = priorToken;
  }
});
