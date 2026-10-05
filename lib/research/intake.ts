import registry from "./providers.json" with { type: "json" };

export const providers = registry;
export const providerByTicker = Object.fromEntries(providers.map(p => [p.ticker, p]));
export const sectorNames: Record<string, string> = {
  semiconductors: "半導体", networking: "ネットワーク", "ai-cloud": "AIクラウド",
  "power-cooling": "電力・冷却", servers: "サーバー", software: "AIソフトウェア", platforms: "大手クラウド",
};
export const sectorNamesEn: Record<string, string> = {
  semiconductors: "Semiconductors", networking: "Networking", "ai-cloud": "AI cloud",
  "power-cooling": "Power & cooling", servers: "Servers", software: "AI software", platforms: "Large cloud platforms",
};

export type IntakeSource = {
  url: string; ticker: string; title?: string | null; published_on: string | null;
  discovered_at: string; checked_at: string | null; sha256: string | null;
  content_type?: string | null; content_bytes?: number | null; extracted_chars?: number | null; fetched_at?: string | null;
  evidence_url?: string | null; evidence_kind?: "direct" | "sec-exhibit-99.1";
  status: "pending" | "approved" | "held" | "rejected"; error: string | null;
};
export type ReviewedBrief = {
  url: string; ticker: string; title: string | null; published_on: string | null;
  detected_at: string | null; source_sha256: string; source_checked_at: string;
  summary_ja: string; impact_label: "positive" | "negative" | "mixed" | "neutral" | "uncertain";
  impact_ja: string; confidence: "low" | "medium" | "high"; status: "approved";
  generation_method: "human" | "ai-assisted"; generated_at: string; reviewed_at: string;
  evidence: { summary: { text: string; truncated: boolean }[]; impact: { text: string; truncated: boolean }[] };
};
export type IntakeSnapshot = {
  schemaVersion: number; generatedAt: string; sources: IntakeSource[];
  events?: { id: number; url: string; ticker: string; detected_at: string; title: string | null; published_on: string | null;
    body_fetched_at?: string | null; detection_to_body_ms?: number | null }[];
  history: { id: number; url: string; at: string; kind: string; sha256: string | null }[];
  discoveryRuns: { id: number; ticker: string; at: string; status: "ok" | "fallback" | "degraded"; candidates: number; error: string | null; index_url: string | null;
    source_format?: string | null; sources_checked?: number; sources_configured?: number }[];
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

export type PdfEvidenceState = "extracted" | "pending" | "error";
export function pdfEvidenceState(source: IntakeSource): PdfEvidenceState | null {
  let isPdf = source.content_type === "application/pdf";
  if (!isPdf) {
    try { isPdf = /\.pdf$/i.test(new URL(source.url).pathname); } catch { isPdf = false; }
  }
  if (!isPdf) return null;
  if (source.error) return "error";
  return (source.extracted_chars ?? 0) > 0 ? "extracted" : "pending";
}

export function pdfEvidenceCounts(sources: IntakeSource[]) {
  const states = sources.map(pdfEvidenceState).filter(state => state !== null);
  const extracted = states.filter(state => state === "extracted").length;
  const pending = states.filter(state => state === "pending").length;
  const error = states.filter(state => state === "error").length;
  return { total: states.length, extracted, pending, error };
}

export type SecEvidenceState = "exhibit" | "direct" | "pending" | "error";
export function secEvidenceState(source: IntakeSource): SecEvidenceState | null {
  let isSecFiling = false;
  try {
    const url = new URL(source.url);
    isSecFiling = url.hostname === "www.sec.gov" && /^\/Archives\/edgar\/data\//i.test(url.pathname);
  } catch { isSecFiling = false; }
  if (!isSecFiling) return null;
  if (source.error === "sec-exhibit-unavailable") return "error";
  if (source.evidence_kind === "sec-exhibit-99.1") return "exhibit";
  if (!source.sha256) return source.error ? "error" : "pending";
  return source.error ? "error" : "direct";
}

export function secEvidenceCounts(sources: IntakeSource[]) {
  const states = sources.map(secEvidenceState).filter(state => state !== null);
  const exhibit = states.filter(state => state === "exhibit").length;
  const direct = states.filter(state => state === "direct").length;
  const pending = states.filter(state => state === "pending").length;
  const error = states.filter(state => state === "error").length;
  return { total: states.length, exhibit, direct, pending, error };
}

export function filterSources(sources: IntakeSource[], query: string, ticker: string, state: string, review: string, titles: Record<string, string> = {}, sector = "all", pdfEvidence = "all", secEvidence = "all") {
  const q = query.trim().toLocaleLowerCase();
  return sources.filter(s => (ticker === "all" || s.ticker === ticker)
    && (state === "all" || fetchState(s) === state)
    && (review === "all" || s.status === review)
    && (sector === "all" || providerByTicker[s.ticker]?.sector === sector)
    && (pdfEvidence === "all" || pdfEvidenceState(s) === pdfEvidence)
    && (secEvidence === "all" || secEvidenceState(s) === secEvidence)
    && (!q || `${s.ticker} ${providerByTicker[s.ticker]?.name || ""} ${s.title || ""} ${titles[s.url] || ""} ${sourceTitle(s.url)} ${s.url}`.toLocaleLowerCase().includes(q)));
}

export function coverageCounts(data: IntakeSnapshot) {
  const latest = new Map(latestDiscoveryRuns(data).map(run => [run.ticker, run]));
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
      if (s.evidence_url) {
        const evidence = new URL(s.evidence_url);
        if (evidence.protocol !== "https:" || !hosts.includes(evidence.hostname) || evidence.username || evidence.password
            || (evidence.port && evidence.port !== "443")) issues.push("unsafe-evidence-url");
        const rules = providerByTicker[s.ticker]?.articleRules ?? [];
        // TWSE material disclosures are inline evidence, not remotely fetched articles.
        // Keep their query identity intact rather than adding them to articleRules.
        const exchangeEvidence = s.ticker === "TSM" && evidence.hostname === "openapi.twse.com.tw"
          && evidence.pathname === "/v1/opendata/t187ap04_L"
          && evidence.searchParams.get("company") === "2330"
          && [...evidence.searchParams.keys()].sort().join(",") === "company,date,id,time"
          && /^\d{7}$/.test(evidence.searchParams.get("date") ?? "")
          && /^\d{1,6}$/.test(evidence.searchParams.get("time") ?? "")
          && /^[0-9a-f]{16}$/.test(evidence.searchParams.get("id") ?? "");
        if (!exchangeEvidence && !rules.some(rule => rule.host === evidence.hostname && new RegExp(rule.pattern).test(evidence.pathname))) issues.push("unsafe-evidence-path");
      }
    } catch { issues.push("invalid-url"); }
    if (s.evidence_kind && !["direct", "sec-exhibit-99.1"].includes(s.evidence_kind)) issues.push("invalid-evidence-kind");
    if (!providerByTicker[s.ticker] || !["pending", "approved", "held", "rejected"].includes(s.status)) issues.push("invalid-status");
    if (s.sha256 && (!/^[a-f0-9]{64}$/.test(s.sha256) || !s.checked_at)) issues.push("invalid-revision");
    for (const time of [s.discovered_at, s.checked_at]) if (time && (!Number.isFinite(Date.parse(time)) || Date.parse(time) > Date.parse(data.generatedAt))) issues.push("invalid-source-time");
  }
  for (const h of data.history) if (!urls.has(h.url) || !Number.isFinite(Date.parse(h.at))) issues.push("invalid-history");
  for (const run of data.discoveryRuns) {
    if ((run.sources_checked != null && (!Number.isInteger(run.sources_checked) || run.sources_checked < 0))
        || (run.sources_configured != null && (!Number.isInteger(run.sources_configured) || run.sources_configured < 1))
        || (run.sources_checked != null && run.sources_configured != null && run.sources_checked > run.sources_configured)
        || (run.status !== "degraded" && run.sources_checked === 0)) issues.push("invalid-discovery-evidence");
  }
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
    if (!source || source.ticker !== brief.ticker || source.sha256 !== brief.source_sha256
        || source.checked_at !== brief.source_checked_at || source.error) issues.push("invalid-brief-source");
    if (brief.status !== "approved" || !impactLabels.has(brief.impact_label) || !confidences.has(brief.confidence)
        || !["human", "ai-assisted"].includes(brief.generation_method)) issues.push("invalid-brief-status");
    if (!brief.summary_ja || brief.summary_ja.length > 600 || !brief.impact_ja || brief.impact_ja.length > 900
        || !japanese.test(brief.summary_ja + brief.impact_ja) || /[\u0000-\u001f\u007f<>]/.test(brief.summary_ja + brief.impact_ja)) issues.push("invalid-brief-copy");
    for (const field of [brief.evidence?.summary, brief.evidence?.impact]) {
      if (!Array.isArray(field) || field.length < 1 || field.length > 2
          || field.some(item => !item || typeof item.text !== "string" || !item.text || item.text.length > 320
            || typeof item.truncated !== "boolean" || /[\u0000-\u001f\u007f]/.test(item.text))) issues.push("invalid-brief-evidence");
    }
    const generated = Date.parse(brief.generated_at);
    const reviewed = Date.parse(brief.reviewed_at);
    const sourceChecked = Date.parse(brief.source_checked_at);
    if (!Number.isFinite(generated) || !Number.isFinite(reviewed) || !Number.isFinite(sourceChecked)
        || reviewed < generated || reviewed > Date.parse(data.generatedAt)
        || sourceChecked > Date.parse(data.generatedAt)) issues.push("invalid-brief-time");
    if (brief.detected_at && !Number.isFinite(Date.parse(brief.detected_at))) issues.push("invalid-brief-detection-time");
  }
  return issues;
}

