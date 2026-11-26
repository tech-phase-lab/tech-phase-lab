/** The site's share of the Twelve Data plan, and the shared cache every price screen reads through (owner, Nov 23: "it must be impossible to
 * break" with 1,000 members on the site). No server-only / Next imports so the logic can be tested and load-simulated directly; the
 * wiring to the real provider and to the Next.js data cache is lib/research/twelve-gateway.ts.
 *
 * Plan: 610 credits a minute and no daily cap, shared by the website (Vercel) and the Railway monitor (price alerts, the comparison's
 * background job, value check, ownership). The provider's own meter (/api_usage) is the only figure that sees all of them, so every
 * decision starts from it and adds this process's spending since it was read.
 *
 * Tiers (the minute's total usage, everyone included, plus the call must stay at or under the tier's ceiling):
 *   critical 600  the monitor's price alerts (a member's notice must not be starved by page views: 480 + its 100 symbols fit, with room for the meter's lag)
 *   user     480  a member's page: quotes, charts, a stock's facts, the comparison's one-credit series
 *   warm     420  the comparison's daily job (lib/research/comparison-warm.ts)
 *   background 400 the monitor's value check and ownership, the comparison's background fills: they yield first
 *   fast     200  the optional 15-second quote refresh, taken only on a quiet minute
 * Members first (Nov 25 production log: the daily job took ~455 credits at the start of every minute, leaving members ~25): the warm and
 * background ceilings are further lowered by a member reserve, at least MEMBER_RESERVE_MIN and otherwise twice the most credits members asked
 * for in any of the last five minutes, and the whole user tier after a minute in which a member was refused (memberReserve below; the
 * allocator applies it).
 * Strict (owner, Nov 23): every website instance asks the Railway monitor for each call's credits (scripts/research/twelve_allocator.py,
 * POST /twelve/lease); the monitor is the one place that sees every credit, whatever the number of instances. Only when it cannot be
 * reached does an instance fall back to a tiny emergency allowance under the shared meter (createLeaseGovernor).
 * Every user-facing read goes through a shared cache (one provider read per symbol and time slot for everyone), and when a read is refused
 * the last good copy is shown with its own time instead of an error. */

export const PLAN_CREDITS_PER_MINUTE = 610;
export const CEILING = { critical: 600, user: 480, warm: 420, background: 400, fast: 200 } as const;
/** The allocator's member reserve (scripts/research/twelve_allocator.py, the same constants; a test keeps them equal). */
export const MEMBER_RESERVE_MIN = 60, MEMBER_RESERVE_FACTOR = 2, MEMBER_WINDOW = 5;
const YIELDING: readonly Tier[] = ["warm", "background"];
/** Credits kept free for members above the warm and background jobs, from members' asks (granted or refused) and refusals by minute. */
export function memberReserve(asks: Map<number, number>, refused: Map<number, number>, minute: number): number {
  const recent = (book: Map<number, number>) => [...book].filter(([m]) => minute - MEMBER_WINDOW < m && m <= minute).map(([, c]) => c);
  if (recent(refused).some(c => c > 0)) return CEILING.user;
  return Math.max(MEMBER_RESERVE_MIN, MEMBER_RESERVE_FACTOR * Math.max(0, ...recent(asks)));
}
/** A tier's ceiling now: the warm and background jobs' is lowered by the member reserve. */
export const tierCeiling = (tier: Tier, reserve: number) => YIELDING.includes(tier) ? Math.max(0, Math.min(CEILING[tier], CEILING.user - reserve)) : CEILING[tier];
export type Tier = keyof typeof CEILING;
/** Each server instance's own cap on what it sends, whatever the meter says. The meter is a few seconds old and other instances spend
 * meanwhile, so an instance (1) adds the rate at which everyone else spent between its last two readings, and (2) takes at most SHARE of
 * the room left at the reading before it reads again. Several instances therefore cannot each spend the whole room. */
