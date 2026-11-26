import "server-only";
import type { DurableStore, Entry } from "./twelve-budget.ts";
import { decodeValue, encodeValue } from "./twelve-copies-wire.ts";

/** Durable copies of the costly Twelve Data answers, kept by the Railway monitor (scripts/research/twelve_copies.py, POST /twelve/copies/get
 * and /twelve/copies/put) at the site's existing monitor address and server token (RESEARCH_MONITOR_URL / RESEARCH_MONITOR_TOKEN).
 *
 * Production, Nov 26: the Next.js data cache (Vercel's Runtime Cache, which Vercel describes as ephemeral and regional) lost the comparison's
 * daily statistics copies within hours. ASML and AVNT, stored at 00:21 UTC, and UNFI, stored at 03:30, were all missing at 08:00–08:05.
 * YUM (05:35) and SONO (07:51) were still there. The entries are about 2 KB, far below the 2 MB entry limit, and nothing in the site revalidates
 * a tag or a path. A lost copy cost 50 credits again on a member's request, and those refusals starved the warm job. The runtime cache stays the fast
 * first read; these copies are what is left when it has lost one. Any failure here is a miss and never an error. */

/** The kinds kept here (scripts/research/twelve_copies.py KINDS; a test keeps them equal). */
export const DURABLE_KINDS = ["compare-statistics", "compare-statements", "md-facts-stats-v2", "md-facts-next-earnings-v2", "portfolio-splits"] as const;
export type DurableKind = (typeof DURABLE_KINDS)[number];
const isKind = (name: string): name is DurableKind => (DURABLE_KINDS as readonly string[]).includes(name);

/** The monitor's address for `path`, or null when it is not configured (the same rules as the allocator's lease). */
export function monitorEndpoint(path: string): { url: URL; token: string } | null {
  const base = process.env.RESEARCH_MONITOR_URL, token = process.env.RESEARCH_MONITOR_TOKEN;
  if (!base || !token) return null;
  try {
    const url = new URL(base);
    if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)))) return null;
    url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`; url.search = ""; url.hash = "";
    return { url, token };
  } catch { return null; }
}

async function post(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  const target = monitorEndpoint(path);
  if (!target) return null;
  try {
    const response = await fetch(target.url, { method: "POST", headers: { Authorization: `Bearer ${target.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(1_500) });
    if (!response.ok) return null;
    const answer = await response.json().catch(() => null) as Record<string, unknown> | null;
    return answer?.ok === true ? answer : null;
  } catch { return null; }
}

/** The stored copies of these keys ({} when none, or when the monitor cannot be reached). */
export async function durableGet(kind: DurableKind, keys: string[]): Promise<Record<string, Entry<unknown>>> {
  if (!keys.length) return {};
  const answer = await post("/twelve/copies/get", { kind, keys: [...new Set(keys)].slice(0, 64) });
  const copies = answer?.copies;
  const out: Record<string, Entry<unknown>> = {};
  if (!copies || typeof copies !== "object") return out;
  for (const [key, copy] of Object.entries(copies as Record<string, { at?: unknown; value?: unknown }>)) {
    if (!copy || typeof copy.at !== "number" || !Number.isFinite(copy.at) || !("value" in copy)) continue;
    try { out[key] = { at: copy.at, value: decodeValue(copy.value) }; } catch { /* an unreadable copy is a miss */ }
  }
  return out;
}

/** Stores a copy (the monitor keeps the newest per kind and key). false when it could not be stored. */
export async function durablePut(kind: DurableKind, key: string, entry: Entry<unknown>): Promise<boolean> {
  const at = Math.round(entry.at), wire = encodeValue(entry.value);
  if (!wire) return false;
  if ("value" in wire) return (await post("/twelve/copies/put", { kind, key, at, value: wire.value }))?.stored === true;
  // In order; the monitor stores the value once the last part has arrived.
  let stored = false;
  for (const [part, chunk] of wire.chunks.entries()) {
    const answer = await post("/twelve/copies/put", { kind, key, at, part, parts: wire.chunks.length, chunk });
    if (!answer) return false;
    stored = answer.stored === true;
  }
  return stored;
}

/** The shared reader's durable side (lib/research/twelve-budget.ts createReader): only for a ReadSpec marked `durable`. */
export const durableCopies: DurableStore = {
  async get(name, key) { return isKind(name) ? (await durableGet(name, [key]))[key] ?? null : null; },
  async put(name, key, entry) { if (isKind(name)) await durablePut(name, key, entry); },
};
