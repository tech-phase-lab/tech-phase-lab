// RESOLUTE ルールのお守り PC version (owner, Nov 25, 01_ルールのお守り_PC).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readAccountReturn, rememberAccountReturn } from "../lib/research/account-return.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("the wall page has a PC layout: preview on the left, settings on the right, the same height", () => {
  const screen = read("../app/resolute/wall/screen.tsx");
  assert.match(screen, /<ToolShell identityReady=\{identityReady\} pc>/);
  assert.match(screen, /className=\{s\.pcPair\}[\s\S]*className=\{s\.pcPreview\}[\s\S]*className=\{s\.pcSettings\}/);
  const css = read("../app/resolute/wall/reference.module.css");
  assert.match(css, /\.pcPair \{[^}]*align-items:stretch/);
  // Background buttons carry a round colour swatch (photo: a "+").
  assert.match(css, /\.swatch \{[^}]*border-radius:50%/);
  assert.match(screen, /i===3\?'\+':null/);
});

test("「スマホで開く」 QR code: this page's address, drawn locally, PC only, with the owner's sentence", () => {
  const screen = read("../app/resolute/wall/screen.tsx");
  assert.match(screen, /\$\{window\.location\.origin\}\/resolute\/wall/);
  assert.match(screen, /const qr=desktop&&!touch&&here;/, "only in the PC layout, never on a touch screen (so never on the phone)");
  assert.match(screen, /\{qr\?<div className=\{s\.qr\}>/);
  assert.match(screen, /スマホのカメラで読み取ると、この画面がスマホで開きます。<\/span><span>スマホで保存すると、そのままロック画面に設定できます。/);
  const qr = read("../app/resolute/wall/qr-code.tsx");
  assert.match(qr, /from "qrcode-generator"/);
  assert.doesNotMatch(qr, /https?:\/\//, "no external QR service");
  const pkg = JSON.parse(read("../package.json"));
  assert.equal(pkg.dependencies["qrcode-generator"], "2.0.4", "pinned to an exact version");
  const lock = JSON.parse(read("../package-lock.json"));
  assert.equal(lock.packages["node_modules/qrcode-generator"].version, "2.0.4");
});

test("signing in from a RESOLUTE page comes back to it (the QR code opens /resolute/wall on the phone)", () => {
  const values = new Map();
  const storage = { setItem: (k, v) => values.set(k, v), getItem: k => values.get(k) ?? null };
  rememberAccountReturn(storage, "/resolute/wall", 1000);
  assert.equal(readAccountReturn(storage, 2000), "/resolute/wall");
  rememberAccountReturn(storage, "https://evil.test/", 3000);
  assert.equal(readAccountReturn(storage, 4000), "/resolute/wall", "an unsafe path is not stored");
  const shell = read("../app/resolute/tool-shell.tsx");
  assert.match(shell, /href="\/research\/account" prefetch=\{false\} onClick=\{\(\)=>\{ try \{ rememberAccountReturn\(window\.sessionStorage,window\.location\.pathname\+window\.location\.search\)/);
});

test("phone (resolute-mobile-all-1125 §14): the shared heading, the preview and the settings with round swatches, no QR code", () => {
  const screen = read("../app/resolute/wall/screen.tsx");
  assert.match(screen, /<SectionHeading label="RULE CHARM" title=\{title\} description=\{lead\}\/>/);
  assert.match(screen, /\{desktop\?s\.pc:s\.phoneLayout\}/);
  const css = read("../app/resolute/wall/reference.module.css");
  assert.match(css, /\.pcPreview, \.pcSettings \{[^}]*var\(--rz-panel-fill\) padding-box,var\(--rz-panel-edge\) border-box/);
  assert.match(css, /\.phoneLayout \.pcPair \{ grid-template-columns:minmax\(0,1fr\);/);
});
