import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("RESOLUTE phone layout carries the shared look; the PC frame does not (owner, Nov 25 §A)", () => {
  const shell = read("../app/resolute/tool-shell.tsx");
  assert.match(shell, /<main className=\{`\$\{styles\.page\} \$\{styles\.mobile\} /);
  assert.match(shell, /if\(pc && desktop\) return <main className=\{`\$\{styles\.page\} \$\{pc_\.page\}`\}/, "the PC frame stays as it was");
  const css = read("../app/resolute/diagnosis.module.css");
  const theme = css.slice(css.indexOf("RESOLUTE shared look, phone layout"));
  // Dark navy with a soft gold glow from the top; panels with a thin gold edge, navy fill and 22px corners.
  assert.match(theme, /\.page\.mobile\{[^}]*radial-gradient\([^}]*#d8b36a33/);
  assert.match(theme, /\.mobile \.card,\.mobile \.hero,\.panel\{[^}]*border-radius:22px;[^}]*var\(--rz-panel-fill\) padding-box,var\(--rz-panel-edge\) border-box/);
  // Round gold primary, gold outline secondary, round chosen pills, gold Mincho numbers, phrase-aware Japanese line breaks.
  assert.match(theme, /\.mobile \.primary\{[^}]*border-radius:999px;background:var\(--rz-gold-grad\)/);
  assert.match(theme, /\.mobile \.secondary[^{]*\{[^}]*border:1px solid #d8b36a8f;border-radius:999px;[^}]*color:var\(--gold2\)/);
  assert.match(theme, /\.pill\[aria-pressed=true\][^{]*\{border-color:var\(--gold\);color:var\(--gold2\);background:var\(--rz-pill-on\)/);
  assert.match(theme, /\.bigGold,\.mobile \.bigNumber,\.mobile \.percentNumber\{font-family:var\(--rz-serif\)/);
  assert.match(theme, /word-break:auto-phrase/);
  assert.doesNotMatch(theme, /repeating-linear-gradient|text-overflow:\s*ellipsis/);
  // The home page background has no diagonal stripes; the stars band is the shared hook.
  assert.doesNotMatch(read("../app/resolute/home/reference.module.css"), /repeating-linear-gradient/);
  assert.match(theme, /\.starsBand::before\{/);
});

test("shared heading and next/back components", () => {
  const heading = read("../app/resolute/section-heading.tsx");
  assert.match(heading, /className=\{styles\.headLabel\}/);
  assert.match(heading, /styles\.toolHeading/);
  const flow = read("../app/resolute/flow-navigation.tsx");
  assert.match(flow, /export function NextBack\(/);
  assert.match(flow, /return <NextBack label=/);
  // 「⑤ 相場の温度計へ進む →」 with 「← ③ 終値アラートへ戻る」 under it.
  assert.match(flow, /"⑤ 相場の温度計"/);
  assert.match(flow, /"へ進む →"/);
  assert.match(flow, /"← "\+previous\[1\]\+"へ戻る"/);
});

test("the phone menu: Tech Phase first, six steps in two columns without wrapping, tools, small settings links (owner, Nov 25 §02)", () => {
  const shell = read("../app/resolute/tool-shell.tsx");
  const menu = shell.slice(shell.indexOf('<nav id="resolute-tools"'));
  assert.ok(menu.indexOf("h.tpCard") < menu.indexOf("h.steps") && menu.indexOf("h.steps") < menu.indexOf("h.tools") && menu.indexOf("h.tools") < menu.indexOf("h.foot"));
  assert.match(menu, /"ホーム画面に追加する方法"[\s\S]*"言語とタイムゾーン"/);
  const css = read("../app/resolute/tool-shell.module.css");
  assert.match(css, /\.steps \{ display: grid; grid-template-columns: 1fr 1fr;/);
  assert.match(css, /\.step span \{[^}]*white-space: nowrap;/);
  assert.doesNotMatch(css, /@media \(max-width: 360px\) \{ \.steps \{ grid-template-columns: 1fr; \}/, "the steps stay in two columns on small phones");
});

test("settings on the phone: language as round buttons, time zone, save, three numbered steps (owner, Nov 25 §19)", () => {
  const settings = read("../app/resolute/settings/screen.tsx");
  assert.match(settings, /<ResoluteHeader locale=\{viewLocale\} setLocale=\{setViewLocale\} \/>/);
  assert.match(settings, /role="radiogroup"/);
  assert.match(settings, /role="radio" aria-checked=\{locale === value\} className=\{d\.pill\}/);
  assert.match(settings, /<AddToHomeSteps en=\{en\} steps=\{3\}/);
  assert.match(settings, /className=\{d\.primary\}>\{phase === "saving" \? c\.saving : c\.save\}/);
  assert.match(read("../app/resolute/add-to-home-steps.tsx"), /\.slice\(0, count\)/);
});

test("the owner keeps full RESOLUTE access: the new look changes no access check", () => {
  const shell = read("../app/resolute/tool-shell.tsx");
  assert.match(shell, /const shown=reviewing \? identityReady : access==="allowed";/);
  assert.match(shell, /setAccess\(value\.canUseTools \? "allowed" : "denied"\)/);
  assert.match(read("../lib/membership/entitlements.ts"), /OWNER_ACCOUNT_ID/);
});
