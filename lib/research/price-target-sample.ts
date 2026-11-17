import type { PriceTarget } from "./price-targets.ts";

/** Nov 17 (owner, filming the PRO video): the sample price-target notice the monitor sends from a Railway variable
 * (scripts/research/web_push.py, DEMO_TARGET_URL) opens /research/price-targets?demo=nvda. With that query, and
 * only then, the page shows the same made-up change at the top of the list, as a real row timed now. It lives in this browser only:
 * nothing is written anywhere, nobody else sees it, and the page removes the query so a reload shows the normal list. */
export const PRICE_TARGET_SAMPLE_PARAM = "demo";
export const PRICE_TARGET_SAMPLE_VALUE = "nvda";

/** The sample row for these search params at this time, or null (any other query, or none). */
export function priceTargetSample(params: { get: (name: string) => string | null } | null | undefined, now: number): PriceTarget | null {
  if (params?.get(PRICE_TARGET_SAMPLE_PARAM) !== PRICE_TARGET_SAMPLE_VALUE || !Number.isFinite(now)) return null;
  const at = new Date(now).toISOString();
  // Fictional firm and numbers (the same as the notice); id 0 never collides with a real row (real ids are positive).
  return { id: 0, source: "Sample", url: "", publishedAt: at, observedAt: at, ticker: "NVDA", firm: "Sample Securities", previous: 295, latest: 340 };
}

/** The address without the sample query (other params and the fragment kept), for history.replaceState; null when there is nothing to remove. */
export function withoutSampleQuery(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(PRICE_TARGET_SAMPLE_PARAM)) return null;
  url.searchParams.delete(PRICE_TARGET_SAMPLE_PARAM);
  return url.pathname + url.search + url.hash;
}

/** The rows the list shows: the sample first, then the real ones. */
export function withPriceTargetSample(items: PriceTarget[], sample: PriceTarget | null): PriceTarget[] {
  return sample ? [sample, ...items] : items;
}
