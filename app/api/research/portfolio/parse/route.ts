import { auth } from "@clerk/nextjs/server";
import { getMembership } from "@/lib/membership/server";
import { readHoldings, decodeImage, visionConfigured } from "@/lib/portfolio/vision";
import { takeRead } from "@/lib/portfolio/limit";
import { reconcile } from "@/lib/portfolio/parse";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });

/** Screenshot in, holdings out. Same-origin, signed-in only, a few per day, and the picture is never stored. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "forbidden" }, 403);
  const { userId } = await auth();
  if (!userId) return json({ error: "sign-in" }, 401);
  // PRO members only (the owner counts as PRO): the reading costs money and the feature is part of PRO.
  if ((await getMembership()).plan !== "pro") return json({ error: "pro-only" }, 403);
  if (!visionConfigured()) return json({ error: "not-configured" }, 503);
  let image;
  try { image = decodeImage((await request.json())?.image); } catch { image = null; }
  if (!image) return json({ error: "invalid-image" }, 400);
  try {
    const turn = await takeRead(userId);
    if (!turn.ok) return json({ error: "limit" }, 429);
    const parsed = await readHoldings(image);
    return json({ holdings: parsed.holdings, warnings: parsed.warnings, mismatch: reconcile(parsed), left: turn.left });
  } catch { return json({ error: "unavailable" }, 503); }
}