export const INSTANCE_PER_MINUTE = 120;
export const INSTANCE_BURST = 12;
export const SHARE = 0.15;
/** A call this small may always go while the minute is under its ceiling (one symbol's quote or bars). */
export const MIN_SHARE = 2;
/** When the provider's meter cannot be read, an instance sends at most this much a minute. */
export const UNKNOWN_METER_PER_MINUTE = 60;
export const METER_MAX_AGE_MS = 2_000;

/** Credits one call costs (twelvedata.com/pricing "API credits", Nov 2026). A batched quote or series costs one credit per symbol. */
const PER_CALL: Record<string, number> = { statistics: 50, earnings: 20, splits: 20, income_statement: 100, cash_flow: 100, balance_sheet: 100, dividends: 20, profile: 10, logo: 1, api_usage: 1, symbol_search: 1 };
export function creditCost(path: string, params: Record<string, string> = {}): number {
  const fixed = PER_CALL[path];
  if (fixed !== undefined) return fixed;
  const symbols = (params.symbol ?? "").split(",").filter(Boolean).length;
  return Math.max(1, symbols); // quote, time_series, eod, price: one credit per symbol
}

export type Meter = { used: number | null; at: number };
export type Governor = {
  /** True (and the credits are counted) when the call may be sent now. Never waits. `caller` (the provider path) labels the allocator's
   * per-minute summary only. */
  acquire(cost: number, tier: Tier, caller?: string): Promise<boolean>;
  /** The provider answered 429: nothing more this minute except critical calls. */
  limited(): void;
  /** Credits sent outside acquire (the meter read itself). */
  record(cost: number): void;
  estimate(): number | null;
};

const minuteOf = (t: number) => Math.floor(t / 60_000);

export function createGovernor({ readMeter, now = Date.now, perMinute = INSTANCE_PER_MINUTE, burst = INSTANCE_BURST,
  unknownPerMinute = UNKNOWN_METER_PER_MINUTE, meterMaxAgeMs = METER_MAX_AGE_MS, maxCost = Infinity }: {
  readMeter: () => Promise<Meter | null>; now?: () => number; perMinute?: number; burst?: number; unknownPerMinute?: number; meterMaxAgeMs?: number; maxCost?: number;
}): Governor {
  let tokens = burst, unknownTokens = Math.min(burst, unknownPerMinute), refilledAt = now();
  let meter: (Meter & { checkedAt: number }) | null = null;
  let reading: Promise<void> | null = null;
  let blockedUntil = 0;
  let othersPerMs = 0; // credits a millisecond spent by everyone but this instance (the monitor, other instances), from the last readings
  const spends: { at: number; cost: number }[] = [];

  const refill = () => {
    const t = now(), minutes = Math.max(0, t - refilledAt) / 60_000;
    tokens = Math.min(burst, tokens + minutes * perMinute);
    unknownTokens = Math.min(burst, unknownTokens + minutes * unknownPerMinute);
    refilledAt = t;
  };
  const localSince = (from: number) => {
    const start = minuteOf(now()) * 60_000;
    while (spends.length && spends[0].at < start) spends.shift();
    return spends.reduce((sum, s) => s.at >= Math.max(from, start) ? sum + s.cost : sum, 0);
  };
  const ensureMeter = async () => {
    const t = now();
    if (meter && t - meter.checkedAt < meterMaxAgeMs && minuteOf(meter.at) === minuteOf(t)) return;
    reading ??= readMeter()
      .then(m => {
        const next = { used: m?.used ?? null, at: m?.at ?? now(), checkedAt: now() };
        if (meter && meter.used !== null && next.used !== null && next.at > meter.at && minuteOf(meter.at) === minuteOf(next.at)) {
          const mine = spends.reduce((sum, s) => s.at >= meter!.at && s.at < next.at ? sum + s.cost : sum, 0);
          const observed = Math.max(0, next.used - meter.used - mine) / (next.at - meter.at);
          othersPerMs = 0.5 * othersPerMs + 0.5 * observed;
        }
        if (!meter || next.at >= meter.at) meter = next;
        else meter.checkedAt = next.checkedAt;
      })
      .catch(() => { meter = { used: null, at: now(), checkedAt: now() }; })
      .finally(() => { reading = null; });
    await reading;
  };
  /** The minute's usage now: the last reading (none from an earlier minute: the provider's count starts again each minute), what everyone
   * else is expected to have spent since at their recent rate, and this instance's own spending since. */
  const parts = () => {
    if (!meter || meter.used === null || !Number.isFinite(meter.used)) return null;
    const t = now(), sameMinute = minuteOf(meter.at) === minuteOf(t), since = sameMinute ? meter.at : minuteOf(t) * 60_000;
    return { others: (sameMinute ? meter.used : 0) + othersPerMs * (t - since), mine: localSince(since) };
  };
  const estimate = (): number | null => { const p = parts(); return p ? p.others + p.mine : null; };
  return {
    async acquire(cost, tier) {
      if (cost <= 0) return true;
      if (cost > maxCost) return false;
      if (now() < blockedUntil && tier !== "critical") return false;
      await ensureMeter();
      refill();
      // A call larger than the burst may go once the bucket is full; the debt is paid back before the next one.
      if (tokens < Math.min(cost, burst)) return false;
      const p = parts();
      if (p === null) {
        if (unknownTokens < Math.min(cost, burst)) return false;
        unknownTokens -= cost;
      } else {
        if (p.others + p.mine + cost > CEILING[tier]) return false;
        if (tier !== "critical" && p.mine + cost > Math.max(MIN_SHARE, SHARE * (CEILING[tier] - p.others))) return false;
      }
      tokens -= cost;
      spends.push({ at: now(), cost });
      return true;
    },
    limited() { blockedUntil = (minuteOf(now()) + 1) * 60_000 + 1_000; },
    record(cost) { if (cost > 0) spends.push({ at: now(), cost }); },
    estimate,
  };
}

