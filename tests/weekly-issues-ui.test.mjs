import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const { cardBadge, formatNumber, barHeights, scheduleDate } = await import("../lib/research/weekly-format.ts");
const card = over => ({ label: "a", value: null, outlook: null, previous: null, unit: "", outlookUnit: "", range: "", delta: null, ...over });

test("the badge is percent for amounts and points for percentages, and absent when nothing compares", () => {
  assert.deepEqual(cardBadge(card({ value: 542.29, outlook: 615, unit: "億ドル" })), { text: "+13.4%", tone: "up", caption: "見通し" });
  assert.equal(cardBadge(card({ value: 12.5, outlook: 11.75, unit: "%" })).text, "−0.75pt");
  assert.equal(cardBadge(card({ value: 10, previous: 8, unit: "" })).caption, "前回比");
  assert.equal(cardBadge(card({ outlook: 5 })), null);
  assert.equal(cardBadge(card({ value: 0, outlook: 5 })), null);
  assert.equal(cardBadge(card({ value: 5, outlook: 5 })).tone, "flat");
});
test("numbers, bars and dates format without surprises", () => {
  assert.equal(formatNumber(1234567.5), "1,234,567.5");
  assert.equal(formatNumber(542.29), "542.29");
  assert.deepEqual(barHeights([542.29, 615]), [88, 100]);
  assert.deepEqual(barHeights([0, 0]), [0, 0]);
  assert.deepEqual(scheduleDate("2026-10-02"), { month: "OCT", day: "2", weekday: "金" });
});
test("the weekly route is PRO-only for reading, owner-only for drafts and actions, and never marks a person's edit as automatic", () => {
  const route = read("app/api/research/weekly-issues/route.ts");
  assert.match(route, /pro-required/); assert.match(route, /owner-required/);
  assert.match(route, /auto: false/);
  assert.match(route, /RESEARCH_EDITOR_TOKEN/);
  assert.match(read("proxy.ts"), /\/api\/research\/weekly-issues/);
});
test("the screen has the past-issues list, one closed source fold, and an off-by-default auto switch", () => {
  const screen = read("app/research/weekly/issues.tsx");
  for (const text of ["これまでの号", "さらに前の号を見る", "最新", "今週のひとこと", "確認なしで自動公開", "<details className={styles.sources}>"]) assert.ok(screen.includes(text), text);
  assert.equal((screen.match(/<details/g) ?? []).length, 2, "only the sources and the owner's draft fold");
  assert.ok(!screen.includes("毎週木曜"));
});
test("the weekly-draft notice setting is the owner's alone", () => {
  assert.match(read("app/research/notification-page-view.tsx"), /p\.owner && <>/);
  assert.match(read("app/api/research/notifications/route.ts"), /weeklyDraft === true \&\& !member\.isAdmin/);
});

test("the owner can turn the weekly auto-draft on and try one now (Nov 4)", () => {
  const screen = read("app/research/weekly/issues.tsx");
  for (const text of ["毎週土曜に下書きを自動で作る", "今すぐ下書きを作る", "generateEnabled", "generateHour", "AIの設定がまだ終わっていません"]) assert.ok(screen.includes(text), text);
  assert.match(read("app/api/research/weekly-issues/route.ts"), /generate: "\/admin\/weekly\/generate"/);
  assert.ok(!/checked=\{generateEnabled \?\? true\}/.test(screen), "off unless the owner turns it on");
});

test("the weekly title stays on one line and the issue carries gold-brown frames, a rule after each heading and coloured outlooks (Nov 4)", () => {
  assert.match(read("app/research/weekly/issues.tsx"), /<ResearchToolShell desk compactTitle /);
  assert.match(read("app/research/research-tool-shell.tsx"), /compactTitle \? styles\.compactTitle/);
  assert.match(read("app/research/research-tools.module.css"), /\.desk h1\.compactTitle\{[^}]*white-space:nowrap/);
  const css = read("app/research/weekly/issues.module.css");
  for (const text of ["border:1px solid #4a3d20", ".part h3::after", ".val_up", ".val_down"]) assert.ok(css.includes(text), text);
  assert.ok(!/\.part\{[^}]*#2a3140/.test(css), "no blue-grey frame on a part");
});
