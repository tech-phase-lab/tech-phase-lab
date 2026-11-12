import { NextResponse } from "next/server";

// TEMPORARY probe (removed before merge): reports only the shape of Twelve Data earnings endpoints and error code/message. Never values, never the key.
export const dynamic = "force-dynamic";
const shape = (v: unknown, depth = 0): unknown => Array.isArray(v) ? [v.length, v.length && depth < 3 ? shape(v[0], depth + 1) : null] : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, depth < 3 ? shape(x, depth + 1) : typeof x])) : v === null ? "null" : typeof v;
export async function GET(request: Request) {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return NextResponse.json({ configured: false });
  const symbol = new URL(request.url).searchParams.get("symbol") === "AMAT" ? "AMAT" : "NBIS";
  const calls: [string, Record<string, string>][] = [
    ["earnings", { symbol, outputsize: "2" }], ["earnings", { symbol, period: "next" }], ["earnings_calendar", {}],
    ["earnings_estimate", { symbol }], ["revenue_estimate", { symbol }], ["eps_trend", { symbol }], ["eps_revisions", { symbol }], ["income_statement", { symbol, period: "quarterly", outputsize: "1" }],
  ];
  const out: Record<string, unknown> = {};
  for (const [path, params] of calls) {
    const url = new URL(`https://api.twelvedata.com/${path}`);
    for (const [k, v] of Object.entries({ ...params, apikey: key })) url.searchParams.set(k, v);
    try {
      const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      const body = await r.json() as { status?: string; code?: unknown; message?: unknown };
      out[`${path}${params.period ? `:${params.period}` : ""}`] = body?.status === "error" ? { http: r.status, code: body.code, message: String(body.message).replace(key, "").slice(0, 160) } : { http: r.status, shape: shape(body) };
    } catch (e) { out[path] = { failed: e instanceof Error ? e.message.slice(0, 80) : "error" }; }
  }
  return NextResponse.json(out);
}
