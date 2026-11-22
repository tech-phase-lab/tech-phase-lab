import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bellOn, bellPatch } from "../lib/research/stock-news-bell.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const monitored = ["MU", "NVDA", "AMD", "TSM"];

test("the bell is lit only when this device gets news and chose this stock", () => {
  assert.equal(bellOn({ news: true, newsTickers: ["MU", "NVDA"] }, "NVDA"), true);
  assert.equal(bellOn({ news: false, newsTickers: ["MU", "NVDA"] }, "NVDA"), false, "the device's news switch is off");
  assert.equal(bellOn({ news: true, newsTickers: ["MU"] }, "NVDA"), false);
});

test("pressing the bell changes the same per-device setting as 監視株ニュース, and nothing else", () => {
  assert.deepEqual(bellPatch({ news: true, newsTickers: ["MU", "NVDA"] }, "NVDA", monitored), { newsTickers: ["MU"] }, "off: this stock only");
  assert.deepEqual(bellPatch({ news: true, newsTickers: ["TSM", "MU"] }, "AMD", monitored), { newsTickers: ["MU", "AMD", "TSM"] }, "on: added, in the list's order");
  assert.deepEqual(bellPatch({ news: false, newsTickers: ["MU", "TSM"] }, "AMD", monitored), { news: true, newsTickers: ["AMD"] },
    "switch off: news for this stock only, the old choices are not silently switched back on");
  assert.equal(bellPatch({ news: true, newsTickers: [] }, "AAPL", monitored), null, "only the monitored stocks have news notifications");
});

test("the bell in 監視22銘柄 is wired (no longer 準備中) and saves through the notification API", () => {
  const activity = read("../app/research/companies/company-activity.tsx");
  assert.doesNotMatch(activity, /準備中\)/);
  assert.match(activity, /<StockNewsBell ticker=\{ticker\} ja=\{ja\} full=\{full\} \/>/);
  const bell = read("../app/research/companies/stock-news-bell.tsx");
  assert.match(bell, /action: "preferences"/);
  assert.match(bell, /action: "save-preferences"/);
  assert.match(bell, /href="\/research#tech-phase-pro"/, "FREE: leads to PRO");
  assert.match(bell, /href="\/research\/notifications"/, "no device yet: leads to the notification page");
  // `full` is PRO, the owner account or the owner role (AGENTS.md: the owner can always use every feature).
  assert.match(activity, /const full = memberPlan === "pro" \|\| ownerAccount \|\| ownerRole;/);
});
