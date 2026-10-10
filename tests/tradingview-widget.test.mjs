import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/research/stocks/widget/route.ts";

const request = (params) => new Request(`https://example.test/research/stocks/widget?${new URLSearchParams(params)}`);

test("each symbol has a standalone, uncached provider document", async () => {
  for (const symbol of ["NASDAQ:NVDA", "NASDAQ:MU", "NASDAQ:NBIS", "NYSE:BRK.B"]) {
    const result = GET(request({ symbol, kind: "compact", lang: "ja" }));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(result.headers.get("x-frame-options"), "SAMEORIGIN");
    const html = await result.text();
    assert.match(html, /<!doctype html>/);
    assert.ok(html.includes(JSON.stringify(symbol)));
    assert.match(html, /embed-widget-symbol-info\.js/);
    assert.match(html, /"isTransparent":false/);
    assert.match(html, /ResizeObserver/);
    assert.match(html, /parent.postMessage/);
    assert.match(html, /location.origin/);
  }
});

test("chart document starts with a real height and a 12-month daily range", async () => {
  const html = await GET(request({ symbol: "NASDAQ:NVDA", kind: "chart", lang: "en" })).text();
  assert.match(html, /height:100vh/);
  assert.match(html, /html,body\{[^}]*height:100%/);
  assert.match(html, /embed-widget-advanced-chart\.js/);
  assert.match(html, /"range":"12M"/);
  assert.match(html, /"interval":"D"/);
  assert.match(html, /"timezone":"Etc\/UTC"/);
  assert.match(html, /"locale":"en"/);
});

test("widget route rejects unsupported kinds and markup in symbols", () => {
  for (const symbol of ["", "<script>alert(1)</script>", "NASDAQ:NVDA\"", "NASDAQ:NVDA&x=1", "../../admin"]) {
    assert.equal(GET(request({ symbol, kind: "compact" })).status, 400);
  }
  assert.equal(GET(request({ symbol: "NASDAQ:NVDA", kind: "arbitrary" })).status, 400);
});