/** When the monitor's allocator cannot be reached: an instance sends at most this much a minute, one or two symbols at a time, and only
 * while the shared meter leaves room. The site shows its last good copies meanwhile. */
export const EMERGENCY_PER_MINUTE = 4;
export const EMERGENCY_BURST = 2;
export const ALLOCATOR_RETRY_MS = 10_000;
/** lease: asks the central allocator; true / false is its answer, null means it could not be reached (then the emergency fallback
 * decides, and the allocator is asked again after ALLOCATOR_RETRY_MS). */
export function createLeaseGovernor({ lease, fallback, now = Date.now }: {
  lease: (cost: number, tier: Tier, caller?: string) => Promise<boolean | null>; fallback: Governor; now?: () => number;
}): Governor {
  let downUntil = 0, blockedUntil = 0;
  return {
    async acquire(cost, tier, caller) {
      if (cost <= 0) return true;
      if (now() < blockedUntil && tier !== "critical") return false;
      if (now() >= downUntil) {
        const answer = await lease(cost, tier, caller).catch(() => null);
        if (answer !== null) return answer;
        downUntil = now() + ALLOCATOR_RETRY_MS;
      }
      return fallback.acquire(cost, tier);
    },
    limited() { blockedUntil = (minuteOf(now()) + 1) * 60_000 + 1_000; fallback.limited(); },
    record(cost) { fallback.record(cost); },
    estimate: () => fallback.estimate(),
  };
}

/** The allocator's rule, the same as scripts/research/twelve_allocator.py (used by the load simulation): usage = the meter (read at most
 * every 3 s) + every credit granted or spent since 2 s before that reading (for the monitor's own jobs: since the reading); all or
 * nothing under the tier's ceiling. */
