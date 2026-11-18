import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { freeTechSelection, isFullAccess, projectFreeNews, projectFreeWire } from "../lib/research/tech-news-access.ts";
import { flashRows } from "../lib/research/flash-rows.ts";
import { buildNotebook } from "../lib/research/stock-notebook.ts";

// 銘柄手帳 shows the ハイテク速報 stream (owner, Nov 18). Policy (docs/TECH-PHASE-FREE-PRO-POLICY-2026-10-25.md): FREE gets the newest five
// stories that are at least 30 minutes old; PRO and the owner get everything, live. The limit is applied by the server routes the notebook reads.
const NOW = Date.parse("2026-11-12T11:11:00Z"); // Thursday in Japan: the notebook shows this week
const ago = minutes => new Date(NOW - minutes * 60_000).toISOString();
const story = (id, minutes, ticker) => ({ id, title: `T${id}`, url: `https://example.com/${id}`, publisher: "Pub", tickers: [ticker], publishedAt: ago(minutes), observedAt: ago(minutes), approvedAt: ago(minutes),
  summaryJa: `見出し${id}`, summaryEn: `Headline ${id}`, impactJa: `PAID-${id}`, impactEn: `PAID-${id}`, impactLabel: "positive", confidence: "high" });
const feed = () => ({ ok: true, enabled: true, items: [
  story("1", 2, "MU"), story("2", 12, "NVDA"), story("3", 29, "MU"), story("4", 31, "AMD"), story("5", 45, "MU"), story("6", 90, "NVDA"), story("7", 300, "MU"), story("8", 900, "AMD"), story("9", 1500, "MU")] });
const wire = () => ({ MU: [{ id: "w1", titleEn: "Micron opens new memory plant in Idaho", titleJa: "マイクロンが新工場", shortJa: null, publisher: "Wire", origin: "wire", url: "https://example.com/w1", publishedAt: ago(4) }] });
const TICKERS = ["MU", "NVDA", "AMD"];

/** What a viewer's notebook holds: the routes' answer for that viewer, put through the notebook's own builder. */
function notebookFor(viewer) {
  const f = feed(), w = wire();
  let shownFeed = f, shownWire = w;
  if (!isFullAccess(viewer)) { const selected = freeTechSelection(f, w, NOW); shownFeed = projectFreeNews(f, selected); shownWire = projectFreeWire(w, selected); }
  return buildNotebook({ tickers: TICKERS, now: NOW, lang: "ja", rows: flashRows(shownFeed, shownWire, "ja"), targets: [], events: [] });
}
const viewers = {
  signedOut: { status: "signed-out", plan: "free" },
  free: { status: "signed-in", plan: "free", isAdmin: false, testing: false },
  pro: { status: "signed-in", plan: "pro", isAdmin: false, testing: false },
  // getMembership for the owner account: ownerMode gives plan "pro" without a paid plan (lib/membership/server.ts).
  owner: { status: "signed-in", plan: "pro", isAdmin: true, ownerMode: true, ownerAccount: true, testing: false },
};

test("FREE notebook: at most five tech alerts, newest first, none newer than 30 minutes, no summary text", () => {
  for (const viewer of [viewers.signedOut, viewers.free]) {
    const news = notebookFor(viewer).news;
    assert.ok(news.length > 0 && news.length <= 5, `${news.length}`);
    assert.ok(news.every(item => Date.parse(item.at) <= NOW - 30 * 60_000));
    assert.deepEqual(news.map(item => item.at), [...news.map(item => item.at)].sort().reverse());
    assert.deepEqual(news.map(item => item.title), ["見出し4", "見出し5", "見出し6", "見出し7", "見出し8"]);
    assert.ok(!JSON.stringify(news).includes("PAID-"));
  }
});

test("PRO and owner notebooks: every story of the week, the newest ones live", () => {
  for (const viewer of [viewers.pro, viewers.owner]) {
    const news = notebookFor(viewer).news;
    assert.ok(news.some(item => item.title === "見出し1"), "the 2-minute-old story is there");
    assert.ok(news.some(item => item.title.includes("マイクロン")), "the wire headline is there");
    assert.equal(news.filter(item => item.title.startsWith("見出し")).length, 9);
  }
});

test("the notebook reads only the server-limited routes, and those routes decide from the session", () => {
  const data = readFileSync(new URL("../app/research/notebook/notebook-data.ts", import.meta.url), "utf8");
  assert.match(data, /"\/api\/research\/news"/);
  assert.match(data, /"\/api\/research\/company-wire"/);
  const notebook = readFileSync(new URL("../app/research/notebook/stock-notebook.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(notebook, /fetch\(/, "the notebook part has no other source");
  for (const route of ["news", "company-wire"]) {
    const source = readFileSync(new URL(`../app/api/research/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /viewerHasFullNews\(\)/, route);
    assert.match(source, /projectFree(News|Wire)\(/, route);
    assert.match(source, /PRIVATE_HEADERS/, route);
  }
});

test("no other API route hands out the monitor's news or company wire without the same check", () => {
  const files = [];
  const walk = dir => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (name === "route.ts") files.push(path); } };
  walk(new URL("../app/api", import.meta.url).pathname);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // The stream route only issues a ticket for a revision signal (hashes, no story text: scripts/research/stream_gateway.py).
    if (file.endsWith("/news/stream/route.ts")) continue;
    const readsStories = /readMonitor\("(news|company-wire)"|\/(news|company-wire)`;/.test(source);
    if (readsStories) assert.match(source, /viewerHasFullNews\(\)/, file);
  }
});
