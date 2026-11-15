import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { refreshChunk, refreshQueue, parseCursor, REFRESH_BUDGET_MS, SEC_SPACING_MS } from "../lib/research/radar-refresh.ts";
import { radarGenres } from "../lib/research/radar.ts";

const facts = {
  latest: { end: "2026-09-30", basis: "ttm", revenue: 1e9, ocfMargin: 12.5, fcfMargin: 8, cover: 2.4, revenueGrowth: 40.2 },
  previous: { end: "2026-06-30", basis: "ttm", revenue: 9e8, ocfMargin: 10, fcfMargin: 5, cover: 2.8, revenueGrowth: 30 },
};
function clock() { let t = Date.parse("2026-11-15T23:00:00Z"); return { now: () => t, sleep: async ms => { t += ms; }, advance: ms => { t += ms; } }; }

test("the queue holds every company of every genre once per genre, and the cursor is a position in it", () => {
  const queue = refreshQueue();
  assert.equal(queue.length, radarGenres.reduce((n, g) => n + g.tickers.length, 0));
  for (const genre of radarGenres) for (const ticker of genre.tickers) assert.ok(queue.some(q => q.genre === genre.id && q.ticker === ticker));
  assert.equal(parseCursor(null), 0); assert.equal(parseCursor(""), 0); assert.equal(parseCursor("3"), 3);
  for (const bad of ["-1", "1.5", "x", String(queue.length), "99999"]) assert.equal(parseCursor(bad), null, bad);
  assert.ok(SEC_SPACING_MS >= 100, "at most ten SEC requests a second"); assert.ok(REFRESH_BUDGET_MS <= 35_000, "fits the route's 60 seconds");
});

test("every company is saved in one pass when there is time; SEC requests are spaced and a failure never overwrites", async () => {
  const c = clock(); const saved = [], starts = [];
  const report = await refreshChunk(0, {
    now: c.now, sleep: c.sleep, budgetMs: 1e12,
    load: async ticker => { starts.push(c.now()); c.advance(50); if (ticker === "NVDA") throw Error("sec-unavailable"); if (ticker === "AMD") return { latest: null, previous: null, reason: "not-derivable" }; return facts; },
    save: async row => { saved.push(`${row.genre}:${row.ticker}`); return row.ticker !== "INTC"; },
  });
  const queue = refreshQueue();
  assert.equal(report.done, true); assert.equal(report.next, null); assert.equal(report.total, queue.length);
  assert.deepEqual(report.failures.sort(), ["semis:AMD", "semis:INTC", "semis:NVDA"]);
  assert.equal(report.refreshed, queue.length - 3); assert.equal(report.failed, 3);
  assert.ok(!saved.includes("semis:NVDA") && !saved.includes("semis:AMD"), "a failed calculation is never sent to the storage");
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= SEC_SPACING_MS, `gap ${starts[i] - starts[i - 1]}`);
  assert.equal(report.secRequests, new Set(queue.map(q => q.ticker)).size);
});

test("a company without revenue is left to the live calculation, not counted as a failure", async () => {
  const c = clock();
  const report = await refreshChunk(0, { now: c.now, sleep: c.sleep, budgetMs: 1e12, load: async t => t === "OKLO" ? { latest: { ...facts.latest, noRevenue: true }, previous: null } : facts, save: async () => true });
  assert.equal(report.live, 1); assert.equal(report.failed, 0);
});

test("a call stops when its time is used and the cursor continues where it stopped, until the list is done", async () => {
  const c = clock(); const seen = [];
  const deps = { now: c.now, sleep: c.sleep, budgetMs: 10_000, load: async () => { c.advance(3_000); return facts; }, save: async row => { seen.push(`${row.genre}:${row.ticker}`); return true; } };
  let cursor = 0, calls = 0, report;
  do { report = await refreshChunk(cursor, deps); calls++; assert.ok(report.next === null || report.next > cursor); cursor = report.next ?? cursor; } while (!report.done && calls < 100);
  assert.equal(report.done, true); assert.ok(calls > 1);
  assert.deepEqual(seen, refreshQueue().map(q => `${q.genre}:${q.ticker}`));
});