/**
 * Drop only the records that fail validation, instead of rejecting the whole
 * live snapshot. One malformed source used to send every visitor back to the
 * bundled snapshot, which only changes on a deployment. Each record is
 * checked with the same rules as snapshotIssues; history, events and briefs
 * that reference a dropped source are dropped with it. Returns null when the
 * snapshot itself (version/time) is invalid or the result still has issues.
 */
export function quarantineSnapshot(data: IntakeSnapshot): { snapshot: IntakeSnapshot; dropped: number } | null {
  const empty: IntakeSnapshot = { ...data, sources: [], history: [], discoveryRuns: [], events: [], briefs: [] };
  if (snapshotIssues(empty).length) return null;
  const sources: IntakeSnapshot["sources"] = [];
  const kept = new Map<string, IntakeSnapshot["sources"][number]>();
  for (const source of data.sources ?? []) {
    if (kept.has(source.url) || snapshotIssues({ ...empty, sources: [source] }).length) continue;
    kept.set(source.url, source);
    sources.push(source);
  }
  const withSource = (url: string) => kept.has(url) ? [kept.get(url)!] : [];
  const history = (data.history ?? []).filter(item => !snapshotIssues({ ...empty, sources: withSource(item.url), history: [item] }).length);
  const discoveryRuns = (data.discoveryRuns ?? []).filter(run => !snapshotIssues({ ...empty, discoveryRuns: [run] }).length);
  const events = (data.events ?? []).filter(event => !snapshotIssues({ ...empty, sources: withSource(event.url), events: [event] }).length);
  const briefs = (data.briefs ?? []).filter(brief => !snapshotIssues({ ...empty, sources: withSource(brief.url), briefs: [brief] }).length);
  const snapshot: IntakeSnapshot = { ...data, sources, history, discoveryRuns, events,
    ...(data.briefs !== undefined ? { briefs } : {}) };
  if (data.events === undefined) delete (snapshot as { events?: unknown }).events;
  if (snapshotIssues(snapshot).length) return null;
  const dropped = (data.sources?.length ?? 0) - sources.length + (data.history?.length ?? 0) - history.length
    + (data.discoveryRuns?.length ?? 0) - discoveryRuns.length + (data.events?.length ?? 0) - events.length
    + (data.briefs?.length ?? 0) - briefs.length;
  return { snapshot, dropped };
}

