import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import terms from "../lib/legal/terms-ja.ts";
import privacy from "../lib/legal/privacy-ja.ts";
import { parseLegal } from "../lib/legal/parse.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const blockTexts = blocks => blocks.flatMap(b => b.kind === "items" ? b.items.map(i => `${i.no}. ${i.text}`) : b.kind === "bullets" ? b.items.map(i => `- ${i}`) : b.kind === "title" ? [`# ${b.text}`] : b.kind === "heading" ? [`## ${b.text}`] : [b.text]);

test("the pages carry the owner's Markdown byte for byte", () => {
  assert.equal(terms, read("../content/legal/terms.ja.md"));
  assert.equal(privacy, read("../content/legal/privacy.ja.md"));
});

test("every line of the text is shown exactly as written, placeholders in 【】 included", () => {
  for (const [source, placeholders] of [[terms, ["【2,980円(税込)】", "【日本語版5,980円(税込)、PRO会員は3,980円(税込)/英語版39米ドル、PRO会員は29米ドル】", "【30日】", "【運営者の所在地を管轄する地方裁判所】", "【制定日】"]],
    [privacy, ["【請求があった場合に遅滞なく開示します】", "【問い合わせ用メールアドレス】", "【アクセス解析ツールを使う場合は、その名称と無効にする方法をここに書きます。】", "【制定日】"]]]) {
    const lines = source.split("\n").filter(line => line.trim()).map(line => line.trimEnd());
    assert.deepEqual(blockTexts(parseLegal(source)), lines);
    for (const mark of placeholders) assert.ok(source.includes(mark) && blockTexts(parseLegal(source)).join("\n").includes(mark), mark);
  }
});

test("terms has 16 articles and privacy 9 sections", () => {
  assert.equal(parseLegal(terms).filter(b => b.kind === "heading").length, 16);
  assert.equal(parseLegal(privacy).filter(b => b.kind === "heading").length, 9);
});

test("the pages are public drafts: no sign-in, not indexed, at /terms and /privacy", () => {
  for (const [dir, title] of [["terms", "利用規約"], ["privacy", "プライバシーポリシー"]]) {
    const page = read(`../app/${dir}/page.tsx`);
    assert.match(page, /robots: \{ index: false, follow: false \}/);
    assert.ok(!/clerk|auth\(|getMembership/i.test(page + read(`../app/${dir}/layout.tsx`)));
    assert.ok(page.includes(title));
  }
  const proxy = read("../proxy.ts");
  assert.ok(!/\/terms|\/privacy/.test(proxy));
});

test("links: LP footer and home footer reach both pages; the menu no longer carries them (owner, Oct 28)", () => {
  const lp = read("../app/resolute/lp/landing.tsx");
  assert.match(lp, /href="\/terms">利用規約/);
  assert.match(lp, /href="\/privacy">プライバシー</);
  const header = read("../app/research/site-header.tsx");
  assert.doesNotMatch(header, /href="\/terms"/); assert.doesNotMatch(header, /href="\/privacy"/);
  const home = read("../app/research/research-dashboard.tsx");
  assert.match(home, /<Link href="\/terms">/); assert.match(home, /<Link href="\/privacy">/);
});

test("the English terms and privacy policy follow the Japanese originals clause by clause (owner, Nov 6)", async () => {
  const { parseLegal } = await import("../lib/legal/parse.ts");
  for (const name of ["terms", "privacy"]) {
    const ja = parseLegal((await import(`../lib/legal/${name}-ja.ts`)).default), en = parseLegal((await import(`../lib/legal/${name}-en.ts`)).default);
    const shape = blocks => blocks.filter(block => block.kind !== "title").map(block => block.kind === "items" || block.kind === "bullets" ? `${block.kind}:${block.items.length}` : block.kind).join(",");
    // The English adds one translation notice after the title; every other block matches in kind and count.
    assert.equal(shape(en), "text," + shape(ja), name);
    assert.equal(en.filter(block => block.kind === "heading").length, ja.filter(block => block.kind === "heading").length, name);
  }
  const terms = (await import("../lib/legal/terms-en.ts")).default;
  for (const fact of ["2,980", "5,980", "3,980", "USD 39", "USD 29", "30 days", "one year"]) assert.ok(terms.includes(fact), fact);
  assert.ok(terms.includes("the Japanese version prevails"));
});
