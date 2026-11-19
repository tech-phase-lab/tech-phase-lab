import { parseCspReports, reportLimiter } from "@/lib/security-headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Browsers post Content-Security-Policy-Report-Only violations here. One fixed-shape log line per distinct
// (directive, blocked host) per minute, at most 30 lines a minute per instance; no URLs, paths or user data.
const MAX_BYTES = 16_384;
const allowLine = reportLimiter();
const done = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!["application/csp-report", "application/reports+json", "application/json"].includes(type)) return done();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return done();
  let text = "";
  try { text = await request.text(); } catch { return done(); }
  if (text.length > MAX_BYTES) return done();
  let body: unknown;
  try { body = JSON.parse(text); } catch { return done(); }
  for (const report of parseCspReports(body)) {
    if (allowLine(`${report.directive} ${report.blocked}`)) console.warn(`csp-report-only directive=${report.directive} blocked=${report.blocked}`);
  }
  return done();
}
