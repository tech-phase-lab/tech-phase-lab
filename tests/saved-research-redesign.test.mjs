import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("../app/research/research-dashboard.tsx");
const empty = read("../app/research/saved-empty.tsx");
const notebook = read("../app/research/research-notebook.tsx");
const walker = read("../lib/research/notebook-pdf-browser.ts");

test("the empty saved page shows the invented sample, exactly as worded, and never a real article", () => {
  for (const text of ["TICKER", "書き込みの例", "ある半導体メーカーが、新工場の稼働を前倒しへ", "稼働を来期の初めに前倒しし", "生産能力の引き上げ", "需要の取り込み", "次の決算で、設備投資の額を確認する", "蛍光ペン", "下線", "囲み", "メモ", "気づきを残す、自分だけの一冊。", "何度でも立ち戻れる場所に。", "保存する記事を調べる"]) assert.ok(empty.includes(text), text);
  assert.match(dashboard, /<SavedEmpty lang=\{lang\} onFind=/);
  assert.match(dashboard, /MY RESEARCH/);
});

test("the article picker has its own header, ticker chips, a bookmark per card and the bar after saving", () => {
  for (const text of ["PICK AN ARTICLE", "保存する記事を選ぶ", "しおりを押すと、保存一覧に入ります。", "保存一覧へ", "件を保存しました"]) assert.ok(dashboard.includes(text), text);
  assert.match(dashboard, /styles\.pickChips/);
  assert.match(dashboard, /styles\.pickSave/);
  assert.match(dashboard, /setSavedBurst\(count => count \+ 1\)/);
  assert.doesNotMatch(dashboard, /openSavedButton/);
});

test("saving and writing logic is untouched: the same update, commit and merge calls remain (source check)", () => {
  assert.match(dashboard, /collection\.update\(current => \(\{ \.\.\.current, saved: removing/);
  assert.match(dashboard, /collection\.commitMarks\(active\.id, lang, raw, marks\)/);
  assert.match(notebook, /mergeSavedDocuments\(wrap\(previous\.after\)/);
});

test("the writing sheet and the PDF carry the parts the design names", () => {
  for (const text of ["本文をなぞると、1行ずつ選べます", "選択中: ", "この書き込みを削除", "元に戻す", "完了"]) assert.ok(notebook.includes(text), text);
  assert.match(notebook, /data-ink-tail=/);
  for (const layout of ["meta", "company", "title", "facts", "change", "section", "metrics"]) assert.ok(walker.includes(`layout === "${layout}"`), layout);
  for (const layout of ["meta", "company", "title", "facts", "change", "section", "metrics"]) assert.ok(dashboard.includes(`data-pdf="${layout}"`), layout);
});