// ---------- the route ----------
const here = path => new URL(`../${path}`, import.meta.url).href;
async function loadRoute() {
  const text = readFileSync(new URL("../app/api/research/radar/refresh/route.ts", import.meta.url), "utf8")
    .replace('import { validSyncToken } from "@/lib/membership/sync-auth";', `import { validSyncToken } from ${JSON.stringify(here("lib/membership/sync-auth.ts"))};`)
    .replace('import { loadRadarFactsFresh } from "@/lib/research/radar-server";', "const loadRadarFactsFresh = t => globalThis.__radarRefresh.load(t);")
    .replace('import { saveRow, storeConfig } from "@/lib/research/radar-store";', `import { saveRow, storeConfig } from ${JSON.stringify(here("lib/research/radar-store.ts"))};`)
    .replace('import { parseCursor, refreshChunk } from "@/lib/research/radar-refresh";', `import { parseCursor, refreshChunk } from ${JSON.stringify(here("lib/research/radar-refresh.ts"))};`);
  assert.ok(!text.includes("@/"));
  return import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(text)).toString("base64") + `#${Math.random()}`);
}
const WARM = "w".repeat(40), CRON = "c".repeat(40);
const storage = { TECH_PHASE_RADAR_API_URL: "https://radar.example.com", TECH_PHASE_RADAR_WRITE_TOKEN: "a".repeat(40), TECH_PHASE_RADAR_READ_TOKEN: "b".repeat(40) };
async function withEnv(env, run) {
  const keys = ["COMPARISON_WARM_SECRET", "CRON_SECRET", ...Object.keys(storage)];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]])); const savedFetch = globalThis.fetch; const savedInfo = console.info;
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  const posts = []; const loads = [];
  globalThis.__radarRefresh = { load: async t => { loads.push(t); return facts; } };
  globalThis.fetch = async (url, init) => { posts.push({ url: String(url), auth: init?.headers?.Authorization, row: JSON.parse(init.body) }); return Response.json({ ok: true, saved: true }); };
  console.info = () => {};
  try { await run({ posts, loads }); } finally {
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    globalThis.fetch = savedFetch; console.info = savedInfo; delete globalThis.__radarRefresh;
  }
}
const call = (route, auth, query = "", method = "POST") => route[method](new Request(`https://techphase.app/api/research/radar/refresh${query}`, { method, headers: auth ? { Authorization: auth } : {} }));

test("the refresh route takes only the warm or cron secret, and refuses before any SEC or storage request", () => withEnv({ COMPARISON_WARM_SECRET: WARM, CRON_SECRET: CRON, ...storage }, async ({ posts, loads }) => {
  const route = await loadRoute();
  for (const auth of [null, "Bearer wrong", `Basic ${WARM}`, `Bearer ${storage.TECH_PHASE_RADAR_WRITE_TOKEN}`, WARM]) {
    const response = await call(route, auth);
    assert.equal(response.status, 401, String(auth)); assert.deepEqual(await response.json(), { ok: false });
  }
  assert.equal((await call(route, `Bearer ${WARM}`, "?cursor=abc")).status, 400);
  assert.equal(loads.length, 0); assert.equal(posts.length, 0);
}));

test("with the warm secret the route saves rows to the storage with the write token and answers counts only", () => withEnv({ COMPARISON_WARM_SECRET: WARM, ...storage }, async ({ posts, loads }) => {
  const route = await loadRoute();
  const total = refreshQueue().length;
  const response = await call(route, `Bearer ${WARM}`, `?cursor=${total - 2}`, "GET");
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.ok, true); assert.equal(body.done, true); assert.equal(body.refreshed, 2); assert.equal(body.from, total - 2);
  assert.equal(posts.length, 2); assert.equal(loads.length, 2);
  assert.ok(posts.every(p => p.url === "https://radar.example.com/v1/financial-radar" && p.auth === `Bearer ${storage.TECH_PHASE_RADAR_WRITE_TOKEN}`));
  const text = JSON.stringify(body);
  for (const secret of [WARM, storage.TECH_PHASE_RADAR_WRITE_TOKEN, storage.TECH_PHASE_RADAR_READ_TOKEN]) assert.ok(!text.includes(secret));
  assert.ok(!("ocf_margin" in body) && !text.includes("12.5"), "no figures in the answer");
}));

test("the cron secret works too, and without the storage nothing is read or written", () => withEnv({ CRON_SECRET: CRON }, async ({ posts, loads }) => {
  const route = await loadRoute();
  const body = await (await call(route, `Bearer ${CRON}`)).json();
  assert.deepEqual({ ok: body.ok, storage: body.storage, done: body.done }, { ok: true, storage: false, done: true });
  assert.equal(loads.length, 0); assert.equal(posts.length, 0);
}));
