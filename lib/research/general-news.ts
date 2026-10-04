import providers from "./providers.json" with { type: "json" };
import reportedNewsTickers from "./reported-news-tickers.json" with { type: "json" };
import { parseResultBriefs, type ResultBrief } from "./market-results.ts";
import { parseAnalystUpdates, type AnalystUpdate } from "./analyst-news.ts";
import { marketNewsDetail, type MarketNewsDetail } from "./market-news-detail.ts";
type Syndication = { policy: "issuer-capacity-contract-v1" | "issuer-business-news-v1"; issuer: string; distributor: "GlobeNewswire" | "PR Newswire" };
export const OFFICIAL_NEWS_HISTORY_LIMIT = 100;
export const NEWS_BRIEF_TITLE_SUFFIXES = { ja: "（短報・詳細確認中）", en: " (brief; details awaiting review)" } as const;
export type OfficialHistory = { limit: number; sourceEligible: number; returned: number; omitted: number; hasMore: boolean; byteLimited: boolean; coreOverTarget: boolean };
type NewsBody = { bodyJa?: string; bodyEn?: string };
type CompactTitles = { shortTitleJa?: string; shortTitleEn?: string };
export type GeneralNewsItem = CompactTitles & {
  id: string; title: string; url: string; publisher: string; tickers: string[];
  publishedAt: string; observedAt: string; approvedAt: string; summaryJa: string; summaryEn: string;
  impactJa: string; impactEn: string; impactLabel: "positive" | "negative" | "mixed" | "neutral" | "uncertain";
  confidence: "high" | "medium" | "low";
};
export type OfficialNewsSource = { id: string; url: string; publisher: string; publishedAt: string; observedAt: string };
export type OfficialNewsBrief = { version: 1; scope: "company" | "sector"; validFacts: number; pendingFacts: number };
export type OfficialUpdate = CompactTitles & NewsBody & { brief?: OfficialNewsBrief; generalSource?: 1; newsCategory?: "policy"; syndication?: Syndication; id: string; title: string; translationJa?: string; url: string; publisher: string; tickers: string[]; observedAt: string; publishedAt?: string; publishedOn?: string; researchId?: string; sources?: OfficialNewsSource[] };
export type MarketUpdate = CompactTitles & MarketNewsDetail & { id: string; titleJa: string; titleEn: string; url: string; topic: "index-membership" | "government-bonds" | "crude-oil"; publishedAt: string; observedAt: string };
export type GeneralNewsFeed = { ok: true; enabled: boolean; items: GeneralNewsItem[]; officialUpdates?: OfficialUpdate[]; marketUpdates?: MarketUpdate[]; analystUpdates?: AnalystUpdate[]; resultBriefs?: ResultBrief[]; officialHistory?: OfficialHistory };
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

// This presentation classification is emitted only by the source-bound policy
// adapter. It neither admits a new source nor authorizes an issuer/ticker claim.
function policyNewsCategory(value: Record<string, unknown>): { newsCategory?: "policy"; generalSource?: 1 } {
  if (value.newsCategory === undefined) return {};
  if (value.newsCategory !== "policy" || value.generalSource !== 1
    || value.publisher !== "Reported economic news" || typeof value.url !== "string"
    || !/^https:\/\/x\.com\/(wallstengine|tipranks|fabymetal4)\/status\/\d+$/i.test(value.url)
    || value.brief !== undefined || value.syndication !== undefined || value.researchId !== undefined
    || value.sources !== undefined || !Array.isArray(value.tickers) || value.tickers.length !== 0
    || !newsBody(value).bodyJa
    || typeof value.translationJa !== "string" || !value.translationJa.trim()) {
    throw Error("Invalid policy news category");
  }
  return { generalSource: 1, newsCategory: "policy" };
}

