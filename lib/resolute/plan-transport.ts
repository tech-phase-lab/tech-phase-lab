import { parsePlanSnapshot, type PlanInput } from "./plan-data.ts";
import { PLAN_BODY_LIMIT } from "./plan-http.ts";

export async function fetchResolutePlan(token: string, base: string | undefined, secret: string | undefined,
  method: "GET" | "PUT" | "DELETE", mutation?: { baseRevision: number; plan: PlanInput | null }, request: typeof fetch = fetch) {
  if (!base || !secret || secret.length < 43 || !token || token.length > 16384) throw new Error("Unavailable");
  const url = new URL(base);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    url.pathname !== "/" || !url.hostname.endsWith(".up.railway.app")) throw new Error("Unavailable");
  url.pathname = "/internal/v1/plan";
  // Never automatically retry writes: a lost response may follow a committed mutation.
  const res = await request(url, { method, cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${token}`, "X-Resolute-Service-Token": secret,
      Accept: "application/json", ...(method === "GET" ? {} : { "Content-Type": "application/json" }) },
    body: method === "GET" ? undefined : JSON.stringify(method === "DELETE" ? { baseRevision: mutation?.baseRevision } : mutation),
    signal: AbortSignal.timeout(20000) });
  if (!res.headers.get("content-type")?.startsWith("application/json")) { await res.body?.cancel(); throw new Error("Unavailable"); }
  const reader = res.body?.getReader(); if (!reader) throw new Error("Unavailable");
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > PLAN_BODY_LIMIT + 2048) { await reader.cancel(); throw new Error("Unavailable"); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
  if (res.status === 200 || res.status === 409) return { status: res.status, body: parsePlanSnapshot(body) };
  const errors: Record<number, string> = { 400: "INVALID_PLAN", 401: "AUTH_REQUIRED", 403: "PLAN_ACCESS_DENIED",
    413: "BODY_TOO_LARGE", 415: "JSON_REQUIRED", 429: "RATE_LIMITED", 503: "PLAN_UNAVAILABLE" };
  const error = errors[res.status];
  if (!error || body?.error !== error) throw new Error("Unavailable");
  return { status: res.status, body: { error } };
}
