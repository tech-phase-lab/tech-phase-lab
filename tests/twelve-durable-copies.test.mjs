// Production, Nov 26: the comparison's daily statistics copies (50 credits each) were gone from the Next.js data cache (Vercel's Runtime
// Cache) within hours: ASML and AVNT stored at 00:21 UTC and UNFI at 03:30 were all read again for 50 credits at 08:00-08:05, while YUM
// (05:35) and SONO (07:51) were still there. The costly copies are now also kept by the Railway monitor (scripts/research/twelve_copies.py)
// and read back from it. The reader is run directly with a lost runtime store; the server-only wiring is read from source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createReader } from "../lib/research/twelve-budget.ts";
import { T0, clockAt, memoryStore } from "./support/twelve-load-sim.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const STATS = { name: "md-facts-stats-v2", slotMs: 6 * 3600_000, staleMs: 14 * 86_400_000, durable: true };
const QUOTE = { name: "md-quote-v1", slotMs: 60_000, staleMs: 3600_000 };
function monitor() {
  const rows = new Map();
  const store = {
    gets: 0, puts: 0,
    async get(name, key) { store.gets++; await null; return rows.get(`${name}|${key}`) ?? null; },
    async put(name, key, entry) { store.puts++; await null; const old = rows.get(`${name}|${key}`); if (!old || old.at < entry.at) rows.set(`${name}|${key}`, structuredClone(entry)); },
  };
  return store;
}
const facts = { eps: 40.64, marketCap: 502230134286, dividendYield: 0.64 };

test("a durable copy outlives the runtime cache: a new instance with an empty store gets it without asking the provider", async () => {
  const clock = clockAt(T0), kept = monitor();
  let provider = 0;
  const first = createReader(memoryStore(), clock.now, kept);
  await first.read(STATS, "ASML", async () => { provider++; return facts; });
  assert.equal(provider, 1);
  assert.equal(kept.puts, 1);
  // Two hours later the runtime cache has lost it (a fresh store), on another instance (a fresh reader).
  clock.advance(2 * 3600_000);
  const later = createReader(memoryStore(), clock.now, kept);
  const got = await later.read(STATS, "ASML", async () => { provider++; return facts; });
  assert.equal(provider, 1, "no second 50-credit read");
  assert.equal(got.fresh, true);
  assert.equal(got.value.marketCap, 502230134286);
});

test("past its slot the durable copy is the last good copy when the provider refuses, and a new read replaces it", async () => {
  const clock = clockAt(T0), kept = monitor();
  await createReader(memoryStore(), clock.now, kept).read(STATS, "TSM", async () => facts);
  clock.advance(9 * 3600_000);
  const reader = createReader(memoryStore(), clock.now, kept);
  const refused = await reader.read(STATS, "TSM", async () => { throw new Error("twelve-budget"); });
  assert.equal(refused.fresh, false);
  assert.equal(refused.value.eps, 40.64);
  const copies = createReader(memoryStore(), clock.now, kept);
  assert.equal((await copies.read(STATS, "TSM", null)).value.eps, 40.64, "a copies-only read finds it too");
  await reader.read(STATS, "TSM", async () => ({ ...facts, eps: 41 }));
  assert.equal((await createReader(memoryStore(), clock.now, kept).read(STATS, "TSM", null)).value.eps, 41);
});

test("only specs marked durable are written to the monitor; a monitor that fails or is down is a miss, never an error", async () => {
  const clock = clockAt(T0), kept = monitor();
  const reader = createReader(memoryStore(), clock.now, kept);
  await reader.read(QUOTE, "NVDA", async () => ({ price: 1 }));
  assert.equal(kept.puts, 0, "a one-minute quote is not sent to the monitor");
  const broken = { async get() { throw new Error("down"); }, async put() { throw new Error("down"); } };
  const got = await createReader(memoryStore(), clock.now, broken).read(STATS, "PLTR", async () => facts);
  assert.equal(got.fresh, true);
  assert.equal(await createReader(memoryStore(), clock.now, broken).read(STATS, "PLTR", null), null);
  // Without a durable store the reader behaves as before.
  assert.equal((await createReader(memoryStore(), clock.now).read(STATS, "GEV", async () => facts)).fresh, true);
});

test("the kinds the site keeps durable are the monitor's", () => {
  const site = read("lib/research/twelve-copies.ts").match(/DURABLE_KINDS = \[([^\]]*)\]/)[1].match(/"([^"]+)"/g).map(s => s.slice(1, -1));
  const monitorKinds = read("scripts/research/twelve_copies.py").match(/KINDS = \(([^)]*)\)/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual(site, monitorKinds);
  for (const name of ["md-facts-stats-v2", "md-facts-next-earnings-v2"]) assert.ok(site.includes(name), name);
});

