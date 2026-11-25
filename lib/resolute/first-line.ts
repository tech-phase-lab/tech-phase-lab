/** 衝撃度チェッカーの「最初のラインまで」(Shock Gauge, "Until your first price level").
 *
 * The member's first line is the shallowest purchase level of their saved plan (plan.buyLines[].dropPct), measured from the reference
 * price they set for each stock on the closing-price alert screen (notification settings watchItems; the server already applies stock
 * splits to it, notification-splits.ts). The same numbers the closing-price alerts use (alert-judge.ts): a stock reaches its first line
 * when its price is at or below referencePrice × (100 − dropPct) / 100.
 *
 * The current price is the site's shared quote copy (/api/research/market/quotes: one provider read per symbol and time slot for every
 * member, through the Twelve Data allocator), never a provider call of its own. Nothing is invented: without a saved plan line, a saved
 * stock or a usable price, there is no view and the screen leaves the row out (owner: no placeholder text). */

export type FirstLineItem = { symbol: string; referencePrice: number };
export type FirstLinePrice = { price: number; asOf: string };
export type FirstLineView = {
  symbol: string;
  price: number;
  asOf: string;
  referencePrice: number;
  dropPct: number;
  linePrice: number;
  /** How far the price still has to fall to reach the line, in % of the current price (0 or less: reached). One decimal. */
  awayPct: number;
  reached: boolean;
  /** 0 at the reference price, 1 at the line (the share of the way from the reference down to the line already travelled). */
  progress: number;
};

/** A price older than this is not shown as "current" (a long weekend plus a holiday is four days). */
export const FIRST_LINE_PRICE_MAX_AGE_MS = 8 * 86_400_000;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,14}$/;
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The shallowest purchase level of the plan, or null when the plan has none. */
export function firstDropPct(buyLines: readonly { dropPct: number }[] | null | undefined): number | null {
  const lines = (buyLines ?? []).map(l => l.dropPct).filter(p => positive(p) && p < 100);
  return lines.length ? Math.min(...lines) : null;
}

/** The stock nearest to (or furthest past) its first line, or null when nothing can be shown truthfully. */
export function firstLineView(
  items: readonly FirstLineItem[],
  buyLines: readonly { dropPct: number }[] | null | undefined,
  prices: Readonly<Record<string, FirstLinePrice | undefined>>,
  now = Date.now(),
): FirstLineView | null {
  const dropPct = firstDropPct(buyLines);
  if (dropPct === null) return null;
  let best: FirstLineView | null = null, bestRaw = Infinity;
  for (const item of items) {
    if (!SYMBOL.test(item.symbol) || !positive(item.referencePrice)) continue;
    const quote = prices[item.symbol];
    if (!quote || !positive(quote.price)) continue;
    const at = Date.parse(quote.asOf);
    if (!Number.isFinite(at) || now - at > FIRST_LINE_PRICE_MAX_AGE_MS) continue;
    const linePrice = Math.round(item.referencePrice * (100 - dropPct)) / 100;
    const reached = quote.price <= linePrice, raw = (quote.price - linePrice) / quote.price * 100;
    const awayPct = reached ? 0 : Math.max(0.1, round1(raw));
    const span = item.referencePrice - linePrice;
    const progress = Math.min(1, Math.max(0, (item.referencePrice - quote.price) / span));
    const view = { symbol: item.symbol, price: quote.price, asOf: quote.asOf, referencePrice: item.referencePrice, dropPct, linePrice, awayPct, reached, progress };
    // A stock already past its line comes first (the furthest past), then the one closest to it.
    if (!best || raw < bestRaw) { best = view; bestRaw = raw; }
  }
  return best;
}
