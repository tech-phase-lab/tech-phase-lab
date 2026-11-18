import { availableNewsPayload, type GeneralNewsFeed } from "@/lib/research/general-news";
import { parseCompanyWire, type CompanyWireItem } from "@/lib/research/company-wire";
import { publicPriceTargets, type PriceTarget } from "@/lib/research/price-targets";

/** 銘柄手帳's reads, shared by the page and its two parts so the page can open in one go (owner, Nov 18: it opened in three visible steps).
 * The news / wire / target reads do not depend on the list, so the page starts them before the saved lists have answered. A read is reused
 * for a minute; a failed one is not kept, so the next open asks again. The server decides what FREE receives (/api/research/news). */
export type NotebookSources = { feed: GeneralNewsFeed | null; wire: Record<string, CompanyWireItem[]>; targets: PriceTarget[] | null; ok: boolean };
export type WeekAnswer = { ok: boolean; body: { ok?: boolean; error?: string } & Record<string, unknown> | null };

const REUSE_MS = 60_000;
let sources: { promise: Promise<NotebookSources>; at: number } | null = null;
const weeks = new Map<string, { promise: Promise<WeekAnswer>; at: number }>();

const getJson = async (url: string, timeout: number) => {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw Error(url);
  return response.json();
};

export function notebookSources(): Promise<NotebookSources> {
  if (sources && Date.now() - sources.at < REUSE_MS) return sources.promise;
  const promise = (async (): Promise<NotebookSources> => {
    const [news, companyWire, priceTargets] = await Promise.allSettled([getJson("/api/research/news", 15_000), getJson("/api/research/company-wire", 15_000), getJson("/api/research/price-targets", 15_000)]);
    let feed: GeneralNewsFeed | null = null, wire: Record<string, CompanyWireItem[]> = {}, targets: PriceTarget[] | null = null;
    if (news.status === "fulfilled") { try { feed = availableNewsPayload(news.value); } catch { /* shown as unavailable */ } }
    if (companyWire.status === "fulfilled") { try { wire = parseCompanyWire(companyWire.value).items; } catch { /* optional lane */ } }
    if (priceTargets.status === "fulfilled") { try { targets = publicPriceTargets(priceTargets.value).items; } catch { /* optional lane */ } }
    return { feed, wire, targets, ok: news.status === "fulfilled" || priceTargets.status === "fulfilled" };
  })();
  const entry = { promise, at: Date.now() };
  sources = entry;
  void promise.then(result => { if (!result.ok && sources === entry) sources = null; });
  return promise;
}

/** This week's price moves for `key` (tickers joined by commas). `fresh` asks again (the reload button). */
export function notebookWeek(key: string, fresh = false): Promise<WeekAnswer> {
  const kept = weeks.get(key);
  if (!fresh && kept && Date.now() - kept.at < REUSE_MS) return kept.promise;
  const promise = (async (): Promise<WeekAnswer> => {
    try {
      const response = await fetch(`/api/research/notebook-week?tickers=${encodeURIComponent(key)}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const body = await response.json().catch(() => null);
      return { ok: response.ok && body?.ok === true, body };
    } catch { return { ok: false, body: null }; }
  })();
  const entry = { promise, at: Date.now() };
  weeks.set(key, entry);
  void promise.then(result => { if (!result.ok && weeks.get(key) === entry) weeks.delete(key); });
  return promise;
}
