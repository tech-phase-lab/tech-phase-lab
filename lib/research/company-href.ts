/**
 * Links to a 監視22銘柄 company page (PRO only, owner Nov 25). A reader without PRO is sent to the stock's FREE page instead
 * (price, then 「企業を知る」); the page itself redirects there too (lib/membership/pro-page.ts).
 */
export function companyFreeHref(ticker?: string): string {
  return ticker ? `/research/quote/${encodeURIComponent(ticker)}?from=search` : "/research/stocks";
}
export function companyHref(ticker: string, pro: boolean): string {
  return pro ? `/research/companies/${encodeURIComponent(ticker)}` : companyFreeHref(ticker);
}
