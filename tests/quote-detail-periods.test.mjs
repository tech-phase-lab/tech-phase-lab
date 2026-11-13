import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRIMARY_PERIODS } from "../lib/research/market-board-periods.ts";
import { baseText, periodBase, periodBases, periodPercent, targetDate } from "../lib/research/period-change.ts";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Fixture closes (made up): every weekday from 2021-01-04 to 2026-11-13, price = day index.
const closes = [];
for (let t = Date.UTC(2021, 0, 4), i = 1; t <= Date.UTC(2026, 10, 13); t += 86_400_000) { const d = new Date(t); if (d.getUTCDay() % 6) closes.push({ at: d.toISOString().slice(0, 10), close: i++ }); }
const closeOn = date => closes.find(c => c.at === date).close;

test("the day each period reaches back to", () => {
  assert.equal(targetDate("1w", "2026-11-13"), "2026-11-06");
  assert.equal(targetDate("1m", "2026-03-31"), "2026-02-28");
  assert.equal(targetDate("6m", "2026-11-13"), "2026-05-13");
  assert.equal(targetDate("1y", "2026-11-13"), "2025-11-13");
  assert.equal(targetDate("5y", "2026-11-13"), "2021-11-13");
});

test("a holiday or weekend falls back to the trading day before; year to date uses the previous year's last close", () => {
  assert.deepEqual(periodBase(closes, "6m", "2026-11-13"), { date: "2026-05-13", close: closeOn("2026-05-13") });
  assert.deepEqual(periodBase(closes, "5y", "2026-11-13"), { date: "2021-11-12", close: closeOn("2021-11-12") }); // 2021-11-13 was a Saturday
  assert.deepEqual(periodBase(closes, "ytd", "2026-11-13"), { date: "2025-12-31", close: closeOn("2025-12-31") });
  const withHoliday = closes.filter(c => c.at !== "2026-05-13");
  assert.equal(periodBase(withHoliday, "6m", "2026-11-13").date, "2026-05-12");
});

test("no base (and so no line) when the series does not reach back, or has a hole there", () => {
  assert.equal(periodBase(closes.filter(c => c.at >= "2024-01-01"), "5y", "2026-11-13"), null);
  assert.equal(periodBase(closes.filter(c => c.at < "2026-04-01" || c.at > "2026-06-01"), "6m", "2026-11-13"), null);
  assert.deepEqual(Object.keys(periodBases(closes.filter(c => c.at >= "2026-01-01"), "2026-11-13")).sort(), ["1m", "1w", "6m"]);
});

test("the percentage follows the live price, and the base is written as the design shows it", () => {
  assert.equal(periodPercent(110, { date: "2026-05-13", close: 100 }).toFixed(2), "10.00");
  assert.equal(periodPercent(null, { date: "2026-05-13", close: 100 }), null);
  assert.equal(baseText("6m", { date: "2026-05-13", close: 845.99 }, "2026-11-13", true), "5/13 845.99 から");
  assert.equal(baseText("ytd", { date: "2025-12-31", close: 573.7 }, "2026-11-13", true), "前年末 573.70 から");
  assert.equal(baseText("1y", { date: "2025-11-13", close: 10 }, "2026-11-13", true), "2025/11/13 10.00 から");
});

test("the page: seven evenly spaced buttons, mint selection, the line only for 1W/1M/6M/1Y/YTD/5Y, glow without box-shadow", () => {
  assert.deepEqual([...PRIMARY_PERIODS], ["5m", "15m", "1d", "1m", "6m", "1y"]);
  const css = read("app/research/price/period-buttons.module.css");
  assert.match(css, /justify-content:space-between/);
  assert.match(css, /\[aria-pressed=true\] \{ border-color:#8fe3c0;background:#12261d;color:#8fe3c0;/);
  const line = read("app/research/price/period-change-line.module.css");
  assert.doesNotMatch(line, /box-shadow\s*:/);
  assert.match(line, /height:8px;[^}]*filter:blur\(5px\)/);
  assert.match(line, /width:72%;height:2px;animation:breathe 2\.4s/);
  assert.match(line, /prefers-reduced-motion: reduce\) \{ \.glow \{ animation:none/);
  const detail = read("app/research/price/quote-detail.tsx");
  assert.match(detail, /isChangePeriod\(range\) && periodBases && <PeriodChangeLine/);
  assert.match(detail, /useQuotes\(\[ticker\], false, true\)/);
  assert.match(detail, /<FlashValue scope=\{ticker\}/);
  assert.match(read("app/research/price/detail.module.css"), /\.mode button\[aria-pressed="true"\]\{background:#8fe3c0;color:#07120d;/);
  assert.match(read("app/api/research/market/chart/route.ts"), /TICKER_RE\.test\(ticker\) \|\| isMarketChartSymbol\(ticker\)/);
});
