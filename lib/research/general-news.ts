import providers from "./providers.json" with { type: "json" };
import { parseResultBriefs, type ResultBrief } from "./market-results.ts";
type NewsBody = { bodyJa?: string; bodyEn?: string };
type CompactTitles = { shortTitleJa?: string; shortTitleEn?: string };
export type GeneralNewsItem = CompactTitles & {
  id: string; title: string; url: string; publisher: string; tickers: string[];
  publishedAt: string; observedAt: string; approvedAt: string; summaryJa: string; summaryEn: string;
  impactJa: string; impactEn: string; impactLabel: "positive" | "negative" | "mixed" | "neutral" | "uncertain";
  confidence: "high" | "medium" | "low";
};
export type OfficialNewsSource = { id: string; url: string; publisher: string; publishedAt: string; observedAt: string };
export type OfficialUpdate = CompactTitles & NewsBody & { id: string; title: string; translationJa?: string; url: string; publisher: string; tickers: string[]; observedAt: string; publishedAt?: string; publishedOn?: string; researchId?: string; sources?: OfficialNewsSource[] };
export type MarketUpdate = CompactTitles & { id: string; titleJa: string; titleEn: string; url: string; topic: "index-membership" | "government-bonds" | "crude-oil"; publishedAt: string; observedAt: string };
export type GeneralNewsFeed = { ok: true; enabled: boolean; items: GeneralNewsItem[]; officialUpdates?: OfficialUpdate[]; marketUpdates?: MarketUpdate[]; resultBriefs?: ResultBrief[] };
const officialUpdateHosts = new Set(["nebius.com", "developer.nvidia.com", "x.com", "blogs.arista.com",
  "investor.marvell.com", "racks.vertiv.com", "pr.tsmc.com", "www.palantir.com", "www.bea.gov"]);

// Optional display copy must never make a valid full article disappear.
function compactTitles(value: Record<string, unknown>): CompactTitles {
  const ja = value.shortTitleJa, en = value.shortTitleEn;
  const valid = (text: unknown): text is string => typeof text === "string"
    && !!text.trim() && Array.from(text).length <= 180 && !/[\0\r\n]/.test(text);
  return valid(ja) && valid(en) ? { shortTitleJa: ja.trim(), shortTitleEn: en.trim() } : {};
}

// Optional approved story text never admits private source bodies or analysis.
function newsBody(value: Record<string, unknown>, maxLength = 12000): NewsBody {
  const valid = (v: unknown): v is string => typeof v === "string" && !!v.trim()
    && v.length <= maxLength && !v.includes("\0");
  return valid(value.bodyJa) && valid(value.bodyEn)
    ? { bodyJa: value.bodyJa, bodyEn: value.bodyEn } : {};
}

// Keep the strict validator for every article, but isolate a rejected article
// from unrelated valid stories. Never substitute previously cached publications.
export function availableNewsPayload(value: unknown): GeneralNewsFeed {
  if (!value || typeof value !== "object") throw Error("Invalid news feed");
  const raw = value as Record<string, unknown>;
  const base = publicNewsPayload({ ok: raw.ok, enabled: raw.enabled, items: [] });
  const accepted: Record<string, unknown[]> = {};
  for (const [key, limit] of [["resultBriefs", 20], ["officialUpdates", 20], ["marketUpdates", 20], ["items", 30]] as const) {
    if (raw[key] === undefined && key !== "items") continue;
    const rows = raw[key];
    accepted[key] = [];
    if (!Array.isArray(rows) || rows.length > limit) continue;
    for (const row of rows) {
      try {
        const checked = publicNewsPayload({ ...base, resultBriefs: accepted.resultBriefs,
          [key]: [row] });
        accepted[key].push(...(checked[key] ?? []));
      } catch { /* Only the rejected article is omitted. */ }
    }
  }
  return publicNewsPayload({ ...base, ...accepted });
}