// Partial publications retain their explicit source and review boundary on each
// server/browser parse. Invalid markers cannot silently become full articles.
function newsBrief(value: Record<string, unknown>): { brief?: OfficialNewsBrief; generalSource?: 1 } {
  if (value.brief === undefined) return {};
  const marker = value.brief;
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) throw Error("Invalid news brief");
  const brief = marker as Record<string, unknown>;
  const validCount = (count: unknown): count is number => Number.isInteger(count) && Number(count) >= 1 && Number(count) <= 7;
  const statusTitle = (title: unknown, suffix: string): title is string => typeof title === "string"
    && title.endsWith(suffix) && !!title.slice(0, -suffix.length).trim();
  if (value.generalSource !== 1 || typeof value.url !== "string"
    || !/^https:\/\/x\.com\/(wallstengine|tipranks)\/status\/\d+$/i.test(value.url)
    || brief.version !== 1 || !["company", "sector"].includes(brief.scope as string)
    || !validCount(brief.validFacts) || !validCount(brief.pendingFacts) || brief.validFacts + brief.pendingFacts > 8
    || !newsBody(value).bodyJa || !Array.isArray(value.tickers)
    || (brief.scope === "sector" ? value.tickers.length !== 0
      : value.tickers.length !== 1 || !reportedNewsTickers.includes(value.tickers[0]))) {
    throw Error("Invalid news brief");
  }
  // Older clients discard the new marker, so core and compact headlines must
  // independently disclose that details remain under review.
  if (!statusTitle(value.title, NEWS_BRIEF_TITLE_SUFFIXES.en)
    || !statusTitle(value.translationJa, NEWS_BRIEF_TITLE_SUFFIXES.ja)
    || (value.shortTitleEn !== undefined && !statusTitle(value.shortTitleEn, NEWS_BRIEF_TITLE_SUFFIXES.en))
    || (value.shortTitleJa !== undefined && !statusTitle(value.shortTitleJa, NEWS_BRIEF_TITLE_SUFFIXES.ja))) {
    throw Error("Invalid brief review status");
  }
  // A sector brief cannot reuse the private company assessment's headline,
  // including the compact headline shown by the home rotation.
  if (brief.scope === "sector" && (value.title !== `Broker industry outlook${NEWS_BRIEF_TITLE_SUFFIXES.en}`
    || value.translationJa !== `証券会社による業界見通し${NEWS_BRIEF_TITLE_SUFFIXES.ja}` || value.publisher !== "Reported industry news"
    || (value.shortTitleJa !== undefined && value.shortTitleJa !== value.translationJa)
    || (value.shortTitleEn !== undefined && value.shortTitleEn !== value.title))) {
    throw Error("Invalid sector brief");
  }
  return { generalSource: 1, brief: { version: 1, scope: brief.scope as OfficialNewsBrief["scope"],
    validFacts: brief.validFacts, pendingFacts: brief.pendingFacts } };
}