export type CoverageSource = IntakeSource & { displayTitle: string; fetchState: "error" | "fetched" | "unfetched" };
export type CoverageCompany = {
  ticker: string;
  name: string;
  sector: string;
  sectorKey: string;
  indexUrl: string;
  format: string;
  discovery: { status: "ok" | "fallback" | "degraded" | "untested"; candidates: number; checkedAt: string | null; error: string | null;
    sourceFormat: string | null; sourcesChecked: number; sourcesConfigured: number };
  counts: ReturnType<typeof intakeCounts>;
  sources: CoverageSource[];
};

function coverageDiscovery(
  provider: (typeof providers)[number],
  runs: IntakeSnapshot["discoveryRuns"],
): CoverageCompany["discovery"] {
  const latest = runs[0];
  if (!latest) return { status: "untested", candidates: 0, checkedAt: null, error: null,
    sourceFormat: null, sourcesChecked: 0, sourcesConfigured: 1 };
  const ordinary: CoverageCompany["discovery"] = {
    status: latest.status === "ok" || latest.status === "fallback" ? latest.status : "degraded",
    candidates: latest.candidates, checkedAt: latest.at, error: latest.error,
    sourceFormat: latest.source_format ?? null,
    sourcesChecked: latest.sources_checked ?? 1,
    sourcesConfigured: latest.sources_configured ?? 1,
  };
  const primary = new Set([provider.monitorUrl ?? provider.indexUrl,
    ...(provider.fallbackSources ?? []).map(source => source.url)]);
  if (!provider.independentSupplemental) return ordinary;
  // Independently completed BE phases must not let a newer healthy RSS row
  // hide failed or as-yet-unobserved SEC coverage in the existing coverage UI.
  const supplemental = new Set((provider.supplementalSources ?? []).map(source => source.url));
  const phases = [runs.find(run => primary.has(run.index_url ?? "")),
    runs.find(run => supplemental.has(run.index_url ?? ""))];
  const completed = phases.filter((run): run is IntakeSnapshot["discoveryRuns"][number] => Boolean(run));
  const failed = completed.find(run => run.status === "degraded");
  return {
    ...ordinary,
    status: failed || completed.length < 2 ? "degraded" :
      completed.some(run => run.status === "fallback") ? "fallback" : "ok",
    candidates: completed.reduce((sum, run) => sum + run.candidates, 0),
    error: failed?.error ?? null,
    sourceFormat: [...new Set(completed.flatMap(run => (run.source_format ?? "").split("+")).filter(Boolean))].join("+") || null,
    sourcesChecked: completed.reduce((sum, run) => sum + (run.sources_checked ?? 1), 0),
    sourcesConfigured: primary.size + supplemental.size,
  };
}

