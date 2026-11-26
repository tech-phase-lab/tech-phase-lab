// Nov 17 (owner, filming the PRO video): the sample price-target notice opens /research/price-targets?demo=nvda, and the page then shows
// the same made-up change (NVDA, Sample Securities, $295 → $340, raised, timed now) at the top of the list, styled as a real row.
// Browser only, nothing for anyone without the query, and the query is removed from the address bar after it is read.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { priceTargetSample, withoutSampleQuery, withPriceTargetSample } from "../lib/research/price-target-sample.ts";
import { openPushPath, pushOpenPath } from "../lib/research/push-open.ts";
import { cleanPushServerNotice } from "../lib/research/push-server-notice.ts";

const NOW = Date.UTC(2026, 10, 17, 6, 6, 21);
const params = query => new URLSearchParams(query);

async function bundle(path, searchStub = false) {
  const dir = await mkdtemp(new URL("../.price-target-sample-", import.meta.url));
  try {
    const outfile = `${dir}/component.mjs`;
    await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external",
      jsx: "automatic", outfile, plugins: [{ name: "stubs", setup(b) {
        b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default new Proxy({}, {get: (_, key) => key})", loader: "js" }));
        if (searchStub) {
          b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "next-navigation", namespace: "stub" }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "js",
            contents: "export const useSearchParams = () => new URLSearchParams(globalThis.__search ?? '');" }));
        }
      } }] });
    return await import(pathToFileURL(outfile).href);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test("the sample row is the notice's change, timed now, only for demo=nvda", () => {
  const item = priceTargetSample(params("demo=nvda"), NOW);
  assert.deepEqual({ ticker: item.ticker, firm: item.firm, previous: item.previous, latest: item.latest }, { ticker: "NVDA", firm: "Sample Securities", previous: 295, latest: 340 });
  assert.equal(item.publishedAt, new Date(NOW).toISOString());
  assert.equal(item.observedAt, new Date(NOW).toISOString());
  for (const query of ["", "demo=amd", "demo=NVDA", "x=nvda"]) assert.equal(priceTargetSample(params(query), NOW), null, query);
  assert.equal(priceTargetSample(null, NOW), null);
  assert.deepEqual(withPriceTargetSample([{ id: 5 }], item).map(row => row.id), [0, 5]);
  assert.deepEqual(withPriceTargetSample([{ id: 5 }], null).map(row => row.id), [5]);
  assert.equal(withoutSampleQuery("https://techphase.app/research/price-targets?demo=nvda"), "/research/price-targets");
  assert.equal(withoutSampleQuery("https://techphase.app/research/price-targets?demo=nvda&a=1#x"), "/research/price-targets?a=1#x");
  assert.equal(withoutSampleQuery("https://techphase.app/research/price-targets"), null);
});

test("the sample row renders exactly like a real raised row (same card, same classes)", async () => {
  const { default: Card } = await bundle("../app/research/price-target-card.tsx");
  const sample = priceTargetSample(params("demo=nvda"), NOW);
  const real = { ...sample, id: 77, source: "X · TipRanks", url: "https://x.com/tipranks/status/1" };
  const html = renderToStaticMarkup(React.createElement(Card, { item: sample, lang: "ja", now: NOW }));
  assert.equal(html, renderToStaticMarkup(React.createElement(Card, { item: real, lang: "ja", now: NOW })));
  for (const text of ["NVDA", "Sample Securities", "$295 → $340", "引き上げ", "+15.3%"]) assert.ok(html.includes(text), text);
});

test("the panel puts the sample first, and shows nothing extra without it", async () => {
  const { default: Panel } = await bundle("../app/research/price-targets-panel.tsx");
  const sample = priceTargetSample(params("demo=nvda"), NOW);
  const withSample = renderToStaticMarkup(React.createElement(Panel, { lang: "ja", sample }));
  assert.ok(withSample.includes("Sample Securities"));
  assert.ok(!renderToStaticMarkup(React.createElement(Panel, { lang: "ja" })).includes("Sample Securities"));
  assert.ok(!fs.readFileSync(new URL("../app/research/news/news-feed.tsx", import.meta.url), "utf8").includes("sample"), "the news page never shows it");
});

