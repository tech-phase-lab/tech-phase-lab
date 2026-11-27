import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FOCUS_BARS, FOCUS_LIVE_AGE_MS, FOCUS_LIVE_PER_MINUTE, closeLabel, earningsOn, flashOn, focusDue, focusLabel, focusSession, focusStat, liveDue, liveSession, liveStats, rankFocus, regularSession, settledSession } from "../lib/research/search-focus.ts";
import { SEARCH_THEMES, THEME_TICKERS } from "../lib/research/search-themes.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const day = (date, close, volume) => ({ at: date, open: close, high: close, low: close, close, volume });
/** 21 sessions oldest first: 20 at `base` volume, then the session itself. */
function series(last, { base = 1_000_000, volume = 3_000_000, prev = 100, close = 108.42 } = {}) {
  const bars = [];
  const start = Date.parse(`${last}T12:00:00Z`) - 40 * 86_400_000;
  for (let i = 0; bars.length < 21; i++) {
    const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const w = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (w === 0 || w === 6 || d >= last) continue;
    bars.push(day(d, prev, base));
  }
  bars.push(day(last, close, volume));
  return bars.slice(-22);
}

test("the session the snapshot holds: the last weekday whose close has settled (16:15 New York)", () => {
  assert.equal(settledSession(Date.parse("2026-11-25T20:00:00Z")), "2026-11-24"); // 15:00 ET Wednesday: still trading
  assert.equal(settledSession(Date.parse("2026-11-25T21:20:00Z")), "2026-11-25"); // 16:20 ET
  assert.equal(settledSession(Date.parse("2026-11-26T03:00:00Z")), "2026-11-25"); // Japan's morning
  assert.equal(settledSession(Date.parse("2026-11-29T15:00:00Z")), "2026-11-27"); // Sunday: Friday
  assert.equal(settledSession(Date.parse("2026-11-30T13:00:00Z")), "2026-11-27"); // Monday before the open
});

test("volume multiple: the session's volume ÷ the 20 sessions before it; a bar of a session still trading is not used", () => {
  const bars = series("2026-11-25");
  assert.equal(bars.length, FOCUS_BARS);
  const stat = focusStat(bars, "2026-11-25");
  assert.deepEqual(stat, { date: "2026-11-25", close: 108.42, change: 8.42, volume: 3_000_000, average: 1_000_000, multiple: 3 });
  // During the session of the 26th, its partial bar is left out: the 25th stays the session.
  const partial = [...bars, day("2026-11-26", 120, 10)];
  assert.equal(focusStat(partial, "2026-11-25").date, "2026-11-25");
  // Fewer than 20 sessions before it: no multiple (never a guess), the day change still shown.
  const short = focusStat(bars.slice(-10), "2026-11-25");
  assert.equal(short.multiple, null);
  assert.equal(short.change, 8.42);
  assert.equal(focusStat([], "2026-11-25"), null);
});

test("「今日の注目」: earnings, 速報 or ≥2× volume qualify; the six largest multiples; fewer filled with the largest moves; none, none", () => {
  const s = (multiple, change, date = "2026-11-25") => ({ date, close: 1, change, volume: 1, average: 1, multiple });
  const stats = {
    MU: s(4.1, 8.42), NBIS: s(3.2, 6.1), SKHY: s(2.6, 5.2), IREN: s(1.1, -5.31), CRWV: s(0.9, -3.8), AMD: s(1.4, 4.87),
    NVDA: s(1.0, 0.4), MSFT: s(0.8, -0.2), OLD: s(9.9, 20, "2026-11-24"),
  };
  const flags = { earnings: ["IREN"], flash: ["CRWV"] };
  const rows = rankFocus(stats, flags, "2026-11-25", t => t.toLowerCase());
  assert.deepEqual(rows.map(r => r.ticker), ["MU", "NBIS", "SKHY", "IREN", "CRWV", "AMD"]);
  assert.equal(rows[0].name, "mu");
  assert.ok(!rows.some(r => r.ticker === "OLD"), "a stock of another session never takes part");
  // Only two qualify: four more by the largest absolute day change.
  const fewer = rankFocus(stats, { earnings: [], flash: [] }, "2026-11-25", t => t);
  assert.deepEqual(fewer.map(r => r.ticker), ["MU", "NBIS", "SKHY", "IREN", "AMD", "CRWV"]);
  // More than six qualify: the six largest multiples.
  const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`T${i}`, s(2 + i, 1)]));
  assert.deepEqual(rankFocus(many, { earnings: [], flash: [] }, "2026-11-25", t => t).map(r => r.ticker), ["T8", "T7", "T6", "T5", "T4", "T3"]);
  assert.deepEqual(rankFocus({}, flags, "2026-11-25", t => t), []);
  assert.deepEqual(rankFocus(stats, flags, null, t => t), []);
});

