/** Where a stock's logo is looked for, in order (owner, Nov 25). 1. The data provider's (Twelve Data's) square logo for the company's domain, when the
 * domain is known (lib/research/stock-logo-domains.ts). 2. A logo keyed by the ticker itself, so a stock without a known domain still has one.
 * The site-icon service used before is gone: it answered Micron and Marvell with black glyphs that vanished on the dark square. */
export function logoSources(ticker: string, domain?: string): string[] {
  return [...(domain ? [`https://api.twelvedata.com/logo/${encodeURIComponent(domain)}`] : []), `https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`];
}
