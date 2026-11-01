import { guard, json, readCode } from "@/lib/owner-2fa/route";
import { confirmSetup, grantProofCookie } from "@/lib/owner-2fa/server";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const who = await guard(request, true);
  if (who instanceof Response) return who;
  const code = await readCode(request);
  if (!code) return json({ error: "invalid-input" }, 400);
  try {
    const result = await confirmSetup(who.userId, code);
    if (result === "ok") { await grantProofCookie(who.userId); return json({ ok: true }); }
    return json({ ok: false, reason: result }, result === "locked" ? 429 : result === "missing" ? 409 : 401);
  } catch { return json({ error: "unavailable" }, 503); }
}