test("earnings that day: the site's calendar (dated and date-only) and the results feed, in New York dates; 速報 rows of that day", () => {
  const earnings = earningsOn("2026-11-25", {
    calendar: [{ kind: "earnings", ticker: "NVDA", startsAt: "2026-11-25T16:20:00-05:00" }, { kind: "earnings", ticker: "LATE", startsAt: "2026-11-26T08:00:00-05:00" }, { kind: "economic", startsAt: "2026-11-25T08:30:00-05:00" }],
    dateOnly: [{ kind: "earnings", ticker: "KLAC", date: "2026-11-25" }],
    results: [{ kind: "earnings", ticker: "DELL", publishedAt: "2026-11-25T21:05:00Z" }, { kind: "earnings", ticker: "PREV", publishedAt: "2026-11-25T03:00:00Z" }],
  });
  assert.deepEqual(earnings, ["DELL", "KLAC", "NVDA"]);
  const flash = flashOn("2026-11-25", [
    { kind: "news", tickers: ["CRWV"], at: "2026-11-25T14:00:00Z", timeKind: "published" },
    { kind: "earnings", tickers: ["DELL"], at: "2026-11-25T21:05:00Z", timeKind: "published" },
    { kind: "news", tickers: ["MU"], at: "2026-11-25", timeKind: "date" },
    { kind: "news", tickers: ["OLD"], at: "2026-11-24T14:00:00Z", timeKind: "published" },
  ]);
  assert.deepEqual(flash, { flash: ["CRWV", "DELL", "MU"], earnings: ["DELL"] });
});

test("the snapshot session, the stocks still due, and the close label", () => {
  const s = date => ({ date, close: 1, change: 0, volume: 1, average: 1, multiple: 1 });
  assert.equal(focusSession({ A: s("2026-11-25"), B: s("2026-11-25"), C: s("2026-11-24"), D: s("2026-11-26") }), "2026-11-25");
  assert.equal(focusSession({}), null);
  const now = Date.parse("2026-11-25T22:00:00Z");
  assert.deepEqual(focusDue(["A", "B", "C", "D"], { A: "2026-11-25", B: "2026-11-24" }, { C: now - 60_000 }, "2026-11-25", now), ["B", "D"]);
  assert.equal(closeLabel("2026-11-25", "ja"), "11/25 終値");
  assert.equal(closeLabel("2026-11-25", "en"), "Nov 25 close");
});

test("themes: 17, the owner's short English names for the list only, every candidate a valid ticker", () => {
  assert.equal(SEARCH_THEMES.length, 17);
  const short = Object.fromEntries(SEARCH_THEMES.filter(t => t.short).map(t => [t.en, t.short]));
  assert.equal(short["Chip manufacturing & testing"], "Chipmaking");
  assert.equal(short["Optical links"], "Optical");
  assert.equal(short["Networking & connectivity"], "Networking");
  assert.ok(THEME_TICKERS.includes("NVDA") && THEME_TICKERS.includes("MU"));
  assert.equal(new Set(THEME_TICKERS).size, THEME_TICKERS.length);
});

