import { cookies } from "next/headers";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
export async function POST(request: Request) {
  try {
    if (process.env.RESOLUTE_PAYPAL_LIVE_ENABLED !== "true" || process.env.RESOLUTE_GUEST_CHECKOUT_ENABLED !== "true")
      return Response.json({ error: "PAYMENT_DISABLED" }, { status: 503, headers });
    const url = new URL(request.url);
    if (url.search || request.headers.get("origin") !== url.origin)
      return Response.json({ error: "INVALID_ORIGIN" }, { status: 403, headers });
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return Response.json({ error: "JSON_REQUIRED" }, { status: 415, headers });
    const reader = request.body?.getReader(); if (!reader) throw Error("Missing body");
    const parts: Uint8Array[] = []; let size = 0;
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 1024) { await reader.cancel(); return Response.json({ error: "BODY_TOO_LARGE" }, { status: 413, headers }); }
      parts.push(part.value);
    }
    const value = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!value || Object.keys(value).length !== 1 || typeof value.token !== "string" || value.token.length > 512 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value.token)) throw Error("Invalid token");
    const hint = JSON.parse(Buffer.from(value.token.split(".")[0], "base64url").toString("utf8"));
    if (typeof hint.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(hint.id)) throw Error("Invalid order");
    // This ID is an unverified display hint, never proof of payment.
    // No grant here. Signature, expiry, payment and account are checked on explicit claim.
    (await cookies()).set("__Host-resolute-recovery", value.token, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 86400,
    });
    return Response.json({ ready: true, orderId: hint.id }, { headers });
  } catch { return Response.json({ error: "INVALID_RECOVERY_LINK" }, { status: 400, headers }); }
}
