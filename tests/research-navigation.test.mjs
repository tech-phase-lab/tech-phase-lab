import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { researchViewFromHash, researchViewHashes } from "../lib/research/navigation.ts";

test("each research view can be restored from its URL on reload or history navigation", () => {
  for (const view of ["home", "changes", "metrics", "saved"]) {
    assert.equal(researchViewFromHash(researchViewHashes[view]), view);
  }
  assert.equal(researchViewFromHash(""), "home");
});

test("section links and unknown hashes do not silently replace the selected view", () => {
  for (const hash of ["#monitored-companies", "#tech-phase-pro", "#unknown", "#toString"]) {
    assert.equal(researchViewFromHash(hash), null);
  }
});

test("home navigation wires history, empty records, and honest feature labels", () => {
  const dashboard = readFileSync(new URL("../app/research/research-dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /addEventListener\("hashchange", syncHash\)/);
  assert.match(dashboard, /addEventListener\("popstate", syncHash\)/);
  assert.match(dashboard, /removeEventListener\("popstate", syncHash\)/);
  assert.match(dashboard, /window\.history\.pushState\(null, "", hash\)/);
  assert.match(dashboard, /window\.location\.hash !== hash/);
  assert.match(dashboard, /id="saved"/);
  assert.match(dashboard, /events\[0\]\?\.id \?\? ""/);
  assert.match(dashboard, /TradingViewの参考株価・12か月チャート/);
  assert.match(dashboard, /<HomeTools lang=\{lang\} onChanges=\{\(\) => openView\("changes"\)\}/);
  assert.doesNotMatch(dashboard, /参考株価・チャート", "REFERENCE PRICES/);
  assert.doesNotMatch(dashboard, /配信準備中|独自株価画面|契約確認後に価格/);
});
