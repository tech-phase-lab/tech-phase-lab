import registry from "./providers.json" with { type: "json" };

export const providers = registry;
export const providerByTicker = Object.fromEntries(providers.map(p => [p.ticker, p]));
export const sectorNames: Record<string, string> = {
  semiconductors: "半導体", networking: "ネットワーク", "ai-cloud": "AIクラウド",
  "power-cooling": "電力・冷却", servers: "サーバー", software: "AIソフトウェア", platforms: "大手クラウド",
};

export type IntakeSource = {
  url: string; ticker: string; title?: string | null; published_on: string | null;
  discovered_at: string; checked_at: string | null; sha256: string | null;
  content_type?: string | null; content_bytes?: number | null; extracted_chars?: number | null; fetched_at?: string | null;
  status: "pending" | "approved" | "held" | "rejected"; error: string | null;
};
export type ReviewedBrief = {
  url: string; ticker: string; title: string | null; published_on: string | null;
  detected_at: string | null; source_sha256: string;
  summary_ja: string; impact_label: "positive" | "negative" | "mixed" | "neutral" | "uncertain";
  impact_ja: string; confidence: "low" | "medium" | "high"; status: "approved";
  generated_at: string; reviewed_at: string;
};
export type IntakeSnapshot = {
  schemaVersion: number; generatedAt: string; sources: IntakeSource[];
  events?: { id: number; url: string; ticker: string; detected_at: string; title: string | null; published_on: string | null;
    body_fetched_at?: string | null; detection_to_body_ms?: number | null }[];
  history: { id: number; url: string; at: string; kind: string; sha256: string | null }[];
  discoveryRuns: { id: number; ticker: string; at: string; status: "ok" | "fallback" | "degraded"; candidates: number; error: string | null; index_url: string | null }[];
  briefs?: ReviewedBrief[];
};

export type FetchState = "error" | "fetched" | "unfetched";
export function fetchState(source: IntakeSource): FetchState {
  return source.error ? "error" : source.sha256 ? "fetched" : "unfetched";
}

export function intakeCounts(sources: IntakeSource[]) {
  return { total: sources.length, fetched: sources.filter(s => fetchState(s) === "fetched").length,
    unfetched: sources.filter(s => fetchState(s) === "unfetched").length,
    error: sources.filter(s => fetchState(s) === "error").length,
    pending: sources.filter(s => s.status === "pending").length };
}

export function filterSources(sources: IntakeSource[], query: string, ticker: string, state: string, review: string, titles: Record<string, string> = {}, sector = "all") {
  const q = query.trim().toLocaleLowerCase();
  return sources.filter(s => (ticker === "all" || s.ticker === ticker)
    && (state === "all" || fetchState(s) === state)
    && (review === "all" || s.status === review)
    && (sector === "all" || providerByTicker[s.ticker]?.sector === sector)
    && (!q || `${s.ticker} ${providerByTicker[s.ticker]?.name || ""} ${s.title || ""} ${titles[s.url] || ""} ${sourceTitle(s.url)} ${s.url}`.toLocaleLowerCase().includes(q)));
}

export function coverageCounts(data: IntakeSnapshot) {
  const latest = new Map<string, IntakeSnapshot["discoveryRuns"][number]>();
  for (const r of data.discoveryRuns) if (!latest.has(r.ticker) || latest.get(r.ticker)!.id < r.id) latest.set(r.ticker, r);
  return {
    registered: providers.length,
    discovered: providers.filter(p => ["ok", "fallback"].includes(latest.get(p.ticker)?.status ?? "")).length,
    needsCheck: providers.filter(p => latest.get(p.ticker)?.status === "degraded").length,
    untested: providers.filter(p => !latest.has(p.ticker)).length,
  };
}

export function sourceTitle(url: string) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const slug = parts.at(-1) === "default.aspx" ? parts.at(-2)! : parts.at(-1)!;
  return decodeURIComponent(slug).replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

