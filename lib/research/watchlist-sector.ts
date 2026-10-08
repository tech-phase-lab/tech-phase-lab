type SectorLabel = { ja: string; en: string };

// Watchlist-only labels. Do not expand the news monitoring registry for display.
// Group by the existing investment theme: connectivity belongs with MRVL/CRDO,
// even when the underlying products are semiconductors. Astera Labs source:
// https://www.asteralabs.com/about/ (reviewed 2026-10-08)
const additionalSectors: Record<string, SectorLabel> = {
  ALAB: { ja: "ネットワーク", en: "Networking" },
};

export function watchlistSector(ticker: string, registered?: SectorLabel): SectorLabel | undefined {
  // SEC search results supply an exchange, not an industry. Unknown classifications
  // deliberately have no badge, including after reloading saved tickers.
  return registered ?? (Object.hasOwn(additionalSectors, ticker) ? additionalSectors[ticker] : undefined);
}
