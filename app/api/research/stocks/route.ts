import { normalizeTicker, parseSecDirectory, parseSecProfile, searchDirectory } from "@/lib/research/stock-directory";

const directoryUrl = "https://www.sec.gov/files/company_tickers_exchange.json";
const maxResponseBytes = 2_000_000;

function headers() {
  return {
    Accept: "application/json",
    "User-Agent": process.env.RESEARCH_USER_AGENT || "TechPhaseResearch/1.0 research-preview",
  };
}

async function secJson(url: string, revalidate: number) {
  const response = await fetch(url, { headers: headers(), next: { revalidate, tags: ["sec-stock-directory"] }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`sec-http-${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxResponseBytes) throw new Error("sec-response-too-large");
  const text = await response.text();
  if (text.length > maxResponseBytes) throw new Error("sec-response-too-large");
  return JSON.parse(text) as unknown;
}

async function directory() {
  return parseSecDirectory(await secJson(directoryUrl, 86_400));
}

function errorResponse(error: unknown) {
  const code = error instanceof Error && /^sec-|^invalid-sec|^incomplete-sec/.test(error.message) ? error.message : "stock-directory-unavailable";
  return Response.json({ ok: false, error: code, source: directoryUrl }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticker = normalizeTicker(url.searchParams.get("ticker") ?? "");
  const query = (url.searchParams.get("q") ?? "").slice(0, 80);
  try {
    const entries = await directory();
    if (ticker) {
      const entry = entries.find((item) => item.ticker === ticker);
      if (!entry) return Response.json({ ok: false, error: "ticker-not-found", source: directoryUrl }, { status: 404 });
      const cik = String(entry.cik).padStart(10, "0");
      const profileUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
      const profile = parseSecProfile(entry, await secJson(profileUrl, 3_600));
      return Response.json({ ok: true, profile, source: directoryUrl, profileSource: profileUrl, asOf: new Date().toISOString() }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
    }
    if (!query.trim()) return Response.json({ ok: true, results: [], source: directoryUrl, notice: "query-required" });
    const results = searchDirectory(entries, query, Number(url.searchParams.get("limit") ?? 24));
    return Response.json({ ok: true, results, source: directoryUrl, asOf: new Date().toISOString() }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400" } });
  } catch (error) {
    return errorResponse(error);
  }
}
