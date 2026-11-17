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

test("6. Nov 17 design: no emoji row in the post; a face button, a popover under it and a badge on the bottom-right edge", async () => {
  const component = await read("../app/research/desk/reactions.tsx");
  assert.doesNotMatch(component, /reactionRow|reactionChip|reactionPlus|reactionPicker/);
  const order = [...component.matchAll(/emoji: "([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(order, ["👍", "😊", "😢", "😠", "🔥"]);
  assert.match(component, /reactionState\(/, "the existing toggle is kept");
  assert.match(component, /aria-expanded=\{open\}/);
  assert.match(component, /aria-pressed=\{value\.selected\}/);
  assert.match(component, /\.filter\(choice => choice\.count > 0\)\.sort\(\(a, b\) => b\.count - a\.count\)/, "only those with one or more, most first");
  assert.match(component, /shortCount\(choice\.count\)/);
  const css = await read("../app/research/desk/format.module.css");
  assert.doesNotMatch(css, /\.reaction(Row|Chip|Plus|Picker|Add)\b/);
  const rule = name => css.match(new RegExp(`\\.${name}\\{([^}]*)\\}`))[1];
  for (const value of ["width:30px", "height:30px", "border:1px solid #3a3424", "border-radius:50%"]) assert.ok(rule("faceButton").includes(value), value);
  assert.match(css, /\.faceButton svg\{[^}]*stroke:#b9a77f/);
  for (const value of ["position:absolute", "top:calc(100% + 8px)", "display:flex", "background:#1b2330", "border:1px solid #33465b"]) assert.ok(rule("reactionPopover").includes(value), value);
  assert.match(css, /\.reactionChoice\[aria-pressed=true\]\{border-color:#8a7444;background:#2a2213\}/, "gold border on my own");
  for (const value of ["position:absolute", "right:14px", "bottom:-14px", "height:28px", "border-radius:14px", "background:#151b25", "border:1px solid #2f3a4a", "max-width:calc(100% - 28px)"]) assert.ok(rule("reactionBadge").includes(value), value);
  const columns = await read("../app/research/columns/columns.tsx");
  assert.match(columns, /ownerMode \? <PostActions[^]*?: access === "pro" \? <ReactionFace reactions=\{reactions\} ja=\{ja\}>\{noteMeta\}<\/ReactionFace> : noteMeta/, "owner: pencil and trash; PRO member: the face");
  assert.match(columns, /item\.kind === "notes" && access === "pro" && !editing && <ReactionBadge/, "the badge shows for the owner too");
});
