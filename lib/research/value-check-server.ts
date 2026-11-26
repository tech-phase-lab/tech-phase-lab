import "server-only";
import { unstable_cache } from "next/cache";
import { parseValueFigures, parseValueSnapshot, type ValueSnapshot } from "./value-check";
import { valueSnapshotWithNames } from "./company-display-names";

/** トレジャーハント: the ranking is computed once a day after the close by the research monitor (scripts/research/value_check.py), so a
 * member's request never needs a fresh copy. Owner, Nov 26: the screen took seconds (page → membership check in the browser → this API
 * → the monitor, one after the other). Now one shared copy is kept here: a request reads it at once, and once it is REVALIDATE_SECONDS
 * old the next request still gets it at once while a new copy is read in the background (stale-while-revalidate). A failed read is
 * never stored (unstable_cache throws through), so the last good copy stays. The page draws it on the server (page.tsx); the API
 * (app/api/research/value-check) answers from the same copy. Membership is checked by the caller before this is read. */
export const VALUE_SNAPSHOT_REVALIDATE_SECONDS = 600;

export class ValueSnapshotUnavailable extends Error {
  constructor(readonly reason: "not-connected" | "not-ready" | "unavailable") { super(reason); }
}

/** The monitor's /value-check, read straight (no copy). Throws ValueSnapshotUnavailable. */
export async function readValueSnapshotNow(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch): Promise<ValueSnapshot> {
  return valueSnapshotWithNames(parseValueSnapshot(await readMonitor("/value-check", 1_500_000, env, fetcher)));
}
/** The monitor's /value-check/values (the comparison's list, apart from the ranking so the ranking stays within the 1.5 MB the site in
 *  production accepts, whichever is deployed first; reviewer, Nov 26). Throws ValueSnapshotUnavailable. */
export async function readValueFiguresNow(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch) {
  try { return parseValueFigures(await readMonitor("/value-check/values", 4_000_000, env, fetcher)); }
  catch (error) { throw error instanceof ValueSnapshotUnavailable ? error : new ValueSnapshotUnavailable("unavailable"); }
}
async function readMonitor(path: string, limit: number, env: Record<string, string | undefined>, fetcher: typeof fetch): Promise<unknown> {
  const base = env.RESEARCH_MONITOR_URL, token = env.RESEARCH_MONITOR_TOKEN;
  if (!base || !token) throw new ValueSnapshotUnavailable("not-connected");
  let url: URL;
  try { url = new URL(base); } catch { throw new ValueSnapshotUnavailable("not-connected"); }
  if (url.username || url.password || (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new ValueSnapshotUnavailable("not-connected");
  url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`; url.search = ""; url.hash = "";
  let response: Response;
  try { response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8000) }); }
  catch { throw new ValueSnapshotUnavailable("unavailable"); }
  if (response.status === 503) throw new ValueSnapshotUnavailable("not-ready");
  if (!response.ok) throw new ValueSnapshotUnavailable("unavailable");
  const body = await response.text();
  if (new TextEncoder().encode(body).length > limit) throw new ValueSnapshotUnavailable("unavailable");
  try { return JSON.parse(body); } catch { throw new ValueSnapshotUnavailable("unavailable"); }
}

/** A fixed name keeps the shared copy across deployments (unstable_cache otherwise keys on the callback's source text). v3 (Nov 26): the
 * ranking alone; the comparison's list is its own copy below. */
const readShared = async () => readValueSnapshotNow();
readShared.toString = () => "value-check-snapshot-v3";
const shared = unstable_cache(readShared, ["value-check-snapshot-v3"], { revalidate: VALUE_SNAPSHOT_REVALIDATE_SECONDS });

const readSharedValues = async () => readValueFiguresNow();
readSharedValues.toString = () => "value-check-values-v1";
const sharedValues = unstable_cache(readSharedValues, ["value-check-values-v1"], { revalidate: VALUE_SNAPSHOT_REVALIDATE_SECONDS });

/** The shared copy (see above) with the comparison's list from /value-check/values when it describes the same close. Throws
 *  ValueSnapshotUnavailable when there is no ranking and the monitor cannot give one; a missing list only leaves `values` out. */
export async function loadValueSnapshot(): Promise<ValueSnapshot> {
  const [ranking, figures] = await Promise.all([loadRanking(), sharedValues().catch(() => null)]);
  return figures && figures.asOf === ranking.asOf ? { ...ranking, values: figures.values } : ranking;
}
async function loadRanking(): Promise<ValueSnapshot> {
  try { return await shared(); } catch (error) {
    const reason = error instanceof ValueSnapshotUnavailable ? error.reason : (error as Error)?.message;
    throw new ValueSnapshotUnavailable(reason === "not-connected" || reason === "not-ready" ? reason : "unavailable");
  }
}

/** Treasure Hunt's own screen and API: the shared copy without the comparison's list (`values`, every calculated ticker), which only the
 * Stock Comparison reads; the ranking pages stay as small and fast as before. */
export async function loadValueRanking(): Promise<ValueSnapshot> {
  const { values, ...ranking } = await loadValueSnapshot();
  void values;
  return ranking;
}

/** Tells the monitor which companies a member just compared without a valuation figure, so its background worker reads them first
 * (scripts/research/compare_values.py want()). Only the order of the monitor's work changes: no provider call, nothing waits for it, and each
 * company is sent at most once an hour per instance. */
const asked = new Map<string, number>();
export async function requestValueFigures(tickers: string[], env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch): Promise<void> {
  const now = Date.now(), fresh = tickers.filter(t => /^[A-Z0-9.\-]{1,15}$/.test(t) && now - (asked.get(t) ?? 0) > 3_600_000).slice(0, 10);
  if (!fresh.length || !env.RESEARCH_MONITOR_URL || !env.RESEARCH_MONITOR_TOKEN) return;
  for (const t of fresh) asked.set(t, now);
  try {
    const url = new URL(env.RESEARCH_MONITOR_URL);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/value-check/want`; url.search = ""; url.hash = "";
    await fetcher(url, { method: "POST", headers: { Authorization: `Bearer ${env.RESEARCH_MONITOR_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: fresh }), cache: "no-store", signal: AbortSignal.timeout(3000) });
  } catch { /* the order of the monitor's work only */ }
}
