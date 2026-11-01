import test from "node:test";
import assert from "node:assert/strict";
import { barVisible, needsRefresh, parseBarState, DISMISS_MS, REFRESH_MS } from "../lib/research/resolute-bar-state.ts";

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
