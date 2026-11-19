// The provider store for the audit: no Twelve Data call is ever made. For a symbol Twelve Data lists (the audit passes its reference list), the
// price series is a synthetic, recent, split-adjusted daily series in the listed currency, so the price-dependent code runs as it does in
// production once the background job has stored the real series. Statistics (forward P/E) and the provider's statements are not audited.
const audit = () => globalThis.__comparisonAudit ?? {};
export const providerConfigured = () => true;
export const twelveComparisonConfigured = () => true;
export function syntheticSeries(ticker, currency, now = Date.now()) {
  const values = [];
  for (let i = 1; i <= 140; i++) {
    const date = new Date(now - i * 86400000);
    if ([0, 6].includes(date.getUTCDay())) continue;
    values.push({ datetime: date.toISOString().slice(0, 10), close: String(100 + (i % 7)) });
  }
  return { adjust: "splits", retrievedAt: new Date(now).toISOString(), payload: { meta: { symbol: ticker, interval: "1day", currency }, status: "ok", values } };
}
export async function loadMarketInputs(ticker) {
  const currency = audit().priceCurrency?.(ticker);
  // The provider answers with its own symbol (BRK.B for BRK-B), as production receives it.
  return currency ? { series: syntheticSeries(audit().providerSymbol?.(ticker) ?? ticker, currency) } : {};
}
export async function loadTwelveComparison() { return null; }
export async function loadTwelveComparisonState() { return { data: null, busy: false }; }
export function scheduleFill() {}
export function backgroundFill() { return Promise.resolve(); }
export async function cachedStatistics() { return null; }
export async function cachedStatements() { return null; }
export async function userSeries(ticker) { return (await loadMarketInputs(ticker)).series ?? null; }
export async function minuteUsage() { return null; }
export const weeklyNote = () => ({ read: async () => null, write: async () => null });
export const warmStatistics = async () => null, warmSeries = async () => null, warmStatements = async () => null;
export const hasStatisticsToday = async () => false, hasSeriesToday = async () => false;
export const fetching = read => read();
