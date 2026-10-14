/** Per-company headlines from public wires: Japanese only once checked. */
export type CompanyWireItem = {
  id: string; titleEn: string; titleJa: string | null; publisher: string;
  origin: "wire" | "third-party" | "unknown"; url: string; publishedAt: string;
};
export type CompanyWireFeed = { ok: true; items: Record<string, CompanyWireItem[]> };

const TICKER = /^[A-Z]{1,5}$/;
const text = (value: unknown, max: number) => typeof value === "string" && !!value.trim() && value.length <= max && !value.includes("\0");

/** Rejected rows are dropped one by one; nothing malformed reaches the page. */
export function parseCompanyWire(value: unknown): CompanyWireFeed {
  if (!value || typeof value !== "object" || (value as { ok?: unknown }).ok !== true) throw new Error("Invalid company wire");
  const raw = (value as { items?: unknown }).items;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid company wire");
  const items: Record<string, CompanyWireItem[]> = {};
  for (const [ticker, rows] of Object.entries(raw)) {
    if (!TICKER.test(ticker) || !Array.isArray(rows) || rows.length > 20) continue;
    const kept: CompanyWireItem[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const v = row as Record<string, unknown>;
      if (!text(v.id, 64) || !text(v.titleEn, 400) || !(v.titleJa === null || text(v.titleJa, 400))
        || typeof v.publisher !== "string" || v.publisher.length > 200 || !["wire", "third-party", "unknown"].includes(v.origin as string)
        || !text(v.url, 2000) || !text(v.publishedAt, 40) || !Number.isFinite(Date.parse(v.publishedAt as string))) continue;
      let url: URL;
      try { url = new URL(v.url as string); } catch { continue; }
      if (url.protocol !== "https:" || url.username || url.password) continue;
      kept.push({ id: v.id as string, titleEn: v.titleEn as string, titleJa: v.titleJa as string | null, publisher: v.publisher as string,
        origin: v.origin as CompanyWireItem["origin"], url: url.href, publishedAt: v.publishedAt as string });
    }
    if (kept.length) items[ticker] = kept;
  }
  return { ok: true, items };
}
