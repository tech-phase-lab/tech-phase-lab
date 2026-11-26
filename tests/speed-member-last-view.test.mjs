// Speed, Nov 26: the public news pages run without the identity proxy (owner, Oct 21), so a PRO member's own feed cannot be drawn by the
// server. Their last view on this device opens the page at once instead (the #891 pattern), only under the verified member mark.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = new Map();
globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.document = { documentElement: { dataset: {} } };
const { readLastView, writeLastView, forgetLastView, memberMarked } = await import("../lib/research/member-last-view.ts");
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const mark = value => { if (value) document.documentElement.dataset.memberHint = value; else delete document.documentElement.dataset.memberHint; };

test("kept and shown only under the PRO / owner mark; a FREE or signed-out browser never reads it and drops it", () => {
  store.clear();
  for (const value of ["pro", "owner"]) {
    mark(value);
    assert.equal(memberMarked(), true);
    writeLastView("alerts", { feed: value }, 1_000);
    assert.deepEqual(readLastView("alerts", 2_000), { data: { feed: value }, at: 1_000 });
  }
  mark(null);
  assert.equal(readLastView("alerts", 2_000), null, "no mark: nothing is shown");
  writeLastView("alerts", { feed: "free" }, 3_000);
  assert.equal(store.size, 0, "a write without the mark removes the kept copy");
});

test("kept a day at most, and forgotten on request", () => {
  store.clear(); mark("pro");
  writeLastView("topics", [1], 0);
  assert.ok(readLastView("topics", 24 * 3_600_000 - 1));
  assert.equal(readLastView("topics", 24 * 3_600_000), null);
  forgetLastView("topics");
  assert.equal(store.size, 0);
  mark(null);
});

test("ハイテク速報 shows the member's last view at once, keeps it only while PRO, forgets it once the reader is known not to be PRO", () => {
  const flash = read("app/research/news/flash-page.tsx");
  assert.match(flash, /if \(initial\) return;\n    const kept = readLastView</);
  assert.match(flash, /if \(memberSettled && !full\) \{ forgetLastView\("alerts"\); return; \}/);
  assert.match(flash, /if \(full && feed && wireLoaded && checkedAt\) writeLastView\("alerts"/);
  // FREE rules are unchanged on screen: a non-PRO reader's rows go through the FREE filter (30 minutes, latest five).
  assert.match(flash, /const rows = full \? allRows : freeFlashRows\(allRows/);
  const topics = read("app/research/news/general-news-panel.tsx");
  assert.match(topics, /const kept = generalOnly && !cached \? readLastView<GeneralNewsFeed>\("topics"\) : null;/);
  assert.match(topics, /if \(generalOnly\) writeLastView\("topics", payload\);/);
  // The mark is set before the first paint from the last verified membership and removed when a check finds the reader is not PRO.
  assert.match(read("app/research/member-display-provider.tsx"), /writeHint\(pro \|\| ownerHint \? \{/);
});
