export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function endpoint(path: string) {
  const value = process.env.RESEARCH_MONITOR_URL;
  if (!value) throw new Error("not-configured");
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local))) {
    throw new Error("invalid-monitor-url");
  }
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

async function relay(url: URL, init: RequestInit, timeout = 15_000) {
  const upstream = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeout) });
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
    const retainedKeys = ["retainedSourceId", "retainedUrl", "expectedSourceSha"];
    if (["retainedSourceId", "retainedUrl"].some(key => requestUrl.searchParams.has(key))) {
      const allowed = new Set(["kind", ...retainedKeys]);
      const single = (key: string) => requestUrl.searchParams.getAll(key).length === 1;
      const sourceId = requestUrl.searchParams.get("retainedSourceId") ?? "";
      const retainedUrl = requestUrl.searchParams.get("retainedUrl") ?? "";
      const expectedSha = requestUrl.searchParams.get("expectedSourceSha") ?? "";
      if (kind !== "official-research" || !single("kind") || !retainedKeys.every(single)
          || [...requestUrl.searchParams.keys()].some(key => !allowed.has(key))
          || !/^[a-z][a-z0-9-]{0,79}$/.test(sourceId)
          || !/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/[1-9][0-9]{0,19}$/.test(retainedUrl)
          || !/^[a-f0-9]{64}$/.test(expectedSha)) {
        return response(400, { ok: false, error: "invalid-retained-selector" });
      }
      const url = endpoint("/admin/official-research");
      for (const key of retainedKeys) url.searchParams.set(key, requestUrl.searchParams.get(key)!);
      return await relay(url, { headers: { Authorization: auth } });
    }
    const eventIds = requestUrl.searchParams.getAll("eventId");
    if (eventIds.length && (!["signals", "official-research"].includes(kind ?? "") || eventIds.length !== 1 || !/^[1-9][0-9]{0,11}$/.test(eventIds[0]))) {
      return response(400, { ok: false, error: "invalid-event-id" });
    }
    const proofHashes: Record<string, string> = {};
    for (const key of ["expectedSourceSha", "expectedBodySha"]) {
      const values = requestUrl.searchParams.getAll(key);
      const researchDetail = kind === "official-research" && eventIds.length === 1;
      if (researchDetail ? values.length !== 1 || !/^[a-f0-9]{64}$/.test(values[0]) : values.length > 0) {
        return response(400, { ok: false, error: "invalid-revision-hash" });
      }
      if (researchDetail) proofHashes[key] = values[0];
    }
    const view = requestUrl.searchParams.get("view") ?? (kind === "official-research" ? "pending" : "all");
    const allowedViews = kind === "official-research" ? ["pending", "all"] : ["posts", "news"].includes(kind ?? "") ? ["all"] : kind === "signals" ? ["all", "new", "changed", "baseline", "targets", "ratings"] : kind === "annual"
      ? ["all", "actionable", "invalid", "draft", "held", "approved", "rejected"]
      : ["all", "ready", "blocked", "needs-draft"];
    if (!allowedViews.includes(view)) {
      return response(400, { ok: false, error: "invalid-review-filter" });
    }
    const url = endpoint(kind === "official-research" ? "/admin/official-research" : kind === "posts" ? "/admin/posts" : kind === "news" ? "/admin/news" : kind === "signals" ? "/admin/signals" : kind === "annual" ? "/admin/annual-briefs" : "/admin/briefs");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("view", view);
    if (eventIds.length) url.searchParams.set("eventId", eventIds[0]);
    for (const [key, value] of Object.entries(proofHashes)) url.searchParams.set(key, value);
    for (const key of ["beforeEventId", "terminalBeforeEventId"]) {
      const values = requestUrl.searchParams.getAll(key);
      if (!values.length) continue;
      if (kind !== "official-research" || values.length !== 1 || !/^[1-9][0-9]{0,15}$/.test(values[0]) || !Number.isSafeInteger(Number(values[0]))) {
        return response(400, { ok: false, error: "invalid-cursor" });
      }
      url.searchParams.set(key, values[0]);
    }
    if (kind === "posts") {
      const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
      if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return response(400, { ok: false, error: "invalid-offset" });
      url.searchParams.set("offset", String(offset));
    }
    if (kind === "signals" && requestUrl.searchParams.has("ticker")) {
      const ticker = requestUrl.searchParams.get("ticker") ?? "";
      if (!/^[A-Z0-9.\-]{1,15}$/.test(ticker)) return response(400, { ok: false, error: "invalid-ticker" });
      url.searchParams.set("ticker", ticker);
    }
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
    if (!parsed || typeof parsed !== "object" || !["generate", "draft", "review", "annual-draft", "annual-review", "news-generate", "news-retry", "news-draft", "news-review", "post-draft", "post-review"].includes(String(parsed.action)) || !parsed.payload || typeof parsed.payload !== "object" || Array.isArray(parsed.payload)) {
      return response(400, { ok: false, error: "invalid-request" });
    }
    const paths: Record<string, string> = {
      "post-draft": "/admin/posts/draft",
      "post-review": "/admin/posts/review",
      generate: "/admin/briefs/generate",
      draft: "/admin/briefs/draft",
      review: "/admin/briefs/review",
      "annual-draft": "/admin/annual-briefs/draft",
      "annual-review": "/admin/annual-briefs/review",
      "news-generate": "/admin/news/generate",
      "news-retry": "/admin/news/retry",
      "news-draft": "/admin/news/draft",
      "news-review": "/admin/news/review",
    };
    const path = paths[String(parsed.action)];
    return await relay(endpoint(path), {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(parsed.payload),
    }, ["news-generate", "news-retry"].includes(String(parsed.action)) ? 115_000 : 15_000);
  } catch {
    return response(503, { ok: false, error: "editorial-service-unavailable" });
  }
}
