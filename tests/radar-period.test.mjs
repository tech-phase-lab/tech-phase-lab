import test from "node:test";
import assert from "node:assert/strict";
import { quarterOf } from "../lib/research/radar-period.ts";

test("the radar names the quarter its newest results cover, not a bare month (owner, Nov 14)", () => {
  assert.equal(quarterOf("2026-09-30", true), "7〜9月期");
  assert.equal(quarterOf("2026-10-02", true), "7〜9月期");     // a 52/53-week quarter ending in the first days of October
  assert.equal(quarterOf("2026-01-31", true), "11〜1月期");
  assert.equal(quarterOf("2026-08-01", true), "5〜7月期");
  assert.equal(quarterOf("2026-09-30", false), "Jul–Sep quarter");
  assert.equal(quarterOf(null, true), "");
});
