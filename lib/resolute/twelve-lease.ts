/** RESOLUTE's door to the Twelve Data plan (610 credits a minute, shared with the website and the research monitor).
 *
 * Every RESOLUTE job (closing-price alerts, the daily Twelve Data prefetch, 「今日やること」, the thermometer) asks before it sends a call:
 *  1. Its own pace: at most `perMinute` credits in any rolling minute for this process, whatever the allocator says, so a job never
 *     bursts (a thermometer of 140 symbols is spread over two minutes instead of sent back to back).
 *  2. The monitor's central allocator (scripts/research/twelve_allocator.py, POST /twelve/lease) with RESOLUTE's own token: the one
 *     place that sees every credit of the minute. A refusal is waited out (the minute's count starts again every minute), never
 *     sent anyway; a 429 from the provider pauses the job to the next minute. Nothing is retried: a call that is not granted before the
 *     job's deadline is simply not made, and the caller treats it like a failed read (no close, no split: nothing is guessed).
 *  3. When the allocator is not configured or cannot be reached, the job keeps only its own pace, lowered to FALLBACK_PER_MINUTE.
 *
 * No key, token or URL is ever printed. Pure apart from `fetch` and the clock, both injectable. */

export type LeaseTier = "critical" | "warm" | "background";
export const LEASE_TIERS: readonly LeaseTier[] = ["critical", "warm", "background"];
/** The allocator never grants more than this in one lease (twelve_allocator.MAX_COST). Callers batch below it. */
export const MAX_LEASE_COST = 120;
/** Without the allocator a RESOLUTE job sends at most this much a minute (the site's members keep the rest of the plan). */
export const FALLBACK_PER_MINUTE = 60;
/** How long a refused lease waits before asking again (the allocator's minute may have room after the meter moves). */
export const REFUSED_WAIT_MS = 3_000;
const WINDOW_MS = 60_000;
/** Within the minute the pace is smooth too: at most a sixth of it (or one call) in any ten seconds. */
const BURST_MS = 10_000;

export type TwelveLease = {
  /** True when `cost` credits may be sent now (counted). Waits for room up to the deadline; false after it. Never throws. */
  take(cost: number, caller: string): Promise<boolean>;
  /** The provider answered 429: nothing more is sent until the next minute. */
  limited(): void;
  /** Credits taken so far, and how they were decided (for the run's report: counts only). */
  report(): { credits: number; leases: number; refused: number; mode: "allocator" | "local" | "unpaced" };
};

type Fetcher = (input: URL, init?: RequestInit) => Promise<Response>;
export type LeaseOptions = {
  tier: LeaseTier;
  perMinute: number;
  /** Absolute time (ms) after which nothing more is taken. */
  deadline?: number;
  url?: string | null;
  token?: string | null;
  fetcher?: Fetcher;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const realSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** The allocator's address: an https origin (http only for localhost), no credentials in it. */
export function leaseEndpoint(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return null;
    url.pathname = `${url.pathname.replace(/\/$/, "")}/twelve/lease`; url.search = ""; url.hash = "";
    return url;
  } catch { return null; }
}

export function createTwelveLease(options: LeaseOptions): TwelveLease {
  const now = options.now ?? Date.now, sleep = options.sleep ?? realSleep, fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const endpoint = options.token && options.token.length >= 32 ? leaseEndpoint(options.url) : null;
  let allocator = endpoint !== null;
  let perMinute = allocator ? options.perMinute : Math.min(options.perMinute, FALLBACK_PER_MINUTE);
  const spends: { at: number; cost: number }[] = [];
  let pausedUntil = 0, credits = 0, leases = 0, refused = 0;
  const deadline = options.deadline ?? Infinity;
  const used = (t: number) => { while (spends.length && spends[0].at <= t - WINDOW_MS) spends.shift(); return spends.reduce((sum, s) => sum + s.cost, 0); };
  /** Waits until `ms` from now unless that passes the deadline (then false). */
  const wait = async (ms: number) => { if (now() + ms > deadline) return false; await sleep(Math.max(1, ms)); return true; };

  async function ask(cost: number, caller: string): Promise<boolean | null> {
    try {
      const response = await fetcher(endpoint!, { method: "POST", headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ cost, tier: options.tier, caller }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3_000) });
      if (!response.ok) { await response.body?.cancel(); return null; }
      const body = await response.json().catch(() => null) as { ok?: unknown; granted?: unknown } | null;
      return body?.ok === true ? body.granted === true : null;
    } catch { return null; }
  }

  return {
    async take(cost, caller) {
      if (!Number.isInteger(cost) || cost <= 0 || cost > MAX_LEASE_COST || cost > perMinute) return false;
      for (;;) {
        const t = now();
        if (t > deadline) return false;
        if (t < pausedUntil) { if (!await wait(pausedUntil - t)) return false; continue; }
        // 1. Own pace: at most a sixth of the minute (or this one call) in any ten seconds, and `perMinute` in any minute.
        const recent = spends.filter(s => s.at > t - BURST_MS);
        const burst = Math.max(cost, Math.floor(perMinute / 6));
        if (recent.length && recent.reduce((sum, s) => sum + s.cost, 0) + cost > burst) {
          let freed = recent.reduce((sum, s) => sum + s.cost, 0), until = t;
          for (const s of recent) { if (freed + cost <= burst) break; freed -= s.cost; until = s.at + BURST_MS; }
          if (!await wait(until - t + 1)) return false;
          continue;
        }
        if (used(t) + cost > perMinute) {
          let freed = used(t), until = t;
          for (const s of spends) { if (freed + cost <= perMinute) break; freed -= s.cost; until = s.at + WINDOW_MS; }
          if (!await wait(until - t + 1)) return false;
          continue;
        }
        // 2. The allocator.
        if (allocator) {
          const answer = await ask(cost, /^[a-z][a-z0-9_-]{0,31}$/.test(caller) ? caller : "resolute");
          if (answer === null) { allocator = false; perMinute = Math.min(perMinute, FALLBACK_PER_MINUTE); continue; }
          if (!answer) { refused++; if (!await wait(REFUSED_WAIT_MS)) return false; continue; }
        }
        spends.push({ at: now(), cost }); credits += cost; leases++;
        return true;
      }
    },
    limited() { pausedUntil = (Math.floor(now() / WINDOW_MS) + 1) * WINDOW_MS + 1_000; },
    report: () => ({ credits, leases, refused, mode: allocator ? "allocator" : "local" }),
  };
}

/** No pace and no allocator: for tests and pure callers that inject their own fetcher. Production entry points use leaseFromEnv. */
export function unpacedLease(): TwelveLease {
  let credits = 0, leases = 0;
  return { async take(cost) { if (!Number.isInteger(cost) || cost <= 0 || cost > MAX_LEASE_COST) return false; credits += cost; leases++; return true; }, limited() {}, report: () => ({ credits, leases, refused: 0, mode: "unpaced" }) };
}

/** The lease for a production job, from its environment: RESOLUTE_TWELVE_LEASE_URL (the monitor's origin; the push monitor's origin
 * RESOLUTE_PUSH_MONITOR_URL when unset) and RESOLUTE_TWELVE_LEASE_TOKEN. Without them the job keeps its own pace at FALLBACK_PER_MINUTE. */
export function leaseFromEnv(env: Record<string, string | undefined>, options: Omit<LeaseOptions, "url" | "token">): TwelveLease {
  return createTwelveLease({ ...options, url: env.RESOLUTE_TWELVE_LEASE_URL || env.RESOLUTE_PUSH_MONITOR_URL || null, token: env.RESOLUTE_TWELVE_LEASE_TOKEN || null });
}
