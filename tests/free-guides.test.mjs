import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("free learning and service help stay separate and linked from navigation", () => {
  const guide = read("app/research/learn/guide.tsx");
  const faq = read("app/research/faq/faq.tsx");
  const home = read("app/research/home-tools.tsx");
  const nav = read("app/research/bottom-nav.tsx");
  assert.match(guide, /口座を開く前に/);
  assert.match(guide, /注文画面で止まって確認/);
  assert.match(guide, /決算を読む順番/);
  assert.match(guide, /日本居住者向け/);
  assert.match(guide, /一般情報です/);
  assert.match(faq, /質問すると必ず回答されますか/);
  assert.match(faq, /以前の非公開質問は本人と運営者だけ/);
  assert.match(faq, /画面の更新間隔と、発表から端末到着までの実測時間は別/);
  for (const source of [home, nav]) {
    assert.match(source, /\/research\/learn/);
    assert.match(source, /\/research\/faq/);
  }
});

test("beginner guide uses official regulator references without affiliate links", () => {
  const guide = read("app/research/learn/guide.tsx");
  assert.match(guide, /fsa\.go\.jp\/menkyo/);
  assert.match(guide, /fsa\.go\.jp\/policy\/nisa2/);
  assert.match(guide, /investor\.gov\/introduction-investing/);
  assert.doesNotMatch(guide, /affiliate|アフィリエイト/i);
});

 test("home help is secondary and quick tools omit diagonal arrows", () => {
  const home = read("app/research/home-tools.tsx");
  const quick = home.split("<nav className={styles.grid}")[1].split("</nav>")[0];
  assert.doesNotMatch(quick, /research\/(learn|faq)|↗/);
  const dashboard = read("app/research/research-dashboard.tsx");
  assert.ok(dashboard.indexOf("<HomeHelp") > dashboard.indexOf("<PriceTargetsPanel"));
  const nav = read("app/research/bottom-nav.tsx");
  assert.ok(nav.indexOf('["/research/learn"') > nav.indexOf('["/research/calendar"'));
  assert.match(nav, /member\?\.status === "signed-in" && member\?\.plan === "pro"/);
  assert.match(nav, /proMenu \|\| !\["\/research\/notes", "\/research\/qa", "\/research\/weekly"\]\.includes\(href\)/);
});
