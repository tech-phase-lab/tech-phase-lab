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
  status: "pending" | "approved" | "held" | "rejected"; error: string | null;
};
export type IntakeSnapshot = {
  schemaVersion: number; generatedAt: string; sources: IntakeSource[];
  history: { id: number; url: string; at: string; kind: string; sha256: string | null }[];
  discoveryRuns: { id: number; ticker: string; at: string; status: string; candidates: number; error: string | null; index_url: string | null }[];
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
    discovered: providers.filter(p => latest.get(p.ticker)?.status === "ok").length,
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
  return issues;
}
