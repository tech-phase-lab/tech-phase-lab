export type GeneralNewsItem = {
  id: string; title: string; url: string; publisher: string; tickers: string[];
  publishedAt: string; observedAt: string; approvedAt: string; summaryJa: string; summaryEn: string;
};
export type GeneralNewsFeed = { ok: true; enabled: boolean; items: GeneralNewsItem[] };

export function publicNewsPayload(value: unknown): GeneralNewsFeed {
  if (!value || typeof value !== "object") throw new Error("Invalid news feed");
  const payload = value as Record<string, unknown>;
  if (payload.ok !== true || typeof payload.enabled !== "boolean" || !Array.isArray(payload.items) || payload.items.length > 30) throw new Error("Invalid news feed");
  if (!payload.enabled) return { ok: true, enabled: false, items: [] };
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
    return { id, title: field("title", 2000), url: url.href, publisher: field("publisher", 500), tickers,
      publishedAt: date("publishedAt"), observedAt: date("observedAt"), approvedAt: date("approvedAt"),
      summaryJa: field("summaryJa", 1200), summaryEn: field("summaryEn", 1200) };
  });
  return { ok: true, enabled: true, items };
}
