import assert from "node:assert/strict";
import { test } from "node:test";
import { targetPreview } from "../lib/research/x-target-preview.ts";

test("price target preview extracts only supported X claims and labels verification", () => {
  const result = targetPreview("$AMD price target raised to $720 from $620 at BofA BofA keeps Buy", ["AMD"]);
  assert.equal(result?.heading, "AMD：BofAが目標株価を620ドルから720ドルへ引き上げ");
  assert.match(result?.summary ?? "", /原発表での確認待ち/);
  assert.equal(targetPreview("$AMD price target raised to $720", ["AMD"]), null);
  assert.equal(targetPreview("$AMD price target raised to $720 from $620 at BofA", ["AMD", "MU"]), null);
});
