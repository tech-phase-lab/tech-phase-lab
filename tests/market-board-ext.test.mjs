import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("market board: a 時間外 line at ±0.00% is not shown (owner, Nov 28)", () => {
  const src = fs.readFileSync(new URL("../app/research/price/market-board.tsx", import.meta.url), "utf8");
  assert.match(src, /Math\.abs\(itemExt\.percentChange\) >= 0\.005 && <ExtLine/);
});
