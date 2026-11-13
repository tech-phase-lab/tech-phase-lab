import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BOARD_PERIODS, DEFAULT_PERIOD, OTHER_PERIODS, PERIOD_LABEL, PRIMARY_PERIODS, groupBars, hourlyBars, isBoardPeriod, isIntradayPeriod, mergeBars, periodInterval, periodSeries, shapePeriod } from "../lib/research/market-board-periods.ts";
import { nextFlash, startFlash } from "../lib/research/value-flash.ts";

const bar = (at, open, high, low, close, volume = 10) => ({ at, open, high, low, close, volume });
const stamp = (d, m) => `${d} ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
const halfHours = (d, from = 240, to = 1200) => { const out = []; for (let m = from; m < to; m += 30) out.push(bar(stamp(d, m), m, m + 2, m - 2, m + 1, 100)); return out; };

test("the six buttons that are always visible, and the four in the pull-down, in the owner's order", () => {
  assert.deepEqual(PRIMARY_PERIODS.map(p => PERIOD_LABEL[p].ja), ["5分", "15分", "1日", "1ヶ月", "6ヶ月", "1年"]);
  assert.deepEqual(OTHER_PERIODS.map(p => PERIOD_LABEL[p].ja), ["1時間", "3時間", "1週間", "5年"]);
  assert.equal(BOARD_PERIODS.length, 10);
  assert.equal(new Set(BOARD_PERIODS).size, 10);
  assert.equal(DEFAULT_PERIOD, "15m");
  assert.equal(isBoardPeriod("15m"), true); assert.equal(isBoardPeriod("1M"), false); assert.equal(isBoardPeriod("1ヶ月"), false);
});

test("each button's candle and span", () => {
  const note = p => PERIOD_LABEL[p].jaNote;
  assert.equal(note("5m"), "5分足 ・ 直近1日"); assert.equal(note("15m"), "15分足 ・ 直近5日");
  assert.equal(note("1h"), "1時間足 ・ 直近1ヶ月"); assert.equal(note("3h"), "3時間足 ・ 直近3ヶ月");
  assert.equal(note("1d"), "日足 ・ 直近3ヶ月"); assert.equal(note("1w"), "週足 ・ 直近2年");
  assert.equal(note("1m"), "日足 ・ 直近1ヶ月"); assert.equal(note("6m"), "日足 ・ 直近6ヶ月");
  assert.equal(note("1y"), "日足 ・ 直近1年"); assert.equal(note("5y"), "週足 ・ 直近5年");
  assert.deepEqual([periodSeries("5m").interval, periodSeries("15m").interval, periodSeries("1h").interval, periodSeries("3h").interval], ["5min", "15min", "30min", "30min"]);
  assert.deepEqual([periodSeries("1d").interval, periodSeries("1m").interval, periodSeries("6m").interval, periodSeries("1y").interval], ["1day", "1day", "1day", "1day"]);
  assert.deepEqual([periodSeries("1w").interval, periodSeries("5y").interval], ["1week", "1week"]);
  assert.deepEqual(BOARD_PERIODS.filter(isIntradayPeriod), ["5m", "15m", "1h", "3h"]);
  assert.equal(periodInterval("15m"), "intraday"); assert.equal(periodInterval("1d"), "daily"); assert.equal(periodInterval("5y"), "weekly");
});

test("the daily and weekly periods take the last N candles", () => {
  const daily = Array.from({ length: 400 }, (_, i) => bar(`2025-${String(1 + Math.floor(i / 28) % 12).padStart(2, "0")}-${String(1 + i % 28).padStart(2, "0")}`, 1, 2, 0, 1));
  assert.equal(shapePeriod("1d", daily).bars.length, 66);
  assert.equal(shapePeriod("1m", daily).bars.length, 23);
  assert.equal(shapePeriod("6m", daily).bars.length, 130);
  assert.equal(shapePeriod("1y", daily).bars.length, 252);
  assert.equal(shapePeriod("1w", daily).bars.length, 104);
  assert.equal(shapePeriod("5y", daily).bars.length, 260);
  assert.equal(shapePeriod("1m", daily).before.length, 74);
});

test("a merged bar: first open, highest high, lowest low, last close, summed volume; unknown volume stays unknown", () => {
  const m = mergeBars([bar("2026-11-12 10:00:00", 5, 9, 4, 6, 10), bar("2026-11-12 11:00:00", 6, 12, 5, 8, 20), bar("2026-11-12 12:00:00", 8, 10, 2, 3, 30)]);
  assert.deepEqual(m, { at: "2026-11-12 10:00:00", open: 5, high: 12, low: 2, close: 3, volume: 60 });
  assert.equal(mergeBars([bar("x", 1, 1, 1, 1, null)]).volume, null);
});

test("3-hour bars: three hourly bars each, within one day and one part of the session", () => {
  const hours = hourlyBars(halfHours("2026-11-12"));
  // pre-market 04..09 (6), regular 09:30..15:30 (7), after-hours 16..19 (4)
  assert.equal(hours.length, 17);
  assert.deepEqual(hours.slice(0, 2).map(b => b.at), ["2026-11-12 04:00:00", "2026-11-12 05:00:00"]);
  const regular = hours.filter(b => b.at >= "2026-11-12 09:30" && b.at < "2026-11-12 16:00");
  assert.deepEqual(regular.map(b => b.at.slice(11, 16)), ["09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30"]);
  const threes = groupBars(hours, 3);
  assert.equal(threes.length, 2 + 3 + 2); // 6 pre → 3+3, 7 regular → 3+3+1, 4 after → 3+1
  const first = threes[0];
  assert.equal(first.at, "2026-11-12 04:00:00");
  assert.equal(first.open, hours[0].open); assert.equal(first.close, hours[2].close);
  assert.equal(first.high, Math.max(...hours.slice(0, 3).map(b => b.high)));
  assert.equal(first.low, Math.min(...hours.slice(0, 3).map(b => b.low)));
  assert.equal(first.volume, hours.slice(0, 3).reduce((a, b) => a + b.volume, 0));
  assert.deepEqual(threes.filter(b => b.at >= "2026-11-12 09:30" && b.at < "2026-11-12 16:00").map(b => b.at.slice(11, 16)), ["09:30", "12:30", "15:30"]);
});

test("1h and 3h are built from the 30-minute series; the volume of the hourly bar is the sum of its halves", () => {
  const hours = hourlyBars(halfHours("2026-11-12", 570, 960));
  assert.equal(hours[0].at, "2026-11-12 09:30:00");
  assert.equal(hours[0].volume, 200);
  assert.equal(hours[hours.length - 1].at, "2026-11-12 15:30:00"); assert.equal(hours[hours.length - 1].volume, 100);
  const set = shapePeriod("1h", [...halfHours("2026-11-11"), ...halfHours("2026-11-12")]);
  assert.equal(set.bars.length, 34);
});

test("the glow: the first value never glows, a rise is up, a fall is down, a new scope starts over", () => {
  let s = startFlash("QQQ", 100);
  assert.equal(s.dir, null); assert.equal(s.n, 0);
  assert.equal(nextFlash(s, "QQQ", 100), s);
  s = nextFlash(s, "QQQ", 101); assert.deepEqual([s.dir, s.n], ["up", 1]);
  s = nextFlash(s, "QQQ", 100.5); assert.deepEqual([s.dir, s.n], ["down", 2]);
  const other = nextFlash(s, "SPY", 700); assert.deepEqual([other.dir, other.n], [null, 0]);
  const late = nextFlash(startFlash("DIA", null), "DIA", 470); assert.equal(late.dir, null); assert.equal(late.value, 470);
  assert.equal(nextFlash(late, "DIA", null), late);
});

test("reduced motion: the glow and the ring are switched off, only a brief colour change is left", () => {
  const css = readFileSync(new URL("../app/research/price/board.module.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(block.includes(".dot[data-pulse]{animation:none}"));
  assert.ok(/\.flashUp\{animation:tintUp/.test(block) && /\.flashDown\{animation:tintDown/.test(block));
  assert.ok(/@keyframes glowUp/.test(css) && /@keyframes glowDown/.test(css));
  assert.ok(!/box-shadow/.test(css.slice(css.indexOf("@keyframes tintUp"))));
});
