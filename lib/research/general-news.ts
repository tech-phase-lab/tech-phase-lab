export type GeneralNewsItem = {
  id: string; title: string; url: string; publisher: string; tickers: string[];
  publishedAt: string; observedAt: string; approvedAt: string; summaryJa: string; summaryEn: string;
  impactJa: string; impactEn: string; impactLabel: "positive" | "negative" | "mixed" | "neutral" | "uncertain";
  confidence: "high" | "medium" | "low";
};
export type OfficialUpdate = { id: string; title: string; url: string; publisher: string; tickers: string[]; observedAt: string };
export type GeneralNewsFeed = { ok: true; enabled: boolean; items: GeneralNewsItem[]; officialUpdates?: OfficialUpdate[] };
const officialUpdateHosts = new Set(["nebius.com", "developer.nvidia.com", "x.com", "blogs.arista.com",
  "investor.marvell.com", "racks.vertiv.com", "pr.tsmc.com", "www.palantir.com"]);

export function publicNewsPayload(value: unknown): GeneralNewsFeed {
  if (!value || typeof value !== "object") throw new Error("Invalid news feed");
  const payload = value as Record<string, unknown>;
  if (payload.ok !== true || typeof payload.enabled !== "boolean" || !Array.isArray(payload.items) || payload.items.length > 30) throw new Error("Invalid news feed");
  const updates: { officialUpdates?: OfficialUpdate[] } = {};
  if (payload.officialUpdates !== undefined) {
    if (!Array.isArray(payload.officialUpdates) || payload.officialUpdates.length > 20) throw Error("Invalid updates");
    updates.officialUpdates = payload.officialUpdates.map(raw => {
      if (!raw || typeof raw !== "object") throw Error("Invalid update");
      const v = raw as Record<string, unknown>;
      for (const key of ["id", "title", "url", "publisher", "observedAt"]) if (typeof v[key] !== "string" || !(v[key] as string).trim()) throw Error("Invalid update field");
      const url = new URL(v.url as string);
      if (url.protocol !== "https:" || url.username || url.password || url.port || !officialUpdateHosts.has(url.hostname)) throw Error("Invalid official source");
      if (url.hostname === "x.com" && !/^\/nebiusai\/status\/\d+$/i.test(url.pathname)) throw Error("Invalid official account");
      if (Array.from(v.title as string).length > 180 || (v.publisher as string).length > 80 || !/^\d+$/.test(v.id as string) || !Number.isFinite(Date.parse(v.observedAt as string))) throw Error("Invalid update");
      if (!Array.isArray(v.tickers) || v.tickers.length > 5 || !v.tickers.every(t => typeof t === "string" && /^[A-Z][A-Z0-9.-]{0,9}$/.test(t))) throw Error("Invalid update tickers");
      return { id: v.id as string, title: v.title as string, publisher: v.publisher as string, url: url.href, observedAt: v.observedAt as string, tickers: v.tickers as string[] };
    });
  }
  if (!payload.enabled) return { ok: true, enabled: false, items: [], ...updates };
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
  });
  return { ok: true, enabled: true, items, ...updates };
}
