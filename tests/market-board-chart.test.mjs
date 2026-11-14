import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clampWick, clampWicks, latestTradingDay, liveBand, sessionTicks } from "../lib/research/market-board-periods.ts";

const bar = (at, open, high, low, close) => ({ at, open, high, low, close, volume: 100 });
/** One New York day of 15-minute bars from 4:00 to 19:45 (64 bars). */
const day = date => Array.from({ length: 64 }, (_, k) => {
  const m = 240 + k * 15;
  return bar(`${date} ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`, 750, 751, 749, 750.5);
});

test("a high or low 3% or more off the bar's open / close is cut back to the body (owner, Nov 14: SPY lows of 711 / 700 / 722 / 691)", () => {
  // The provider's own 15-minute bars of Nov 9–11, 2026.
  assert.deepEqual(clampWick(bar("2026-11-11 16:45:00", 760.2, 760.35, 711.4601, 759.671)), bar("2026-11-11 16:45:00", 760.2, 760.35, 759.671, 759.671));
  assert.equal(clampWick(bar("2026-11-10 16:45:00", 751.32, 751.48, 700.4258, 750.96)).low, 750.96);
  assert.equal(clampWick(bar("2026-11-09 16:45:00", 753, 753.51, 722.1914, 753.46)).low, 753);
  // A spike up is cut the same way.
  assert.equal(clampWick(bar("2026-11-05 16:15:00", 732.39, 766.4342, 730.65, 732.21)).high, 732.39);
  // Ordinary wicks stay, and an untouched bar is the same object.
  const normal = bar("2026-11-13 10:00:00", 750, 755, 744, 752);
  assert.equal(clampWick(normal), normal);
  assert.equal(clampWick(bar("x", 100, 102.9, 97.1, 100)).high, 102.9);
  assert.equal(clampWick(bar("x", 100, 103, 97, 100)).high, 100);
  assert.equal(clampWick(bar("x", 100, 103, 97, 100)).low, 100);
  assert.equal(clampWicks([normal, bar("x", 100, 100, 90, 100)])[1].low, 100);
});

test("the 15-minute chart is the latest trading day only; the bars before it feed the moving averages", () => {
  const thu = day("2026-11-12"), fri = day("2026-11-13");
  // A weekday (or a weekend / holiday: the data simply ends with the last day that traded).
  const set = latestTradingDay([...thu, ...fri], [bar("2026-11-11 19:45:00", 1, 1, 1, 1)]);
  assert.equal(set.bars.length, 64);
  assert.equal(set.bars[0].at, "2026-11-13 04:00:00");
  assert.equal(set.bars.at(-1).at, "2026-11-13 19:45:00");
  assert.equal(set.before.length, 65);
  assert.equal(set.before.at(-1).at, "2026-11-12 19:45:00");
  // Monday morning before the open: the previous trading day stays in front of the new day's pre-market bars.
  const monPre = [bar("2026-11-16 04:00:00", 750, 750, 750, 750), bar("2026-11-16 04:15:00", 750, 750, 750, 750)];
  const early = latestTradingDay([...thu, ...fri, ...monPre]);
  assert.equal(early.bars[0].at, "2026-11-13 04:00:00");
  assert.equal(early.bars.length, 66);
  // Once the session has begun, the new day alone.
  const monOpen = [...monPre, bar("2026-11-16 09:30:00", 750, 750, 750, 750)];
  assert.equal(latestTradingDay([...fri, ...monOpen]).bars[0].at, "2026-11-16 04:00:00");
  assert.deepEqual(latestTradingDay([]), { bars: [], before: [] });
});

test("axis times only where pre-market, the session and after-hours begin, in Japan time with daylight saving", () => {
  // November (New York on standard time): 18:00 / 23:30 / 06:00 JST.
  const winter = day("2026-11-13");
  assert.deepEqual(sessionTicks(winter, bar("2026-11-12 19:45:00", 1, 1, 1, 1)), [{ index: 0, label: "18:00" }, { index: 22, label: "23:30" }, { index: 48, label: "06:00" }]);
  // July (daylight saving): an hour earlier in Japan time.
  assert.deepEqual(sessionTicks(day("2026-07-10")).map(t => t.label), ["17:00", "22:30", "05:00"]);
  // A view that starts in the middle of the session gets no tick at its left edge.
  assert.deepEqual(sessionTicks(winter.slice(30), winter[29]).map(t => t.label), ["06:00"]);
  // Two days (Monday's pre-market behind Friday): four ticks.
  assert.deepEqual(sessionTicks([...winter, bar("2026-11-16 04:00:00", 1, 1, 1, 1)]).map(t => t.label), ["18:00", "23:30", "06:00", "18:00"]);
});

test("the band and its one word only while it is pre-market or after-hours now, over the extended part on the right", () => {
  const fri = day("2026-11-13");
  // After-hours now: the band starts at the first after-hours bar (16:00), word アフター.
  assert.deepEqual(liveBand(fri, "post", true), { from: 48, label: "アフター" });
  assert.deepEqual(liveBand(fri, "post", false), { from: 48, label: "After" });
  // Just after 16:00 with no after-hours bar yet: an empty stretch at the right end.
  assert.deepEqual(liveBand(fri.slice(0, 48), "post", true), { from: 48, label: "アフター" });
  // Pre-market now: only the new day's pre-market bars, never the previous evening's after-hours.
  const mon = [bar("2026-11-16 04:00:00", 1, 1, 1, 1), bar("2026-11-16 04:15:00", 1, 1, 1, 1)];
  assert.deepEqual(liveBand([...fri, ...mon], "pre", true), { from: 64, label: "プレ" });
  assert.deepEqual(liveBand(fri, "pre", true), { from: 64, label: "プレ" });
  // Regular session, closed (weekends, holidays, after 20:00): no band, no word.
  assert.equal(liveBand(fri, "regular", true), null);
  assert.equal(liveBand(fri, "closed", true), null);
});

test("the board chart: no per-band words or dotted band lines, a mint band, the tag shows the big price, axis numbers under the tag hidden", () => {
  const board = readFileSync(new URL("../app/research/price/market-board.tsx", import.meta.url), "utf8");
  const chart = readFileSync(new URL("../app/research/price/price-chart.tsx", import.meta.url), "utf8");
  assert.ok(!/bands=\{/.test(board), "the board no longer draws a band per extended run");
  assert.match(board, /live=\{intraday \? \{ phase \} : undefined\}/);
  assert.match(board, /sessionTicks=\{period === "15m"\}/);
  assert.match(board, /tag = shownPrice === null \? undefined : \{ price: shownPrice, text: num\(shownPrice\), tone \}/);
  assert.match(board, /latestTradingDay\(chart\.bars, chart\.before\)/);
  assert.match(board, /clampWicks\(set\.bars\)/);
  assert.match(chart, /fill="#8fe3c0" fillOpacity="0\.06"/);
  assert.match(chart, /grid\.filter\(g => !tag \|\| Math\.abs\(g\.y - Y\(tag\.price\)\) >= 13\)/);
});
