import { proCheckAuthorized } from "@/lib/research/pro-check";
import { runProCheck } from "@/lib/research/pro-check-server";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

/** HQ's read-only production check of the PRO-only Stock Comparison (lib/research/pro-check.ts): the real comparison of fixed large-cap pairs
 *  from the shared stores, per company the seven factors present or missing, the card's strengths and weaknesses and any invalid figure.
 *  Server to server only: `Authorization: Bearer <COMPARISON_WARM_SECRET>` (the monitor's existing secret for the comparison's warm job),
 *  compared in constant time; anything else, including any request a browser makes, gets a bare 404 as if the route did not exist. No CORS
 *  headers, no membership read, no member data in the answer. Called once a day by scripts/research/production_watch.py (`proCompare`). */
export async function GET(request: Request) {
  if (!proCheckAuthorized(request.headers, process.env.COMPARISON_WARM_SECRET)) return new Response(null, { status: 404, headers });
  const started = performance.now();
  try {
    const pairs = await runProCheck();
    const ms = Math.round(performance.now() - started);
    console.info(`pro check pairs=${pairs.length} failed=${pairs.filter(p => !p.ok).map(p => p.tickers.join("/")).join(",") || "-"} ms=${ms}`);
    return Response.json({ ok: true, generatedAt: new Date().toISOString(), ms, pairs }, { headers });
  } catch {
    return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers });
  }
}
/** Every other method, OPTIONS (a CORS preflight) included, is answered as a missing route rather than 405 with an Allow list. */
const hidden = () => new Response(null, { status: 404, headers });
export { hidden as POST, hidden as PUT, hidden as PATCH, hidden as DELETE, hidden as OPTIONS };
