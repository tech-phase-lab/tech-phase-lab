import { auth } from "@clerk/nextjs/server";
import { membershipConfigured } from "@/lib/membership/server";
import { readImagesText, decodeImage, visionConfigured } from "@/lib/portfolio/vision";
import { draftPrompt, ownerDraftAccess, parseDraft, parseDraftInput } from "@/lib/resolute/owner-news";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });

/** Shock Gauge owner: screenshots and / or pasted text in, a draft title and summary out (owner accounts only, same origin). The
 * pictures are read in memory for this request only and never stored or logged. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "forbidden" }, 403);
  if (!membershipConfigured()) return json({ error: "unavailable" }, 503);
  const { userId } = await auth();
  const access = ownerDraftAccess(userId);
  if (access !== 200) return json({ error: access === 401 ? "sign-in" : "owner-only" }, access);
  if (!visionConfigured()) return json({ error: "not-configured" }, 503);
  let input, images;
  try {
    input = parseDraftInput(await request.json());
    images = input.images.map(decodeImage);
  } catch { return json({ error: "invalid-input" }, 400); }
  if (images.some(i => !i)) return json({ error: "invalid-image" }, 400);
  try {
    const result = parseDraft(await readImagesText(images.filter(i => i !== null), draftPrompt(input)), input);
    if (!result) return json({ error: "no-draft" }, 422);
    return json({ draft: result.draft, issues: result.issues, url: input.url });
  } catch (error) {
    const reason = error instanceof Error && /^vision-[a-z0-9_.:-]{1,64}$/i.test(error.message) ? error.message : undefined;
    return json({ error: "unavailable", ...(reason ? { reason } : {}) }, 503);
  }
}
