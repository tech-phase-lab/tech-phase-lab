import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import terms from "../lib/legal/terms-ja.ts";
import privacy from "../lib/legal/privacy-ja.ts";
import commerce from "../lib/legal/commerce-ja.ts";
import { parseLegal } from "../lib/legal/parse.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const row = cells => `| ${cells.join(" | ")} |`;
const blockTexts = blocks => blocks.flatMap(b => b.kind === "table" ? [row(b.header), "|---|---|", ...b.rows.map(row)] : b.kind === "items" ? b.items.map(i => `${i.no}. ${i.text}`) : b.kind === "bullets" ? b.items.map(i => `- ${i}`) : b.kind === "title" ? [`# ${b.text}`] : b.kind === "heading" ? [`## ${b.text}`] : [b.text]);

test("the pages carry the owner's Markdown byte for byte", () => {
  assert.equal(terms, read("../content/legal/terms.ja.md"));
  assert.equal(privacy, read("../content/legal/privacy.ja.md"));
  assert.equal(commerce, read("../content/legal/commerce.ja.md"));
});

// Since Nov 17 the texts are the lawyer-reviewed full texts (owner pack). The only placeholder left is 「●日」 in the privacy
// policy (days until backups are erased): it stays as written until the real retention is confirmed.
test("every line of the text is shown exactly as written, the ●日 placeholder included", () => {
  for (const [source, placeholders] of [[terms, ["月額2,980円(税込)または年額29,800円(税込)", "東京地方裁判所を第一審の合意管轄"]],
    [privacy, ["最長●日間", "バックアップを含めて●日以内に削除します"]],
    [commerce, ["| 事業者の氏名 | ご請求があればメールでお知らせします |", "support@techphase.app"]]]) {
    const lines = source.split("\n").filter(line => line.trim()).map(line => line.trimEnd());
    assert.deepEqual(blockTexts(parseLegal(source)), lines);
    for (const mark of placeholders) assert.ok(source.includes(mark) && blockTexts(parseLegal(source)).join("\n").includes(mark), mark);
  }
});

test("terms has 22 articles, privacy 10 sections, and the commerce notice one table each for Tech Phase Research and RESOLUTE", () => {
  assert.equal(parseLegal(terms).filter(b => b.kind === "heading").length, 22);
  assert.equal(parseLegal(privacy).filter(b => b.kind === "heading").length, 10);
  const tables = parseLegal(commerce).filter(b => b.kind === "table");
  assert.deepEqual(parseLegal(commerce).filter(b => b.kind === "heading").map(b => b.text), ["Tech Phase Research", "RESOLUTE"]);
  assert.deepEqual(tables.map(t => t.rows.length), [14, 14]); // + 申し込みの撤回 (lawyer review, Nov 24)
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
  assert.match(lp, /href="\/privacy">プライバシーポリシー</);
  const header = read("../app/research/site-header.tsx");
  assert.doesNotMatch(header, /href="\/terms"/); assert.doesNotMatch(header, /href="\/privacy"/);
  const home = read("../app/research/research-dashboard.tsx");
  assert.match(home, /<Link href="\/terms">/); assert.match(home, /<Link href="\/privacy">/);
});

test("the English terms and privacy policy follow the Japanese originals clause by clause (owner, Nov 6)", async () => {
  const { parseLegal } = await import("../lib/legal/parse.ts");
  for (const name of ["terms", "privacy", "commerce"]) {
    const ja = parseLegal((await import(`../lib/legal/${name}-ja.ts`)).default), en = parseLegal((await import(`../lib/legal/${name}-en.ts`)).default);
    const shape = blocks => blocks.filter(block => block.kind !== "title").map(block => block.kind === "items" || block.kind === "bullets" ? `${block.kind}:${block.items.length}` : block.kind === "table" ? `table:${block.rows.length}` : block.kind).join(",");
    // The English adds one translation notice after the title; every other block matches in kind and count.
    assert.equal(shape(en), "text," + shape(ja), name);
    assert.equal(en.filter(block => block.kind === "heading").length, ja.filter(block => block.kind === "heading").length, name);
  }
  const terms = (await import("../lib/legal/terms-en.ts")).default;
  for (const fact of ["2,980", "29,800", "USD 20", "USD 200", "5,980", "3,980", "7,980", "9,800", "30 days", "one year", "three months", "3,000"]) assert.ok(terms.includes(fact), fact);
  assert.ok(terms.includes("the Japanese version prevails"));
});
