import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCompanyWire } from "../lib/research/company-wire.ts";
import { homeStockStories, stockNewsWire } from "../lib/research/home-stock-news.ts";
import { homePulseItems } from "../lib/research/news-pulse-items.ts";

// Owner, Nov 15: the home's top band and news list show the Stock News API stories, not the Tech Alerts (ハイテク速報) items.
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const now = Date.parse("2026-11-15T03:00:00Z");
const row = (id, titleEn, titleJa, source, minutes, shortJa = null) => ({ id, titleEn, titleJa, shortJa, publisher: "Reuters", origin: "third-party",
  url: `https://news.example/${id}`, publishedAt: new Date(now - minutes * 60_000).toISOString(), ...(source ? { source } : {}) });
const wire = () => parseCompanyWire({ ok: true, items: {
  NVDA: [row("s1", "Nvidia wins a large order from Meta", "エヌビディア、メタから大型受注", "stocknews", 10, "エヌビディア大型受注"),
    row("y1", "Nvidia ships a new rack system", "エヌビディアが新ラックを出荷", "yahoo", 5, "エヌビディア新ラック出荷")],
  MKT: [row("m1", "Oil jumps on Hormuz tension", "ホルムズ緊張で原油が急騰", "stocknews", 20, "原油が急騰")],
  AAPL: [row("s2", "Apple unveils a new chip", null, "stocknews", 2)],
} }).items;
const at = new Date(now - 60_000).toISOString();
const official = { id: "o1", generalSource: 1, tickers: ["MU"], publisher: "Reported company news", url: "https://x.com/wallstengine/status/2106377353018601",
  title: "MU raises HBM outlook", translationJa: "MU、HBM需要で見通しを引き上げ", publishedAt: at, observedAt: at, bodyJa: "MU、HBM需要で見通しを引き上げ\n\n長い記事本文。",
  bodyEn: "MU raises HBM outlook\n\nLong article body.", pulseTitleJa: "MU、HBM需要で見通しを引き上げ", pulseTitleEn: "MU raises HBM outlook" };
const feed = { ok: true, enabled: false, items: [], officialUpdates: [official], marketUpdates: [] };

test("the company headline feed carries where each row came from; a malformed or missing source is left out", () => {
  const items = wire();
  assert.equal(items.NVDA[0].source, "stocknews");
  assert.equal(items.NVDA[1].source, "yahoo");
  const odd = parseCompanyWire({ ok: true, items: { NVDA: [{ ...row("x", "Nvidia news item", "エヌビディアのニュース", null, 1), source: "Stock News <b>" }, row("z", "Nvidia older", null, null, 3)] } }).items;
  assert.deepEqual(odd.NVDA.map(item => "source" in item), [false, false]);
});

test("only Stock News API rows reach the home list, market news included; the Japanese list has Japanese headlines only", () => {
  const items = wire();
  assert.deepEqual(Object.keys(stockNewsWire(items)).sort(), ["AAPL", "MKT", "NVDA"]);
  assert.equal(stockNewsWire(items), stockNewsWire(items), "the same feed gives the same object, so the story grouping is kept");
  assert.deepEqual(homeStockStories(items, "ja").map(story => story.id), ["s1", "m1"], "the untranslated Apple story and the Yahoo row are not listed");
  assert.deepEqual(homeStockStories(items, "en").map(story => story.id), ["s2", "s1", "m1"]);
  assert.deepEqual(homeStockStories({}, "ja"), []);
});

test("the LIVE band carries the Tech Alerts items only, never a Stock News API story or another company headline (owner, Nov 15)", () => {
  for (const lang of ["ja", "en"]) {
    const ids = homePulseItems(feed, lang, now, wire(), 5).map(item => item.id);
    assert.ok(ids.length > 0, "the Tech Alerts items are shown");
    assert.ok(ids.every(id => !id.startsWith("wire-")), "no company-wire row on the band");
    assert.deepEqual(ids, homePulseItems(feed, lang, now, {}, 5).map(item => item.id), "the same band with or without the wire");
  }
});

test("the home list asks for the Stock News API stories; the Top Topics page and the official tab keep their own lists", () => {
  const panel = read("../app/research/news/general-news-panel.tsx");
  assert.match(read("../app/research/news/news-feed.tsx"), /<GeneralNewsPanel [^>]*officialOnly=\{view === "official"\} stockNews \/>/);
  assert.match(panel, /const stockOnly = stockNews && !officialOnly && !generalOnly;/);
  assert.match(panel, /const stockStories = stockOnly \? homeStockStories\(wire, lang\) : \[\];/);
  assert.match(panel, /\.\.\.\(stockOnly \? \[\] : official\)\.map\(/);
  assert.match(panel, /const news = officialOnly \|\| stockOnly \? \[\] :/);
  assert.match(panel, /const market = officialOnly \|\| generalOnly \|\| stockOnly \? \[\] :/);
  assert.match(panel, /const originalPreview = officialOnly \|\| generalOnly \|\| stockOnly \? \[\] :/);
  assert.match(panel, /\(stockOnly \? stockStories : wireStories\(wire, lang\)\)/);
  assert.doesNotMatch(read("../app/research/general-news/page.tsx"), /stockNews/);
});
