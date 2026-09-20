import { createHash } from "node:crypto";
import { extractBusinessSection, normalizeTicker, parseSecDirectory, parseSecProfile, searchDirectory, type BusinessSection } from "@/lib/research/stock-directory";

const directoryUrl = "https://www.sec.gov/files/company_tickers_exchange.json";
const maxResponseBytes = 2_000_000;
const maxFilingBytes = 12_000_000;

function headers(accept = "application/json") {
  return {
    Accept: accept,
    "User-Agent": process.env.RESEARCH_USER_AGENT || "TechPhaseResearch/1.0 research-preview",
  };
}

async function secJson(url: string, revalidate: number) {
  let response: Response;
  try {
    response = await fetch(url, { headers: headers(), next: { revalidate, tags: ["sec-stock-directory"] }, signal: AbortSignal.timeout(8_000) });
  } catch (error) {
    throw new Error(error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ? "sec-timeout" : "sec-fetch-unavailable");
  }
  if (!response.ok) throw new Error(`sec-http-${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxResponseBytes) throw new Error("sec-response-too-large");
  const text = await response.text();
  if (text.length > maxResponseBytes) throw new Error("sec-response-too-large");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("sec-invalid-json");
  }
}

async function secHtml(url: string) {
  let response: Response;
  try {
    response = await fetch(url, { headers: headers("text/html,application/xhtml+xml"), cache: "no-store", signal: AbortSignal.timeout(12_000) });
  } catch (error) {
    throw new Error(error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ? "sec-filing-timeout" : "sec-filing-fetch-unavailable");
  }
  if (!response.ok) throw new Error(`sec-filing-http-${response.status}`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new Error("sec-filing-invalid-content-type");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxFilingBytes) throw new Error("sec-filing-too-large");
  const html = await response.text();
  if (html.length > maxFilingBytes) throw new Error("sec-filing-too-large");
  return html;
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
      if (url.searchParams.get("view") === "business") {
        const filing = profile.latestAnnualFiling;
        if (!filing || (filing.form !== "10-K" && filing.form !== "20-F")) return Response.json({ ok: false, error: "annual-filing-not-found" }, { status: 404 });
        const html = await secHtml(filing.documentUrl);
        const extracted = extractBusinessSection(html, filing.form);
        if (!extracted) return Response.json({ ok: false, error: "business-section-not-found", filing }, { status: 422, headers: { "Cache-Control": "public, s-maxage=3600" } });
        const business: BusinessSection = {
          ticker: entry.ticker,
          cik: entry.cik,
          form: filing.form,
          filingDate: filing.filingDate,
          reportDate: filing.reportDate,
          accessionNumber: filing.accessionNumber,
          ...extracted,
          documentUrl: filing.documentUrl,
          filingIndexUrl: filing.filingIndexUrl,
          retrievedAt: new Date().toISOString(),
          sourceSha256: createHash("sha256").update(html).digest("hex"),
        };
        return Response.json({ ok: true, business }, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
      }
      return Response.json({ ok: true, profile, source: directoryUrl, profileSource: profileUrl, asOf: new Date().toISOString() }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
    }
    if (!query.trim()) return Response.json({ ok: true, results: [], source: directoryUrl, notice: "query-required" });
    const results = searchDirectory(entries, query, Number(url.searchParams.get("limit") ?? 24));
    return Response.json({ ok: true, results, source: directoryUrl, asOf: new Date().toISOString() }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400" } });
  } catch (error) {
    return errorResponse(error);
  }
}
