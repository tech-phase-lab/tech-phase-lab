import { getMembership } from "@/lib/membership/server";
import { parseWhaleSnapshot, whaleMovesAccess, whaleMovesEnabled, type WhaleSnapshot } from "@/lib/research/whale-moves";
import { whaleSnapshotWithNames } from "@/lib/research/company-display-names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status, headers });

/** The monitor's snapshot changes at most a few times a day (13F quarterly, FINRA twice a month, Form 4 and buybacks as filed), so one
 * copy per server instance is shared by every PRO request: younger than FRESH_MS it is served as is; older (up to KEEP_MS) it is still
 * served at once while one refresh runs behind it. Membership is still checked on every request before anything is sent. */
const FRESH_MS = 5 * 60_000, KEEP_MS = 6 * 3_600_000;
type Loaded = { kind: "ok"; snapshot: WhaleSnapshot } | { kind: "fail"; error: "not-connected" | "not-ready" | "unavailable" };
let cached: { snapshot: WhaleSnapshot; at: number } | null = null;
let loading: Promise<Loaded> | null = null;

async function loadFromMonitor(): Promise<Loaded> {
  const base = process.env.RESEARCH_MONITOR_URL, token = process.env.RESEARCH_MONITOR_TOKEN;
  if (!base || !token) return { kind: "fail", error: "not-connected" };
  const url = new URL(base);
  if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)))) return { kind: "fail", error: "not-connected" };
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ownership`; url.search = ""; url.hash = "";
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (response.status === 503) return { kind: "fail", error: "not-ready" };
  if (!response.ok) return { kind: "fail", error: "unavailable" };
  const body = await response.text();
  if (new TextEncoder().encode(body).length > 1_500_000) return { kind: "fail", error: "unavailable" };
  const snapshot = whaleSnapshotWithNames(parseWhaleSnapshot(JSON.parse(body)));
  cached = { snapshot, at: Date.now() };
  return { kind: "ok", snapshot };
}

/** One monitor request at a time per instance; a failed refresh keeps the last good copy. */
function refresh(): Promise<Loaded> {
  loading ??= loadFromMonitor().catch((): Loaded => ({ kind: "fail", error: "unavailable" })).finally(() => { loading = null; });
  return loading;
}

async function whaleSnapshot(): Promise<Loaded> {
  const age = cached ? Date.now() - cached.at : Infinity;
  if (cached && age < FRESH_MS) return { kind: "ok", snapshot: cached.snapshot };
  if (cached && age < KEEP_MS) { void refresh(); return { kind: "ok", snapshot: cached.snapshot }; }
  const loaded = await refresh();
  return loaded.kind === "fail" && cached ? { kind: "ok", snapshot: cached.snapshot } : loaded;
}

/** クジラの足あと (PRO; the owner's accounts always). Per-ticker totals from the research monitor (13F, FINRA, Form 4, buybacks). */
export async function GET() {
  try {
    // The membership check and (when no copy is held yet) the monitor request run side by side; nothing is sent before the check passes.
    const snapshot = whaleSnapshot();
    const member = await getMembership().catch(() => ({ status: "unavailable", plan: "free" }));
    const access = whaleMovesAccess(member, whaleMovesEnabled());
    if (access !== 200) return fail(access, access === 401 ? "sign-in" : access === 403 ? "pro-required" : access === 404 ? "not-found" : "unavailable");
    const loaded = await snapshot;
    if (loaded.kind === "fail") return fail(503, loaded.error);
    return Response.json(loaded.snapshot, { headers });
  } catch { return fail(503, "unavailable"); }
}
