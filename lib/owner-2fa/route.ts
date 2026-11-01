import "server-only";
import { ownerTwoFactorConfigured, signedInOwner } from "./server.ts";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
export const json = (value: unknown, status = 200) => Response.json(value, { status, headers });

/** Same-origin JSON only, the approved owner only, and nothing when the keys are not set. */
export async function guard(request: Request, post: boolean): Promise<{ userId: string } | Response> {
  if (!["preview", "production"].includes(process.env.VERCEL_ENV ?? "") && process.env.NODE_ENV === "production") return json({ error: "unavailable" }, 404);
  if (post && (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json"))) return json({ error: "forbidden" }, 403);
  const userId = await signedInOwner();
  if (!userId) return json({ error: "forbidden" }, 403);
  if (!ownerTwoFactorConfigured()) return json({ error: "not-configured" }, 503);
  return { userId };
}

export async function readCode(request: Request): Promise<string | null> {
  try {
    const text = await request.text();
    if (text.length > 200) return null;
    const value = JSON.parse(text)?.code;
    return typeof value === "string" && /^\d{6}$/.test(value) ? value : null;
  } catch { return null; }
}
