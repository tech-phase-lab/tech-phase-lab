// RESOLUTE ⑥ Tax estimate PC, マイルール PC (two-page spread) and the phone rulebook fixes (owner, Nov 25).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rulebookChapters, numberChapters, chapterGroup } from "../lib/resolute/rulebook.ts";
import { createReviewSamplePlan } from "../lib/resolute/review-sample.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("chapter numbers run 01, 02, 03… in Japanese and English; continued pages keep their chapter's number", () => {
  const plan = createReviewSamplePlan();
  for (const locale of ["ja", "en"]) {
    const chapters = rulebookChapters(plan, locale);
    assert.equal(chapters[0].kicker, "01 / KNOW YOURSELF");
    assert.equal(chapters[1].kicker, "02 / UNDERSTAND YOUR HABITS");
    assert.equal(chapters[2].kicker, "03 / PROTECT YOUR FOUNDATION");
    const seen = new Map();
    for (const chapter of chapters) {
      const number = chapter.kicker.slice(0, 2), group = chapterGroup(chapter);
      if (seen.has(group)) assert.equal(seen.get(group), number); else seen.set(group, number);
    }
    assert.deepEqual([...seen.values()], [...seen.values()].map((_, i) => String(i + 1).padStart(2, "0")));
  }
  // Long conditions split over several pages keep one chapter number.
  const pages = numberChapters([
    { id: "a", kicker: "01 / A", title: "", lead: "", paragraphs: [], metrics: [] },
    { id: "hold-off-0", kicker: "06 / B", title: "", lead: "", paragraphs: [], metrics: [] },
    { id: "hold-off-1", kicker: "06 / B", title: "", lead: "", paragraphs: [], metrics: [] },
    { id: "pause-0", kicker: "06 / B", title: "", lead: "", paragraphs: [], metrics: [] },
  ]);
  assert.deepEqual(pages.map(p => p.kicker), ["01 / A", "02 / B", "02 / B", "03 / B"]);
});

test("phone rulebook: the page bar sits below the page, the bookmark clears MY RULES, a tap turns the page", () => {
  const css = read("../app/resolute/diagnosis.module.css");
  assert.doesNotMatch(css, /\.readerControls\{position:sticky/);
  assert.match(css, /\.bookRibbon\{position:absolute;z-index:3;right:112px;/);
  const book = read("../app/resolute/notebook/book.tsx");
  assert.match(book, /onClick=\{event=>\{if\(Date\.now\(\)-swiped\.current<500/);
  assert.match(book, /event\.clientX-box\.left>box\.width\/2\?1:-1/);
  // Swipe still turns the page.
  assert.match(book, /Math\.abs\(dx\)>70&&Math\.abs\(dx\)>Math\.abs\(dy\)\*2/);
});

test("PC rulebook: a spread after the cover, click / keys / buttons turn it, contents from rulebook.ts, text flows on", () => {
  const spread = read("../app/resolute/notebook/spread.tsx");
  assert.match(spread, /rulebookChapters\(plan, locale\)/);
  assert.match(spread, /const leftOf = \(s: number\): Side => s === 0 \? "none" : 2 \* s - 1;/);
  assert.match(spread, /data-side="left" onClick=\{\(\) => go\(shown - 1\)\}/);
  assert.match(spread, /data-side="right" onClick=\{\(\) => go\(shown \+ 1\)\}/);
  assert.match(spread, /event\.key === "ArrowRight"/);
  assert.match(spread, /`\$\{pad\(2 \* shown - 1\)\}–\$\{pad\(2 \* shown\)\} \/ \$\{pad\(total\)\}`/);
  assert.match(spread, /aria-current=\{entry\.pages\.some\(n => inView\.has\(n\)\) \? "page" : undefined\}/);
  assert.match(spread, /area\.scrollHeight <= area\.clientHeight \+ 1/);
  assert.doesNotMatch(spread, /text-overflow|line-clamp|…/);
  const css = read("../app/resolute/notebook/book-pc.module.css");
  assert.match(css, /\.layout \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 264px; gap: 26px; align-items: stretch; \}/);
  assert.doesNotMatch(css, /ellipsis|line-clamp/);
  const screen = read("../app/resolute/notebook/screen.tsx");
  assert.match(screen, /<ToolShell identityReady=\{identityReady\} pc>/);
  for (const words of ["この一冊を保存する", "ルールを見直す", "表紙に戻る", "通信なしで読み返せます。"]) assert.ok((screen + spread).includes(words), words);
});

test("PC tax estimate: inputs and result side by side, six assumptions in a 3 × 2 grid of equal height", () => {
  const screen = read("../app/resolute/tax/screen.tsx");
  assert.match(screen, /<ToolShell identityReady=\{identityReady\} pc>/);
  assert.match(screen, /if \(desktop\) return <TaxPc/);
  assert.match(screen, /TAX_ASSUMPTIONS\.map\(row => <div key=\{row\.en\.term\} className=\{x\.assumption\}>/);
  assert.match(screen, /税率は所得税15%・住民税5%・復興特別所得税の合計20\.315%で計算しています。/);
  assert.match(screen, /<FlowNavigation step=\{6\} locale=\{locale\} wide\/>/);
  // Phone: the result has the tax row in red and the after-tax row in gold; この計算の前提 opens item by item.
  assert.match(screen, /<section className=\{`\$\{styles\.card\} \$\{x\.result\} \$\{x\.phoneResult\}`\}/);
  assert.match(screen, /TAX_ASSUMPTIONS\.map\(row => <details key=\{row\.en\.term\} className=\{x\.phoneAssumption\}>/);
  const css = read("../app/resolute/tax/tax-pc.module.css");
  assert.match(css, /\.assumptions \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); grid-auto-rows: 1fr;/);
  assert.match(css, /\.pair \{ display: grid;[^}]*align-items: stretch; \}/);
  assert.doesNotMatch(css, /ellipsis|line-clamp/);
});
