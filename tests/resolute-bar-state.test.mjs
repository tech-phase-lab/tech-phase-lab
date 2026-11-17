import test from "node:test";
import assert from "node:assert/strict";
import { barStateFromAnswer, barVisible, needsRefresh, parseBarState, DISMISS_MS, REFRESH_MS } from "../lib/research/resolute-bar-state.ts";

const now = Date.parse("2026-10-27T00:00:00Z");
const state = (owned, anon = false) => ({ owned, anon, at: now });

test("the bar is never drawn for a purchaser; a signed-in person with nothing remembered waits, a signed-out visitor does not", () => {
  assert.equal(barVisible(state(true), 0, true, now), false);
  assert.equal(barVisible(state(true, true), 0, false, now), false);
  assert.equal(barVisible(null, 0, true, now), false);   // signed in, unknown: wait for the answer
  assert.equal(barVisible(null, 0, false, now), true);   // signed out: nothing bought, show at once
  assert.equal(barVisible(state(false), 0, true, now), true);
  assert.equal(barVisible(state(false, true), 0, false, now), true); // signed out, no purchase
});

test("an answer learned while signed out is not trusted once the visitor is signed in", () => {
  assert.equal(barVisible(state(false, true), 0, true, now), false);
});

test("'×' hides the bar for seven days, then it may return", () => {
  assert.equal(barVisible(state(false), now - 1000, false, now), false);
  assert.equal(barVisible(state(false), now - DISMISS_MS + 1000, false, now), false);
  assert.equal(barVisible(state(false), now - DISMISS_MS - 1000, false, now), true);
});

test("a damaged remembered state is ignored", () => {
  assert.equal(parseBarState(null), null);
  assert.equal(parseBarState("{"), null);
  assert.equal(parseBarState(JSON.stringify({ owned: "yes", anon: false, at: 1 })), null);
  assert.deepEqual(parseBarState(JSON.stringify({ owned: false, anon: true, at: 5 })), { owned: false, anon: true, at: 5 });
});

test("a signed-out answer is asked again once the member check shows a signed-in person", () => {
  assert.equal(needsRefresh(state(false, true), false, now), false);
  assert.equal(needsRefresh(state(false, true), true, now), true);
  assert.equal(needsRefresh(state(false), true, now), false);
  assert.equal(needsRefresh(null, false, now), true);
  assert.equal(needsRefresh({ ...state(false), at: now - REFRESH_MS }, false, now), true);
});

test("the owner sees the bar in every view until the seven-day mark", () => {
  const now = 1_000_000_000;
  assert.equal(barVisible(state(true), 0, true, now, true), true);
  assert.equal(barVisible(state(true), 0, true, now, false), false);
  assert.equal(barVisible(state(true), now - 1000, true, now, true), false);
});

test("the owner previewing a member plan sees the home bar exactly as a member without RESOLUTE does", () => {
  const now = 1_000_000_000;
  const ownerAnswer = barStateFromAnswer({ canUseTools: true, accessBasis: "owner" });
  const buyerAnswer = barStateFromAnswer({ canUseTools: true, use: { status: "active" } });
  const memberAnswer = barStateFromAnswer({ canUseTools: false, use: { status: "none" } });
  assert.deepEqual(ownerAnswer, { owned: true, anon: false, basis: "owner" });
  assert.deepEqual(buyerAnswer, { owned: true, anon: false });
  assert.deepEqual(memberAnswer, { owned: false, anon: false });
  assert.equal(barStateFromAnswer({ error: "x" }), null);
  const at = (answer) => ({ ...answer, at: now });
  // Owner mode (ownerAccount=true).
  assert.equal(barVisible(at(ownerAnswer), 0, true, now, true), true);
  // Owner previewing PRO or FREE (ownerAccount=false, but the entitlement answer is still the owner exception).
  assert.equal(barVisible(at(ownerAnswer), 0, true, now, false), true);
  // A real PRO member and a FREE member, neither of whom bought RESOLUTE.
  assert.equal(barVisible(at(memberAnswer), 0, true, now, false), true);
  // A RESOLUTE buyer (whatever their Tech Phase plan) never sees it.
  assert.equal(barVisible(at(buyerAnswer), 0, true, now, false), false);
  // "×" still hides it for seven days in the preview.
  assert.equal(barVisible(at(ownerAnswer), now - 1000, true, now, false), false);
});

test("the owner-access mark survives being remembered on the device", () => {
  assert.deepEqual(parseBarState(JSON.stringify({ owned: true, anon: false, at: 5, basis: "owner" })), { owned: true, anon: false, at: 5, basis: "owner" });
  assert.deepEqual(parseBarState(JSON.stringify({ owned: true, anon: false, at: 5, basis: "gift" })), { owned: true, anon: false, at: 5 });
});

test("every place that remembers the RESOLUTE answer keeps the owner-access mark", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of ["../app/research/resolute-bar.tsx", "../app/resolute/entry-gate.tsx", "../app/resolute/lp/owned-redirect.tsx"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /barStateFromAnswer\(body\)/, file);
    assert.doesNotMatch(source, /writeBarState\(\{ owned: body\.canUseTools/, file);
  }
});
