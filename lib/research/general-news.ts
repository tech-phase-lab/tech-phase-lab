import { parseResultBriefs, type ResultBrief } from "./market-results.ts";
export type GeneralNewsItem = {
  id: string; title: string; url: string; publisher: string; tickers: string[];
  publishedAt: string; observedAt: string; approvedAt: string; summaryJa: string; summaryEn: string;
  impactJa: string; impactEn: string; impactLabel: "positive" | "negative" | "mixed" | "neutral" | "uncertain";
  confidence: "high" | "medium" | "low";
};
export type OfficialUpdate = { id: string; title: string; translationJa?: string; url: string; publisher: string; tickers: string[]; observedAt: string; publishedAt?: string; publishedOn?: string; researchId?: string };
export type GeneralNewsFeed = { ok: true; enabled: boolean; items: GeneralNewsItem[]; officialUpdates?: OfficialUpdate[]; resultBriefs?: ResultBrief[] };
const officialUpdateHosts = new Set(["nebius.com", "developer.nvidia.com", "x.com", "blogs.arista.com",
  "investor.marvell.com", "racks.vertiv.com", "pr.tsmc.com", "www.palantir.com", "www.bea.gov"]);

export function publicNewsPayload(value: unknown): GeneralNewsFeed {
  if (!value || typeof value !== "object") throw new Error("Invalid news feed");
  const payload = value as Record<string, unknown>;
  if (payload.ok !== true || typeof payload.enabled !== "boolean" || !Array.isArray(payload.items) || payload.items.length > 30) throw new Error("Invalid news feed");
  const updates: { officialUpdates?: OfficialUpdate[]; resultBriefs?: ResultBrief[] } = {};
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
      if (url.protocol !== "https:" || url.username || url.password || url.port || (!officialUpdateHosts.has(url.hostname) && !verifiedMu)) throw Error("Invalid official source");
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
      if (v.researchId !== undefined && !(verifiedMu && v.researchId === 'mu-q4-2026') && !resultReference) throw Error('Invalid research reference');
      return { id: v.id as string, title: v.title as string, publisher: v.publisher as string, url: url.href, observedAt: v.observedAt as string, tickers: v.tickers as string[], ...publication, ...translation, ...(v.researchId ? {researchId:v.researchId as string} : {}) };
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
    return { id, title: field("title", 2000), url: url.href, publisher: field("publisher", 500), tickers,
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