export function createAllocatorModel({ readMeter, now }: { readMeter: () => number | null; now: () => number }) {
  let meter: { used: number | null; at: number } | null = null;
  let events: { at: number; cost: number }[] = [];
  const usage = (overlapMs = 2_000) => {
    const t = now(), start = minuteOf(t) * 60_000;
    events = events.filter(e => e.at >= start);
    if (!meter || t - meter.at >= 3_000 || minuteOf(meter.at) !== minuteOf(t)) { meter = { used: readMeter(), at: now() }; if (meter.used !== null) events.push({ at: meter.at, cost: 1 }); }
    if (meter.used === null) return null;
    const same = minuteOf(meter.at) === minuteOf(t), since = same ? Math.max(meter.at - overlapMs, start) : start;
    return (same ? meter.used : 0) + events.reduce((sum, e) => e.at >= since ? sum + e.cost : sum, 0);
  };
  const asks = new Map<number, number>(), refused = new Map<number, number>();
  const add = (book: Map<number, number>, m: number, cost: number) => book.set(m, (book.get(m) ?? 0) + cost);
  return {
    usage,
    grant(cost: number, tier: Tier) {
      const used = usage(), m = minuteOf(now());
      if (tier === "user") add(asks, m, cost);
      const ok = used !== null && used + cost <= tierCeiling(tier, memberReserve(asks, refused, m));
      if (!ok) { if (tier === "user") add(refused, m, cost); return false; }
      events.push({ at: now(), cost }); return true;
    },
    record(cost: number) { events.push({ at: now(), cost }); },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The shared reader: fresh copy of this time slot (memory, then the cross-instance store) -> one read for everyone (in-flight shared)
// -> the last good copy (with its own time). A read that is refused or fails is never stored, so the next slot tries again.

export type Entry<T> = { value: T; at: number };
export type Result<T> = Entry<T> & { fresh: boolean };
/** The cross-instance store (the Next.js data cache in production). put keeps the first entry of a slot. */
export type SlotStore = {
  peek(name: string, key: string, slot: number): Promise<Entry<unknown> | null>;
  put(name: string, key: string, slot: number, entry: Entry<unknown>): Promise<void>;
};
/** name: the kind of data; slotMs: how long a copy counts as fresh; staleMs: how old a copy may be when nothing fresher can be had. */
/** `durable`: the copies are also kept by a DurableStore (the monitor, lib/research/twelve-copies.ts) and read back from it when the
 * cross-instance store has lost them (production, Nov 26: Vercel's runtime cache lost costly copies within hours). */
/** `swr` (speed, Nov 26): when this slot has no copy yet but an earlier one exists, the reader answers with the earlier copy at once and
 * reads the new slot in the background (the same single read the request would have waited for: no extra provider call). */
export type ReadSpec = { name: string; slotMs: number; staleMs: number; durable?: boolean; swr?: boolean };
/** A store that keeps the newest copy per name and key for weeks (a miss or a failure is null; never throws to the reader). */
export type DurableStore = {
  get(name: string, key: string): Promise<Entry<unknown> | null>;
  put(name: string, key: string, entry: Entry<unknown>): Promise<void>;
};
const COARSE_MS = 3_600_000;
/** A daily copy as well (production QA, Nov 24): under load, a chart or a stock page's period change that no instance had read in the last two
 * hours answered 503 although a copy from earlier that day or the day before existed. Kept within staleMs like every other last good copy;
 * it costs one store write per save and no provider call. */
const DAILY_MS = 86_400_000;
/** A fixed offset in [0, slotMs) from the key's text (FNV-1a). */
function offset(text: string, slotMs: number) { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h % slotMs; }
const MEMORY_LIMIT = 20_000;

/** `background`: keeps a refresh started for a stale answer running after the answer is sent (the serverless platform's waitUntil). */
export function createReader(store: SlotStore, now: () => number = Date.now, durable: DurableStore | null = null, background: (work: Promise<unknown>) => void = () => {}) {
  const memory = new Map<string, Entry<unknown>>();
  const inflight = new Map<string, Promise<Entry<unknown> | null>>();
  const id = (spec: ReadSpec, key: string) => `${spec.name}|${key}`;
  const slotName = (spec: ReadSpec) => `${spec.name}@${spec.slotMs}`;
  // Each key's slots start at its own offset, the same on every instance: copies do not all expire at :00, so the provider is not asked
  // for every symbol in the same second of every minute (the meter is a few seconds old; a synchronized burst would outrun it).
  const slotOf = (spec: ReadSpec, key: string, t: number) => Math.floor((t + offset(id(spec, key), spec.slotMs)) / spec.slotMs);
  const remember = (spec: ReadSpec, key: string, entry: Entry<unknown>) => {
    const k = id(spec, key), old = memory.get(k);
    if (old && old.at > entry.at) return;
    memory.delete(k); memory.set(k, entry);
    if (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value!);
  };
  const quiet = async <T>(work: Promise<T>): Promise<T | null> => { try { return await work; } catch { return null; } };

  async function fresh<T>(spec: ReadSpec, key: string): Promise<Entry<T> | null> {
    const t = now(), m = memory.get(id(spec, key));
    if (m && t - m.at < spec.slotMs && m.at <= t) return m as Entry<T>;
    const hit = await quiet(store.peek(slotName(spec), key, slotOf(spec, key, t)));
    if (hit && t - hit.at < spec.slotMs) { remember(spec, key, hit); return hit as Entry<T>; }
    if (spec.durable && durable) {
      // Kept in memory either way, so the last-good-copy lookup below finds it without asking again.
      const kept = await quiet(durable.get(spec.name, key));
      if (kept && Number.isFinite(kept.at) && kept.at <= t) {
        remember(spec, key, kept);
        if (t - kept.at < spec.slotMs) return kept as Entry<T>;
      }
    }
    return null;
  }
  async function stale<T>(spec: ReadSpec, key: string): Promise<Entry<T> | null> {
    const t = now(), s = slotOf(spec, key, t), c = Math.floor(t / COARSE_MS), d = Math.floor(t / DAILY_MS);
    const found = [memory.get(id(spec, key)) ?? null, ...await Promise.all([
      quiet(store.peek(slotName(spec), key, s - 1)), quiet(store.peek(slotName(spec), key, s - 2)),
      quiet(store.peek(`${spec.name}~h`, key, c)), quiet(store.peek(`${spec.name}~h`, key, c - 1)),
      quiet(store.peek(`${spec.name}~d`, key, d)), quiet(store.peek(`${spec.name}~d`, key, d - 1)),
    ])].filter((e): e is Entry<unknown> => !!e && t - e.at <= spec.staleMs).sort((a, b) => b.at - a.at)[0];
    if (found) remember(spec, key, found);
    return (found as Entry<T>) ?? null;
  }
  async function save(spec: ReadSpec, key: string, entry: Entry<unknown>) {
    remember(spec, key, entry);
    await Promise.all([
      ...(spec.durable && durable ? [quiet(durable.put(spec.name, key, entry))] : []),
      quiet(store.put(slotName(spec), key, slotOf(spec, key, entry.at), entry)),
      quiet(store.put(`${spec.name}~h`, key, Math.floor(entry.at / COARSE_MS), entry)),
      quiet(store.put(`${spec.name}~d`, key, Math.floor(entry.at / DAILY_MS), entry)),
    ]);
  }
  const startFetch = <T>(spec: ReadSpec, key: string, run: () => Promise<Entry<T> | null>) => {
    const k = id(spec, key), running = inflight.get(k);
    if (running) return running as Promise<Entry<T> | null>;
    const promise = run().catch(() => null).finally(() => inflight.delete(k));
    inflight.set(k, promise);
    return promise;
  };

  return {
    /** One key. `fetch` null: never call the provider (a cached or last good copy only). */
    async read<T>(spec: ReadSpec, key: string, fetch: (() => Promise<T>) | null): Promise<Result<T> | null> {
      const f = await fresh<T>(spec, key);
      if (f) return { ...f, fresh: true };
      if (fetch || inflight.has(id(spec, key))) {
        const run = () => startFetch<T>(spec, key, async () => {
          if (!fetch) return null;
          // Another instance may have read this slot meanwhile (a background refresh starts a moment after the miss).
          const filled = await fresh<T>(spec, key);
          if (filled) return filled;
          const entry = { value: await fetch(), at: now() };
          await save(spec, key, entry);
          return entry;
        });
        if (spec.swr) {
          const earlier = await stale<T>(spec, key);
          if (earlier) { background(run()); return { ...earlier, fresh: false }; }
        }
        const got = await run();
        if (got) return { ...got, fresh: true };
      }
      const s = await stale<T>(spec, key);
      return s ? { ...s, fresh: false } : null;
    },
    /** Many keys, fetched together in chunks (one multi-symbol call each) and at most `maxFetch` of them for this request, never-read and
     * oldest first; a key the provider does not return is stored as null (asked again next slot, not on every request). */
    async readMany<T>(spec: ReadSpec, keys: string[], fetchMany: ((keys: string[]) => Promise<Map<string, T | null>>) | null,
      { chunk = 12, maxFetch = Infinity }: { chunk?: number; maxFetch?: number } = {}): Promise<Record<string, Result<T | null>>> {
      const out: Record<string, Result<T | null>> = {};
      const wanted = [...new Set(keys)];
      const hits = await Promise.all(wanted.map(k => fresh<T | null>(spec, k)));
      const missing = wanted.filter((k, i) => { if (hits[i]) { out[k] = { ...hits[i]!, fresh: true }; return false; } return true; });
      // swr: a key with an earlier copy is answered with it at once; its read (already running, or started below) continues in the background.
      const earlier = spec.swr ? await Promise.all(missing.map(k => stale<T | null>(spec, k))) : [];
      const answered = new Set<string>();
      if (spec.swr) missing.forEach((k, i) => { const e = earlier[i]; if (e) { out[k] = { ...e, fresh: false }; answered.add(k); } });
      const waiting = missing.filter(k => inflight.has(id(spec, k)) && !answered.has(k));
      const age = (k: string) => memory.get(id(spec, k))?.at ?? -Infinity;
      const toFetch = fetchMany ? missing.filter(k => !inflight.has(id(spec, k))).sort((a, b) => age(a) - age(b)).slice(0, Math.max(0, maxFetch)) : [];
      const jobs: Promise<unknown>[] = waiting.map(k => inflight.get(id(spec, k))!.then(e => { if (e) out[k] = { ...e as Entry<T | null>, fresh: true }; }));
      const later: Promise<unknown>[] = [];
      for (let i = 0; i < toFetch.length; i += chunk) {
        const group = toFetch.slice(i, i + chunk);
        const batch = (async () => {
          const values = await fetchMany!(group);
          const at = now();
          await Promise.all(group.map(k => save(spec, k, { value: values.get(k) ?? null, at })));
          return at;
        })();
        batch.catch(() => undefined);
        for (const k of group) {
          const job = startFetch<T | null>(spec, k, async () => {
            const at = await batch;
            return memory.get(id(spec, k)) as Entry<T | null> ?? { value: null, at };
          });
          if (answered.has(k)) later.push(job); else jobs.push(job.then(e => { if (e) out[k] = { ...e, fresh: true }; }));
        }
      }
      if (later.length) background(Promise.all(later));
      await Promise.all(jobs);
      await Promise.all(wanted.filter(k => !out[k]).map(async k => { const s = await stale<T | null>(spec, k); if (s) out[k] = { ...s, fresh: false }; }));
      return out;
    },
    /** Stores a copy read outside the reader (the optional 15-second refresh). */
    save: (spec: ReadSpec, key: string, entry: Entry<unknown>) => save(spec, key, entry),
    /** The age of this instance's last copy (Infinity when none). */
    age: (spec: ReadSpec, key: string) => now() - (memory.get(id(spec, key))?.at ?? -Infinity),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// How long a copy counts as fresh. Prices move from 4:00 to 20:00 New York time on weekdays (pre-market and after-hours included);
// outside those hours a stock's quote and bars do not change, so they are read four times an hour at most. Currencies, crypto and
// metals (symbols with a "/") trade around the clock.

const NY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function stocksTrading(now: number): boolean {
  const parts = Object.fromEntries(NY.formatToParts(new Date(now)).map(p => [p.type, p.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 4 * 60 && minutes < 20 * 60;
}
export const QUOTE_SLOT_MS = 60_000;
export const CLOSED_SLOT_MS = 15 * 60_000;
export const quoteSlotMs = (symbol: string, now: number) => symbol.includes("/") || stocksTrading(now) ? QUOTE_SLOT_MS : CLOSED_SLOT_MS;
/** Bars: intraday candles one minute (the live price comes from the quote), daily and longer ten minutes; closed hours fifteen / sixty. */
export function barSlotMs(symbol: string, interval: string, now: number): number {
  const intraday = /min|h$/.test(interval);
  const open = symbol.includes("/") || stocksTrading(now);
  return intraday ? (open ? 60_000 : CLOSED_SLOT_MS) : (open ? 10 * 60_000 : 60 * 60_000);
}
/** The optional 15-second quote refresh (the watchlist and a stock's page, fast=1): a copy older than 15 seconds is read again through
 * the shared reader with its own 15-second slot, so one provider read per symbol and slot serves every member and instance (before, each
 * request read its own up to 12 symbols again). The instance that reads also stores the quote as the one-minute copy, so the minute's
 * readers do not read it again. At most FAST_MAX_PER_REQUEST symbols a request. `granted`: every symbol asked got this slot's copy. */
export const FAST_SLOT_MS = 15_000;
export const FAST_MAX_PER_REQUEST = 12;
export const fastQuoteSpec: ReadSpec = { name: "md-quote-fast-v1", slotMs: FAST_SLOT_MS, staleMs: 60_000 };
export async function fastRefresh<T>(reader: ReturnType<typeof createReader>, mainSpec: ReadSpec, got: Record<string, Result<T | null>>,
  fetchFast: (keys: string[]) => Promise<Map<string, T | null>>, now: () => number = Date.now): Promise<{ got: Record<string, Result<T | null>>; granted: boolean }> {
  const older = Object.keys(got).filter(t => got[t].fresh && got[t].value && now() - got[t].at >= FAST_SLOT_MS).slice(0, FAST_MAX_PER_REQUEST);
  if (!older.length) return { got, granted: true };
  const read = await reader.readMany<T>(fastQuoteSpec, older, async keys => {
    const values = await fetchFast(keys), at = now();
    await Promise.all(keys.map(k => { const value = values.get(k); return value ? reader.save(mainSpec, k, { value, at }) : null; }));
    return values;
  }, { chunk: FAST_MAX_PER_REQUEST, maxFetch: FAST_MAX_PER_REQUEST });
  const out = { ...got };
  let granted = true;
  for (const t of older) {
    const hit = read[t];
    if (hit?.fresh && hit.value && now() - hit.at < FAST_SLOT_MS) { if (hit.at > out[t].at) out[t] = { value: hit.value, at: hit.at, fresh: true }; }
    else granted = false;
  }
  return { got: out, granted };
}
/** At most this many quote symbols / bar series a single request may send to the provider; the rest show their last good copy. */
export const MAX_QUOTES_PER_REQUEST = 24;
export const MAX_SPARKLINES_PER_REQUEST = 8;
export const STALE_LIMIT_MS = 3 * 86_400_000;
