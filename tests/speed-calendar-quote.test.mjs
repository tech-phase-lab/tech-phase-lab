// Speed, Nov 26: the calendar and a stock page draw their first data on the server. Production, Nov 26 (390px, Slow 4G, CPU x4): the
// calendar's rows came after 7.3 s and moved the page (CLS 0.39); a stock page waited for five reads after its script.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
let dir;
test.before(async () => { dir = await mkdtemp(join(tmpdir(), "first-cal-")); });
test.after(() => rm(dir, { recursive: true, force: true }));

async function bundle(entry, stubs) {
  const out = join(dir, `${entry.replace(/\W/g, "_")}.mjs`);
  await build({ entryPoints: [`${root}/${entry}`], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "silent", alias: { "@": root },
    plugins: [{ name: "stubs", setup(b) {
      b.onResolve({ filter: /.*/ }, args => { const hit = Object.keys(stubs).find(k => args.path === k || args.path.endsWith(k)); return hit ? { path: hit, namespace: "stub" } : undefined; });
      b.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ loader: "js", contents: stubs[args.path] }));
    } }] });
  return import(pathToFileURL(out).href);
}

const NOW = Date.parse("2026-11-12T11:11:30Z");
const ago = m => new Date(NOW - m * 60_000).toISOString();
const SECRET = "PAID-BODY-TEXT";
const feed = { ok: true, enabled: true,
  items: [{ id: "n1", title: "T", url: "https://example.com/n1", publisher: "P", tickers: ["MU"], publishedAt: ago(5), observedAt: ago(5), approvedAt: ago(5), summaryJa: "見出し", summaryEn: "H", impactJa: SECRET, impactEn: SECRET, impactLabel: "positive", confidence: "high" }],
  officialUpdates: [{ id: "o1", title: "Micron news", translationJa: "公式", url: "https://example.com/o1", publisher: "Issuer", tickers: ["MU"], observedAt: ago(2), publishedAt: ago(2), bodyJa: SECRET, bodyEn: SECRET }],
  eventResults: [{ id: "cpi-2026-11", resultJa: "CPI", resultEn: "CPI" }], resultBriefs: [] };

test("calendar: the results rows come from the news feed's FREE projection, without stories; the same for every reader", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const { firstCalendarWithin } = await bundle("lib/research/calendar-first-paint.ts", {
    "server-only": "",
    "/tech-news-server": "export async function readMonitor() { return structuredClone(globalThis.__feed); }",
    "/public-news-response": "export const buildPublicNews = raw => raw;",
    "/earnings-history-server": "export async function loadEarningsHistory() { return { resultBriefs: [], months: ['2026-10', '2026-11'], complete: true }; }",
  });
  globalThis.__feed = feed;
  const first = await firstCalendarWithin(5_000);
  assert.equal(first.now, Date.parse("2026-11-12T11:11:00Z"));
  assert.deepEqual(first.news.items, [], "no stories");
  const json = JSON.stringify(first);
  assert.ok(!json.includes(SECRET), "a watched company's non-result update goes through the FREE projection");
  assert.deepEqual(first.news.eventResults, feed.eventResults);
  assert.deepEqual(first.history.months, ["2026-10", "2026-11"]);
  // Neither the loader nor the page asks who is reading: the HTML is the same for everyone.
  for (const file of ["lib/research/calendar-first-paint.ts", "app/research/calendar/page.tsx"]) assert.doesNotMatch(read(file), /getMembership|cookies\(|auth\(/);
  assert.match(read("app/research/calendar/page.tsx"), /export const dynamic = "force-dynamic";/);
});

test("calendar: rows are drawn from the first HTML, and until the results are known each row's place is kept", () => {
  const calendar = read("app/research/calendar/event-calendar.tsx");
  assert.match(calendar, /useCalendarClock\(initial\?\.now \?\? drawnAt\)/);
  assert.match(calendar, /useState\(initial !== null\)/);
  assert.match(calendar, /pendingRows > 0 && <ol className=\{calendarStyles\.agenda\} aria-busy="true"/);
  assert.match(calendar, /now === null && clock === null && <div className=\{calendarStyles\.waiting\}/);
  // The posted results are known in the first render, so a posted call is never listed (owner, Oct 28).
  assert.match(calendar, /useState<\{ ticker: string; at: number \}\[\]>\(\(\) => initial \? reportedRows\(/);
  assert.match(read("app/research/calendar/economic-results-panel.tsx"), /poller\.start\(drawn \? NEWS_POLL_INTERVAL_MS : 0\)/);
  assert.match(read("app/research/calendar/event-calendar.module.css"), /\.pendingRow\{min-height:65px/);
});

test("stock page: the quote and the first chart are shared copies only, under the same symbols rule as the price routes", async () => {
  const mod = await bundle("lib/research/quote-first-paint.ts", {
    "server-only": "",
    "/market-data": "export const marketDataConfigured = () => true; export const isMarketChartSymbol = () => false; export async function peekQuote(t) { globalThis.__peeks.push(t); return { ticker: t, name: 'N', price: 10, change: 1, percentChange: 10, currency: 'USD', asOf: '2026-11-12T11:00:00Z', marketOpen: true }; } export async function peekPeriodSet() { return null; }",
    "/market-access": "export const marketCaller = async () => globalThis.__caller; export const directoryTickers = async () => new Set(['NVDA']);",
    "/market-quote": "export const quoteAnswer = q => Object.fromEntries(Object.entries(q).map(([k, v]) => [k, { ticker: v.ticker, price: v.price }]));",
  });
  globalThis.__peeks = [];
  globalThis.__caller = "anonymous";
  assert.equal(await mod.firstQuoteWithin("ZZZZ", "15m"), null, "a visitor: not a listed company");
  assert.deepEqual(globalThis.__peeks, [], "and nothing is read");
  assert.equal((await mod.firstQuoteWithin("NVDA", "15m")).quotes.NVDA.price, 10);
  for (const caller of ["member", "owner"]) { globalThis.__caller = caller; assert.ok(await mod.firstQuoteWithin("ZZZZ", "15m"), caller); }
  // Copies only: the reader is never given a provider call.
  const data = read("lib/research/market-data.ts");
  assert.match(data, /readMany<MarketQuote>\(quoteSpec\(Date\.now\(\)\), \[ticker\], null\)/);
  assert.match(data, /barsEntry\(ticker, series\.interval, series\.size, \{ fetch: false,/);
  assert.match(data, /if \(!got\?\.fresh \|\| !got\.value\.length\) return null;/);
});

test("stock page: the server's period is the page's default, and the screen shows the copy at once and then reads as before", () => {
  assert.match(read("app/research/price/period-buttons.tsx"), /export const DETAIL_DEFAULT_PERIOD: DetailPeriod = "15m";/);
  assert.match(read("app/research/quote/[ticker]/page.tsx"), /firstQuoteWithin\(ticker, "15m"\)/);
  const detail = read("app/research/price/quote-detail.tsx");
  assert.match(detail, /useLiveQuote\(ticker, initial\)/);
  assert.match(detail, /useChartStore\(key, initial\?\.chart \?/);
  // The same answer shape as /api/research/market/quotes.
  assert.match(read("app/api/research/market/quotes/route.ts"), /quotes: quoteAnswer\(quotes, history\)/);
});
