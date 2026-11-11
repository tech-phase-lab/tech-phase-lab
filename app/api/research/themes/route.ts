import { getMembership } from "@/lib/membership/server";
import { themeRankingAccess } from "@/lib/research/theme-ranking";
import { isGroupFilter } from "@/lib/research/theme-definitions";
import { loadThemeReturns, themePricesConfigured, usMarketOpen } from "@/lib/research/theme-prices";

export const dynamic = "force-dynamic";
// "All" reads every genre; the first request of a cold cache can take a while (the credits are spread over chunks).
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** PRO only. The ranking itself is computed in the browser from these per-stock returns so the period tabs need no round trip. */
export async function GET(request: Request) {
  try {
    const member = await getMembership();
    const access = themeRankingAccess(member);
    if (access !== 200) return Response.json({ ok: false, error: access === 401 ? "sign-in" : access === 403 ? "pro-required" : "unavailable" }, { status: access, headers });
    const requested = new URL(request.url).searchParams.get("group") ?? "all";
    if (!isGroupFilter(requested)) return Response.json({ ok: false, error: "unknown-group" }, { status: 400, headers });
    if (!themePricesConfigured()) return Response.json({ ok: false, error: "not-connected" }, { status: 503, headers });
    const data = await loadThemeReturns(requested);
    // The entitlement may expire while the upstream data is being fetched.
    if (themeRankingAccess(member) !== 200) return Response.json({ ok: false, error: "pro-required" }, { status: 403, headers });
    return Response.json({ ok: true, group: requested, ...data, marketOpen: usMarketOpen(), validUntil: "accessExpiresAt" in member ? member.accessExpiresAt : 0 }, { headers });
  } catch (error) { console.warn(`theme-ranking route: ${error instanceof Error ? error.message : "error"}`); return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers }); }
}
