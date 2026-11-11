import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("TradingView is gone: no widget routes, no embed code, no mention on screen", async () => {
  for (const gone of ["app/research/market/widget", "app/research/market/themes-widget", "app/research/stocks/widget", "app/research/stocks/tradingview-chart.tsx", "app/research/market/themes.tsx"])
    assert.equal(existsSync(new URL(`../${gone}`, import.meta.url)), false, gone);
  for (const file of ["app/research/market/page.tsx", "app/research/watchlist/watchlist.tsx", "app/research/stocks/market-workspace.tsx", "app/research/price/quote-card.tsx", "app/research/price/quote-detail.tsx"])
    assert.doesNotMatch(await read(file), /tradingview|<iframe/i, file);
});
test("Twelve Data is called only from the server routes; the browser reads our own API", async () => {
  for (const file of ["app/research/price/use-market.ts", "app/research/price/quote-card.tsx", "app/research/price/quote-detail.tsx", "app/research/price/market-indices.tsx", "app/research/price/price-chart.tsx"])
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
  for (const label of ["1日", "1週", "1ヵ月", "3ヵ月", "6ヵ月", "年初来", "1年", "3年", "5年"]) assert.match(detail, new RegExp(label));
  assert.match(detail, /useState<ChartRange>\("1m"\)/);
  assert.match(detail, /useState<"candles" \| "line">\("candles"\)/);
  assert.match(detail, /ローソク足/); assert.match(detail, /ライン/);
  for (const label of ["株価", "企業情報", "連関マップ", "価格通知", "設定のみ保存できます。通知配信は準備中です。", "前日終値", "出来高"]) assert.match(detail, new RegExp(label));
  for (const label of ["ウォッチリスト", "監視22銘柄", "銘柄検索"]) assert.match(detail, new RegExp(label));
  assert.doesNotMatch(detail, /銘柄情報 →/);
  assert.match(await read("app/research/watchlist/watchlist.tsx"), /router\.push\(detailHref\(ticker, "watchlist"\)\)/);
  assert.match(await read("app/research/companies/company-watch.tsx"), /from="watch"/);
});
test("the market page shows the three indices and no sector or heat map", async () => {
  const page = await read("app/research/market/page.tsx");
  assert.match(page, /<MarketIndices \/>/);
  assert.doesNotMatch(page, /セクター別騰落率|ヒートマップ|Heatmap/);
  const indices = await read("lib/research/market-data.ts");
  for (const symbol of ["DJI", "NDX", "SPX"]) assert.match(indices, new RegExp(`"${symbol}"`));
  assert.match(indices, /s&p/i); assert.match(indices, /prepost: "true"/); assert.match(indices, /interval: "1min"/);
  // Owner, Nov 11: an ETF price is not an index level, so no ETF stands in for an index.
  assert.doesNotMatch(indices.slice(indices.indexOf("export const INDICES")), /DIA|QQQ|SPY/);
  assert.match(await read("app/api/research/market/quotes/route.ts"), /tickers\.length > 100/);
});

test("every route that reads the member is behind the Clerk proxy (the theme ranking failed in production without it)", async () => {
  const proxy = await read("proxy.ts");
  for (const path of ["/api/research/themes", "/api/research/compare"]) assert.ok(proxy.includes(`"${path}"`), path);
});
test("a company's four statements calls run one company at a time and without a row count the plan refuses", async () => {
  const collector = await read("lib/research/twelve-data-collector.ts");
  assert.match(collector, /serial\(\(\) => fetchTwelveBundle/);
  assert.doesNotMatch(collector, /outputsize: "[48]"/);
  assert.match(collector, /code === 429/);
});
test("the market page keeps its charts (indices, bond ETFs, forex) from Twelve Data", async () => {
  assert.match(await read("app/research/market/page.tsx"), /<MarketChart \/>/);
  const chart = await read("app/research/price/market-chart.tsx");
  for (const symbol of ["DJI", "NDX", "SPX", "SHY", "IEF", "TLT", "USD/JPY", "EUR/USD", "EUR/JPY"]) assert.ok(chart.includes(`"${symbol}"`), symbol);
});
test("the stock search card is not repeated above itself", async () => {
  assert.doesNotMatch(await read("app/research/stocks/market-workspace.tsx"), /TECH PHASE MARKET|styles\.company/);
});

test("the indices panel follows the design: three linked columns, no ETF names or mini charts, one credit line", async () => {
  const panel = await read("app/research/price/market-indices.tsx");
  assert.match(panel, /href=\{`\/research\/market\/index\/\$\{item\.id\}`\}/);
  assert.doesNotMatch(panel, /<polyline|<svg|proxy|item\.symbol/);
  assert.match(panel, /<IndexStrip lang=\{lang\} \/>/);
  assert.match(await read("app/research/market/index-strip.tsx"), /CFD/);
  assert.match(await read("app/research/market/index/[id]/page.tsx"), /plain/);
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
