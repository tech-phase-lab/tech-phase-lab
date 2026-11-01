import { guard, json } from "@/lib/owner-2fa/route";
import { hasOwnerProof, status } from "@/lib/owner-2fa/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const who = await guard(request, false);
  if (who instanceof Response) return who;
  try { return json({ ...(await status(who.userId)), verified: await hasOwnerProof(who.userId) }); } catch { return json({ error: "unavailable" }, 503); }
}
