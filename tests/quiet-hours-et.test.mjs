import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as quiet from "../lib/research/quiet-hours.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

// The notifications page view, rendered with the real quiet-hours helpers and stand-ins for the rest.
function view(props) {
  const source = ts.transpileModule(read("../app/research/notification-page-view.tsx"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const target = { exports: {} };
  new Function("require", "module", "exports", source)(id => {
    if (id === "react") return React;
    if (id === "react/jsx-runtime") return jsxRuntime;
    if (id === "next/link") return { default: ({ children, ...rest }) => React.createElement("a", rest, children) };
    if (id === "@/lib/research/intake") return { providers: [{ ticker: "NVDA" }], earningsOnlyProviders: [{ ticker: "ORCL" }] };
    if (id === "@/lib/research/home-install") return { SHOW_EVENT: "x", installContext: () => "none", isStandalone: () => false };
    if (id === "@/lib/research/quiet-hours") return quiet;
    if (id.endsWith(".css")) return { default: {} };
    throw new Error(`unexpected import ${id}`);
  }, target, target.exports);
  const base = { state: "on", label: "", busy: false, starting: false, usable: true, hasSubscription: true, message: "", testSent: false, received: false,
    prefsState: "ready", prefsMessage: "", onPrefs() {}, onToggle() {}, onDisable() {}, onTest() {}, onRetry() {}, onStatus() {}, onReceived() {} };
  return renderToStaticMarkup(React.createElement(target.exports.default, { ...base, ...props }));
}

const prefs = q => ({ targets: true, earnings: true, news: true, newsTickers: ["NVDA"], weeklyNotebook: true, economic: true, economicKinds: ["jobs"], weeklyIssue: false, rizelAnswer: false, rizelNote: false, quiet: q });

test("quiet hours labels: Japanese stays as before for Japan time and names ET otherwise; English always names the zone (owner, Nov 17)", () => {
  assert.equal(quiet.quietLabel({ on: true, start: 23, end: 7, zone: "Asia/Tokyo" }, "ja"), "23:00〜07:00");
  assert.equal(quiet.quietLabel({ on: true, start: 23, end: 7 }, "ja"), "23:00〜07:00", "settings saved before Nov 17 are Japan time");
  assert.equal(quiet.quietLabel({ on: true, start: 23, end: 7, zone: "America/New_York" }, "ja"), "23:00〜07:00（米国東部時間）");
  assert.equal(quiet.quietLabel({ on: true, start: 23, end: 7, zone: "America/New_York" }, "en"), "23:00–07:00 ET");
  assert.equal(quiet.quietLabel({ on: true, start: 22, end: 6, zone: "Asia/Tokyo" }, "en"), "22:00–06:00 JST");
  assert.equal(quiet.quietLabel({ on: false, start: 23, end: 7, zone: "America/New_York" }, "en"), "Off");
  assert.equal(quiet.quietLabel({ on: false, start: 23, end: 7 }, "ja"), "オフ");
});

test("the English screen edits and saves ET, the Japanese one Japan time (sent without a zone, as before)", () => {
  assert.equal(quiet.quietZoneFor("en"), "America/New_York");
  assert.equal(quiet.quietZoneFor("ja"), "Asia/Tokyo");
  const nov = new Date("2026-11-17T03:00:00Z"); // New York on EST: Tokyo is 14 hours ahead
  const jul = new Date("2026-07-17T03:00:00Z"); // New York on EDT: 13 hours
  assert.deepEqual(quiet.quietDraft({ on: true, start: 23, end: 7, zone: "America/New_York" }, "en", nov), { on: true, start: 23, end: 7, zone: "America/New_York" });
  assert.deepEqual(quiet.quietDraft({ on: true, start: 23, end: 7 }, "en", nov), { on: true, start: 9, end: 17, zone: "America/New_York" }, "23:00 JST is 09:00 EST");
  assert.deepEqual(quiet.quietDraft({ on: true, start: 23, end: 7 }, "en", jul), { on: true, start: 10, end: 18, zone: "America/New_York" }, "23:00 JST is 10:00 EDT");
  assert.deepEqual(quiet.quietDraft({ on: true, start: 23, end: 7, zone: "America/New_York" }, "ja", nov), { on: true, start: 13, end: 21, zone: "Asia/Tokyo" });
  assert.deepEqual(quiet.quietToSave({ on: true, start: 23, end: 7, zone: "America/New_York" }), { on: true, start: 23, end: 7, zone: "America/New_York" });
  assert.deepEqual(quiet.quietToSave({ on: true, start: 23, end: 7, zone: "Asia/Tokyo" }), { on: true, start: 23, end: 7 });
  // Both sides of the Nov 1, 2026 switch.
  assert.equal(quiet.convertHour(23, "America/New_York", "Asia/Tokyo", new Date("2026-10-31T12:00:00Z")), 12);
  assert.equal(quiet.convertHour(23, "America/New_York", "Asia/Tokyo", new Date("2026-11-02T12:00:00Z")), 13);
  assert.equal(quiet.storedQuietZone({ on: true, start: 1, end: 2, zone: "Europe/London" }), "Asia/Tokyo");
});

test("the notifications page shows the stored hours with their zone in each language, and an English new device reads ET", () => {
  const et = prefs({ on: true, start: 23, end: 7, zone: "America/New_York" });
  const jst = prefs({ on: true, start: 23, end: 7, zone: "Asia/Tokyo" });
  assert.match(view({ lang: "en", prefs: et }), />23:00–07:00 ET</);
  assert.match(view({ lang: "en", prefs: jst }), />23:00–07:00 JST</);
  assert.match(view({ lang: "ja", prefs: jst }), />23:00〜07:00</);
  assert.match(view({ lang: "ja", prefs: et }), />23:00〜07:00（米国東部時間）</);
  assert.match(view({ lang: "ja", prefs: prefs({ on: true, start: 23, end: 7 }) }), />23:00〜07:00</, "an older server's answer without a zone is Japan time");
  assert.match(view({ lang: "en", prefs: null, prefsState: "loading" }), />23:00–07:00 ET</, "before the settings are read, the English site shows its default, 23 to 7 ET");
  assert.match(view({ lang: "ja", prefs: null, prefsState: "loading" }), />23:00〜07:00</);
});

test("the English footnote no longer says the release time in Japan, and the server keeps the zone per device", () => {
  const source = read("../app/research/notification-page-view.tsx");
  assert.doesNotMatch(source, /release time in Japan/);
  assert.match(source, /release times are in ET on the calendar/);
  assert.match(source, /日本時間の発表の時刻に届きます。おやすみモード中は届きません。/, "the Japanese footnote is unchanged");
  assert.match(source, /quietToSave\(draft\)/);
  const python = read("../scripts/research/web_push.py");
  assert.match(python, /\('quiet_zone', "TEXT NOT NULL DEFAULT 'Asia\/Tokyo'"\)/);
  assert.match(python, /QUIET_ZONES = \('Asia\/Tokyo', 'America\/New_York'\)/);
  assert.match(python, /datetime\.fromtimestamp\(moment, zone\)\.hour/);
});
