// Speed, Nov 26: the public news pages run without the identity proxy (owner, Oct 21), so a PRO member's own feed cannot be drawn by the
// server. Their last view on this device is shown once the membership check confirmed PRO (the #891 pattern), and goes with the hint.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = new Map();
globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k),
  key: i => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.document = { documentElement: { dataset: {} } };
const { readLastView, writeLastView, forgetLastView, forgetAllLastViews, topicsSubset } = await import("../lib/research/member-last-view.ts");
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const mark = value => { if (value) document.documentElement.dataset.memberHint = value; else delete document.documentElement.dataset.memberHint; };

test("kept only under the PRO / owner mark; without it nothing is read and a write removes the copy", () => {
  store.clear();
  for (const value of ["pro", "owner"]) {
    mark(value);
    writeLastView("alerts", { feed: value }, 1_000);
    assert.deepEqual(readLastView("alerts", 2_000), { data: { feed: value }, at: 1_000 });
  }
  mark(null);
  assert.equal(readLastView("alerts", 2_000), null);
  writeLastView("alerts", { feed: "free" }, 3_000);
  assert.equal(store.size, 0);
});

test("an expired copy is deleted when read; clearing the hint clears every kept view", () => {
  store.clear(); mark("pro");
  writeLastView("topics", { ok: true }, 0);
  assert.equal(readLastView("topics", 24 * 3_600_000), null);
  assert.equal(store.size, 0, "deleted on read");
  writeLastView("alerts", 1, 0); writeLastView("topics", 2, 0); store.set("tech-phase:member-hint", "{}");
  forgetAllLastViews();
  assert.deepEqual([...store.keys()], ["tech-phase:member-hint"]);
  forgetLastView("alerts"); mark(null);
});

test("注目トピック keeps only its stories, without impact texts or the rest of the feed", () => {
  const feed = { ok: true, enabled: true, items: [{ id: "1", title: "T", impactJa: "PAID", impactEn: "PAID", summaryJa: "見出し" }], officialUpdates: [{ bodyJa: "PAID" }], analystUpdates: [{}], marketUpdates: [], resultBriefs: [] };
  const kept = topicsSubset(feed);
  assert.deepEqual(Object.keys(kept).sort(), ["enabled", "items", "ok"]);
  assert.ok(!JSON.stringify(kept).includes("PAID"));
  assert.equal(kept.items[0].summaryJa, "見出し");
});

test("pages: a kept view appears only after the check confirmed PRO; the hint's removal clears them", () => {
  const flash = read("app/research/news/flash-page.tsx");
  assert.match(flash, /if \(keptShown\.current \|\| !memberSettled \|\| !full\) return;/);
  // It replaces the server's FREE view, never a feed this browser read itself.
  assert.match(flash, /if \(serverFirstNow\.current\) \{ setFeed\(kept\.data\.feed\);/);
  assert.match(flash, /const full = memberPlan === "pro" \|\| ownerAccount \|\| ownerRole;/);
  assert.match(flash, /const rows = full \? allRows : freeFlashRows\(allRows/);
  // The server's FREE view with a browser that is PRO after all: both feeds are read at once.
  assert.match(flash, /const drawnFree = initial !== null && !full;/);
  assert.match(flash, /poller\.start\(drawnFree \? NEWS_POLL_INTERVAL_MS : 0\)/);
  assert.match(flash, /const first = drawnFree \? initial\?\.wire : null;/);
  const screen = read("app/research/general-news/screen.tsx");
  assert.match(screen, /const keepPlan = !memberSettled \? undefined : memberPlan === "pro" \|\| ownerAccount \|\| ownerRole \? "pro" : "none";/);
  const topics = read("app/research/news/general-news-panel.tsx");
  assert.match(topics, /if \(keepPlan !== "pro" \|\| keptShown\.current \|\| initialNews\) return;/);
  assert.match(topics, /writeLastView\("topics", topicsSubset\(payload\)\)/);
  const provider = read("app/research/member-display-provider.tsx");
  assert.match(provider, /if \(!hint\) forgetLastViews\(\);/);
  assert.match(provider, /const LAST_VIEW_PREFIX = "tech-phase:last-view:";/);
  assert.match(read("lib/research/member-last-view.ts"), /const PREFIX = "tech-phase:last-view:";/);
});
