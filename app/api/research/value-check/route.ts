import { getMembership } from "@/lib/membership/server";
import { valueCheckAccess, valueCheckEnabled } from "@/lib/research/value-check";
import { ValueSnapshotUnavailable, loadValueRanking } from "@/lib/research/value-check-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status, headers });

/** トレジャーハント, internally value-check (PRO; the owner's accounts always). The scores come from the research monitor, computed once a
 * day after the close; this answers from the shared copy (lib/research/value-check-server.ts), never waiting on the monitor once it is filled. */
export async function GET() {
  try {
    const member = await getMembership().catch(() => ({ status: "unavailable", plan: "free" }));
    const access = valueCheckAccess(member, valueCheckEnabled());
    if (access !== 200) return fail(access, access === 401 ? "sign-in" : access === 403 ? "pro-required" : access === 404 ? "not-found" : "unavailable");
    return Response.json(await loadValueRanking(), { headers });
  } catch (error) {
    return fail(503, error instanceof ValueSnapshotUnavailable ? error.reason : "unavailable");
  }
}
