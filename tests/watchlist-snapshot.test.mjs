import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WATCHLIST_SNAPSHOT_QUOTES, emptyWatchlistSnapshot, parseWatchlistSnapshot, serializeWatchlistSnapshot, signInHint, withLists, withQuotes } from "../lib/research/watchlist-snapshot.ts";
import { favoriteIntradayChart } from "../lib/research/watchlist-chart.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const path = (start, prices) => prices.map((price, index) => ({ at: new Date(Date.parse(start) + index * 5 * 60_000).toISOString(), price }));
const quote = (ticker, price, history) => ({ ticker, price, change: 1, percentChange: 0.5, currency: "USD", asOf: "2026-11-25T16:30:00.000Z", session: "regular", delayed: false, source: "twelve-data", ...(history ? { history } : {}) });

test("the last screen keeps each row's price and 5-minute path, packed, and draws the same chart after a reload (owner, Nov 25)", () => {
  const history = path("2026-11-25T14:30:00.000Z", [100.1234, 100.5, 99.75, 101.25]);
  const snapshot = withQuotes(emptyWatchlistSnapshot, { NVDA: quote("NVDA", 101.25, history), AMD: quote("AMD", 50) });
  const raw = serializeWatchlistSnapshot(snapshot);
  assert.ok(!raw.includes("2026-11-25T14:35"), "the path is stored packed, not as one ISO time per point");
  const back = parseWatchlistSnapshot(raw);
  assert.deepEqual(back.quotes.NVDA, quote("NVDA", 101.25, history));
  assert.deepEqual(back.quotes.AMD, quote("AMD", 50));
  assert.deepEqual(favoriteIntradayChart(back.quotes.NVDA), favoriteIntradayChart(quote("NVDA", 101.25, history)));
});

test("a new answer replaces a row's quote, keeps its path when the answer had none, and only the last 100 symbols are kept", () => {
  const history = path("2026-11-25T14:30:00.000Z", [1, 2, 3]);
  let snapshot = withQuotes(emptyWatchlistSnapshot, { NVDA: quote("NVDA", 3, history) });
  snapshot = withQuotes(snapshot, { NVDA: quote("NVDA", 4) });
  assert.equal(snapshot.quotes.NVDA.price, 4);
  assert.deepEqual(snapshot.quotes.NVDA.history, history);
  const many = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`T${index}`, quote(`T${index}`, 10 + index)]));
  snapshot = withQuotes(snapshot, many);
  assert.equal(Object.keys(snapshot.quotes).length, WATCHLIST_SNAPSHOT_QUOTES);
  assert.ok(!snapshot.quotes.NVDA && snapshot.quotes.T119 && !snapshot.quotes.T19 && snapshot.quotes.T20);
});

test("broken or foreign copies are ignored, never shown", () => {
  assert.deepEqual(parseWatchlistSnapshot(null), emptyWatchlistSnapshot);
  assert.deepEqual(parseWatchlistSnapshot("{"), emptyWatchlistSnapshot);
  const bad = JSON.stringify({ quotes: { NVDA: { ...quote("AMD", 1) }, MU: { ...quote("MU", -1) }, TSM: { ...quote("TSM", 5), h: [1, [0], [1, 2]] } } });
  const parsed = parseWatchlistSnapshot(bad);
  assert.equal(parsed.quotes.NVDA, undefined);
  assert.equal(parsed.quotes.MU, undefined);
  assert.equal(parsed.quotes.TSM.history, undefined, "a path with a zero gap is dropped, the price stays");
});

test("a member's lists are kept only with the sign-in they belong to; signing out forgets them", () => {
  const lists = { lists: [{ id: "default", name: "半導体", tickers: ["NVDA", "AMD"] }, { id: "my-list-2", name: "", tickers: ["MU"] }], names: { NVDA: "NVIDIA" } };
  const saved = parseWatchlistSnapshot(serializeWatchlistSnapshot(withLists(emptyWatchlistSnapshot, "uat:1732550000", lists)));
  assert.equal(saved.owner, "uat:1732550000");
  assert.deepEqual(saved.lists.lists.map(item => [item.id, item.name, item.tickers]), [["default", "半導体", ["NVDA", "AMD"]], ["my-list-2", "", ["MU"]]]);
  const out = parseWatchlistSnapshot(serializeWatchlistSnapshot(withLists(saved, null, null)));
  assert.equal(out.owner, null); assert.equal(out.lists, null);
  assert.equal(signInHint("a=1; __client_uat=0; __client_uat_AbC12=0"), "out");
  assert.equal(signInHint("__client_uat=1732550000; __client_uat_AbC12=1732550000"), "uat:1732550000,1732550000");
  assert.equal(signInHint("theme=dark"), null);
  const hook = read("app/research/watchlist/use-favorite-lists.ts");
  assert.match(hook, /const earlyLists = early && status === "loading" \? \(hint === "out" \? local : hint && snapshot\.owner === hint \? snapshot\.lists : null\) : null;/);
  assert.match(hook, /editable: status === "guest" \|\| !!cloud && status !== "conflict"/, "nothing can be edited from the early copy");
});

test("the watchlist draws rows from the last screen at once and asks the server exactly as before (no extra provider credit)", () => {
  const page = read("app/research/watchlist/watchlist.tsx");
  assert.match(page, /useFavoriteLists\(\{ early: true \}\)/);
  assert.match(page, /const shown = live \? \(!live\.history\?\.length && last\?\.history\?\.length \? \{ \.\.\.live, history: last\.history \} : live\) : last \?\? quotes\[ticker\];/);
  assert.match(page, /useEffect\(\(\) => \{ if \(fetchedQuotes\) saveWatchlistQuotes\(fetchedQuotes\); \}, \[fetchedQuotes\]\);/);
  // The switch from the stored copy to the first answer does not glow; later answers do, as before.
  assert.match(page, /scope=\{`\$\{list\.id\}:\$\{ticker\}:\$\{sessionView\}:\$\{liveQuotes\[ticker\] \? "live" : "last"\}`\}/);
  assert.match(page, /useQuotes\(favorites\.slice\(0, 100\), true, true, true\)/);
  assert.match(read("app/research/price/use-market.ts"), /fast \? 15_000 : 60_000/);
});
