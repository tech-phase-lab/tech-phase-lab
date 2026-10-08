import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("free learning and service help stay separate and linked from navigation", () => {
  const guide = read("app/research/learn/guide.tsx");
  const faq = read("app/research/faq/faq.tsx");
  const home = read("app/research/home-tools.tsx");
  // The full menu moved from the bottom bar to the header menu (Oct 8).
  const nav = read("app/research/site-header.tsx");
  assert.match(guide, /口座を開く/);
  assert.match(guide, /注文する/);
  assert.match(guide, /購入までの4ステップ/);
  assert.doesNotMatch(guide, /日本居住者向け|NISA|一次情報を確認する|最初は、この順番で/);
  assert.match(faq, /質問をすると必ず回答されますか/);
  assert.doesNotMatch(faq, /以前の非公開質問/);
  assert.doesNotMatch(faq, /現在は開発プレビューです/);
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
  const nav = read("app/research/site-header.tsx");
  assert.ok(nav.indexOf('item("/research/learn"') > nav.indexOf('item("/research/calendar"'));
  assert.match(nav, /const member = ownerAccount \|\| plan === "pro"/);
  // PRO destinations are listed for PRO members and the owner only.
  const pro = nav.slice(nav.indexOf("{member && <div className={styles.grp}>"), nav.indexOf("</div>}", nav.indexOf("{member && <div className={styles.grp}>")));
  for (const href of ["/research/compare", "/research/notes", "/research/qa", "/research/weekly"]) assert.ok(pro.includes(`item("${href}"`), href);
});

test("FAQ owns its styles and every referenced class is defined", () => {
  const faq = read("app/research/faq/faq.tsx");
  assert.match(faq, /from "\.\/styles\.module\.css"/);
  const css = read("app/research/faq/styles.module.css");
  for (const [, name] of faq.matchAll(/className=\{styles\.(\w+)\}/g)) {
    assert.ok(css.includes(`.${name}`), `Missing FAQ style: ${name}`);
  }
});
