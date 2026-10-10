import { createHmac, timingSafeEqual } from "node:crypto";
export const displayCookie = "tp-member-display";
export type Display = { plan: "free" | "pro"; owner: boolean; ownerMode: boolean; ownerAccount?: boolean; accessExpiresAt: number };
export function signDisplay(value: Display, userId: string, secret: string, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...value, userId, expires: Math.min(now + 300_000, value.plan === "pro" ? value.accessExpiresAt : now + 300_000) })).toString("base64url");
  return body + "." + createHmac("sha256", secret).update("display-v1:" + body).digest("base64url");
}
export function verifyDisplay(token: string, userId: string, secret: string, now = Date.now()): Display | undefined {
  try {
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra) return;
    const expected = createHmac("sha256", secret).update("display-v1:" + body).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return;
    const value = JSON.parse(Buffer.from(body, "base64url").toString());
    if (value.userId !== userId || !Number.isFinite(value.expires) || value.expires <= now || !["pro", "free"].includes(value.plan)) return;
    if (value.plan === "pro" && (!Number.isFinite(value.accessExpiresAt) || value.accessExpiresAt <= now)) return;
    return { plan: value.plan, owner: value.owner === true, ownerMode: value.ownerMode === true, ownerAccount: value.ownerAccount === true, accessExpiresAt: value.accessExpiresAt };
  } catch { return; }
}
