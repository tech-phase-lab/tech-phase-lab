/** The browser-tab title in English for each research page (owner, Nov 6: no Japanese in the English view).
 * The Japanese titles stay in each page's metadata; the English view swaps them after the page opens. */
export const ENGLISH_TITLES: Record<string, string> = {
  "/research": "Tech Phase Research",
  "/research/stocks": "Stock Search",
  "/research/calendar": "Earnings & economic calendar",
  "/research/watchlist": "Watchlist",
  "/research/notebook": "Stock Notebook",
  "/research/radar": "Financial Radar",
  "/research/themes": "Theme Ranking",
  "/research/weekly": "PRO Weekly",
  "/research/capital-map": "Capital Map",
  "/research/compare": "Compare Stocks PRO",
  "/research/faq": "FAQ & help",
  "/research/qa": "Ask Rizel",
  "/research/portfolio": "U.S. stock portfolio",
  "/research/pro-experience": "PRO feature tour",
  "/research/notifications": "Notifications",
  "/research/news": "Tech Alerts",
  "/terms": "Terms of Service",
  "/privacy": "Privacy Policy",
};
/** The English title of a path ("/research/pro-experience/watch-22" falls back to its parent page), or "" when none is set. */
export function englishTitle(pathname: string): string {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const title = ENGLISH_TITLES[clean] ?? ENGLISH_TITLES[clean.replace(/\/[^/]+$/, "")];
  return !title ? "" : title === "Tech Phase Research" ? title : `${title} | ${clean.startsWith("/research") ? "Tech Phase Research" : "Tech Phase"}`;
}