export function latestDiscoveryRuns(snapshot: IntakeSnapshot): IntakeSnapshot["discoveryRuns"] {
  return providers.flatMap(provider => {
    const runs = snapshot.discoveryRuns.filter(run => run.ticker === provider.ticker).toSorted((a, b) => b.id - a.id);
    const latest = runs[0];
    if (!latest) return [];
    const discovery = coverageDiscovery(provider, runs);
    return [{ ...latest, status: discovery.status === "untested" ? "degraded" : discovery.status,
      candidates: discovery.candidates, error: discovery.error,
      source_format: discovery.sourceFormat, sources_checked: discovery.sourcesChecked,
      sources_configured: discovery.sourcesConfigured }];
  });
}

export function buildCoverageCompanies(snapshot: IntakeSnapshot): CoverageCompany[] {
  return providers.map((provider) => {
    const runs = snapshot.discoveryRuns.filter((run) => run.ticker === provider.ticker).toSorted((a, b) => b.id - a.id);
    const companySources = snapshot.sources.filter((source) => source.ticker === provider.ticker);
    return {
      ticker: provider.ticker,
      name: provider.name,
      sector: sectorNames[provider.sector],
      sectorKey: provider.sector,
      indexUrl: provider.indexUrl,
      format: provider.format,
      discovery: coverageDiscovery(provider, runs),
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
