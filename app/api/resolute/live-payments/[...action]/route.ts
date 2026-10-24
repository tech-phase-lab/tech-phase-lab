import { auth } from "@clerk/nextjs/server";
import { OWNER_ACCOUNT_ID } from "@/lib/membership/entitlements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
async function handle(request: Request, context: { params: Promise<{ action: string[] }> }) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401, headers });
    if (process.env.RESOLUTE_PAYPAL_LIVE_ENABLED !== "true")
      return Response.json({ error: "PAYMENT_DISABLED" }, { status: 503, headers });
    const { action } = await context.params;
    const path = action.join("/");
    if (path === "audit" && userId !== OWNER_ACCOUNT_ID)
      return Response.json({ error: "PAYMENT_ACCESS_DENIED" }, { status: 403, headers });
    if (!(request.method === "POST" && ["orders", "capture"].includes(path)) &&
        !(request.method === "GET" && (path === "audit" || path === "access" || /^orders\/[0-9a-f-]{36}$/i.test(path))))
      return Response.json({ error: "NOT_FOUND" }, { status: 404, headers });
    if (request.method === "POST" && process.env.RESOLUTE_LIVE_SALES_ENABLED !== "true")
      return Response.json({ error: "PAYMENT_DISABLED" }, { status: 503, headers });
    const incoming = new URL(request.url);
    if (incoming.search || request.method === "POST" && request.headers.get("origin") !== incoming.origin)
      return Response.json({ error: "INVALID_ORIGIN" }, { status: 403, headers });
    const base = process.env.RESOLUTE_API_URL, secret = process.env.RESOLUTE_API_SERVICE_TOKEN;
    if (!base || !secret || secret.length < 43) throw Error("Unavailable");
    const url = new URL(base);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".up.railway.app") || url.port || url.username ||
        url.password || url.pathname !== "/" || url.search || url.hash) throw Error("Unavailable");
    url.pathname = `/internal/v1/live-payments/${path}`;
    const token = await getToken(); if (!token) throw Error("Unavailable");
    let body: string | undefined;
    if (request.method === "POST") {
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        return Response.json({ error: "JSON_REQUIRED" }, { status: 415, headers });
      const reader = request.body?.getReader(); if (!reader) throw Error("Missing body");
      const parts: Uint8Array[] = []; let size = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 2048) { await reader.cancel();
          return Response.json({ error: "BODY_TOO_LARGE" }, { status: 413, headers }); }
        parts.push(value);
      }
      body = Buffer.concat(parts).toString("utf8");
    }
    const response = await fetch(url, { method: request.method, body, cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`,
        "X-Resolute-Service-Token": secret, "Content-Type": "application/json" } });
    // Only our fixed backend may answer; failures never expose upstream text or secrets.
    if (!response.headers.get("content-type")?.startsWith("application/json")) throw Error("Invalid response");
    const text = await response.text(); if (text.length > 65536) throw Error("Oversize response");
    return Response.json(JSON.parse(text), { status: response.status, headers });
  } catch { return Response.json({ error: "PAYMENT_UNAVAILABLE" }, { status: 503, headers }); }
}
export const GET = handle;
export const POST = handle;
