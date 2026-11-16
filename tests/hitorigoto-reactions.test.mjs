import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { shortCount } from "../app/research/desk/reaction-state.ts";
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("6. reaction counts: as they are below 1,000, then 1k / 1.2k with one decimal and no .0", () => {
  for (const [count, text] of [[1, "1"], [9, "9"], [36, "36"], [999, "999"], [1000, "1k"], [1049, "1k"], [1200, "1.2k"], [1299, "1.2k"], [1999, "1.9k"], [2000, "2k"], [12345, "12.3k"], [99999, "99.9k"]]) {
    assert.equal(shortCount(count), text, `${count}`);
  }
  assert.equal(shortCount(0), "0");
  assert.equal(shortCount(-3), "0");
  assert.equal(shortCount(Number.NaN), "0");
});

test("6. the dotted ＋ picker is gone; the five emoji are one row in the fixed order", async () => {
  const component = await read("../app/research/desk/reactions.tsx");
  assert.doesNotMatch(component, /reactionPlus|reactionPicker|reactionAdd|aria-haspopup|aria-expanded/);
  const order = [...component.matchAll(/emoji: "([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(order, ["👍", "😊", "😢", "😠", "🔥"]);
  assert.match(component, /choices\.map\(choice =>/, "every choice is rendered, not only pressed ones");
  assert.match(component, /value\.count > 0 && <span className=\{styles\.reactionCount\}/, "no number at zero");
  assert.match(component, /aria-pressed=\{value\.selected\}/);
  const css = await read("../app/research/desk/format.module.css");
  assert.doesNotMatch(css, /\.reaction(Plus|Picker|Add)\b/);
  assert.match(css, /\.reactionRow\{display:flex;flex-wrap:nowrap;align-items:center;gap:4px[^}]*overflow-x:auto/, "never wraps and never widens the page");
  const chip = css.match(/\.reactions \.reactionChip\{([^}]*)\}/)[1];
  for (const rule of ["gap:3px", "height:30px", "padding:0 7px", "border:1px solid #2a3140", "border-radius:15px", "background:#121620"]) assert.ok(chip.includes(rule), rule);
  assert.match(css, /\.reactions \.reactionChip\[aria-pressed=true\]\{border-color:#8a7444;background:#2a2213\}/);
  assert.match(css, /\.reactions \.reactionCount\{[^}]*font:11px\/1 [^;}]*monospace;color:#8e9aaa/);
  assert.match(css, /\.reactions \.reactionChip\[aria-pressed=true\] \.reactionCount\{color:#e2c27a\}/);
});
