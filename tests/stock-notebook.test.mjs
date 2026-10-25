import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { weekStart, weekLabel, recapWindow, buildNotebook } from "../lib/research/stock-notebook.ts";

const at = text => Date.parse(text);

test("the week starts Monday 00:00 Japan time, including on a Sunday and just after midnight", () => {
  // Sunday 2026-10-25 22:00 JST → Monday 2026-10-19 00:00 JST (= 2026-10-18T15:00Z)
  assert.equal(new Date(weekStart(at("2026-10-25T13:00:00Z"))).toISOString(), "2026-10-18T15:00:00.000Z");
  // Monday 00:30 JST starts a new week
  assert.equal(new Date(weekStart(at("2026-10-25T15:30:00Z"))).toISOString(), "2026-10-25T15:00:00.000Z");
  // Wednesday
  assert.equal(new Date(weekStart(at("2026-10-21T03:00:00Z"))).toISOString(), "2026-10-18T15:00:00.000Z");
  assert.equal(weekLabel(at("2026-10-25T13:00:00Z"), "ja"), "10/19〜10/25");
  assert.equal(weekLabel(at("2026-10-21T12:00:00Z"), "ja"), "10/19〜10/21"); // Wednesday: this week so far
});

test("Monday and Tuesday show the week that just ended, in full", () => {
  const monday = at("2026-10-25T15:30:00Z"); // Mon 2026-10-26 00:30 JST
  const window = recapWindow(monday);
  assert.equal(window.previous, true);
  assert.equal(new Date(window.from).toISOString(), "2026-10-18T15:00:00.000Z");
  assert.equal(new Date(window.to).toISOString(), "2026-10-25T14:59:59.999Z");
  assert.equal(weekLabel(monday, "ja"), "10/19〜10/25");
  assert.equal(recapWindow(at("2026-10-27T12:00:00Z")).previous, true); // Tuesday
  assert.equal(recapWindow(at("2026-10-28T03:00:00Z")).previous, false); // Wednesday
  assert.equal(recapWindow(at("2026-10-25T13:00:00Z")).previous, false); // Sunday: this week, whole
});

const NOW = at("2026-10-25T13:00:00Z"); // Sunday evening JST
const row = (id, kind, tickers, when, title = `title ${id}`) => ({ id, kind, tickers, title, at: when, timeKind: "published" });
const target = (ticker, when, previous = 100, latest = 120) => ({ id: 1, source: "s", url: "https://x", publishedAt: when, observedAt: when, ticker, firm: "Firm", previous, latest });

test("only the reader's stocks and only this week's moves are counted", () => {
  const notebook = buildNotebook({
    tickers: ["MU", "NVDA"], now: NOW, lang: "ja",
    rows: [
      row("e1", "earnings", ["MU"], "2026-10-22T20:00:00Z", "MU決算"),
      row("e2", "earnings", ["AAPL"], "2026-10-22T20:00:00Z"), // not on the list
      row("e3", "earnings", ["NVDA"], "2026-10-10T20:00:00Z"), // last week
      row("n1", "news", ["MU", "AMD"], "2026-10-23T01:00:00Z"),
      row("n2", "news", ["NVDA"], "2026-10-24T01:00:00Z"),
      row("n3", "news", ["NVDA"], "2026-10-12T01:00:00Z"), // last week
    ],
    targets: [target("MU", "2026-10-21T01:00:00Z"), target("MU", "2026-10-05T01:00:00Z"), target("TSLA", "2026-10-21T01:00:00Z")],
    events: [],
  });
  assert.deepEqual(notebook.earnings.map(item => item.ticker), ["MU"]);
  assert.equal(notebook.targets.length, 1);
  assert.deepEqual(notebook.news.map(item => item.ticker), ["NVDA", "MU"]); // newest first
});

test("a result missing from the feed still counts once its calendar time has passed, never twice", () => {
  const events = [
    { id: "a", kind: "earnings", ticker: "NVDA", title: { ja: "NVDA決算", en: "NVDA earnings" }, startsAt: "2026-10-22T20:00:00Z" },
    { id: "b", kind: "earnings", ticker: "MU", title: { ja: "MU決算", en: "MU earnings" }, startsAt: "2026-10-22T20:00:00Z" },
    { id: "c", kind: "earnings", ticker: "MU", title: { ja: "MU 来週", en: "MU next" }, startsAt: "2026-10-28T20:00:00Z" }, // still ahead
    { id: "d", kind: "economic", title: { ja: "CPI", en: "CPI" }, startsAt: "2026-10-22T12:00:00Z" },
  ];
  const notebook = buildNotebook({ tickers: ["MU", "NVDA"], now: NOW, lang: "ja", rows: [row("e1", "earnings", ["MU"], "2026-10-22T21:00:00Z", "MU決算（速報）")], targets: [], events });
  assert.deepEqual(notebook.earnings.map(item => item.ticker).sort(), ["MU", "NVDA"]);
  assert.equal(notebook.earnings.find(item => item.ticker === "MU").title, "MU決算（速報）"); // the feed row wins
});

test("FREE sees counts only; PRO and the owner see the lists (source check)", () => {
  const source = readFileSync(new URL("../app/research/notebook/stock-notebook.tsx", import.meta.url), "utf8");
  assert.match(source, /const full = memberPlan === "pro" \|\| ownerAccount \|\| ownerRole;/);
  assert.match(source, /\{full \? <div className=\{styles\.details\}>/);
  const watchlist = readFileSync(new URL("../app/research/watchlist/watchlist.tsx", import.meta.url), "utf8");
  assert.match(watchlist, /<StockNotebook tickers=\{favorites\} lang=\{lang\} \/>/);
});