export function snapshotIssues(data: IntakeSnapshot) {
  const issues: string[] = [];
  if (data.schemaVersion !== 1 || !Number.isFinite(Date.parse(data.generatedAt))) issues.push("invalid-version-or-time");
  const urls = new Set<string>();
  for (const s of data.sources) {
    try {
      const url = new URL(s.url);
      const hosts = providerByTicker[s.ticker]?.allowedHosts ?? [];
      if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.username || url.password || (url.port && url.port !== "443")) issues.push("unsafe-url");
      if (urls.has(s.url)) issues.push("duplicate-source");
      urls.add(s.url);
    } catch { issues.push("invalid-url"); }
    if (!providerByTicker[s.ticker] || !["pending", "approved", "held", "rejected"].includes(s.status)) issues.push("invalid-status");
    if (s.sha256 && (!/^[a-f0-9]{64}$/.test(s.sha256) || !s.checked_at)) issues.push("invalid-revision");
    for (const time of [s.discovered_at, s.checked_at]) if (time && (!Number.isFinite(Date.parse(time)) || Date.parse(time) > Date.parse(data.generatedAt))) issues.push("invalid-source-time");
  }
  for (const h of data.history) if (!urls.has(h.url) || !Number.isFinite(Date.parse(h.at))) issues.push("invalid-history");
  for (const event of data.events ?? []) {
    if (!urls.has(event.url) || !providerByTicker[event.ticker] || !Number.isFinite(Date.parse(event.detected_at))) issues.push("invalid-event");
    if (event.body_fetched_at && !Number.isFinite(Date.parse(event.body_fetched_at))) issues.push("invalid-event-body-time");
    if (event.detection_to_body_ms != null && (!Number.isFinite(event.detection_to_body_ms) || event.detection_to_body_ms < 0)) issues.push("invalid-event-latency");
  }
  const impactLabels = new Set(["positive", "negative", "mixed", "neutral", "uncertain"]);
  const confidences = new Set(["low", "medium", "high"]);
  const japanese = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
  for (const brief of data.briefs ?? []) {
    const source = data.sources.find(item => item.url === brief.url);
    if (!source || source.ticker !== brief.ticker || source.sha256 !== brief.source_sha256 || source.error) issues.push("invalid-brief-source");
    if (brief.status !== "approved" || !impactLabels.has(brief.impact_label) || !confidences.has(brief.confidence)) issues.push("invalid-brief-status");
    if (!brief.summary_ja || brief.summary_ja.length > 600 || !brief.impact_ja || brief.impact_ja.length > 900
        || !japanese.test(brief.summary_ja + brief.impact_ja) || /[\u0000-\u001f\u007f<>]/.test(brief.summary_ja + brief.impact_ja)) issues.push("invalid-brief-copy");
    const generated = Date.parse(brief.generated_at);
    const reviewed = Date.parse(brief.reviewed_at);
    if (!Number.isFinite(generated) || !Number.isFinite(reviewed) || reviewed < generated || reviewed > Date.parse(data.generatedAt)) issues.push("invalid-brief-time");
    if (brief.detected_at && !Number.isFinite(Date.parse(brief.detected_at))) issues.push("invalid-brief-detection-time");
  }
  return issues;
}

export type CoverageSource = IntakeSource & { displayTitle: string; fetchState: "error" | "fetched" | "unfetched" };
export type CoverageCompany = {
  ticker: string;
  name: string;
  sector: string;
  sectorKey: string;
  indexUrl: string;
  format: string;
  discovery: { status: "ok" | "fallback" | "degraded" | "untested"; candidates: number; checkedAt: string | null; error: string | null };
  counts: ReturnType<typeof intakeCounts>;
  sources: CoverageSource[];
};

export function buildCoverageCompanies(snapshot: IntakeSnapshot): CoverageCompany[] {
  return providers.map((provider) => {
    const runs = snapshot.discoveryRuns.filter((run) => run.ticker === provider.ticker).toSorted((a, b) => b.id - a.id);
    const latest = runs[0];
    const companySources = snapshot.sources.filter((source) => source.ticker === provider.ticker);
    return {
      ticker: provider.ticker,
      name: provider.name,
      sector: sectorNames[provider.sector],
      sectorKey: provider.sector,
      indexUrl: provider.indexUrl,
      format: provider.format,
      discovery: latest ? {
        status: latest.status === "ok" || latest.status === "fallback" ? latest.status : "degraded",
        candidates: latest.candidates,
        checkedAt: latest.at,
        error: latest.error,
      } : { status: "untested", candidates: 0, checkedAt: null, error: null },
      counts: intakeCounts(companySources),
      sources: companySources.map((source) => ({ ...source, displayTitle: source.title || sourceTitle(source.url), fetchState: fetchState(source) })),
    };
  });
}

export function coverageCompanyIssues(companies: CoverageCompany[]): string[] {
  const issues: string[] = [];
  if (companies.length !== providers.length) issues.push("missing-company");
  if (new Set(companies.map((company) => company.ticker)).size !== companies.length) issues.push("duplicate-company");
  for (const company of companies) {
    if (!company.name || !company.sector || !company.indexUrl) issues.push("incomplete-company");
    if (company.sources.some((source) => source.ticker !== company.ticker)) issues.push("wrong-company-source");
    if (company.counts.total !== company.sources.length) issues.push("invalid-company-count");
  }
  return [...new Set(issues)];
}
