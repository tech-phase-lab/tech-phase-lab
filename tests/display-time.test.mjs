import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import {
  displayClock, displayDateTime, displayDayKey, displayParts, formatDisplay, localeFor, zoneFor, zoneLabel,
} from "../lib/research/display-time.ts";

// Owner, Nov 17: every date and time on the English site is U.S. Eastern ("ET", EST/EDT by the calendar);
// the Japanese site stays in Japan time ("JST").
const winter = "2026-12-03T14:05:09Z"; // 23:05:09 JST · 09:05:09 EST
const summer = "2026-07-09T14:05:09Z"; // 23:05:09 JST · 10:05:09 EDT

test("the zone, label and locale of each site", () => {
  assert.equal(zoneFor("ja"), "Asia/Tokyo");
  assert.equal(zoneFor("en"), "America/New_York");
  assert.equal(zoneLabel("ja"), "JST");
  assert.equal(zoneLabel("en"), "ET");
  assert.equal(localeFor("ja"), "ja-JP");
  assert.equal(localeFor("en"), "en-US");
});

test("clocks: Japan time in Japanese, U.S. Eastern in English, following daylight saving", () => {
  assert.equal(displayClock(winter, "ja"), "23:05");
  assert.equal(displayClock(winter, "en"), "09:05");
  assert.equal(displayClock(summer, "ja"), "23:05");
  assert.equal(displayClock(summer, "en"), "10:05");
  assert.equal(displayClock(summer, "en", true), "10:05:09");
  assert.equal(displayClock(Date.parse("2026-11-05T05:00:00Z"), "en"), "00:00", "midnight is 00, never 24");
});

test("full date-times carry the zone label", () => {
  assert.equal(displayDateTime(winter, "ja"), "2026/12/3 23:05:09 JST");
  assert.equal(displayDateTime(winter, "en"), "12/3/2026, 09:05:09 ET");
  assert.equal(displayDateTime(summer, "en"), "7/9/2026, 10:05:09 ET");
  assert.equal(displayDateTime("2026-11-04T15:00:07Z", "ja"), "2026/11/5 0:00:07 JST");
});

test("the calendar day an instant falls on, per site", () => {
  // 03:30 UTC on Nov 5: already Nov 5 in Japan, still Nov 4 in New York.
  assert.equal(displayDayKey("2026-11-05T03:30:00Z", "ja"), "2026-11-05");
  assert.equal(displayDayKey("2026-11-05T03:30:00Z", "en"), "2026-11-04");
  // The New York day turns at 05:00 UTC in winter (EST) and 04:00 UTC in summer (EDT).
  assert.equal(displayDayKey("2026-12-03T04:59:00Z", "en"), "2026-12-02");
  assert.equal(displayDayKey("2026-12-03T05:00:00Z", "en"), "2026-12-03");
  assert.equal(displayDayKey("2026-07-09T03:59:00Z", "en"), "2026-07-08");
  assert.equal(displayDayKey("2026-07-09T04:00:00Z", "en"), "2026-07-09");
});

