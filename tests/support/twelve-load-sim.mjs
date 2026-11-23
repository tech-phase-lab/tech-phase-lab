/** The 1,000-member load simulation for lib/research/twelve-budget.ts (tests/twelve-budget.test.mjs): a provider that counts the key's
 * credits per minute and refuses past the plan, several server instances sharing one store and one meter, the Railway monitor's jobs. */
import { CEILING, EMERGENCY_BURST, EMERGENCY_PER_MINUTE, PLAN_CREDITS_PER_MINUTE, MAX_QUOTES_PER_REQUEST, MAX_SPARKLINES_PER_REQUEST, STALE_LIMIT_MS, createAllocatorModel, createGovernor, createLeaseGovernor, createReader } from "../../lib/research/twelve-budget.ts";

export const T0 = Date.parse("2026-11-23T15:00:00Z"); // a Monday, 10:00 in New York (regular session)
export function clockAt(t) { const c = { t, now: () => c.t, advance: ms => { c.t += ms; } }; return c; }
export function memoryStore() {
  const map = new Map();
  const store = {
    peeks: 0,
    async peek(name, key, slot) { store.peeks++; await null; return map.get(`${name}|${key}|${slot}`) ?? null; },
    async put(name, key, slot, entry) { await null; const k = `${name}|${key}|${slot}`; if (!map.has(k)) map.set(k, structuredClone(entry)); },
  };
  return store;
}
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }
function zipf(n, s, random) {
  const weights = Array.from({ length: n }, (_, i) => 1 / (i + 1) ** s), total = weights.reduce((a, b) => a + b, 0);
  const cdf = []; let acc = 0; for (const w of weights) { acc += w / total; cdf.push(acc); }
  return () => { const u = random(); let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid + 1; else hi = mid; } return `S${lo}`; };
}

/** The provider: a per-minute credit counter for the whole key; a call over the plan is refused with 429. */
function provider(clock) {
  const p = { minute: -1, used: 0, peaks: [], refused: 0, byMinute: [] };
  const roll = () => { const m = Math.floor(clock.now() / 60_000); if (m !== p.minute) { if (p.minute >= 0) p.byMinute.push(p.used); p.minute = m; p.used = 0; } };
  p.charge = (cost, who) => { roll(); if (p.used + cost > PLAN_CREDITS_PER_MINUTE) { p.refused++; return false; } p.used += cost; p[who] = (p[who] ?? 0) + cost; return true; };
  p.usage = () => { roll(); return p.used; };
  p.finish = () => { roll(); p.byMinute.push(p.used); return Math.max(...p.byMinute); };
  return p;
}

/** One simulated run: `members` concurrent members for `minutes`, spread over `instances` server instances, plus the Railway monitor.
 *  legacy: the design before this change (per-instance memory, no budget, no shared copy, a stock's facts always from the provider).
 *  mode: "allocator" (every instance asks the monitor's allocator, scripts/research/twelve_allocator.py), "allocator-down" (the monitor
 *  cannot be reached: the emergency allowance only), "meter" (each instance decides from the shared meter alone). */
