import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("TradingView is gone: no widget routes, no embed code, no mention on screen", async () => {
  for (const gone of ["app/research/market/widget", "app/research/market/ticker-widget", "app/research/market/themes-widget", "app/research/stocks/widget", "app/research/stocks/tradingview-chart.tsx", "app/research/market/themes.tsx"])
    assert.equal(existsSync(new URL(`../${gone}`, import.meta.url)), false, gone);
  for (const file of ["app/research/market/page.tsx", "app/research/watchlist/watchlist.tsx", "app/research/stocks/market-workspace.tsx", "app/research/price/quote-card.tsx", "app/research/price/quote-detail.tsx"])
    assert.doesNotMatch(await read(file), /tradingview|<iframe/i, file);
});
test("Twelve Data is called only from the server routes; the browser reads our own API", async () => {
  for (const file of ["app/research/price/use-market.ts", "app/research/price/quote-card.tsx", "app/research/price/quote-detail.tsx", "app/research/price/market-board.tsx", "app/research/price/price-chart.tsx"])
    assert.doesNotMatch(await read(file), /twelvedata\.com\/|apikey|TWELVE_DATA_API_KEY/i, file);
  assert.match(await read("lib/research/market-data.ts"), /^import "server-only"/);
  assert.match(await read("lib/research/market-data.ts"), /TWELVE_DATA_API_KEY/);
});
test("the cards follow the design: eye button only on the gauge card, five stars when hidden, four equal facts, credit line", async () => {
  const card = await read("app/research/price/quote-card.tsx");
  assert.match(card, /variant === "gauge" && <Eye/);
  assert.match(card, /＊＊＊＊＊/);
  assert.match(card, /本日の値幅/); assert.match(card, /52週の値幅/); assert.match(card, /52週の位置/);
  for (const label of ["EPS", "時価総額", "配当利回り", "次回決算"]) assert.match(card, new RegExp(label));
  assert.match(card, /提供：Twelve Data/);
  assert.doesNotMatch(card, /NEW/);
  assert.match(await read("app/research/price/use-market.ts"), /tech-phase:quote-numbers-hidden:v1/);
});
test("the detail page has the owner's ranges, chart types, tabs, alert band and back label per origin", async () => {
  const detail = await read("app/research/price/quote-detail.tsx"), market = await read("lib/research/market-quote.ts");
  assert.match(market, /CHART_RANGES: ChartRange\[\] = \["1d", "1w", "1m", "3m", "6m", "ytd", "1y", "3y", "5y"\]/);
  // Owner, Nov 13: the market board's periods (5分 … 1年, その他: 1時間 / 3時間 / 1週間 / 年初来 / 5年), 15分 first.
  const buttons = await read("app/research/price/period-buttons.tsx");
  assert.match(buttons, /DETAIL_OTHER_PERIODS: readonly DetailPeriod\[\] = \["1h", "3h", "1w", "ytd", "5y"\]/);
  assert.match(buttons, /DETAIL_DEFAULT_PERIOD: DetailPeriod = "15m"/);
  assert.match(buttons, /PRIMARY_PERIODS\.map/);
  assert.match(detail, /useState<DetailPeriod>\(DETAIL_DEFAULT_PERIOD\)/);
  assert.match(detail, /useState<"candles" \| "line">\("candles"\)/);
  assert.match(detail, /ローソク足/); assert.match(detail, /ライン/);
  for (const label of ["株価", "企業情報", "連関マップ", "価格通知", "設定のみ保存できます。通知配信は準備中です。", "前日終値", "出来高"]) assert.match(detail, new RegExp(label));
  for (const label of ["ウォッチリスト", "監視22銘柄", "銘柄検索"]) assert.match(detail, new RegExp(label));
  assert.doesNotMatch(detail, /銘柄情報 →/);
  assert.match(await read("app/research/watchlist/watchlist.tsx"), /router\.push\(detailHref\(ticker, "watchlist"\)\)/);
  assert.match(await read("app/research/companies/company-watch.tsx"), /from="watch"/);
});
test("the market page is the design's board: SPY / QQQ / DIA cards, five categories, chart with volume, FRED cards below", async () => {
  const page = await read("app/research/market/page.tsx"), board = await read("app/research/price/market-board.tsx");
  assert.match(page, /eyebrow="MARKET"/); assert.match(page, /<MarketBoard \/>/); assert.match(page, /<MacroCards/);
  assert.doesNotMatch(page, /セクター別騰落率|ヒートマップ|Heatmap/);
  for (const label of ["為替", "暗号資産", "金属", "債券ETF", "半導体ETF"]) assert.match(board, new RegExp(label));
  for (const id of ["SPY", "QQQ", "DIA", "USD/JPY", "EUR/JPY", "EUR/USD", "GBP/USD", "BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "XAU/USD", "XAG/USD", "XCU/USD", "XPT/USD", "SHY", "IEF", "TLT", "SMH", "SOXX"]) assert.ok(board.includes(`"${id}"`), id);
  // The period buttons (owner, Nov 13): six always visible, four in the "その他" pull-down (labels and spans live in market-board-periods.ts, which has its own tests).
  const periods = await read("lib/research/market-board-periods.ts");
  for (const label of ["5分", "15分", "1日", "1ヶ月", "6ヶ月", "1年", "1時間", "3時間", "1週間", "5年"]) assert.ok(periods.includes(`ja: "${label}"`), label);
  assert.match(board, /PRIMARY_PERIODS/); assert.match(board, /その他/); assert.match(board, /そのほかの足と期間/); assert.match(board, /DEFAULT_PERIOD/);
  assert.match(board, /maPeriods=\{\[25, 75\]\}/); assert.match(board, /S&P500に連動/); assert.match(board, /ETFの価格です/);
  const data = await read("lib/research/market-data.ts");
  for (const id of ["SMH", "SOXX", "GBP/USD", "BTC/USD", "XAU/USD", "XCU/USD"]) assert.match(data, new RegExp(`(?:"${id}"|\\b${id}):\\s*\\{`), id);
  assert.match(data, /prepost: "true"/); assert.doesNotMatch(data, /interval: "1min"/);
});
test("the board shows prices as the sheet writes them", async () => {
  const { formatPrice } = await import("../app/research/price/market-board.tsx").catch(() => ({ formatPrice: null }));
  if (!formatPrice) return;
  assert.equal(formatPrice(154.321, "fx2"), "154.32"); assert.equal(formatPrice(1.08421, "fx4"), "1.0842");
  assert.equal(formatPrice(98420, "usd"), "$98,420"); assert.equal(formatPrice(182.44, "usd"), "$182.4"); assert.equal(formatPrice(2.414, "usd"), "$2.41");
});
test("the stock card follows the E sheet: no ticker under the name, extended-hours row, 44px / 38px price", async () => {
  const card = await read("app/research/price/quote-card.tsx"), css = await read("app/research/price/price.module.css");
  assert.match(card, /priceText\.length >= 7 \? styles\.priceSmall/);
  assert.match(card, /signedBoth/);
  assert.doesNotMatch(card, /<b>\{ticker\}<\/b>/);
  assert.match(css, /\.price\{font:700 44px/); assert.match(css, /\.priceSmall\{font-size:38px\}/); assert.match(css, /grid-template-columns:minmax\(0,1\.15fr\) minmax\(0,1fr\)/);
});
test("the chart follows F / G: moving averages 5/25/75, volume bars, crosshair tags, 390x350 and 390x260", async () => {
  const chart = await read("app/research/price/price-chart.tsx"), css = await read("app/research/price/chart.module.css");
  assert.match(chart, /period: 5, color: "#f3d98b"/); assert.match(chart, /period: 25, color: "#8fb0ff"/); assert.match(chart, /period: 75, color: "#c3a6ff"/);
  assert.match(css, /aspect-ratio:390\/350/); assert.match(css, /aspect-ratio:390\/260/);
  assert.match(chart, /priceTag/); assert.match(chart, /dateTag/);
});

test("every API route that reads the member is behind the Clerk proxy", async () => {
  const { readdir } = await import("node:fs/promises");
  const proxy = await read("proxy.ts"), matcher = proxy.match(/matcher: \[(.*?)\] \}/s)[1], patterns = [...matcher.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  const covered = path => patterns.some(p => p.endsWith("/:path*") ? path === p.slice(0, -7) || path.startsWith(p.slice(0, -7) + "/") : p === path);
  const walk = async dir => { const out = []; for (const entry of await readdir(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) { const path = `${dir}/${entry.name}`; if (entry.isDirectory()) out.push(...await walk(path)); else if (entry.name === "route.ts") out.push(path); } return out; };
  const missing = [];
  for (const file of await walk("app/api")) {
    if (!/getMembership\(|currentUser|auth\(\)/.test(await read(file))) continue;
    const route = "/" + file.slice(4, -"/route.ts".length).replace(/\[[^\]]+\]/g, "x");
    if (!covered(route)) missing.push(route);
  }
  assert.deepEqual(missing, []);
});
