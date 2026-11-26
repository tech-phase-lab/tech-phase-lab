import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("a visitor with no session is sent to the stock's FREE page before the PRO company page renders (speed, Nov 26)", () => {
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /const COMPANY_PAGE = \/\^\\\/research\\\/companies\(\?:\\\/\(\[\^\/\]\+\)\)\?\\\/\?\$\/;/);
  // Only when the identity middleware finds no user: signed-in readers (the owner's accounts included) still get the page's own check.
  assert.match(proxy, /const \{ userId \} = await auth\(\);\n  if \(userId\) return;/);
  assert.match(proxy, /NextResponse\.redirect\(new URL\(companyFreeHref\(ticker\), request\.url\), 307\)/);
  // The pages keep their server check.
  assert.match(readFileSync(new URL("../app/research/companies/[ticker]/page.tsx", import.meta.url), "utf8"), /await requireProPage\(companyFreeHref\(ticker\)\)/);
});

test("the redirect matches only the company pages", () => {
  const pattern = /^\/research\/companies(?:\/([^/]+))?\/?$/;
  assert.equal(pattern.exec("/research/companies/NVDA")?.[1], "NVDA");
  assert.ok(pattern.test("/research/companies"));
  for (const path of ["/research/companies/NVDA/extra", "/research/companyx", "/research/quote/NVDA"]) assert.equal(pattern.test(path), false);
});
