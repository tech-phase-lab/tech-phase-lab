import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIVE_QUOTE_MS, liveQuoteUrl, startLiveQuote } from "../lib/research/live-quote.ts";
import { startPolling } from "../app/research/price/polling.ts";
import { nextFlash, startFlash } from "../lib/research/value-flash.ts";
import { stocksTrading } from "../lib/research/twelve-budget.ts";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("stock page: polls every 15 seconds only while U.S. stocks trade; outside those hours it reads once and never again", () => {
  assert.equal(LIVE_QUOTE_MS, 15_000);
  assert.match(read("app/research/price/market-board.tsx"), /const FAST_MS = 15_000/); // the market board's cadence
  const calls = [];
  let reads = 0;
  const poll = (task, every) => { calls.push(every); return () => calls.push("stopped"); };
  const stop = startLiveQuote(true, async () => { reads++; }, poll);
  assert.deepEqual(calls, [15_000]);
  stop();
  assert.deepEqual(calls, [15_000, "stopped"]);
  calls.length = 0;
  startLiveQuote(false, async () => { reads++; }, poll)();
  assert.deepEqual(calls, []);
  assert.equal(reads, 1);
  // The session gate: 9:34 New York time on a Friday trades, Saturday and 21:00 do not.
  assert.equal(stocksTrading(Date.parse("2026-11-27T14:34:00Z")), true);
  assert.equal(stocksTrading(Date.parse("2026-11-28T14:34:00Z")), false);
  assert.equal(stocksTrading(Date.parse("2026-11-27T02:00:00Z")), false);
  assert.equal(liveQuoteUrl("NVDA"), "/api/research/market/quotes?tickers=NVDA&fast=1");
});

test("the poller asks nothing while the tab is hidden and resumes when it is shown", async () => {
  const listeners = new Set(), saved = globalThis.document;
  globalThis.document = { visibilityState: "visible", addEventListener: (_, f) => listeners.add(f), removeEventListener: (_, f) => listeners.delete(f) };
  try {
    let runs = 0;
    const stop = startPolling(async () => { runs++; }, 5);
    await new Promise(r => setTimeout(r, 1));
    assert.equal(runs, 1);
    globalThis.document.visibilityState = "hidden";
    await new Promise(r => setTimeout(r, 40));
    const hiddenRuns = runs;
    await new Promise(r => setTimeout(r, 40));
    assert.equal(runs, hiddenRuns, "no reads while hidden");
    globalThis.document.visibilityState = "visible";
    listeners.forEach(f => f());
    await new Promise(r => setTimeout(r, 1));
    assert.equal(runs, hiddenRuns + 1);
    stop();
    assert.equal(listeners.size, 0);
  } finally { globalThis.document = saved; }
});

test("a rise flashes green, a fall red; the first value and another stock never flash; the quick flash is 0.7s and stops under reduced motion", () => {
  let s = startFlash("NVDA", 147.39);
  s = nextFlash(s, "NVDA", 148.49); assert.equal(s.dir, "up");
  s = nextFlash(s, "NVDA", 148.1); assert.equal(s.dir, "down");
  assert.equal(nextFlash(s, "NVDA", 148.1), s);
  assert.equal(nextFlash(s, "AMD", 120).dir, null);
  assert.equal(nextFlash(startFlash("NVDA", null), "NVDA", 1).dir, null);
  const css = read("app/research/price/flash-value.module.css");
  assert.match(css, /\.quickUp \{ animation: flashUp \.7s/);
  assert.match(css, /\.quickDown \{ animation: flashDown \.7s/);
  assert.match(css, /@keyframes flashUp \{ from \{ color: #5fe0aa; \} \}/); assert.match(css, /@keyframes flashDown \{ from \{ color: #ff7a7a; \} \}/);
  // The number's text colour only: no rule or keyframe sets a frame, background, border or glow.
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /border|background|box-shadow|outline|text-shadow/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.quickUp, \.quickDown \{ animation: none/);
  const detail = read("app/research/price/quote-detail.tsx");
  assert.match(detail, /<FlashValue scope=\{ticker\} value=\{quote\.price\} className=\{styles\.price\} quick>/);
  assert.match(detail, /<FlashValue scope=\{ticker\} value=\{quote\.change\} className=\{`\$\{styles\.changeLine\} \$\{styles\[tone\]\}`\} quick>/);
});

test("the page request asks the provider for nothing: the first paint peeks the shared copies; the browser reads only our quotes route", () => {
  const page = read("app/research/quote/[ticker]/page.tsx"), first = read("lib/research/quote-first-paint.ts");
  assert.match(page, /firstQuoteWithin\(ticker, "15m"\)/);
  assert.doesNotMatch(page, /loadMarketQuotes|fetchQuotes|market-data/);
  assert.match(first, /peekQuote\(ticker\)/);
  assert.doesNotMatch(first, /loadMarketQuotes|loadIntraday|fetchQuotes|twelvedata/i);
  const hook = read("app/research/price/use-live-quote.ts");
  assert.match(hook, /startLiveQuote\(trading, read, startPolling\)/);
  assert.match(hook, /fetch\(liveQuoteUrl\(ticker\)/);
  assert.doesNotMatch(hook, /twelvedata|apikey|market-data/i);
});
