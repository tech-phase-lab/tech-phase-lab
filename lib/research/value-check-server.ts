import "server-only";
import { unstable_cache } from "next/cache";
import { parseValueSnapshot, type ValueSnapshot } from "./value-check";
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
  const base = env.RESEARCH_MONITOR_URL, token = env.RESEARCH_MONITOR_TOKEN;
  if (!base || !token) throw new ValueSnapshotUnavailable("not-connected");
  let url: URL;
  try { url = new URL(base); } catch { throw new ValueSnapshotUnavailable("not-connected"); }
  if (url.username || url.password || (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new ValueSnapshotUnavailable("not-connected");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/value-check`; url.search = ""; url.hash = "";
  let response: Response;
  try { response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8000) }); }
  catch { throw new ValueSnapshotUnavailable("unavailable"); }
  if (response.status === 503) throw new ValueSnapshotUnavailable("not-ready");
  if (!response.ok) throw new ValueSnapshotUnavailable("unavailable");
  const body = await response.text();
  if (new TextEncoder().encode(body).length > 1_500_000) throw new ValueSnapshotUnavailable("unavailable");
  try { return valueSnapshotWithNames(parseValueSnapshot(JSON.parse(body))); } catch { throw new ValueSnapshotUnavailable("unavailable"); }
}

/** A fixed name keeps the shared copy across deployments (unstable_cache otherwise keys on the callback's source text). */
const readShared = async () => readValueSnapshotNow();
readShared.toString = () => "value-check-snapshot-v1";
const shared = unstable_cache(readShared, ["value-check-snapshot-v1"], { revalidate: VALUE_SNAPSHOT_REVALIDATE_SECONDS });

/** The shared copy (see above). Throws ValueSnapshotUnavailable when there is none and the monitor cannot give one. */
export async function loadValueSnapshot(): Promise<ValueSnapshot> {
  try { return await shared(); } catch (error) {
    const reason = error instanceof ValueSnapshotUnavailable ? error.reason : (error as Error)?.message;
    throw new ValueSnapshotUnavailable(reason === "not-connected" || reason === "not-ready" ? reason : "unavailable");
  }
}
