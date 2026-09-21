export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

function endpoint(path: string) {
  const value = process.env.RESEARCH_MONITOR_URL;
  if (!value) throw new Error("not-configured");
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local)) throw new Error("invalid-monitor-url");
  url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`;
  url.search = "";
  url.hash = "";
  return url;
}

function authorization(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return /^Bearer [\x21-\x7e]{24,512}$/.test(value) ? value : null;
}

function response(status: number, value: unknown) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}

async function relay(url: URL, init: RequestInit) {
  const upstream = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const text = await upstream.text();
  if (new TextEncoder().encode(text).length > 3_000_000) return response(502, { ok: false, error: "oversized-response" });
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { payload = { ok: false, error: "invalid-response" }; }
  return response(upstream.status, payload);
}

export async function GET(request: Request) {
  const auth = authorization(request);
  if (!auth) return response(401, { ok: false, error: "unauthorized" });
  try {
    const requestUrl = new URL(request.url);
    const requested = Number(requestUrl.searchParams.get("limit") ?? 20);
    const limit = Number.isInteger(requested) ? Math.max(1, Math.min(requested, 50)) : 20;
    const kind = requestUrl.searchParams.get("kind");
    const view = requestUrl.searchParams.get("view") ?? "all";
    if (kind !== "annual" && !["all", "ready", "blocked", "needs-draft"].includes(view)) {
      return response(400, { ok: false, error: "invalid-review-filter" });
    }
    const url = endpoint(kind === "annual" ? "/admin/annual-briefs" : "/admin/briefs");
    url.searchParams.set("limit", String(limit));
    if (kind !== "annual") url.searchParams.set("view", view);
    return await relay(url, { headers: { Authorization: auth } });
  } catch {
    return response(503, { ok: false, error: "editorial-service-unavailable" });
  }
}

export async function POST(request: Request) {
  const auth = authorization(request);
  if (!auth) return response(401, { ok: false, error: "unauthorized" });
  try {
    const text = await request.text();
    if (!text || new TextEncoder().encode(text).length > 64 * 1024) return response(400, { ok: false, error: "invalid-request-size" });
    let parsed: { action?: unknown; payload?: unknown };
    try { parsed = JSON.parse(text); } catch { return response(400, { ok: false, error: "invalid-json" }); }
    if (!parsed || typeof parsed !== "object" || !["generate", "draft", "review", "annual-draft", "annual-review"].includes(String(parsed.action)) || !parsed.payload || typeof parsed.payload !== "object") {
      return response(400, { ok: false, error: "invalid-request" });
    }
    const paths: Record<string, string> = {
      generate: "/admin/briefs/generate",
      draft: "/admin/briefs/draft",
      review: "/admin/briefs/review",
      "annual-draft": "/admin/annual-briefs/draft",
      "annual-review": "/admin/annual-briefs/review",
    };
    const path = paths[String(parsed.action)];
    return await relay(endpoint(path), {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(parsed.payload),
    });
  } catch {
    return response(503, { ok: false, error: "editorial-service-unavailable" });
  }
}
