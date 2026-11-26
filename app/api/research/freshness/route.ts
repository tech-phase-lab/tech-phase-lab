import { assessFreshness } from "@/lib/research/freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

// A few bytes for every page: browsers never download the monitor's full live state (owner, Oct 22).
const headers = {
  "Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
  "X-Content-Type-Options": "nosniff",
};

/** Speed, Nov 26: this answer took up to 10.7 s (p95, Vercel Nov 23–26) because the monitor's /live sometimes answers slowly and every
 * cache miss waited for it (up to 13 s). Now one read per instance is shared by the requests that arrive while it runs, a read younger
 * than FRESH_MS is reused, and a read is given READ_TIMEOUT_MS; when it is late, the last good state (at most KEEP_MS old) is assessed
 * again at the current time — its cycle age grows by the time since it was read, so a stalled monitor still shows as delayed. */
const FRESH_MS = 15_000, KEEP_MS = 10 * 60_000, READ_TIMEOUT_MS = 4_000;
type Live = { body: Record<string, unknown>; at: number };
let last: Live | null = null;
let reading: Promise<Live | null> | null = null;

function aged({ body, at }: Live, now: number): unknown {
  const monitor = body.monitor && typeof body.monitor === "object" ? body.monitor as Record<string, unknown> : null;
  if (!monitor || typeof monitor.lastCycleAgeSeconds !== "number") return body;
  return { ...body, monitor: { ...monitor, lastCycleAgeSeconds: monitor.lastCycleAgeSeconds + Math.max(0, now - at) / 1000 } };
}

async function readLive(): Promise<Live | null> {
  const base = process.env.RESEARCH_MONITOR_URL;
  if (!base) return null;
  const url = new URL(base);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local))) return null;
  // view=freshness: only the operating state, so this never makes the monitor rebuild its intake data (Nov 22, cost).
  url.pathname = `${url.pathname.replace(/\/$/, "")}/live`; url.search = "?view=freshness"; url.hash = "";
  const token = process.env.RESEARCH_MONITOR_TOKEN;
  const response = await fetch(url, { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : undefined, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
  if (!response.ok) return null;
  const body = await response.json();
  return body && typeof body === "object" ? { body: body as Record<string, unknown>, at: Date.now() } : null;
}

export async function GET() {
  const now = Date.now();
  if (last && now - last.at < FRESH_MS) return Response.json({ ok: true, ...assessFreshness(aged(last, now), now) }, { headers });
  reading ??= readLive().catch(() => null).finally(() => { reading = null; });
  const read = await reading;
  if (read) last = read;
  const state = read ?? (last && now - last.at < KEEP_MS ? last : null);
  // The monitor could not be reached: tell readers, never an error page.
  if (!state) return Response.json({ ok: true, status: "unreachable" }, { headers });
  return Response.json({ ok: true, ...assessFreshness(aged(state, now), now) }, { headers });
}
