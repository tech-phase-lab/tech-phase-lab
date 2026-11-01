import { guard, json } from "@/lib/owner-2fa/route";
import { begin } from "@/lib/owner-2fa/server";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const who = await guard(request, true);
  if (who instanceof Response) return who;
  try { return json(await begin(who.userId)); } catch (error) {
    return error instanceof Error && error.message === "ALREADY_ENABLED" ? json({ error: "already-enabled" }, 409) : json({ error: "unavailable" }, 503);
  }
}