test("the first screen: snapshot only for members, the minute job keeps it within the allocator, mint only, one fixed panel", () => {
  const page = read("app/research/stocks/page.tsx"), server = read("lib/research/search-focus-server.ts"), warm = read("app/api/research/compare/warm/route.ts");
  const directory = read("app/research/stocks/stock-directory.tsx"), themes = read("app/research/stocks/stock-theme-discovery.tsx");
  const css = read("app/research/stocks/stock-theme-discovery.module.css"), history = read("app/research/stocks/stock-search-history.tsx");
  const historyCss = read("app/research/stocks/stock-search-history.module.css"), search = read("app/research/stocks/search-redesign.module.css");
  assert.match(page, /loadFocusView\(\)/);
  assert.doesNotMatch(page, /refreshFocusSnapshot|twelveCall/);
  // The view reads the snapshot with no fetch: a member's page never asks the provider.
  const view = server.slice(server.indexOf("export async function loadFocusView"));
  assert.doesNotMatch(view, /twelveCall|refreshFocusSnapshot|fetchDaily/);
  assert.match(server, /sharedReader\.read<FocusSnapshot>\(SNAPSHOT_SPEC, "all", null\)/);
  // The マーケット snapshot's mechanism (#877): the shared bar copy on the warm tier, the credit counted only on a real provider read.
  assert.match(server, /loadSnapshotDailyBars\(ticker, FOCUS_BARS, \(\) => \{ spent\+\+; \}\)/);
  assert.match(read("lib/research/market-data.ts"), /barsEntry\(ticker, "1day", size, \{ fetch: \(\) => \{ spend\(\); return true; \}, tier: "warm" \}\)/);
  assert.doesNotMatch(server, /twelveCall/);
  assert.match(server, /FOCUS_PER_MINUTE = 24/);
  assert.match(warm, /refreshFocusSnapshot\(\)/);
  assert.match(warm, /warmMinute\(Date\.now\(\), lev\.spent \+ board\.spent \+ focus\.spent[ )]/);
  // The search field, history and panel as the sheet draws them; no gold on this FREE page.
  assert.match(directory, /t\("会社名・ティッカー", "Company or ticker"\)/);
  assert.doesNotMatch(directory, /例 {2}NVDA/);
  assert.match(search, /\.hint i\{[^}]*animation:hintCaret/);
  assert.match(history, /ja \? "履歴" : "RECENT"/);
  assert.doesNotMatch(history, /"消去"/);
  assert.match(historyCss, /\.root\{[^}]*margin:22px 0 0/);
  assert.match(historyCss, /\.logo\{[^}]*border-radius:50%/);
  assert.match(historyCss, /\.logo img\{[^}]*width:71%/);
  assert.match(themes, /"今日の注目" : "In focus today"/);
  assert.match(themes, /"今日は大きな動きはありませんでした"/);
  assert.match(css, /\.panel\{[^}]*height:var\(--panel-h\)/);
  assert.match(css, /--panel-h:clamp\(252px,[^;]*,330px\)/);
  assert.match(css, /\.panel\{[^}]*grid-template-columns:150px minmax\(0,1fr\)/);
  assert.match(css, /\.themes ul\{[^}]*overflow-y:auto/);
  assert.match(css, /\.themes::after\{[^}]*linear-gradient/);
  assert.match(css, /\.rows\{[^}]*grid-auto-rows:var\(--row-h\)/);
  for (const file of [css, historyCss, search.slice(search.indexOf(".hint{"))]) assert.doesNotMatch(file, /#f3d98b|#d9b46a|rgba\(217,180,106/i);
  // No after-hours price on this screen.
  assert.doesNotMatch(themes, /extended|時間外/);
});

test("owner accounts keep full access: the first screen has no membership gate", () => {
  for (const path of ["app/research/stocks/stock-theme-discovery.tsx", "app/research/stocks/stock-search-history.tsx", "app/research/stocks/page.tsx"]) {
    assert.doesNotMatch(read(path), /isPro|getMembership|useMembership|PRO_ONLY|locked/);
  }
});

// ---- Live during the U.S. regular session (owner, Nov 27) ----
const candidates = Array.from({ length: 85 }, (_, i) => `T${String(i).padStart(2, "0")}`);

test("live: only during the NYSE regular session (holidays and the early close included); the early close settles at 13:15 ET", () => {
  assert.equal(regularSession(Date.parse("2026-11-25T15:00:00Z")), true); // Wed 10:00 ET
  assert.equal(regularSession(Date.parse("2026-11-25T21:05:00Z")), false); // 16:05 ET
  assert.equal(regularSession(Date.parse("2026-11-26T16:00:00Z")), false); // Thanksgiving
  assert.equal(regularSession(Date.parse("2026-11-27T17:30:00Z")), true); // 12:30 ET, early-close day
  assert.equal(regularSession(Date.parse("2026-11-27T18:05:00Z")), false); // 13:05 ET after the early close
  assert.equal(regularSession(Date.parse("2026-11-28T16:00:00Z")), false); // Saturday
  assert.equal(settledSession(Date.parse("2026-11-27T18:20:00Z")), "2026-11-27");
  assert.deepEqual(liveDue(candidates, {}, Date.parse("2026-11-26T16:00:00Z")), []);
  assert.deepEqual(liveDue(candidates, {}, Date.parse("2026-11-25T21:05:00Z")), []);
});

test("live: at most FOCUS_LIVE_PER_MINUTE quotes a minute, each stock about every 5 minutes, oldest first", () => {
  assert.equal(FOCUS_LIVE_PER_MINUTE, 20);
  assert.equal(FOCUS_LIVE_AGE_MS, 5 * 60_000);
  const start = Date.parse("2026-11-25T14:30:00Z"), live = {}, perMinute = [];
  for (let minute = 0; minute < 120; minute++) {
    const now = start + minute * 60_000, due = liveDue(candidates, live, now);
    assert.ok(due.length <= FOCUS_LIVE_PER_MINUTE);
    for (const ticker of due) live[ticker] = { date: "2026-11-25", price: 1, change: 0, volume: 1, at: now };
    perMinute.push(due.length);
    if (minute >= 10) for (const ticker of candidates) assert.ok(now - live[ticker].at <= 6 * 60_000, `${ticker} at minute ${minute}`);
  }
  const steady = perMinute.slice(10), average = steady.reduce((a, b) => a + b, 0) / steady.length;
  assert.equal(perMinute[0], 20);
  assert.ok(average > 14 && average <= 18, `average ${average}`);
  // Fresh quotes are not due; yesterday's quote and a recent failed attempt are handled.
  const now = start + 3 * 60_000;
  const due = liveDue(["A", "B", "C", "D"], { A: { date: "2026-11-25", price: 1, change: 0, volume: 1, at: now - 60_000 },
    B: { date: "2026-11-24", price: 1, change: 0, volume: 1, at: now - 60_000 }, C: { date: "2026-11-25", price: 1, change: 0, volume: 1, at: now - 6 * 60_000 } }, now, 20, { D: now - 60_000 });
  assert.deepEqual(due, ["B", "C"]);
});

test("live: ranked on today's moves while half the candidates have them; the settled close once it catches up", () => {
  const settled = { AAA: focusStat(series("2026-11-24"), "2026-11-24"), BBB: focusStat(series("2026-11-24", { volume: 900_000 }), "2026-11-24") };
  const at = Date.parse("2026-11-25T16:00:00Z");
  const live = { AAA: { date: "2026-11-25", price: 99, change: -1, volume: 500_000, at }, BBB: { date: "2026-11-25", price: 112, change: 12, volume: 2_500_000, at } };
  assert.equal(liveSession(live, ["AAA", "BBB"], "2026-11-24", at), "2026-11-25");
  assert.equal(liveSession({ AAA: live.AAA }, ["AAA", "BBB", "CCC"], "2026-11-24", at), null); // a third only: the settled close stays
  assert.equal(liveSession(live, ["AAA", "BBB"], "2026-11-25", Date.parse("2026-11-25T21:20:00Z")), null); // settled caught up
  assert.equal(liveSession(live, ["AAA", "BBB"], "2026-11-24", Date.parse("2026-11-26T14:00:00Z")), null); // next morning: yesterday's quotes
  const stats = liveStats(settled, live, "2026-11-25");
  assert.deepEqual(stats.BBB, { date: "2026-11-25", close: 112, change: 12, volume: 2_500_000, average: 1_000_000, multiple: 2.5 });
  const rows = rankFocus(stats, { earnings: [], flash: [] }, "2026-11-25", t => t);
  assert.deepEqual(rows.map(row => [row.ticker, row.change]), [["BBB", 12], ["AAA", -1]]);
  // The settled ranking is unchanged: AAA had the larger multiple on the 24th.
  assert.equal(rankFocus(settled, { earnings: [], flash: [] }, "2026-11-24", t => t)[0].ticker, "AAA");
});

test("live: the label is the market page's 「取引中 ・ HH:MM JST」 in the session, 「MM/DD 終値」 after it settles", () => {
  const at = Date.parse("2026-11-27T14:45:00Z");
  assert.equal(focusLabel({ session: "2026-11-27", live: { at, open: true } }, "ja"), "取引中 ・ 23:45 JST");
  assert.equal(focusLabel({ session: "2026-11-27", live: { at, open: true } }, "en"), "Open · 09:45 ET");
  assert.equal(focusLabel({ session: "2026-11-27", live: { at, open: false } }, "ja"), "11/27 23:45 JST 時点");
  assert.equal(focusLabel({ session: "2026-11-25", live: null }, "ja"), "11/25 終値");
  assert.equal(focusLabel({ session: "2026-11-25" }, "en"), "Nov 25 close");
  assert.equal(focusLabel({ session: null }, "ja"), null);
});

test("live: members only read the snapshot; the minute job asks for quotes through the shared copy on the warm tier, capped", () => {
  const server = read("lib/research/search-focus-server.ts"), market = read("lib/research/market-data.ts"), themes = read("app/research/stocks/stock-theme-discovery.tsx");
  const view = server.slice(server.indexOf("export async function loadFocusView"));
  assert.doesNotMatch(view, /loadSnapshotQuotes|loadSnapshotDailyBars|twelveCall|refreshFocusSnapshot|readMany/);
  assert.match(server, /liveDue\(candidates, live, now, FOCUS_LIVE_PER_MINUTE, liveTried\)/);
  assert.match(server, /loadSnapshotQuotes\(dueLive, FOCUS_LIVE_PER_MINUTE, /);
  const fn = market.slice(market.indexOf("export function loadSnapshotQuotes"), market.indexOf("export async function loadDailyCloses"));
  assert.match(fn, /sharedReader\.readMany<MarketQuote>/);
  assert.match(fn, /fetchQuotes\(group, "warm"\)/);
  assert.match(fn, /\{ chunk: 10, maxFetch \}/);
  assert.match(themes, /focusLabel\(focus, lang\)/);
});
