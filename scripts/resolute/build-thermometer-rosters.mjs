// Builds lib/resolute/thermometer-rosters.json, the two stock lists behind RESOLUTE's thermometer (TP大型株100 and TP半導体40).
//   node scripts/resolute/build-thermometer-rosters.mjs            (writes the file)
// Sources: Nasdaq's own public lists (the NASDAQ-100 constituents; market caps of every U.S.-listed stock).
// - TP大型株100: the NASDAQ-100 as Nasdaq publishes it, one share class per company (101 listed securities, GOOG dropped for GOOGL).
//   Review once or twice a year.
// - TP半導体40: the 40 largest by market cap among the candidates below (chip design, manufacturing, memory, equipment, analog, connectivity).
//   Solar, storage and materials names that Nasdaq files under "Semiconductors" are not candidates. Review in March, June, September and December.
import { writeFileSync } from "node:fs";

const HEADERS = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
const ONE_PER_COMPANY = { GOOG: "GOOGL", FOXA: "FOX" }; // the second class is dropped when the first is present
export const SEMICONDUCTOR_CANDIDATES = [
  "NVDA", "TSM", "AVGO", "SKHY", "AMD", "MU", "INTC", "AMAT", "TXN", "ARM", "ADI", "MRVL", "ASX", "MPWR", "NXPI", "STM", "UMC", "ALAB", "MCHP", "ON",
  "CRDO", "GFS", "CBRS", "MTSI", "TSEM", "LSCC", "SITM", "SWKS", "SMTC", "RMBS", "AMKR", "SLAB", "FORM", "CRUS", "ALGM", "QCOM", "ASML", "LRCX", "KLAC", "TER",
  "ENTG", "ONTO", "QRVO", "MKSI", "ACLS", "CAMT", "NVMI", "KLIC", "PLAB", "POWI", "DIOD", "VSH", "AEIS", "COHU", "UCTT", "ICHR", "AMBA", "MXL", "SYNA", "WOLF",
];
const number = text => Number(String(text ?? "").replace(/[$,]/g, ""));
async function json(url) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}
const ndx = await json("https://api.nasdaq.com/api/quote/list-type/nasdaq100");
const listed = ndx.data.data.rows.map(row => row.symbol);
const nasdaq = listed.filter(symbol => !(symbol in ONE_PER_COMPANY && listed.includes(ONE_PER_COMPANY[symbol]))).sort();
const screener = await json("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&offset=0&download=true");
const caps = new Map(screener.data.rows.map(row => [row.symbol, number(row.marketCap)]));
const ranked = SEMICONDUCTOR_CANDIDATES.filter(symbol => caps.get(symbol) > 0).map(symbol => ({ symbol, marketCap: caps.get(symbol) })).sort((a, b) => b.marketCap - a.marketCap);
const missing = SEMICONDUCTOR_CANDIDATES.filter(symbol => !(caps.get(symbol) > 0));
const output = {
  builtAt: new Date().toISOString().slice(0, 10),
  note: "Equal-weighted baskets. Edit by running scripts/resolute/build-thermometer-rosters.mjs, not by hand.",
  nasdaq100: { source: "Nasdaq (api.nasdaq.com list-type/nasdaq100)", count: nasdaq.length, tickers: nasdaq },
  semiconductors: { source: "Nasdaq market caps of the candidate list", count: Math.min(40, ranked.length), tickers: ranked.slice(0, 40).map(item => item.symbol),
    ranking: ranked.map(item => ({ symbol: item.symbol, marketCapBillion: Math.round(item.marketCap / 1e7) / 100 })), withoutMarketCap: missing },
};
writeFileSync(new URL("../../lib/resolute/thermometer-rosters.json", import.meta.url), JSON.stringify(output, null, 1) + "\n");
console.log(`NASDAQ-100: ${nasdaq.length} tickers; semiconductors: ${output.semiconductors.count} of ${ranked.length} ranked; no market cap: ${missing.join(", ") || "none"}`);