test("the 目標株価 page shows one line under its title instead of the panel's own heading; home keeps the heading (owner, Nov 26)", async () => {
  const { default: Panel } = await bundle("../app/research/price-targets-panel.tsx");
  for (const lang of ["ja", "en"]) {
    const home = renderToStaticMarkup(React.createElement(Panel, { lang }));
    const page = renderToStaticMarkup(React.createElement(Panel, { lang, heading: false }));
    for (const text of ["PRICE TARGETS", lang === "ja" ? "目標株価の変更" : "Price target changes", lang === "ja" ? "過去1週間" : "Past week"]) {
      assert.ok(home.includes(text), text);
      assert.ok(!page.includes(text), text);
    }
  }
  const source = fs.readFileSync(new URL("../app/research/price-targets/screen.tsx", import.meta.url), "utf8");
  assert.match(source, /description=\{lang === "ja" \? "アナリストによる変更・過去1週間" : "Analyst changes · past week"\}/);
  assert.match(source, /<PriceTargetsPanel [^>]*heading=\{false\}/);
  assert.doesNotMatch(fs.readFileSync(new URL("../app/research/news/news-feed.tsx", import.meta.url), "utf8"), /heading=/);
});

test("opened with ?demo=nvda the page hands over the row and removes the query (history.replaceState); a reload shows the normal page", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", { url: "https://techphase.app/research/price-targets?demo=nvda" });
  const keep = {};
  for (const key of ["window", "document", "navigator"]) { keep[key] = Object.getOwnPropertyDescriptor(globalThis, key); Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] }); }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    const { default: Reader } = await bundle("../app/research/price-target-sample-query.tsx", true);
    const got = [];
    const replaced = [];
    const original = dom.window.history.replaceState.bind(dom.window.history);
    dom.window.history.replaceState = (state, unused, url) => { replaced.push(url); original(state, unused, url); };
    globalThis.__search = "demo=nvda";
    const root = createRoot(dom.window.document.getElementById("root"));
    await act(async () => { root.render(React.createElement(Reader, { onSample: item => got.push(item) })); });
    assert.equal(got.length, 1);
    assert.equal(got[0].firm, "Sample Securities");
    assert.deepEqual(replaced, ["/research/price-targets"]);
    assert.equal(dom.window.location.search, "");
    // A reload (no query): nothing.
    globalThis.__search = "";
    const again = [];
    await act(async () => { root.render(React.createElement(Reader, { onSample: item => again.push(item) })); });
    assert.deepEqual(again, []);
    await act(async () => { root.unmount(); });
  } finally {
    delete globalThis.__search;
    for (const key of Object.keys(keep)) { if (keep[key]) Object.defineProperty(globalThis, key, keep[key]); else delete globalThis[key]; }
  }
});

test("the notice page keeps its query through the app's checks and navigation, also when the price-target page is already shown", () => {
  const page = "/research/price-targets?demo=nvda";
  assert.equal(pushOpenPath({ type: "open", url: page }), page);
  assert.equal(pushOpenPath({ type: "open", url: "/research/price-targets?demo=amd" }), null);
  assert.equal(pushOpenPath({ type: "open", url: "/research/news?demo=nvda" }), null);
  assert.equal(cleanPushServerNotice({ id: "0123456789abcdef0123456789abcdef", kind: "price-targets", page, title: "NVDA · 目標株価の変更",
    sentAt: 1, ageMs: 1000, state: "new" }).page, page);
  for (const pathname of ["/research/notifications", "/research/price-targets"]) {
    const moves = [];
    openPushPath(page, { pathname, hash: "" }, { push: href => moves.push(href), setHash: hash => moves.push(hash) });
    assert.deepEqual(moves, [page], pathname);
  }
  const plain = [];
  openPushPath("/research/price-targets", { pathname: "/research/price-targets", hash: "" }, { push: href => plain.push(href), setHash: () => {} });
  assert.deepEqual(plain, [], "a real notice for the page already shown still does not reload it");
});