test("wiring: the facts specs are durable, the shared reader uses the monitor, and the comparison's statistics are kept and read back", () => {
  const data = read("lib/research/market-data.ts");
  assert.match(data, /name: "md-facts-stats-v2", slotMs: 6 \* 3600_000, staleMs: 14 \* 86_400_000, durable: true/);
  assert.match(data, /name: "md-facts-next-earnings-v2", slotMs: 24 \* 3600_000, staleMs: 7 \* 86_400_000, durable: true/);
  const gateway = read("lib/research/twelve-gateway.ts");
  assert.match(gateway, /export const sharedReader = createReader\(dataCache, Date\.now, durableCopies, keepRunning\);/);
  assert.match(gateway, /monitorEndpoint\("\/twelve\/lease"\)/);
  const store = read("lib/research/twelve-store.ts");
  assert.match(store, /await durablePut\("compare-statistics", ticker, \{ at: Date\.parse\(raw\.retrievedAt\), value: raw\.payload \}\)/);
  // The runtime copy is read back over the whole STATISTICS_MAX_AGE_DAYS window (claude/compare-valuation), then the monitor's copy.
  assert.match(store, /return fresh\(await peek\(statisticsDay, ticker, Array\.from\(\{ length: STATISTICS_MAX_AGE_DAYS \+ 1 \}, \(_, i\) => d - i\)\)\) \?\? fresh\(await keptStatistics\(ticker\)\);/);
  assert.match(store, /daySlot\(Date\.parse\(kept\.retrievedAt\)\) === daySlot\(now\)/, "a lost copy is not bought again the same day");
  const copies = read("lib/research/twelve-copies.ts");
  assert.match(copies, /^import "server-only";/);
  assert.match(copies, /signal: AbortSignal\.timeout\(1_500\)/);
  assert.match(copies, /"\/twelve\/copies\/get"/);
  assert.match(copies, /"\/twelve\/copies\/put"/);
});

test("wire: small copies go as they are, large ones gzip-compressed, and ones still over the gateway's limit in parts", async () => {
  const { encodeValue, decodeValue, COMPRESS_AT, PART_BYTES, MAX_PARTS } = await import("../lib/research/twelve-copies-wire.ts");
  const small = { eps: 1.2 };
  assert.deepEqual(encodeValue(small), { value: small });
  assert.deepEqual(encodeValue(null), { value: null });
  assert.deepEqual(decodeValue(small), small);
  // Quarterly statements: repetitive JSON, far over the limit raw, small once compressed.
  const statements = { income: { income_statement: Array.from({ length: 200 }, (_, i) => ({ fiscal_date: `20${10 + (i >> 2)}-0${1 + (i % 4) * 3}-30`, sales: 1e9 + i, cost_of_goods: 4e8 + i, gross_profit: 6e8 + i, operating_income: 2e8 + i, net_income: 1e8 + i, eps_diluted: 1.1 + i / 100 })) }, cashFlow: { cash_flow: [] } };
  assert.ok(JSON.stringify(statements).length > COMPRESS_AT);
  const packed = encodeValue(statements);
  assert.ok("value" in packed && typeof packed.value.$gz === "string" && packed.value.$gz.length <= PART_BYTES);
  assert.deepEqual(decodeValue(packed.value), statements);
  // Incompressible data over the limit even when packed: parts, each under the gateway's body limit, put together by the monitor.
  const { randomBytes } = await import("node:crypto");
  const noise = randomBytes(60_000).toString("hex");
  const parted = encodeValue({ noise });
  assert.ok("chunks" in parted && parted.chunks.length >= 2 && parted.chunks.every(c => c.length <= PART_BYTES));
  assert.deepEqual(decodeValue({ $gz: parted.chunks.join("") }), { noise });
  const huge = randomBytes(1_200_000).toString("hex");
  assert.equal(encodeValue({ huge }), null, `over ${MAX_PARTS} parts is not sent at all`);
  assert.throws(() => decodeValue({ $gz: "not-gzip" }));
});

test("wiring: the statements (200 credits) and portfolio splits (20 a ticker a day) are kept by the monitor too", () => {
  const store = read("lib/research/twelve-store.ts");
  assert.match(store, /await durablePut\("compare-statements", ticker, \{ at: Date\.parse\(statements\.retrievedAt\), value: \{ income: statements\.income, cashFlow: statements\.cashFlow \} \}\)/);
  assert.match(store, /return await peek\(statementsWeek, ticker, \[w, w - 1\]\) \?\? keptStatements\(ticker, now\);/);
  const splits = read("lib/portfolio/split-feed.ts");
  assert.match(splits, /if \(kept && Array\.isArray\(kept\.value\) && etDay\(kept\.at\) === etDay\(\)\) return \{ splits: kept\.value as StockSplit\[\], at: kept\.at \};/);
  assert.ok(splits.indexOf('durableGet("portfolio-splits"') < splits.indexOf("await reserveCredits(20"), "today's kept copy is read before any credit is asked");
  assert.match(splits, /await durablePut\("portfolio-splits", ticker, \{ at: read\.at, value: read\.splits \}\)/);
});