export function publicNewsPayload(value: unknown): GeneralNewsFeed {
  if (!value || typeof value !== "object") throw new Error("Invalid news feed");
  const payload = value as Record<string, unknown>;
  if (payload.ok !== true || typeof payload.enabled !== "boolean" || !Array.isArray(payload.items) || payload.items.length > 30) throw new Error("Invalid news feed");
  const updates: { officialUpdates?: OfficialUpdate[]; marketUpdates?: MarketUpdate[]; resultBriefs?: ResultBrief[] } = {};
  if (payload.marketUpdates !== undefined) {
    if (!Array.isArray(payload.marketUpdates) || payload.marketUpdates.length > 20) throw Error("Invalid market updates");
    updates.marketUpdates = payload.marketUpdates.map(raw => {
      if (!raw || typeof raw !== "object") throw Error("Invalid market update");
      const v = raw as Record<string, unknown>;
      for (const key of ["id", "titleJa", "titleEn", "url", "publishedAt", "observedAt"]) {
        if (typeof v[key] !== "string" || !(v[key] as string).trim() || (v[key] as string).length > 4000 || (v[key] as string).includes("\0")) throw Error("Invalid market field");
      }
      const url = new URL(v.url as string);
      const account = /^\/(TrendSpider|Barchart)\/status\/\d+$/i.exec(url.pathname)?.[1].toLowerCase();
      if (url.protocol !== "https:" || url.hostname !== "x.com" || url.username || url.password || url.port || url.search || url.hash || !account || !/^\d+$/.test(v.id as string)) throw Error("Invalid market source");
      if (account === "trendspider" ? v.topic !== "index-membership" : !["government-bonds", "crude-oil"].includes(v.topic as string)) throw Error("Invalid market topic");
      for (const key of ["publishedAt", "observedAt"]) {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v[key] as string) || !Number.isFinite(Date.parse(v[key] as string))) throw Error("Invalid market date");
      }
      return { ...compactTitles(v), id: v.id as string, titleJa: v.titleJa as string, titleEn: v.titleEn as string, url: url.href, topic: v.topic as MarketUpdate["topic"], publishedAt: v.publishedAt as string, observedAt: v.observedAt as string };
    });
  }
  if (payload.resultBriefs !== undefined) updates.resultBriefs = parseResultBriefs(payload.resultBriefs);
  if (payload.officialUpdates !== undefined) {
    if (!Array.isArray(payload.officialUpdates) || payload.officialUpdates.length > 20) throw Error("Invalid updates");
    const seenOfficialUrls = new Set<string>();
    updates.officialUpdates = payload.officialUpdates.map(raw => {
      if (!raw || typeof raw !== "object") throw Error("Invalid update");
      const v = raw as Record<string, unknown>;
      for (const key of ["id", "title", "url", "publisher", "observedAt"]) if (typeof v[key] !== "string" || !(v[key] as string).trim()) throw Error("Invalid update field");
      const url = new URL(v.url as string);
      const verifiedMu = url.href === 'https://www.sec.gov/Archives/edgar/data/723125/000072312526000018/a2026q4ex991-pressrelease.htm';
      // One reviewed issuer announcement retained from its syndicated source.
      // This does not admit the PR Newswire host or other issuer mentions.
      const reviewedOracle = v.id === "1179" && v.publisher === "Oracle / PR Newswire"
        && v.title === "Oracle Announces Commitment to Absorb $300 Million in Rising Point Beach Energy Costs for Wisconsin Residents"
        && Array.isArray(v.tickers) && v.tickers.length === 1 && v.tickers[0] === "ORCL"
        && url.href === "https://www.prnewswire.com/news-releases/oracle-announces-commitment-to-absorb-300-million-in-rising-point-beach-energy-costs-for-wisconsin-residents-302896645.html";
      const issuerRelease = providers.some(provider => Array.isArray(v.tickers) && v.tickers.includes(provider.ticker)
        && provider.articleRules.some(rule => rule.host === url.hostname && new RegExp(rule.pattern).test(url.pathname))
        && url.hostname !== "www.sec.gov" && url.hostname !== "data.sec.gov" && !url.search && !url.hash);
      if (url.protocol !== "https:" || url.username || url.password || url.port || (!officialUpdateHosts.has(url.hostname) && !verifiedMu && !issuerRelease && !reviewedOracle)) throw Error("Invalid official source");
      if (url.hostname === "x.com" && !/^\/(nebiusai|tipranks|theflynews|wallstengine|fabymetal4)\/status\/\d+$/i.test(url.pathname)) throw Error("Invalid official account");
      if (url.hostname === "www.bea.gov" && (!/^\/news\/20\d{2}\/personal-income-and-outlays-[a-z]+-20\d{2}$/.test(url.pathname) || url.search || url.hash)) throw Error("Invalid BEA release");
      if (Array.from(v.title as string).length > 180 || (v.publisher as string).length > 80 || !/^\d+$/.test(v.id as string) || !Number.isFinite(Date.parse(v.observedAt as string))) throw Error("Invalid update");
      if (!Array.isArray(v.tickers) || v.tickers.length > 5 || !v.tickers.every(t => typeof t === "string" && /^[A-Z][A-Z0-9.-]{0,9}$/.test(t))) throw Error("Invalid update tickers");
      const publication: { publishedAt?: string; publishedOn?: string } = {};
      const translation: { translationJa?: string } = {};
      if (v.translationJa !== undefined) {
        if (typeof v.translationJa !== "string" || !v.translationJa.trim() || Array.from(v.translationJa).length > 180) throw Error("Invalid translation");
        translation.translationJa = v.translationJa.trim();
      }
      if (v.publishedAt !== undefined) {
        if (typeof v.publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v.publishedAt) || !Number.isFinite(Date.parse(v.publishedAt))) throw Error("Invalid publication time");
        publication.publishedAt = new Date(v.publishedAt).toISOString();
      }
      if (v.publishedOn !== undefined) {
        if (typeof v.publishedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.publishedOn) || !Number.isFinite(Date.parse(v.publishedOn)) || new Date(v.publishedOn).toISOString().slice(0,10) !== v.publishedOn) throw Error("Invalid publication date");
        publication.publishedOn = v.publishedOn;
      }
      const resultReference = updates.resultBriefs?.some(r => r.kind === 'earnings' && r.researchId === v.researchId && r.url === url.href);
      if (v.researchId !== undefined && !(verifiedMu && v.researchId === 'mu-q4-2026') && !resultReference && !(issuerRelease && v.researchId === `ir-result-${v.id}`)) throw Error('Invalid research reference');
      const sources: OfficialNewsSource[] = [];
      if (Array.isArray(v.sources) && v.sources.length <= 20) {
        for (const raw of v.sources) {
          if (!raw || typeof raw !== "object") continue;
          const source = raw as Record<string, unknown>;
          const brief = updates.resultBriefs?.find(r => r.id === source.id && r.url === source.url
            && (v.tickers as string[]).includes(r.ticker));
          if (!brief || sources.some(s => s.url === brief.url)) continue;
          // Reconstruct only from independently validated public result briefs.
          // Arbitrary links, source bodies and analysis never pass through.
          sources.push({ id: brief.id, url: brief.url, publisher: brief.publisher,
            publishedAt: brief.publishedAt, observedAt: brief.observedAt });
        }
      }
      const mergedResult = sources.length > 1 && Array.isArray(v.sources) && sources.length === v.sources.length;
      return { ...compactTitles(v), ...newsBody(v, mergedResult ? 40000 : 12000), id: v.id as string, title: v.title as string, publisher: v.publisher as string, url: url.href, observedAt: v.observedAt as string, tickers: v.tickers as string[], ...publication, ...translation, ...(v.researchId ? {researchId:v.researchId as string} : {}), ...(sources.length ? { sources } : {}) };
    }).filter(item => {
      if (seenOfficialUrls.has(item.url)) return false;
      seenOfficialUrls.add(item.url);
      return true;
    });
  }
  if (!payload.enabled) return { ok: true, enabled: false, items: [], ...updates };
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const items = payload.items.map((raw): GeneralNewsItem => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid item");
    const item = raw as Record<string, unknown>;
    const field = (name: string, max: number) => {
      const text = item[name];
      if (typeof text !== "string" || !text.trim() || text.length > max) throw new Error("Invalid field");
      return text;
    };
    const id = field("id", 64);
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid id");
    const url = new URL(field("url", 4096));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid URL");
    const date = (key: string) => { const text = field(key, 50); if (!Number.isFinite(Date.parse(text))) throw new Error("Invalid date"); return text; };
    const tickers = item.tickers;
    if (!Array.isArray(tickers) || tickers.length > 50 || !tickers.every(t => typeof t === "string" && /^[A-Z][A-Z0-9.-]{0,9}$/.test(t))) throw new Error("Invalid tickers");
    const impactLabel = field("impactLabel", 10);
    const confidence = field("confidence", 6);
    if (!["positive", "negative", "mixed", "neutral", "uncertain"].includes(impactLabel)
        || !["high", "medium", "low"].includes(confidence)
        || (impactLabel === "uncertain" && confidence !== "low")) throw new Error("Invalid impact");
    return { ...compactTitles(item), id, title: field("title", 2000), url: url.href, publisher: field("publisher", 500), tickers,
      publishedAt: date("publishedAt"), observedAt: date("observedAt"), approvedAt: date("approvedAt"),
      summaryJa: field("summaryJa", 1200), summaryEn: field("summaryEn", 1200),
      impactJa: field("impactJa", 1200), impactEn: field("impactEn", 1200),
      impactLabel: impactLabel as GeneralNewsItem["impactLabel"], confidence: confidence as GeneralNewsItem["confidence"] };
  }).filter(item => {
    if (seenIds.has(item.id) || seenUrls.has(item.url)) return false;
    seenIds.add(item.id);
    seenUrls.add(item.url);
    return true;
  });
  return { ok: true, enabled: true, items, ...updates };
}
