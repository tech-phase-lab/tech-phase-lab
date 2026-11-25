// RESOLUTE PC versions of the LP and ① the rule diagnosis (owner, Nov 25: 01_LP_PC, 04_ルール診断_PC), and the diagnosis's
// new phone look (resolute-mobile-all-1125 03〜05).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../app/resolute/lp/lp.module.css");
const pc = css.slice(css.indexOf("@media (min-width:1024px)"));

test("the LP PC layout is CSS at 1024px and wider; the phone keeps its layout", () => {
  // Everything PC-only sits inside the media query; outside it the PC menu is hidden and the wrappers add no box.
  assert.match(css, /\.pcBar \{ display:none; \}/);
  assert.match(css, /\.featureGrid, \.visualPair, \.bookCard \{ display:contents; \}/);
  assert.match(pc, /\.pcBar \{ position:fixed;/);
  assert.match(pc, /word-break:auto-phrase/);
  // Side-by-side panels stretch to the same height.
  for (const rule of [".featureGrid {", ".nights {", ".faq {", ".visualPair {"]) assert.match(pc.slice(pc.indexOf(rule)), /align-items:stretch/, rule);
  // Never cut words with "…".
  assert.doesNotMatch(pc, /text-overflow:\s*ellipsis|line-clamp/);
});

test("both LPs keep their words and add only the PC top menu (sections, JA/EN, buy)", () => {
  for (const [file, en] of [["../app/resolute/lp/landing.tsx", false], ["../app/resolute/lp/landing-en.tsx", true]]) {
    const lp = read(file);
    assert.ok(lp.includes(`<PcBar en={${en}} embedded={embedded} />`), file);
    for (const id of ["top", "nights", "features", "message", "faq"]) assert.ok(lp.includes(`id="${id}"`), `${file} #${id}`);
    assert.ok(lp.includes(`<Buy price={price} id="buy" />`), file);
  }
  const parts = read("../app/resolute/lp/parts.tsx");
  for (const text of ["暴落の夜・急騰の夜", "11の機能", "リゼルから", "よくある質問", "RESOLUTEを手に入れる", "Get RESOLUTE"]) assert.ok(parts.includes(text), text);
  // 「暴落の夜も　急騰の夜も」 on one line on PC, 「自分のルールを守る」 on the next.
  assert.ok(read("../app/resolute/lp/landing.tsx").includes("暴落の夜も<br /><span className={s.catchSecond}>急騰の夜も</span><br /><em>自分のルールを守る</em>"));
  assert.match(pc, /\.catch br:first-of-type \{ display:none; \}/);
});

test("the diagnosis uses the shared PC frame and the new phone look, with the same content on both", () => {
  const screen = read("../app/resolute/screen.tsx"), pcCss = read("../app/resolute/pc.module.css");
  assert.match(screen, /<ToolShell identityReady=\{identityReady\} pc>/);
  assert.match(screen, /if\(mode==="intro"&&desktop\)/);
  assert.match(screen, /<div className=\{pc\.diagQuestion\}>/);
  assert.match(screen, /<span className=\{styles\.diagCount\}><b>\{index\+1\}<\/b>\/ \{QUESTION_TOTAL\}<\/span>/);
  // The result: 「保存済みのルールがあります…」 stays off the result, on PC and on the phone (one shared set of actions).
  assert.equal(screen.match(/messageView\(message==="existing"\?null:message\)/g)?.length, 1);
  // The three steps of the quiz from the owner's mockups (phone 03 and PC 04).
  for (const text of ["30問に答える", "ボタンを押すだけ・約5分", "あなたのタイプがわかる", "相場での強みと迷いやすい場面", "あなたの投資ルールができる", "一冊と壁紙にして持ち歩けます"]) assert.ok(screen.includes(text), text);
  for (const rule of [".diagIntro {", ".diagQuestion {", ".diagTop {", ".diagRuleGrid {", ".diagBottom {"]) assert.match(pcCss.slice(pcCss.indexOf(rule)), /align-items: stretch/, rule);
});

test("the phone diagnosis uses the shared look (#871) and only lays out its own parts", () => {
  const diag = read("../app/resolute/diagnosis.module.css"), screen = read("../app/resolute/screen.tsx");
  const own = diag.slice(diag.indexOf("/* ① Rule diagnosis (owner, Nov 25"));
  assert.match(own, /\.diag\{word-break:auto-phrase\}/);
  // No own versions of the shared panels, buttons or pills.
  assert.doesNotMatch(own, /\.(primary|secondary|pill|panel)\b[^{]*\{/);
  assert.match(screen, /<SectionHeading label=\{eyebrow\}/);
  assert.ok(screen.includes("styles.panel"));
  assert.doesNotMatch(own, /text-overflow:\s*ellipsis|line-clamp/);
});
