import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("free learning and service help stay separate and linked from navigation", () => {
  const guide = read("app/research/learn/guide.tsx");
  const faq = read("app/research/faq/faq.tsx");
  const home = read("app/research/home-tools.tsx");
  const nav = read("app/research/bottom-nav.tsx");
  assert.match(guide, /口座を開く/);
  assert.match(guide, /注文する/);
  assert.match(guide, /購入までの4ステップ/);
  assert.doesNotMatch(guide, /日本居住者向け|NISA|一次情報を確認する|最初は、この順番で/);
  assert.match(faq, /質問をすると必ず回答されますか/);
  assert.doesNotMatch(faq, /以前の非公開質問/);
  assert.match(faq, /課金はまだ開始していません/);
  assert.doesNotMatch(faq, /12月に開設予定/);
  assert.match(faq, /全質問への回答はお約束できません/);
  assert.doesNotMatch(faq, /無料で読めるものは|通知は何秒|見出しはありますか|カレンダーはリアルタイム|英語表示はいつ/);
  for (const source of [home, nav]) {
    assert.match(source, /\/research\/learn/);
    assert.match(source, /\/research\/faq/);
  }
});

test("beginner guide explains orders and risk without fabricated affiliate links", () => {
  const guide = read("app/research/learn/guide.tsx");
  assert.match(guide, /成行/);
  assert.match(guide, /指値/);
  assert.match(guide, /条件に合わなければ買えません/);
  assert.match(guide, /損失が出ることもあります/);
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
  assert.match(nav, /useMemberDisplay\(\) === "pro"/);
  assert.match(nav, /proMenu \|\| !\["\/research\/compare", "\/research\/notes", "\/research\/qa", "\/research\/weekly"\]\.includes\(href\)/);
});