test("formatDisplay and displayParts always use the site's zone", () => {
  assert.equal(formatDisplay(winter, "en", { month: "short", day: "numeric", weekday: "short" }), "Thu, Dec 3");
  assert.equal(formatDisplay("2026-12-03T20:00:00Z", "ja", { month: "long", day: "numeric", weekday: "short" }), "12月4日(金)");
  assert.equal(formatDisplay("2026-12-03T20:00:00Z", "en", { month: "short", day: "numeric", weekday: "short" }), "Thu, Dec 3");
  const hour = parts => parts.find(part => part.type === "hour").value;
  assert.equal(hour(displayParts(summer, "en", { hour: "2-digit", hourCycle: "h23" })), "10");
  assert.equal(hour(displayParts(summer, "ja", { hour: "2-digit", hourCycle: "h23" })), "23");
  // A caller cannot slip another zone in through the options.
  assert.equal(formatDisplay(summer, "en", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Tokyo" }), "10");
});

// ---- Guard: no English-reachable Japan-time formatting outside the helper. ----

const root = new URL("../", import.meta.url);
function walk(dir, out = []) {
  for (const name of readdirSync(new URL(dir, root))) {
    const path = `${dir}/${name}`;
    if (statSync(new URL(path, root)).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(path);
  }
  return out;
}
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

/** Files that may still name Japan time, and why. Everything else formats dates through lib/research/display-time.ts. */
const ALLOWED = {
  "lib/research/display-time.ts": "the helper itself",
  // Japanese-only screens (operator and owner tools with no English view).
  "app/research/intake/intake-dashboard.tsx": "Japanese-only operator dashboard",
  "app/research/review/review-dashboard.tsx": "Japanese-only operator review",
  "app/research/review/signals-panel.tsx": "Japanese-only operator review",
  "app/research/review/news-panel.tsx": "Japanese-only operator review",
  "app/research/review/official-research-panel.tsx": "Japanese-only operator review",
  "app/research/desk/inbox-sheet.tsx": "Japanese-only owner desk",
  "app/research/questions/moderation.tsx": "Japanese-only owner moderation",
  "app/research/inbox-key/screen.tsx": "Japanese-only owner tool",
  "app/resolute/checkout/setup/page.tsx": "Japanese-only sandbox setup page",
  // Intentional dual labels and a zone the reader picks.
  "app/research/calendar/earnings-reaction.tsx": "dual label: JST / ET on both sites",
  "app/research/calendar/event-calendar.tsx": "zone switch (JST / ET) the reader chooses; defaults through zoneFor",
  "app/research/calendar/economic-results-panel.tsx": "follows the calendar's chosen zone",
  "app/resolute/settings/screen.tsx": "time-zone picker examples, not a formatted time",
  // Quiet hours store the zone the reader set them in (ET by default in English, #656) and label it.
  "lib/research/quiet-hours.ts": "quiet-hours zone setting (JST or ET), labelled",
  "app/research/notification-page-view.tsx": "explains quiet hours still saved in Japan time",
  // The PRO tour's made-up sample moment (owner spec, Nov 17: 2035/03/12 09:00 JST), fixed text in desk.json.
  "app/research/pro-experience/samples/rizels-desk.tsx": "fixed sample timestamps from the owner's spec",
  // Server-side rules kept in Japan time (display only changed).
  "lib/research/calendar.ts": "default zone of the date selectors; callers on screens pass zoneFor(lang)",
  "lib/research/stock-notebook.ts": "the notebook week is Monday 00:00 Japan time; its labels name those days",
  "lib/research/news-time.ts": "strips a trailing JST/ET label",
  "lib/resolute/morning-note.ts": "'JST' is a token filter, not a displayed time",
};

function findings(file, text) {
  const out = [];
  stripComments(text).split("\n").forEach((line, index) => {
    if (/Asia\/Tokyo/.test(line)) out.push(`${file}:${index + 1} names Asia/Tokyo`);
    if (/\bJST\b/.test(line) && !/zoneLabel|ja \? |\bja\b.*JST.*:|"日本時間"/.test(line)) out.push(`${file}:${index + 1} hard-codes JST`);
    // A Date shown with the device's zone (no timeZone) is neither JST nor ET.
    if (/\.toLocale(?:Date|Time)?String\(\s*(?:lang|ja|en|"en-US"|"ja-JP")/.test(line) && /new Date\(/.test(line) && !/timeZone/.test(line)) out.push(`${file}:${index + 1} formats a date without a zone`);
  });
  return out;
}

test("the guard catches the patterns it is meant to", () => {
  assert.equal(findings("x.tsx", 'const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit" });').length, 1);
  assert.equal(findings("x.tsx", "const s = ja ? `発表 ${time} JST` : `Published ${time} ET`;").length, 0, "a ja-guarded label is fine");
  assert.equal(findings("x.tsx", "<span>{clock(at)} JST</span>").length, 1);
  assert.equal(findings("x.tsx", 'const t = new Date(at).toLocaleString(lang === "ja" ? "ja-JP" : "en-US", { hour12: false });').length, 1);
  assert.equal(findings("x.tsx", "// Japan time (JST) only in a comment").length, 0);
});

test("no screen formats an English date or time in Japan time outside the display-time helper", () => {
  const offenders = [];
  for (const file of [...walk("app"), ...walk("lib")]) {
    if (ALLOWED[file]) continue;
    offenders.push(...findings(file, readFileSync(new URL(file, root), "utf8")));
  }
  // Owner push diagnostics show the device's own clock on purpose (they compare against the phone's log).
  const deviceClock = new Set(["lib/research/push-send-log.ts", "lib/research/push-sw-facts.ts", "lib/research/push-diagnostic.ts", "lib/research/push-server-notice.ts"]);
  assert.deepEqual(offenders.filter(entry => !deviceClock.has(entry.split(":")[0])), []);
});

test("every allow-listed file still exists (the list never hides a renamed screen)", () => {
  for (const file of Object.keys(ALLOWED)) assert.ok(statSync(new URL(file, root)).isFile(), file);
});
