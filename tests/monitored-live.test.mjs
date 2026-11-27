import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID } from "../lib/membership/entitlements.ts";
import { proPageAllowed } from "../lib/membership/pro-access.ts";
import { tickerAllowed } from "../lib/research/market-guard.ts";
import { MAX_QUOTES_PER_REQUEST } from "../lib/research/twelve-budget.ts";
import { liveQuoteUrl } from "../lib/research/live-quote.ts";
import { providers } from "../lib/research/intake.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-11-27T15:00:00Z");
const tickers = providers.map(p => p.ticker);

test("監視22銘柄 list: all 22 quotes in one batched request to our quotes route, within the per-request limit", () => {
  assert.equal(tickers.length, 22);
  assert.ok(tickers.length <= MAX_QUOTES_PER_REQUEST, "one request reads every tile");
  const url = new URL(liveQuoteUrl(tickers), "https://techphase.app");
  assert.equal(url.pathname, "/api/research/market/quotes");
  assert.deepEqual(url.searchParams.get("tickers").split(","), tickers);
  assert.equal(url.searchParams.get("fast"), "1");
  assert.equal(liveQuoteUrl("NVDA"), "/api/research/market/quotes?tickers=NVDA&fast=1");
  const hook = read("app/research/price/use-live-quote.ts");
  assert.match(hook, /export function useLiveQuotes/);
  assert.match(hook, /fetch\(liveQuoteUrl\(key\.split\(","\)\)/);
  assert.equal(hook.match(/startLiveQuote\(trading, read, startPolling\)/g).length, 2, "both hooks: 15s while trading, paused while hidden");
  assert.doesNotMatch(hook, /twelvedata|apikey|market-data/i);
  const directory = read("app/research/companies/company-directory.tsx");
  assert.match(directory, /useLiveQuotes\(companies\.map\(company=>company\.ticker\),!onOpen\)/, "one hook call for the whole list; the tour sample reads nothing");
  assert.match(directory, /<FlashValue scope=\{ticker\} value=\{quote\.price\} className=\{styles\.price\} quick>/);
  assert.match(directory, /<FlashValue scope=\{ticker\} value=\{quote\.change\}[^>]*quick>/);
});

test("each 監視22銘柄 page header: the gauge card is live and flashes; the stock search's dial card keeps its own polling", () => {
  const card = read("app/research/price/quote-card.tsx");
  assert.match(card, /props\.variant === "gauge" \? <LiveQuoteCard/);
  assert.match(card, /function LiveQuoteCard[\s\S]*?useLiveQuote\(ticker\)[\s\S]*?live \/>/);
  assert.match(card, /live \? <FlashValue scope=\{ticker\} value=\{quote\.price\} className=\{styles\.price\} quick>/);
  assert.match(card, /live \? <FlashValue scope=\{ticker\} value=\{quote\.change\} className=\{styles\.moves\} quick>/);
  for (const page of ["company-watch.tsx", "mu-watch.tsx"]) assert.match(read(`app/research/companies/${page}`), /<QuoteCard ticker=(\{[^}]+\}|"[A-Z]+") variant="gauge"/);
});

test("no 'not connected / not auto-updated' copy on the 監視22銘柄 pages (owner, Nov 27: untrue now)", () => {
  const dashboard = read("app/research/companies/company-dashboard.tsx"), watch = read("app/research/companies/company-watch.tsx");
  assert.doesNotMatch(dashboard, /株価・速報の配信は未接続|Live prices and news are not connected|自動反映していません|not incorporated automatically|自動更新なし|<footer/);
  assert.doesNotMatch(watch, /自動反映は未接続|doesn't automatically include newer results/);
  assert.match(watch, /リアルタイム監視は配信済みの記事を自動更新します。/);
});

test("owner accounts keep full access: the 監視22銘柄 pages open and every live quote is readable, also as FREE", () => {
  for (const userId of [OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID]) {
    assert.equal(proPageAllowed({ status: "signed-in", plan: "free", userId }, NOW), true);
    assert.equal(proPageAllowed({ status: "signed-in", plan: "pro", userId, accessExpiresAt: NOW - 1 }, NOW), true);
  }
  assert.equal(proPageAllowed({ status: "signed-in", plan: "free", userId: "user_other" }, NOW), false);
  for (const t of tickers) assert.equal(tickerAllowed(t, "owner", "light", null), true);
  // Prices on the list depend on nothing but the page gate (no plan check that could hide them from the owner).
  assert.doesNotMatch(read("app/research/companies/company-directory.tsx"), /showPrices=[^;]*(plan|pro)\b/);
});
