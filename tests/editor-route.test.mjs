import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "../app/api/research/editor/route.ts";

const authorization = "Bearer editor-token-at-least-24-characters";

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
