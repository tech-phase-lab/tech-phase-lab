// Speed, Nov 26: a visitor opening a 監視22銘柄 page (PRO only) is sent to the stock's FREE page by proxy.ts before the page renders.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { visitorCompanyRedirect } from "../lib/research/company-redirect.ts";

const req = (pathname, { headers = {}, cookies = [], method = "GET" } = {}) => ({ method, pathname, headers: new Headers(headers), cookies });

test("a visitor with no session at all goes to the stock's FREE page", () => {
  assert.equal(visitorCompanyRedirect(req("/research/companies/NVDA"), null), "/research/quote/NVDA?from=search");
  assert.ok(visitorCompanyRedirect(req("/research/companies"), null));
  assert.ok(visitorCompanyRedirect(req("/research/companies/NVDA", { cookies: [{ name: "__client_uat", value: "0" }] }), null), "the SDK's signed-out mark");
});

test("never for a member whose session token is being renewed, the owner, a prefetch or an in-app request", () => {
  for (const cookies of [[{ name: "__client_uat", value: "1763000000" }], [{ name: "__session", value: "eyJ" }], [{ name: "__client_uat_AbC", value: "1763000000" }]]) {
    assert.equal(visitorCompanyRedirect(req("/research/companies/NVDA", { cookies }), null), null, JSON.stringify(cookies));
  }
  assert.equal(visitorCompanyRedirect(req("/research/companies/NVDA"), "user_owner"), null, "a signed-in user (the owner's accounts included) gets the page's own check");
  for (const headers of [{ "next-router-prefetch": "1" }, { rsc: "1" }, { purpose: "prefetch" }, { "sec-purpose": "prefetch;prerender" }]) {
    assert.equal(visitorCompanyRedirect(req("/research/companies/NVDA", { headers }), null), null, JSON.stringify(headers));
  }
  assert.equal(visitorCompanyRedirect(req("/research/companies/NVDA", { method: "HEAD" }), null), null);
});

test("only the company pages; a malformed path does not fail", () => {
  for (const path of ["/research/companies/NVDA/extra", "/research/companyx", "/research/quote/NVDA"]) assert.equal(visitorCompanyRedirect(req(path), null), null, path);
  assert.ok(visitorCompanyRedirect(req("/research/companies/%E0%A4%A"), null), "malformed escape: the FREE page without a ticker, not a 500");
});

test("proxy.ts uses it, and the pages keep their own server check", () => {
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /visitorCompanyRedirect\(\{ method: request\.method, pathname: request\.nextUrl\.pathname, headers: request\.headers, cookies: request\.cookies\.getAll\(\) \}, userId\)/);
  assert.match(readFileSync(new URL("../app/research/companies/[ticker]/page.tsx", import.meta.url), "utf8"), /await requireProPage\(companyFreeHref\(ticker\)\)/);
});
