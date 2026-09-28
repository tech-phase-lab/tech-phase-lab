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
  assert.match(faq, /送信文は自動公開されません/);
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
