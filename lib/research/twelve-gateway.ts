import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { unstable_cache } from "next/cache";
import { EMERGENCY_BURST, EMERGENCY_PER_MINUTE, createGovernor, createLeaseGovernor, createReader, creditCost, type Entry, type SlotStore, type Tier } from "./twelve-budget.ts";
import { parseUsage } from "./quote-refresh-gate.ts";

/** The website's one door to Twelve Data for what members open (price screens, a stock's page, the portfolio, theme ranking). Every call
 * asks the governor first (lib/research/twelve-budget.ts) and is never retried; a refused or failed call throws, and the readers behind it
 * show the last good copy. The key (TWELVE_DATA_API_KEY) never reaches the browser or the log. */

const BASE = () => process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com";
export const twelveConfigured = () => !!process.env.TWELVE_DATA_API_KEY;

export class TwelveBudgetError extends Error { constructor() { super("twelve-budget"); } }
export const isBudgetError = (error: unknown) => error instanceof TwelveBudgetError;

// The provider's meter, read at most once per four-second slot for every instance (the data cache shares it), one credit a read.
const METER_SLOT_MS = 4_000;
async function readUsage(): Promise<{ used: number | null; at: number }> {
  const key = process.env.TWELVE_DATA_API_KEY;
  const at = Date.now();
  if (!key) return { used: null, at };
  governor.record(1);
  try {
    const response = await fetch(`${BASE()}/api_usage?apikey=${encodeURIComponent(key)}`, { cache: "no-store", signal: AbortSignal.timeout(2_000) });
    return { used: response.ok ? parseUsage(await response.json().catch(() => null)) : null, at };
  } catch { return { used: null, at }; }
}
const meterCallback = async (slot: number) => { void slot; const m = await readUsage(); if (m.used === null) throw new Error("meter-unreadable"); return m; };
meterCallback.toString = () => "twelve-meter-v1";
const sharedMeter = unstable_cache(meterCallback, ["twelve-meter-v1"], { revalidate: 60 });

/** The monitor's allocator (scripts/research/twelve_allocator.py, POST /twelve/lease) with the site's existing monitor address and server
 * token (RESEARCH_MONITOR_URL / RESEARCH_MONITOR_TOKEN). null: not configured or not reachable. */
async function lease(cost: number, tier: Tier, caller?: string): Promise<boolean | null> {
  const base = process.env.RESEARCH_MONITOR_URL, token = process.env.RESEARCH_MONITOR_TOKEN;
  if (!base || !token) return null;
  try {
    const url = new URL(base);
    if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)))) return null;
    url.pathname = `${url.pathname.replace(/\/$/, "")}/twelve/lease`; url.search = ""; url.hash = "";
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ cost, tier, ...(caller ? { caller } : {}) }), cache: "no-store", signal: AbortSignal.timeout(1_500) });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null) as { ok?: unknown; granted?: unknown } | null;
    return body?.ok === true ? body.granted === true : null;
  } catch { return null; }
}
/** Only when the allocator cannot be reached: a tiny allowance per instance, one or two symbols at a time, under the shared meter. */
const emergency = createGovernor({
  readMeter: async () => {
    try { return await sharedMeter(Math.floor(Date.now() / METER_SLOT_MS)); }
    catch { return null; } // unreadable (not stored): an unknown meter limits this instance further
  },
  perMinute: EMERGENCY_PER_MINUTE, burst: EMERGENCY_BURST, unknownPerMinute: EMERGENCY_PER_MINUTE, maxCost: EMERGENCY_BURST,
});
export const governor = createLeaseGovernor({ lease, fallback: emergency });

/** The provider's count for this minute from the shared reading, or null. */
export async function sharedMeterUsage(): Promise<number | null> {
  try { return (await sharedMeter(Math.floor(Date.now() / METER_SLOT_MS))).used; } catch { return null; }
}

/** Throws TwelveBudgetError unless the credits may be spent now under `tier`. `caller` (the provider path) labels the allocator's
 * per-minute summary, the measurement of credits by caller. */
export async function reserveCredits(cost: number, tier: Tier = "user", caller?: string) {
  if (!await governor.acquire(cost, tier, caller)) throw new TwelveBudgetError();
}
/** Call after a 429 from the provider. */
export const providerLimited = () => governor.limited();

/** One governed call: no retry, no wait. Throws on refusal, an error answer or a timeout. */
export async function twelveCall(path: string, params: Record<string, string>, { tier = "user", timeoutMs = 12_000 }: { tier?: Tier; timeoutMs?: number } = {}): Promise<unknown> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  await reserveCredits(creditCost(path, params), tier, path);
  const url = new URL(`${BASE()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", key);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => null) as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (response.status === 429 || body?.code === 429) { providerLimited(); throw new Error(`twelve-data ${path} 429`); }
  if (!response.ok || !body || body.status === "error") throw new Error(`twelve-data ${path} ${response.status} ${String(body?.code ?? "")} ${String(body?.message ?? "").replace(/apikey=[^&"\s]*/gi, "").slice(0, 120)}`);
  return body;
}

// The cross-instance store: one data-cache entry per name, key and slot. The callback only stores the value it is handed (`put`); a peek
// outside `put` finds the entry or misses (nothing is fetched inside the cache).
class CacheMiss extends Error { constructor() { super("cache-miss"); } }
const handing = new AsyncLocalStorage<{ entry: Entry<unknown> }>();
const stores = new Map<string, (key: string, slot: number) => Promise<Entry<unknown>>>();
const storeFor = (name: string) => {
  let store = stores.get(name);
  if (!store) {
    const callback = async (key: string, slot: number) => { void key; void slot; const given = handing.getStore(); if (!given) throw new CacheMiss(); return given.entry; };
    callback.toString = () => `twelve-slot:${name}`; // a fixed text keeps the entries across deployments (the key includes it)
    store = unstable_cache(callback, ["twelve-slot-v1", name], { revalidate: 2 * 86_400 });
    stores.set(name, store);
  }
  return store;
};
const dataCache: SlotStore = {
  async peek(name, key, slot) {
    try { return await storeFor(name)(key, slot); } catch (error) { if (!(error instanceof CacheMiss)) console.warn(`twelve cache ${name}: ${error instanceof Error ? error.message : "unreadable"}`); return null; }
  },
  async put(name, key, slot, entry) { await handing.run({ entry }, () => storeFor(name)(key, slot)); },
};
export const sharedReader = createReader(dataCache);
