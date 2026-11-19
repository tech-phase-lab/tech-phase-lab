/** The symbol Twelve Data uses for a ticker from the SEC's list. The SEC writes a share class with a dash (BRK-B, LEN-B, HEI-A, PBR-A); the
 *  provider writes it with a dot (BRK.B) and answers 404 for the dashed form, which left those companies with no price, forward P/E or
 *  statements. Only a single-letter class is mapped: preferreds (-PB), warrants (-WT), units (-UN) and rights (-RI) are other securities. */
export function providerSymbol(ticker: string): string {
  const share = /^([A-Z]{1,6})-([A-OQ-Z])$/.exec(ticker);
  return share ? `${share[1]}.${share[2]}` : ticker;
}

/** True when a provider payload's own symbol is this ticker's (as the SEC writes it, or as the provider does). */
export const sameProviderSymbol = (symbol: unknown, ticker: string) => symbol === ticker || symbol === providerSymbol(ticker);
