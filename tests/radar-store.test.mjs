import test from "node:test";
import assert from "node:assert/strict";
import { storeConfig, toRow, factsFromRow, readRows, saveRow, isStale, STALE_MS } from "../lib/research/radar-store.ts";
import { buildRadar } from "../lib/research/radar.ts";

const W = "w".repeat(40), R = "r".repeat(40);
const env = { TECH_PHASE_RADAR_API_URL: "https://radar.example.com/", TECH_PHASE_RADAR_WRITE_TOKEN: W, TECH_PHASE_RADAR_READ_TOKEN: R };
const facts = {
  latest: { end: "2026-09-30", basis: "ttm", revenue: 1e9, ocfMargin: -12.5, fcfMargin: -20.5, cover: 2.4, revenueGrowth: 40.2 },
  previous: { end: "2026-06-30", basis: "ttm", revenue: 9e8, ocfMargin: -18.1, fcfMargin: -25, cover: 2.8, revenueGrowth: 30 },
};
const at = Date.parse("2026-10-28T01:00:00Z");

test("the storage is used only when the address and both different secrets are set", () => {
  assert.deepEqual(storeConfig(env), { url: "https://radar.example.com", write: W, read: R });
  assert.equal(storeConfig({}), null);
  assert.equal(storeConfig({ ...env, TECH_PHASE_RADAR_READ_TOKEN: undefined }), null);
  assert.equal(storeConfig({ ...env, TECH_PHASE_RADAR_READ_TOKEN: W }), null);
  assert.equal(storeConfig({ ...env, TECH_PHASE_RADAR_WRITE_TOKEN: "short" }), null);
  assert.equal(storeConfig({ ...env, TECH_PHASE_RADAR_API_URL: "http://radar.example.com" }), null);
  assert.equal(storeConfig({ ...env, TECH_PHASE_RADAR_API_URL: "not a url" }), null);
});

test("a calculation becomes one row with all fourteen fields; a failed one becomes nothing", () => {
  const row = toRow("ai-cloud", "NBIS", facts, at, 100);
  assert.deepEqual(row, { genre: "ai-cloud", ticker: "NBIS", ocf_margin: -12.5, cover: 2.4, revenue_growth: 40.2, revenue_usd: 1e9, period_end: "2026-09-30", previous_ocf_margin: -18.1, previous_cover: 2.8, needs_review: false, calculated_at: "2026-10-28T01:00:00Z", fcf_margin: -20.5, basis: "ttm", previous_period_end: "2026-06-30" });
  assert.equal(toRow("ai-cloud", "NBIS", { latest: null, previous: null, reason: "unavailable" }, at, 100), null);
  assert.equal(toRow("ai-cloud", "NBIS", { ...facts, latest: { ...facts.latest, ocfMargin: Number.NaN } }, at, 100), null);
  assert.equal(toRow("ai-cloud", "NBIS", { latest: null, previous: facts.previous }, at, 100), null);
});

test("no borrowing is stored as 1000x, a missing previous as null, and 100%+ earning power is flagged", () => {
  const row = toRow("semis", "IREN", { latest: { ...facts.latest, ocfMargin: 297, cover: Infinity, revenueGrowth: null }, previous: null }, at, 100);
  assert.equal(row.cover, 1000); assert.equal(row.revenue_growth, null);
  assert.equal(row.previous_ocf_margin, null); assert.equal(row.previous_cover, null); assert.equal(row.previous_period_end, null);
  assert.equal(row.needs_review, true);
});

test("stored values draw the same radar as the live calculation (for what is stored)", () => {
  const live = buildRadar("ai-cloud", [{ ticker: "NBIS", facts }], "pro");
  const stored = buildRadar("ai-cloud", [{ ticker: "NBIS", facts: factsFromRow(toRow("ai-cloud", "NBIS", facts, at, 100)) }], "pro");
  assert.deepEqual(stored, live);
});

test("reading returns the rows by ticker, and any failure returns null so the live calculation is used", async () => {
  const row = toRow("ai-cloud", "NBIS", facts, at, 100);
  let seen;
  const ok = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ ok: true, items: [row, { junk: 1 }] })); };
  const rows = await readRows("ai-cloud", storeConfig(env), ok);
  assert.deepEqual([...rows.keys()], ["NBIS"]);
  assert.equal(seen.url, "https://radar.example.com/v1/financial-radar?genre=ai-cloud");
  assert.equal(seen.init.headers.Authorization, `Bearer ${R}`);
  assert.equal(await readRows("ai-cloud", storeConfig(env), async () => new Response("{}", { status: 503 })), null);
  assert.equal(await readRows("ai-cloud", storeConfig(env), async () => { throw Error("down"); }), null);
  assert.equal(await readRows("ai-cloud", null, ok), null);
});

test("saving uses the write secret, retries a temporary failure, and never retries a rejection", async () => {
  const row = toRow("ai-cloud", "NBIS", facts, at, 100);
  const calls = [];
  const flaky = async (url, init) => { calls.push(init); return calls.length < 2 ? new Response("", { status: 503 }) : new Response('{"ok":true,"saved":true}'); };
  assert.equal(await saveRow(row, storeConfig(env), flaky), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers.Authorization, `Bearer ${W}`);
  assert.equal(JSON.parse(calls[0].body).ticker, "NBIS");
  let n = 0;
  assert.equal(await saveRow(row, storeConfig(env), async () => { n++; return new Response("", { status: 400 }); }), false);
  assert.equal(n, 1);
  assert.equal(await saveRow(row, null, flaky), false);
});

test("a value older than six hours is calculated again", () => {
  const row = toRow("ai-cloud", "NBIS", facts, at, 100);
  assert.equal(isStale(row, at + STALE_MS - 1000), false);
  assert.equal(isStale(row, at + STALE_MS + 1000), true);
  assert.equal(isStale(undefined, at), true);
});
