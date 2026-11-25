import { LOGO_DOMAINS } from "@/lib/research/stock-logo-domains";
import { logoSources } from "@/lib/research/stock-logo-sources";
export const maxDuration = 15;
const MAX_BYTES = 300_000;
const found = { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800" };
const none = { "Cache-Control": "public, max-age=3600, s-maxage=86400" };
/** A stock's logo for the price screens (owner, Nov 25: MU, MRVL and others showed none). Public images only, no member data, no provider credit:
 * Twelve Data's logo image for the company's domain, else a ticker-keyed logo; 404 when neither has one (the screen then shows the ticker's letters).
 * Kept a week at the edge, so each logo is fetched from its source about once a week. */
export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  const ticker = decodeURIComponent((await context.params).ticker).toUpperCase();
  if (!/^[A-Z0-9.-]{1,10}$/.test(ticker)) return new Response(null, { status: 400, headers: none });
  for (const url of logoSources(ticker, LOGO_DOMAINS[ticker])) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000), cache: "no-store" });
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || !/^image\/(png|jpeg|webp|gif|svg\+xml)/.test(type)) continue;
      const body = await response.arrayBuffer();
      if (!body.byteLength || body.byteLength > MAX_BYTES) continue;
      return new Response(body, { headers: { ...found, "Content-Type": type, "X-Content-Type-Options": "nosniff", ...(type.startsWith("image/svg") ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } : {}) } });
    } catch { /* the next source */ }
  }
  return new Response(null, { status: 404, headers: none });
}
