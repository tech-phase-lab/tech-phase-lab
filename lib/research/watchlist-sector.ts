type SectorLabel = { ja: string; en: string };

// Watchlist-only labels. Do not expand the news monitoring registry for display.
// Astera Labs describes its products as semiconductor-based connectivity:
// https://www.asteralabs.com/about/ (reviewed 2026-10-08)
const additionalSectors: Record<string, SectorLabel> = {
  ALAB: { ja: "半導体", en: "Semiconductors" },
};

export function watchlistSector(ticker: string, registered?: SectorLabel): SectorLabel | undefined {
  // SEC search results supply an exchange, not an industry. Unknown classifications
  // deliberately have no badge, including after reloading saved tickers.
  return registered ?? (Object.hasOwn(additionalSectors, ticker) ? additionalSectors[ticker] : undefined);
}
