import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dayKey, dayLabel, pageWindow, withDayDividers } from "../lib/research/news-day.ts";
import { formatTargetTime } from "../lib/research/price-target-time.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const now = Date.parse("2026-11-05T03:00:00Z"); // 12:00 on Nov 5, Japan time

test("the home list is five stories a page, five pages at most; the General News page has no cap", () => {
  assert.deepEqual(pageWindow(80, 1, 25), { total: 25, pages: 5, current: 1, start: 0, end: 5 });
  assert.deepEqual(pageWindow(80, 5, 25), { total: 25, pages: 5, current: 5, start: 20, end: 25 });
  assert.equal(pageWindow(80, 9, 25).current, 5, "a page past the end falls back to the last");
  assert.equal(pageWindow(80, 0, 25).current, 1);
  assert.deepEqual(pageWindow(12, 3, 25), { total: 12, pages: 3, current: 3, start: 10, end: 12 });
  assert.equal(pageWindow(0, 1, 25).pages, 1);
  assert.equal(pageWindow(80, 16).pages, 16, "no cap on the whole-list page");
});

test("day dividers: 今日, 昨日, then the date; days are Japan time", () => {
  assert.equal(dayLabel("2026-11-05", now, true), "今日");
  assert.equal(dayLabel("2026-11-04", now, true), "昨日");
  assert.equal(dayLabel("2026-11-03", now, true), "11月3日");
  assert.equal(dayLabel("2026-11-03", now, false), "Nov 3");
  assert.equal(dayLabel("2026-10-31", now, true), "10月31日");
  // 23:30 UTC on Nov 4 is 08:30 on Nov 5 in Japan.
  assert.equal(dayKey("2026-11-04T23:30:00Z", "time"), "2026-11-05");
  assert.equal(dayKey("2026-11-04T14:59:00Z", "time"), "2026-11-04");
  assert.equal(dayKey("2026-11-03", "date"), "2026-11-03");
});

test("a divider goes before the first story of each day, and the top of every page", () => {
  const rows = ["2026-11-05", "2026-11-05", "2026-11-04", "2026-11-04", "2026-11-03"].map(key => ({ dayKey: key }));
  assert.deepEqual(withDayDividers(rows).map(row => row.divider), ["2026-11-05", null, "2026-11-04", null, "2026-11-03"]);
  assert.deepEqual(withDayDividers(rows.slice(1)).map(row => row.divider), ["2026-11-05", "2026-11-04", null, "2026-11-03"]);
});

test("price target times have no seconds", () => {
  assert.equal(formatTargetTime("2026-11-04T12:14:42Z", "ja"), "11月4日 21:14 JST");
});

test("headlines are shown in full: no line limit, no length cut, and no ＋ for a headline", () => {
  const story = read("../app/research/news/news-story.tsx");
  const css = read("../app/research/news/general-news.module.css");
  assert.doesNotMatch(css, /line-clamp|\.clamped/);
  assert.doesNotMatch(story, /clamped|jaLimit/);
  assert.doesNotMatch(read("../app/research/news/flash-page.tsx"), /jaLimit/);
  assert.doesNotMatch(read("../app/research/news/general-news-panel.tsx"), /jaLimit/);
  // The plain headline is the only thing shown when there is no more to read.
  assert.match(story, /const headlineOnly = \(\) => <div className=\{styles\.shortStory\}>/);
});

test("the list has one time on the left, no 発表 line, no seconds, and a button to the whole list", () => {
  const panel = read("../app/research/news/general-news-panel.tsx");
  assert.doesNotMatch(panel, /\$\{lang === "ja" \? "発表"/);
  assert.match(panel, /publication=""/);
  assert.match(panel, /href="\/research\/general-news"/);
  assert.match(panel, /一般ニュースですべて見る/);
  assert.match(panel, /const HOME_STORIES = 25/);
  const row = read("../app/research/news/timeline-row.tsx");
  assert.doesNotMatch(row, /second/);
  assert.match(row, /jst\(\{ hour: "2-digit", minute: "2-digit" \}, at\)/);
});

test("the price target list no longer carries the notification link (it lives in the menu)", () => {
  assert.doesNotMatch(read("../app/research/price-targets-panel.tsx"), /NotificationSettings/);
});
