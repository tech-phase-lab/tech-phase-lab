import rawSnapshot from "@/lib/research/intake-snapshot.json";
import { quarantineSnapshot, type IntakeSnapshot } from "@/lib/research/intake";
import {
  createMonitorFallbackLogger,
  monitorDiagnosticHeaders,
  monitorExceptionReason,
  monitorStatusReason,
  type MonitorFallbackReason,
} from "@/lib/research/live-monitor-observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const bundled = rawSnapshot as IntakeSnapshot;
const monitorLog = createMonitorFallbackLogger();
const liveHeaders = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  // The payload is public-safe and identical for every viewer. Keep the
  // browser on the three-second refresh loop while collapsing concurrent
  // viewers to one monitor request per edge region for a short interval.
  "Vercel-CDN-Cache-Control": "public, s-maxage=2, stale-while-revalidate=3",
};

function endpoint() {
  const value = process.env.RESEARCH_MONITOR_URL;
  if (!value) return null;
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local))) {
    throw new Error("RESEARCH_MONITOR_URL must use HTTPS");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/live`;
  url.search = "";
  url.hash = "";
  return url;
}

function fallback(error: "not-configured" | "monitor-unavailable", reason: MonitorFallbackReason) {
  monitorLog.failure(reason);
  return Response.json(
    { ok: false, mode: "snapshot", error, diagnosticReason: reason, snapshot: bundled },
    { headers: { "Cache-Control": "no-store", ...monitorDiagnosticHeaders(reason) } },
  );
}

export async function GET() {
  let url: URL | null;
  try {
    url = endpoint();
  } catch {
    return fallback("not-configured", "invalid-config");
  }
  if (!url) return fallback("not-configured", "not-configured");

  try {
    const token = process.env.RESEARCH_MONITOR_TOKEN;
    const response = await fetch(url, {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return fallback("monitor-unavailable", monitorStatusReason(response.status));
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 3_000_000) return fallback("monitor-unavailable", "oversized-response");
    const payload = await response.json() as { ok?: boolean; mode?: string; monitor?: unknown; snapshot?: IntakeSnapshot };
    const checked = payload.ok && payload.mode === "automatic" && payload.snapshot ? quarantineSnapshot(payload.snapshot) : null;
    if (!checked) {
      return fallback("monitor-unavailable", "invalid-payload");
    }
    monitorLog.recovered();
    return Response.json({ ...payload, snapshot: checked.snapshot }, {
      headers: { ...liveHeaders, "X-Tech-Phase-Monitor-Mode": "automatic",
        // Count only: no URLs or record details leave the server.
        "X-Tech-Phase-Monitor-Dropped": String(checked.dropped) },
    });
  } catch (error) {
    return fallback("monitor-unavailable", monitorExceptionReason(error));
  }
}
