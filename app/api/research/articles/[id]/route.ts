import { loadLiveResultEvents } from "@/lib/research/live-result-events";
import { events } from "@/lib/research/content-server";
import { isPublicSample } from "@/lib/research/access";
import { getMembership } from "@/lib/membership/server";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const event = events.find(item => item.id === id) ?? (/^x-result-\d+$/.test(id) ? (await loadLiveResultEvents()).find(item => item.id === id) : undefined);
  if (!event) return Response.json({ error: "not-found" }, { status: 404, headers });
  if (isPublicSample(id)) return Response.json({ event: { ...event, locked: false } }, { headers });
  try {
    const member = await getMembership();
    if (member.status === "unavailable") return Response.json({ error: "unavailable" }, { status: 503, headers });
    if (member.status !== "signed-in") return Response.json({ error: "sign-in" }, { status: 401, headers });
    if (member.plan !== "pro" || !Number.isFinite(member.accessExpiresAt) || member.accessExpiresAt <= Date.now()) return Response.json({ error: "pro-required" }, { status: 403, headers });
    return Response.json({ event: { ...event, locked: false }, validUntil: member.accessExpiresAt }, { headers });
  } catch { return Response.json({ error: "unavailable" }, { status: 503, headers }); }
}
