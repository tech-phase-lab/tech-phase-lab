import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

// Owner, Nov 19: no 「。」「、」 right after a closing parenthesis, and amounts are written 「20ドル」, not 「20米ドル」.
// The currency name 「米ドル」 (tabs, 「米ドル建て」) is fine; the unit is 「百万ドル」, not 「百万米ドル」 (owner, Nov 20).
// Legal pages (owner, Nov 24): docs/COPY-PAREN-DOLLAR-LEGAL-PROPOSAL-2026-11-19.md applied; no 「米ドル」 at all there (checked below).
const ROOTS = ["app", "lib"];
const SKIP_DIRS = new Set(["lib/legal", "node_modules"]);
const CODE = new Set([".ts", ".tsx", ".mjs", ".js"]);
const PATTERNS = [/[)）][。、]/g, /\d米ドル/g, /百万米ドル/g];

// Each entry: file, a piece of the matching line, and why it stays.
const ALLOWED = [
  { file: "lib/research/whale-moves.ts", text: "（空売り残高÷平均出来高）。", reason: "クジラの足あとの「i」の説明。オーナー指定の文言をそのまま使う（11/22）" },
  { file: "lib/research/company-introductions.data.json", text: "Applied Optoelectronics（AAOI）、産業用", reason: "社名のティッカーの括弧のあとで、分野の区切りの読点。並べ替えても括弧が読点の前に来る" },
  { file: "lib/research/company-introductions.data.json", text: "Constellation（Calpine取得済み）、NRG", reason: "社名の補足の括弧のあとの列挙。並べ替えても分野の区切りの読点の前に来る" },
  { file: "lib/research/company-introductions.data.json", text: "Ortec (Ametek)、FLIR (Teledyne)、Fluke", reason: "親会社の括弧が付いた社名が3つ続く列挙。並べ替えでは避けられない" },
  { file: "lib/research/comparison-reference.ts", text: "10r/(1+r)、", reason: "数式の括弧" },
  { file: "lib/research/comparison-reference.ts", text: "(25+|m|))。", reason: "数式の括弧" },
  { file: "lib/research/comparison-reference.ts", text: "5+5x/(20+|x|)。", reason: "数式の括弧" },
  { file: "lib/research/comparison-reference.ts", text: "5+5g/(100+|g|)。", reason: "数式の括弧" },
  { file: "lib/research/comparison-reference.ts", text: "5+5x/(25+|x|)。", reason: "数式の括弧" },
  { file: "lib/research/ja-text.ts", text: ".replace(/）、/g", reason: "「）、」を取り除く処理そのもの" },
  { file: "lib/research/market-news-display.ts", text: "（(\\$[A-Z]{1,6})）、除外予定 [^（）$]+（(\\$[A-Z]{1,6})）。", reason: "監視側の見出しを読む正規表現。画面には組み直した見出しを出す" },
  { file: "lib/portfolio/parse.ts", text: "(説明文や記号は付けません)。", reason: "AIへの指示文で、画面には出ない" },
  { file: "lib/portfolio/parse.ts", text: "画面のティッカー(英字)。", reason: "AIへの指示文で、画面には出ない" },
  { file: "lib/portfolio/parse.ts", text: "保有数量(株)。", reason: "AIへの指示文で、画面には出ない" },
  { file: "lib/portfolio/parse.ts", text: "平均取得価額(ドル)。", reason: "AIへの指示文で、画面には出ない" },
  { file: "lib/portfolio/parse.ts", text: "現在値(ドル)。", reason: "AIへの指示文で、画面には出ない" },
  { file: "lib/portfolio/parse.ts", text: "評価損益(ドル)。", reason: "AIへの指示文で、画面には出ない" },
];

function files(dir) {
  if (SKIP_DIRS.has(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return files(path);
    return CODE.has(extname(entry.name)) || extname(entry.name) === ".json" ? [path] : [];
  });
}

/** Blank out // and /* *\/ comments (keeping line breaks) so only code and strings are checked. */
function stripComments(source) {
  let out = "", i = 0, quote = null;
  while (i < source.length) {
    const c = source[i], next = source[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") { out += next ?? ""; i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === "/" && next === "/") { while (i < source.length && source[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop; continue;
    }
    if (c === "\"" || c === "'" || c === "`") quote = c;
    out += c; i++;
  }
  return out;
}

/** JSON: string values only; keys starting with "_" are notes for editors. */
function jsonLines(source) {
  const lines = [];
  const walk = (value, key = "") => {
    if (key.startsWith("_")) return;
    if (typeof value === "string") lines.push(value);
    else if (Array.isArray(value)) value.forEach(item => walk(item));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(JSON.parse(source));
  return lines;
}

/** True when an occurrence of `text` in `line` contains the match at `index`. */
function covers(line, text, index) {
  for (let at = line.indexOf(text); at >= 0; at = line.indexOf(text, at + 1)) if (at <= index && index < at + text.length) return true;
  return false;
}

test("Japanese copy in app/ and lib/: no 「。」「、」 after a closing parenthesis, no 「N米ドル」", () => {
  const found = [];
  const used = new Set();
  for (const file of ROOTS.flatMap(files)) {
    const source = readFileSync(file, "utf8");
    const lines = file.endsWith(".json") ? jsonLines(source) : stripComments(source).split("\n");
    for (const line of lines) {
      for (const pattern of PATTERNS) {
        for (const match of line.matchAll(pattern)) {
          const allowed = ALLOWED.findIndex(entry => entry.file === file && covers(line, entry.text, match.index));
          if (allowed >= 0) { used.add(allowed); continue; }
          found.push(`${join(file)}: …${line.slice(Math.max(0, match.index - 30), match.index + 12).trim()}…`);
        }
      }
    }
  }
  assert.deepEqual(found, []);
  const stale = ALLOWED.filter((_, index) => !used.has(index)).map(entry => `${entry.file}: ${entry.text}`);
  assert.deepEqual(stale, [], "allow-list entries that no longer match anything");
});

test("the allow-list always says why", () => {
  for (const entry of ALLOWED) assert.ok(entry.reason.length > 0, entry.text);
});

// Owner, Nov 24: the legal pages follow the same rule. Prices in dollars are 「20ドル」「200ドル」; 「米ドル」 appears nowhere,
// in the Markdown or in the generated modules the pages render. No 「。」「、」 right after a closing parenthesis in the Japanese texts.
test("legal pages: no 「米ドル」 and no 「。」「、」 after a closing parenthesis", () => {
  const legal = [...readdirSync("content/legal").map(name => `content/legal/${name}`), ...readdirSync("lib/legal").map(name => `lib/legal/${name}`)];
  for (const file of legal) assert.ok(!readFileSync(file, "utf8").includes("米ドル"), file);
  for (const file of legal.filter(f => /\.ja\.md$|-ja\.ts$/.test(f))) {
    const text = readFileSync(file, "utf8");
    assert.deepEqual([...text.matchAll(/[)）][。、]/g)].map(m => text.slice(Math.max(0, m.index - 30), m.index + 2)), [], file);
  }
  const commerce = readFileSync("content/legal/commerce.ja.md", "utf8"), terms = readFileSync("content/legal/terms.ja.md", "utf8");
  assert.ok(commerce.includes("日本国外の利用者は月額20ドル、年額200ドル。"));
  assert.ok(terms.includes("日本国外の利用者には、月額20ドルまたは年額200ドルで提供します。"));
});