// Keep the strict validator for every article, but isolate a rejected article
// from unrelated valid stories. Never substitute previously cached publications.
export function availableNewsPayload(value: unknown): GeneralNewsFeed {
  if (!value || typeof value !== "object") throw Error("Invalid news feed");
  const raw = value as Record<string, unknown>;
  const base = publicNewsPayload({ ok: raw.ok, enabled: raw.enabled, items: [], officialHistory: raw.officialHistory });
  const accepted: Record<string, unknown[]> = {};
  for (const [key, limit] of [["resultBriefs", 20], ["officialUpdates", OFFICIAL_NEWS_HISTORY_LIMIT], ["marketUpdates", 20], ["analystUpdates", 30], ["items", 30]] as const) {
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
  const updates: { officialUpdates?: OfficialUpdate[]; marketUpdates?: MarketUpdate[]; analystUpdates?: AnalystUpdate[]; resultBriefs?: ResultBrief[]; officialHistory?: OfficialHistory } = {};
  if (payload.officialHistory && typeof payload.officialHistory === "object") {
    const h = payload.officialHistory as Record<string, unknown>;
    if (h.limit === OFFICIAL_NEWS_HISTORY_LIMIT
      && ["sourceEligible", "returned", "omitted"].every(k => Number.isInteger(h[k]) && Number(h[k]) >= 0 && Number(h[k]) <= 600)
      && Number(h.returned) <= OFFICIAL_NEWS_HISTORY_LIMIT
      && ["hasMore", "byteLimited", "coreOverTarget"].every(k => typeof h[k] === "boolean")) {
      updates.officialHistory = { limit: OFFICIAL_NEWS_HISTORY_LIMIT, sourceEligible: Number(h.sourceEligible), returned: Number(h.returned), omitted: Number(h.omitted), hasMore: h.hasMore as boolean, byteLimited: h.byteLimited as boolean, coreOverTarget: h.coreOverTarget as boolean };
    }
  }
  if (payload.analystUpdates !== undefined) updates.analystUpdates = parseAnalystUpdates(payload.analystUpdates);
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
      return { ...compactTitles(v), ...marketNewsDetail(v), id: v.id as string, titleJa: v.titleJa as string, titleEn: v.titleEn as string, url: url.href, topic: v.topic as MarketUpdate["topic"], publishedAt: v.publishedAt as string, observedAt: v.observedAt as string };
    });
  }
  if (payload.resultBriefs !== undefined) updates.resultBriefs = parseResultBriefs(payload.resultBriefs);
  if (payload.officialUpdates !== undefined) {
    if (!Array.isArray(payload.officialUpdates) || payload.officialUpdates.length > OFFICIAL_NEWS_HISTORY_LIMIT) throw Error("Invalid updates");
    const seenOfficialUrls = new Map<string, number>();
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
      // The API admits only verified source-bound bilingual contract facts.
      // A syndicated host or a company mention alone cannot admit a story.
      const rawSyndication = v.syndication as Record<string, unknown> | undefined;
      let syndication: Syndication | undefined;
      const syndicationSubject = typeof v.title === "string"
        ? /^(.+) Signs Contract with (.+) for AI Data Center Capacity$/.exec(v.title) : null;
      const syndicatedIssuer = typeof rawSyndication?.issuer === "string"
        ? rawSyndication.issuer.replace(/(?:,?\s+(?:Inc\.?|Corporation|Corp\.?|Ltd\.?|Limited))$/, "") : null;
      const syndicatedPartners: Record<string, string[]> = { NBIS: ["Nebius"] };
      if (rawSyndication && rawSyndication.policy === "issuer-capacity-contract-v1"
        && typeof rawSyndication.issuer === "string" && /^[A-Za-z][A-Za-z0-9 .,&'()-]{1,69}$/.test(rawSyndication.issuer)
        && ((rawSyndication.distributor === "GlobeNewswire" && ["www.globenewswire.com", "globenewswire.com"].includes(url.hostname)
            && /^\/news-release\/20\d{2}\/\d{2}\/\d{2}\/\d+\/0\/en\/[a-z0-9-]+\.html$/i.test(url.pathname))
          || (rawSyndication.distributor === "PR Newswire" && url.hostname === "www.prnewswire.com"
            && /^\/news-releases\/[a-z0-9-]+-\d+\.html$/i.test(url.pathname)))
        && !url.search && !url.hash
        && v.publisher === `${rawSyndication.issuer} / ${rawSyndication.distributor}`
        && typeof v.title === "string" && /^[A-Za-z][A-Za-z0-9 .,&'()-]+ Signs Contract with [A-Za-z][A-Za-z0-9 .-]+ for AI Data Center Capacity$/.test(v.title)
        && typeof v.translationJa === "string" && !!v.translationJa.trim()
        && Array.isArray(v.tickers) && v.tickers.length === 1 && typeof v.tickers[0] === "string"
        && syndicationSubject?.[1] === syndicatedIssuer
        && (syndicatedPartners[v.tickers[0]] ?? []).includes(syndicationSubject?.[2] ?? "")
        && !!newsBody(v).bodyJa && typeof v.publishedAt === "string") {
        syndication = { policy: "issuer-capacity-contract-v1", issuer: rawSyndication.issuer, distributor: rawSyndication.distributor };
      }
      if (rawSyndication?.policy === "issuer-business-news-v1"
        && typeof rawSyndication.issuer === "string" && /^[A-Za-z][A-Za-z0-9 .,&'()-]{1,69}$/.test(rawSyndication.issuer)
        && ((rawSyndication.distributor === "GlobeNewswire" && ["www.globenewswire.com", "globenewswire.com"].includes(url.hostname)
            && /^\/news-release\/20\d{2}\/\d{2}\/\d{2}\/\d+\/0\/en\/[a-z0-9-]+\.html$/i.test(url.pathname))
          || (rawSyndication.distributor === "PR Newswire" && url.hostname === "www.prnewswire.com"
            && /^\/news-releases\/[a-z0-9-]+-\d+\.html$/i.test(url.pathname)))
        && !url.search && !url.hash && v.publisher === `${rawSyndication.issuer} / ${rawSyndication.distributor}`
        && typeof v.title === "string" && !!syndicatedIssuer && v.title.toLowerCase().startsWith(syndicatedIssuer.toLowerCase() + " ")
        && /\b(contract|agreement|partnership|acqui(re|res|red|sition)|launch(es|ed)?|introduc(es|ed)|capacity|production|business outlook|guidance)\b/i.test(v.title)
        && !/\b(lawsuit|class action|shareholder alert|webinar|conference|presentation)\b/i.test(v.title)
        && Array.isArray(v.tickers) && v.tickers.length === 1 && providers.some(p => p.ticker === (v.tickers as string[])[0])
        && typeof v.translationJa === "string" && !!v.translationJa.trim()
        && !!newsBody(v).bodyJa && typeof v.publishedAt === "string") {
        syndication = { policy: "issuer-business-news-v1", issuer: rawSyndication.issuer, distributor: rawSyndication.distributor };
      }
      if (v.syndication !== undefined && !syndication) throw Error("Invalid syndicated release");
      const issuerRelease = providers.some(provider => Array.isArray(v.tickers) && v.tickers.includes(provider.ticker)
        && provider.articleRules.some(rule => rule.host === url.hostname && new RegExp(rule.pattern).test(url.pathname))
        && url.hostname !== "www.sec.gov" && url.hostname !== "data.sec.gov" && !url.search && !url.hash);
      if (url.protocol !== "https:" || url.username || url.password || url.port || (!officialUpdateHosts.has(url.hostname) && !verifiedMu && !issuerRelease && !reviewedOracle && !syndication)) throw Error("Invalid official source");
      // This reporter is admitted only through the source-bound buyback path.
      // Retain its marker so server and browser validation enforce the same lane.
      const reportedBuyback = url.hostname === "x.com" && /^\/trendspider\/status\/\d+$/i.test(url.pathname)
        && !url.search && !url.hash && v.generalSource === 1 && v.brief === undefined
        && v.publisher === "Reported company news" && Array.isArray(v.tickers) && v.tickers.length === 1
        && typeof v.tickers[0] === "string" && reportedNewsTickers.includes(v.tickers[0])
        && [`${v.tickers[0]}: Reported share buyback`, `${v.tickers[0]}: Reported buyback recap`].includes(v.title as string)
        && typeof v.translationJa === "string" && !!v.translationJa.trim() && !!newsBody(v).bodyJa;
      if (url.hostname === "x.com" && !/^\/(nebiusai|tipranks|theflynews|wallstengine|fabymetal4)\/status\/\d+$/i.test(url.pathname)
        && !reportedBuyback) throw Error("Invalid official account");
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
      return { ...(syndication ? { syndication } : {}), ...newsBrief(v), ...policyNewsCategory(v), ...(reportedBuyback ? { generalSource: 1 as const } : {}), ...compactTitles(v), ...newsBody(v, mergedResult ? 40000 : 12000), id: v.id as string, title: v.title as string, publisher: v.publisher as string, url: url.href, observedAt: v.observedAt as string, tickers: v.tickers as string[], ...publication, ...translation, ...(v.researchId ? {researchId:v.researchId as string} : {}), ...(sources.length ? { sources } : {}) };
    }).reduce<OfficialUpdate[]>((items, item) => {
      const index = seenOfficialUrls.get(item.url);
      if (index === undefined) {
        seenOfficialUrls.set(item.url, items.length);
        items.push(item);
      } else if (items[index].id === item.id && items[index].brief && !item.brief && item.bodyJa && item.bodyEn) {
        // A complete publication promotes this same source story in place.
        items[index] = item;
      }
      return items;
    }, []);
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

// Apply the same wire-size target after frontend result merging can add copy.
// Other sections stay intact; any omitted official history is explicit metadata.
export function boundedOfficialHistory(value: GeneralNewsFeed): GeneralNewsFeed {
  const original = value.officialUpdates ?? [];
  const officialUpdates = original.slice(0, OFFICIAL_NEWS_HISTORY_LIMIT);
  const prior = value.officialHistory;
  const result: GeneralNewsFeed = { ...value, officialUpdates };
  const metadata = (byteLimited: boolean): OfficialHistory => ({
    limit: OFFICIAL_NEWS_HISTORY_LIMIT, sourceEligible: prior?.sourceEligible ?? original.length,
    returned: officialUpdates.length, omitted: (prior?.omitted ?? 0) + original.length - officialUpdates.length,
    hasMore: !!prior?.hasMore || officialUpdates.length < original.length,
    byteLimited: !!prior?.byteLimited || byteLimited, coreOverTarget: false,
  });
  const size = () => new TextEncoder().encode(JSON.stringify(result)).length;
  result.officialHistory = metadata(false);
  while (size() > 450_000 && officialUpdates.length) {
    officialUpdates.pop(); result.officialHistory = metadata(true);
  }
  if (size() > 450_000) result.officialHistory.coreOverTarget = true;
  if (size() > 500_000) {
    // Optional new diagnostics must not poison an otherwise valid near-limit core.
    delete result.officialHistory;
    if (size() > 500_000) throw Error("Oversized news core");
    console.warn("news-history-diagnostics-omitted-response-limit");
  }
  return result;
}

export type InitialNewsSnapshot = { data: GeneralNewsFeed; checkedAt: number };
