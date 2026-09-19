import rawSnapshot from "@/lib/research/intake-snapshot.json";
import { snapshotIssues, type IntakeSnapshot } from "@/lib/research/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const bundled = rawSnapshot as IntakeSnapshot;

function endpoint() {
  const value = process.env.RESEARCH_MONITOR_URL;
  if (!value) return null;
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local)) {
    throw new Error("RESEARCH_MONITOR_URL must use HTTPS");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/live`;
  url.search = "";
  url.hash = "";
  return url;
}

function fallback(error: "not-configured" | "monitor-unavailable") {
  return Response.json(
    { ok: false, mode: "snapshot", error, snapshot: bundled },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() {
  let url: URL | null;
  try {
    url = endpoint();
  } catch {
    return fallback("not-configured");
  }
  if (!url) return fallback("not-configured");

  try {
    const token = process.env.RESEARCH_MONITOR_TOKEN;
    const response = await fetch(url, {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return fallback("monitor-unavailable");
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 3_000_000) return fallback("monitor-unavailable");
    const payload = await response.json() as { ok?: boolean; mode?: string; monitor?: unknown; snapshot?: IntakeSnapshot };
    if (!payload.ok || payload.mode !== "automatic" || !payload.snapshot || snapshotIssues(payload.snapshot).length) {
      return fallback("monitor-unavailable");
    }
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return fallback("monitor-unavailable");
  }
}
