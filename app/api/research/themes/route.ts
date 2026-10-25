import { getMembership } from "@/lib/membership/server";
import { themeRankingAccess } from "@/lib/research/theme-ranking";
import { loadThemeReturns, themePricesConfigured } from "@/lib/research/theme-prices";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** PRO only. The ranking itself is computed in the browser from these per-stock returns so the period tabs need no round trip. */
export async function GET() {
  try {
    const member = await getMembership();
    const access = themeRankingAccess(member);
    if (access !== 200) return Response.json({ ok: false, error: access === 401 ? "sign-in" : access === 403 ? "pro-required" : "unavailable" }, { status: access, headers });
    if (!themePricesConfigured()) return Response.json({ ok: false, error: "not-connected" }, { status: 503, headers });
    const data = await loadThemeReturns();
    // The entitlement may expire while the upstream data is being fetched.
    if (themeRankingAccess(member) !== 200) return Response.json({ ok: false, error: "pro-required" }, { status: 403, headers });
    return Response.json({ ok: true, ...data, validUntil: "accessExpiresAt" in member ? member.accessExpiresAt : 0 }, { headers });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers }); }
}