export async function simulate({ legacy = false, mode = "allocator", members = 1000, minutes = 4, instances = 4, universe = 1500, seed = 7 } = {}) {
  const clock = clockAt(T0 - 30_000), random = rng(seed), pick = zipf(universe, 1.1, random);
  const p = provider(clock);
  const shared = memoryStore();
  // Everything the site served before the run (it has been up all day): a copy from 40 minutes ago of every symbol.
  const before = { value: { price: 1 }, at: T0 - 40 * 60_000 }, hour = Math.floor(before.at / 3_600_000);
  for (let i = 0; i < universe; i++) {
    await shared.put("quote~h", `S${i}`, hour, before);
    for (const key of [`S${i}|5min`, `S${i}|1day`, `S${i}|spark`, `cmp|S${i}`, `facts|S${i}`]) await shared.put("bars~h", key, hour, before);
  }
  const meterSlots = new Map();
  const sharedMeter = async () => { const slot = Math.floor(clock.now() / 5_000); if (!meterSlots.has(slot)) { p.charge(1, "meter"); meterSlots.set(slot, { used: p.usage(), at: clock.now() }); } return meterSlots.get(slot); };
  const central = !legacy && mode !== "meter";
  const alloc = createAllocatorModel({ now: clock.now, readMeter: () => { p.charge(1, "meter"); return p.usage(); } });
  const servers = Array.from({ length: instances }, () => {
    const own = memoryStore(); // legacy: each instance's own memory only
    const governor = central
      ? createLeaseGovernor({ now: clock.now, lease: async (cost, tier) => mode === "allocator-down" ? null : alloc.grant(cost, tier),
        fallback: createGovernor({ now: clock.now, readMeter: sharedMeter, perMinute: EMERGENCY_PER_MINUTE, burst: EMERGENCY_BURST, unknownPerMinute: EMERGENCY_PER_MINUTE, maxCost: EMERGENCY_BURST }) })
      : createGovernor({ now: clock.now, readMeter: sharedMeter });
    return { reader: createReader(legacy ? own : shared, clock.now), governor };
  });
  const stats = { lookups: 0, served: 0, fresh: 0, errors: 0, alertPasses: 0, alertSkipped: 0, maxAgeMs: 0 };
  const spend = async (server, cost, tier) => {
    if (!legacy && !await server.governor.acquire(cost, tier)) throw new Error("twelve-budget");
    if (!p.charge(cost, "site")) { server.governor.limited(); throw new Error("429"); }
  };
  const spec = (name, slotMs) => ({ name, slotMs, staleMs: STALE_LIMIT_MS });
  const count = (results, keys) => { for (const k of keys) { stats.lookups++; const r = results[k]; if (r?.value) { stats.served++; if (r.fresh) stats.fresh++; stats.maxAgeMs = Math.max(stats.maxAgeMs, clock.now() - r.at); } } };

  const quotes = async (server, keys) => {
    const r = await server.reader.readMany(spec("quote", 60_000), keys, async group => { await spend(server, group.length, "user"); return new Map(group.map(k => [k, { price: 2 }])); }, { maxFetch: legacy ? Infinity : MAX_QUOTES_PER_REQUEST });
    count(r, keys);
  };
  const series = async (server, key, slotMs, cost = 1, fetch = true) => {
    const r = await server.reader.read(spec("bars", slotMs), key, fetch ? async () => { await spend(server, cost, "user"); return { price: 2 }; } : null);
    count({ [key]: r }, [key]);
  };
  // A stock page: quote, the default chart (intraday), the period bases, the facts. Legacy kept intraday bars 15 seconds per instance.
  const stockPage = async (server, t) => Promise.all([quotes(server, [t]), series(server, `${t}|5min`, legacy ? 15_000 : 60_000), series(server, `${t}|1day`, 30 * 60_000),
    series(server, `facts|${t}`, 6 * 3600_000, legacy || random() < 0.2 ? 70 : (random() < 0.5 ? 20 : 0))]);
  // A comparison of three companies: one one-credit series each (statistics and statements come from the daily job's store).
  const comparison = async (server, ts) => Promise.all(ts.map(t => series(server, `cmp|${t}`, 3_600_000)));
  // A watchlist of 20 symbols polled every 15 seconds with sparklines.
  const watchlist = async (server, ts) => {
    await quotes(server, ts);
    let allowance = legacy ? Infinity : MAX_SPARKLINES_PER_REQUEST;
    await Promise.all(ts.map(t => series(server, `${t}|spark`, legacy ? 60_000 : 5 * 60_000, 1, allowance-- > 0)));
  };
  const lists = Array.from({ length: members }, () => Array.from({ length: 20 }, pick));
  for (let second = 0; second < minutes * 60 + 30; second++) {
    clock.t = T0 - 30_000 + second * 1000;
    // The Railway monitor: background jobs (comparison warm 255 at the start of each minute, value check 2 a second, ownership) stop at
    // their ceiling; price alerts (100 symbols) every five minutes at the critical tier.
    // With the allocator, the monitor's jobs decide from its view and report what they send; the daily comparison job asks it too.
    const s = second % 60, usage = () => central ? alloc.usage(0) : p.usage();
    const job = (cost, ceiling, who) => { const used = usage(); if (used === null || used + cost > ceiling) return false; if (central) alloc.record(cost); return p.charge(cost, who); };
    if (s === 1) { if (central ? alloc.grant(255, "warm") : p.usage() + 255 <= CEILING.warm) p.charge(255, "monitor"); }
    job(2, CEILING.background, "monitor");
    if (s === 30) job(20, CEILING.background, "monitor");
    if (second % 60 === 40) { stats.alertPasses++; if (!job(100, CEILING.critical, "alerts")) stats.alertSkipped++; }
    const jobs = [];
    for (let m = 0; m < members; m++) {
      const server = servers[Math.floor(random() * instances)];
      if (m % 2 === 0) { if ((second + m) % 15 === 0) jobs.push(watchlist(server, lists[m])); } // half poll their watchlist
      else if ((second + m) % 12 === 0) jobs.push(random() < 0.5 ? stockPage(server, pick()) : comparison(server, [pick(), pick(), pick()])); // half browse: 5 pages a minute
    }
    const settled = await Promise.allSettled(jobs);
    stats.errors += settled.filter(r => r.status === "rejected").length;
  }
  return { peak: p.finish(), refused: p.refused, minutes: p.byMinute, site: p.site ?? 0, ...stats };
}
