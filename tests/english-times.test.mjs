import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { parseCompanyWire } from "../lib/research/company-wire.ts";
import { bannerLine } from "../lib/research/us-market-session.ts";
import { quoteTimeText } from "../lib/research/watchlist-freshness.ts";
import { sessionTicks } from "../lib/research/market-board-periods.ts";
import { monthDay } from "../lib/research/month-day.ts";
import { countTodayNews } from "../lib/research/home-today.ts";

// Owner, Nov 17: on the English site every date and time is U.S. Eastern ("ET"); the Japanese site stays in Japan time ("JST").
const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const stub = new Proxy(() => null, { get: (_, key) => key === "__esModule" ? true : stub });
function load(file) {
  const output = ts.transpileModule(read(file), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  const dir = file.slice(0, file.lastIndexOf("/") + 1);
  new Function("require", "module", "exports", output)(name => {
    if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (name.startsWith("@/lib/research/")) return require(`../lib/research/${name.slice("@/lib/research/".length)}.ts`);
    if (name.startsWith("./") && file.includes("/news/") && /feed-pagination|timeline-row/.test(name)) return load(`${dir}${name.slice(2)}.tsx`);
    if (name.startsWith(".") || name.startsWith("next/")) return stub;
    return require(name);
  }, loaded, loaded.exports);
  return loaded.exports;
}
const text = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("home: today's date is Japan time in Japanese and U.S. Eastern in English", () => {
  const { dateLabel } = load("../app/research/home-hero.tsx");
  const at = Date.parse("2026-11-05T03:00:00Z"); // 12:00 Thu Nov 5 in Tokyo, 22:00 Wed Nov 4 in New York (EST)
  assert.equal(dateLabel("ja", at), "11月5日(木)");
  assert.equal(dateLabel("en", at), "Wed, Nov 4");
  const summer = Date.parse("2026-07-10T03:30:00Z"); // 12:30 Fri Jul 10 in Tokyo, 23:30 Thu Jul 9 in New York (EDT)
  assert.equal(dateLabel("ja", summer), "7月10日(金)");
  assert.equal(dateLabel("en", summer), "Thu, Jul 9");
});

test("news/flash: rows are grouped by the ET day in English and the JST day in Japanese", () => {
  const { flashDayKey, dayHeading } = load("../app/research/news/flash-page.tsx");
  const late = { at: "2026-11-05T03:00:00Z", timeKind: "published" };
  assert.equal(flashDayKey(late, "ja"), "2026-11-05");
  assert.equal(flashDayKey(late, "en"), "2026-11-04");
  const summer = { at: "2026-07-10T03:59:00Z", timeKind: "published" }; // 23:59 EDT on Jul 9
  assert.equal(flashDayKey(summer, "en"), "2026-07-09");
  assert.equal(flashDayKey({ at: "2026-07-10T04:00:00Z", timeKind: "published" }, "en"), "2026-07-10");
  assert.equal(flashDayKey({ at: "2026-11-03", timeKind: "date" }, "en"), "2026-11-03", "a date-only source keeps its date");
  assert.equal(dayHeading("2026-11-04", false), "11/4 Wed");
  assert.equal(dayHeading("2026-11-04", true), "11/4（水）");
  const source = read("../app/research/news/flash-page.tsx");
  // The page no longer adds a note under the list (owner, Nov 19), and the 「発表 … JST」 line under each item is gone (owner, Nov 25):
  // the left column keeps the clock and each day heading names the zone (JST / ET).
  assert.doesNotMatch(source, /時刻は日本時間です。/);
  assert.doesNotMatch(source, /"発表"/);
  assert.match(source, /publication=""/);
  assert.match(source, /displayClock\(row\.at, lang\)/);
  assert.match(source, /<small>\{zoneLabel\(lang\)\}<\/small><\/h3>/);
});

test("news timeline row: the clock is ET in English (EST and EDT) and JST in Japanese", () => {
  const TimelineRow = load("../app/research/news/timeline-row.tsx").default;
  const render = (at, lang) => text(renderToStaticMarkup(React.createElement(TimelineRow, { at, kind: "time", fresh: false, lang }, "story")));
  assert.match(render("2026-12-03T14:05:00Z", "en"), /09:05/);
  assert.match(render("2026-12-03T14:05:00Z", "ja"), /23:05/);
  assert.match(render("2026-07-09T14:05:00Z", "en"), /10:05/);
  assert.match(render("2026-07-09T14:05:00Z", "ja"), /23:05/);
});

test("top topics: times and day dividers follow ET in English and JST in Japanese", () => {
  const Topics = load("../app/research/news/topics-list.tsx").default;
  const now = Date.parse("2026-11-05T03:00:00Z"); // Nov 5 12:00 JST · Nov 4 22:00 EST
  const row = (id, titleEn, titleJa, publishedAt) => ({ id, titleEn, titleJa, shortJa: null, publisher: "Reuters", origin: "third-party",
    url: `https://news.example/${id}`, publishedAt, source: "stocknews" });
  const wire = parseCompanyWire({ ok: true, items: {
    MU: [row("a", "Micron ships HBM4 early", "マイクロン、HBM4を前倒し出荷", "2026-11-05T02:30:00Z")],
    AMD: [row("b", "AMD sets a launch date", "AMD、発表日を公表", "2026-11-04T04:30:00Z")],
  } }).items;
  const render = lang => text(renderToStaticMarkup(React.createElement(Topics, { lang, data: null, wire, wireReady: true, error: false,
    receivedAt: new Date(now).toISOString(), page: 1, onPage: () => {} })));
  const en = render("en"), ja = render("ja");
  assert.match(en, /Today .*21:30.*Yesterday .*23:30/, en);
  assert.match(ja, /今日 .*11:30.*昨日 .*13:30/, ja);
});

test("market and watchlist clocks: ET in English, JST in Japanese", () => {
  const at = Date.parse("2026-11-12T21:20:35Z");
  assert.equal(bannerLine("regular", false, at), "Open · 16:20:35 ET");
  assert.equal(bannerLine("regular", true, at), "取引中 ・ 06:20:35 JST");
  assert.equal(quoteTimeText("2026-07-09T20:00:00Z", Date.parse("2026-07-09T21:00:00Z"), "en"), "16:00 ET");
  assert.equal(quoteTimeText("2026-07-09T20:00:00Z", Date.parse("2026-07-09T21:00:00Z"), "ja"), "05:00 JST");
  // The board's 15-minute chart marks where pre-market, the session and after-hours begin.
  const bars = ["2026-07-10 04:00:00", "2026-07-10 09:30:00", "2026-07-10 16:00:00"].map(at => ({ at, open: 1, high: 1, low: 1, close: 1 }));
  assert.deepEqual(sessionTicks(bars, undefined, "en").map(tick => tick.label), ["04:00", "09:30", "16:00"]);
  assert.deepEqual(sessionTicks(bars, undefined, "ja").map(tick => tick.label), ["17:00", "22:30", "05:00"]);
});

test("account dates and the home 'today' count use the site's day", () => {
  assert.equal(monthDay("2026-12-05T02:00:00Z", true), "12月5日");
  assert.equal(monthDay("2026-12-05T02:00:00Z", false), "December 4");
  const story = (id, publishedAt) => ({ id, title: id, url: `https://x.example/${id}`, publisher: "P", tickers: [], publishedAt, observedAt: publishedAt });
  const feed = { ok: true, enabled: true, items: [story("late", "2026-11-05T02:00:00Z")], officialUpdates: [], marketUpdates: [] };
  const now = Date.parse("2026-11-05T03:00:00Z");
  assert.equal(countTodayNews(feed, "ja", now), 1);
  assert.equal(countTodayNews(feed, "en", now), 1);
  assert.equal(countTodayNews(feed, "en", Date.parse("2026-11-05T06:00:00Z")), 0, "Nov 5 01:00 ET: the story was yesterday in New York");
});

test("the changed screens take their times from the display-time helper", () => {
  const uses = {
    "../app/research/home-hero.tsx": /formatDisplay/,
    "../app/research/news/general-news-panel.tsx": /displayDateTime\(value, lang\)/,
    "../app/research/news/original-preview-card.tsx": /displayDateTime\(value, lang\)/,
    "../app/research/news/topics-list.tsx": /displayClock\(card\.at, lang\)/,
    "../app/research/companies/company-activity.tsx": /zoneLabel\(lang\)/,
    "../app/research/price/quote-card.tsx": /zoneLabel/,
    "../app/research/watchlist/watchlist.tsx": /<CurrentTime lang=\{lang\} \/> \{zoneLabel\(lang\)\}/,
    "../app/research/columns/columns.tsx": /zoneLabel\(lang\)/,
    "../app/research/compare/screen.tsx": /displayDateTime\(result\.generatedAt, lang\)/,
    "../app/research/stocks/stock-directory.tsx": /zoneLabel\(lang\)/,
    "../app/research/deep-analysis-panel.tsx": /zoneLabel\(lang\)/,
    "../app/research/freshness-notice.tsx": /zoneLabel\(lang\)/,
    "../app/research/account/billing/screen.tsx": /zoneLabel/,
    "../app/resolute/home/screen.tsx": /formatDisplay/,
    "../app/resolute/checkout/screen.tsx": /formatDisplay/,
  };
  for (const [file, pattern] of Object.entries(uses)) assert.match(read(file), pattern, file);
});
