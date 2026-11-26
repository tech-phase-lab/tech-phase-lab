import { after } from "next/server";
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
 * than FRESH_MS is reused, and a read is given READ_TIMEOUT_MS (13 s, as before). An answer waits ANSWER_WAIT_MS for it; when the read is
 * later than that, the last good state (at most KEEP_MS old) is assessed again at the current time — its cycle age grows by the time since
 * it was read, so a stalled monitor still shows as delayed — and the read goes on after the answer (`after`) and updates the state.
 * With no state yet the answer waits for the whole read. "unreachable" is never kept by a cache. */
const FRESH_MS = 15_000, KEEP_MS = 10 * 60_000, READ_TIMEOUT_MS = 13_000, ANSWER_WAIT_MS = 4_000;
const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
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

/** One read at a time; a good answer becomes `last` whenever it arrives, even after the request that started it was answered. */
function startRead(): Promise<Live | null> {
  reading ??= readLive().catch(() => null).then(read => { if (read && (!last || read.at > last.at)) last = read; return read; }).finally(() => { reading = null; });
  return reading;
}

export async function GET() {
  const now = Date.now();
  if (last && now - last.at < FRESH_MS) return Response.json({ ok: true, ...assessFreshness(aged(last, now), now) }, { headers });
  const kept = last && now - last.at < KEEP_MS ? last : null;
  const read = startRead();
  // With a kept state, answer from it when the read is late; the read continues after the answer.
  const got = kept ? await Promise.race([read, new Promise<"late">(resolve => setTimeout(() => resolve("late"), ANSWER_WAIT_MS))]) : await read;
  if (got === "late") { keepReading(read); }
  const state = got && got !== "late" ? got : kept;
  // The monitor could not be reached: tell readers, never an error page (and never a cached one).
  if (!state) return Response.json({ ok: true, status: "unreachable" }, { headers: noStore });
  const answeredAt = Date.now();
  return Response.json({ ok: true, ...assessFreshness(aged(state, answeredAt), answeredAt) }, { headers: state === got ? headers : noStore });
}
function keepReading(read: Promise<unknown>) { try { after(() => read); } catch { void read; } }
