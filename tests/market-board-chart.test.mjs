import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clampWick, clampWicks, drawnSeries, latestTradingDay, liveBand, sessionTicks } from "../lib/research/market-board-periods.ts";

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
  assert.match(board, /live=\{shownIntraday \? \{ phase \} : undefined\}/);
  assert.match(board, /sessionTicks=\{shownPeriod === "15m"\}/);
  assert.match(board, /tag = shownPrice === null \? undefined : \{ price: shownPrice, text: num\(shownPrice\), tone \}/);
  assert.match(board, /drawnSeries\(shownPeriod, store\.shown \?\? \{ bars: \[\], before: \[\] \}\)/);
  assert.match(chart, /fill="#8fe3c0" fillOpacity="0\.06"/);
  assert.match(chart, /grid\.filter\(g => !tag \|\| Math\.abs\(g\.y - Y\(tag\.price\)\) >= 13\)/);
});

test("what a chart draws: 15 minutes is the latest trading day, intraday bad prints are cut back, daily / weekly / year-to-date are untouched", () => {
  const thu = day("2026-11-12"), fri = day("2026-11-13");
  fri[10] = bar(fri[10].at, 750, 751, 700, 750.5);
  const series = { bars: [...thu, ...fri], before: [] };
  const fifteen = drawnSeries("15m", series);
  assert.equal(fifteen.bars.length, 64);
  assert.equal(fifteen.bars[0].at, "2026-11-13 04:00:00");
  assert.equal(fifteen.bars[10].low, 750, "the 700 low is cut back to the body");
  assert.equal(fifteen.before.at(-1).at, "2026-11-12 19:45:00");
  // 5 minutes / 1 hour / 3 hours: every day kept, wicks cut.
  const five = drawnSeries("5m", series);
  assert.equal(five.bars.length, 128);
  assert.equal(five.bars[74].low, 750);
  assert.equal(drawnSeries("3h", series).bars[74].low, 750);
  // Daily, weekly and year to date: the same object (no copy, no cut).
  for (const period of ["1d", "1m", "1w", "5y", "ytd"]) assert.equal(drawnSeries(period, series), series);
});

test("the stock page chart follows the board's rules (owner, Nov 15: a multi-day 15-minute chart with プレ / アフター on every band was still on MICROSOFT's page)", () => {
  const detail = readFileSync(new URL("../app/research/price/quote-detail.tsx", import.meta.url), "utf8");
  const chart = readFileSync(new URL("../app/research/price/price-chart.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/research/price/chart.module.css", import.meta.url), "utf8");
  // No chart anywhere draws a band per extended-hours run, its dotted edge, or its word.
  assert.ok(!/bands[=?]/.test(detail + chart), "no per-run band option is left");
  assert.ok(!/strokeDasharray="4 4"/.test(chart), "no dotted line at band edges");
  assert.ok(!/rgba\(127,227,192,\.07\)/.test(chart), "no per-run band fill");
  assert.ok(!/\.extLabel/.test(css) && !/extLabel/.test(chart), "no per-band word");
  // The stock page: the shared series rules, the live band only while it is pre / after-hours now, session ticks on 15 minutes, the tag is the big price.
  assert.match(detail, /drawnSeries\(shownRange, store\.shown\)/);
  assert.match(detail, /live=\{intraday && now !== null \? \{ phase \} : undefined\}/);
  assert.match(detail, /sessionTicks=\{shownRange === "15m"\}/);
  assert.match(detail, /tag = quote \? \{ price: quote\.price, text: plain\(quote\.price\), tone \}/);
  assert.match(detail, /<FlashValue scope=\{ticker\} value=\{quote\.price\} className=\{styles\.price\}>\{plain\(quote\.price\)\}/);
});

test("a period switch keeps the chart on the screen with a small spinner, and a period read once comes back at once (owner, Nov 15: stock page and market board)", () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const store = read("app/research/price/use-chart-store.ts"), detail = read("app/research/price/quote-detail.tsx"), board = read("app/research/price/market-board.tsx");
  const chart = read("app/research/price/price-chart.tsx"), css = read("app/research/price/chart.module.css");
  // The store: the key's own series, else the last one shown for the same symbol; busy until the key's own has come.
  assert.match(store, /group\(lastKey\) === group\(key\)/);
  assert.match(store, /shown: own \?\? fallback \?\? null/);
  assert.match(store, /busy: !own/);
  // Both pages use it; the stock page does not read a period it already has, and a switch does not cut a read off.
  for (const page of [detail, board]) { assert.match(page, /useChartStore\(key\)/); assert.match(page, /busy=\{store\.busy\}/); }
  assert.match(detail, /if \(fresh\(key\) \|\| reads\.current\.has\(key\)\) return;/);
  assert.doesNotMatch(detail, /setChart\(/);
  assert.match(board, /let have = fresh\(key\)/);
  assert.match(board, /const loading = store\.shown === null;/);
  // The spinner: a small ring at the chart's top right, nothing dimmed or emptied.
  assert.match(chart, /\{busy && <span className=\{styles\.busy\} role="status"/);
  assert.match(css, /\.busy\{position:absolute;top:6px;right:8px;z-index:2;width:14px;height:14px;/);
  assert.doesNotMatch(css, /\.busy\{[^}]*opacity/);
});

test("the change line under the period buttons: 20px below them, no arrow, no base (owner, Nov 15)", () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const line = read("app/research/price/period-change-line.tsx"), css = read("app/research/price/period-change-line.module.css"), detail = read("app/research/price/detail.module.css");
  assert.match(detail, /\.chartBlock\{display:flex;flex-direction:column;gap:8px\}/);
  assert.match(css, /\.wrap \{[^}]*margin-top:12px;/, "8px gap + 12px = 20px");
  assert.doesNotMatch(line, /[▲▼]/);
  assert.doesNotMatch(line, /baseText|styles\.base/);
  assert.doesNotMatch(css, /\.base \{/);
  assert.match(line, /\{sign\}\{Math\.abs\(percent\)\.toFixed\(2\)\}%/);
  assert.match(line, /`\$\{NAMES\[period\]\[0\]\}の騰落率`/);
  assert.match(line, /`\$\{NAMES\[period\]\[1\]\} change`/);
});
