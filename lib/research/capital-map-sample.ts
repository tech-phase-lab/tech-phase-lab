import type { CapitalHolding, CapitalPortfolio, CapitalSnapshot } from "./capital-map";

// All values and dates are synthetic, NOT downloaded manager/ETF disclosures.
const stock = (ticker: string, name: string, shares: number, value: number): CapitalHolding => ({
  securityId: ticker, ticker, name, shares, value, instrument: "stock", outstandingShares: null,
});
const snapshot = (id: string, asOf: string, publishedOn: string, holdings: CapitalHolding[]): CapitalSnapshot => ({ id, asOf, publishedOn, complete: true, holdings });
export const capitalMapSamples: CapitalPortfolio[] = [
  {
    id: "berkshire-demo", kind: "manager", name: "Berkshire Hathaway", subtitle: "BRK · DISPLAY SAMPLE",
    current: snapshot("berkshire-demo-2", "2026-06-30", "2026-08-14", [
      stock("AAPL", "Apple", 800, 32000), stock("AXP", "American Express", 700, 26000),
      stock("BAC", "Bank of America", 600, 19000), stock("KO", "Coca-Cola", 500, 15000), stock("GOOGL", "Alphabet Class A", 100, 8000),
    ]),
    previous: snapshot("berkshire-demo-1", "2026-03-31", "2026-05-15", [
      stock("AAPL", "Apple", 1000, 35000), stock("AXP", "American Express", 700, 24000),
      stock("BAC", "Bank of America", 500, 17000), stock("KO", "Coca-Cola", 500, 14000), stock("V", "Visa", 200, 10000),
    ]),
  },
  {
    id: "tech-manager-demo", kind: "manager", name: "TECH FUND", subtitle: "FICTIONAL MANAGER",
    current: snapshot("tech-demo-2", "2026-06-30", "2026-08-14", [
      stock("NVDA", "NVIDIA", 500, 40000), stock("NBIS", "Nebius", 300, 24000), stock("MU", "Micron", 200, 18000), stock("AAPL", "Apple", 100, 10000),
      { ...stock("SMH", "VanEck Semiconductor ETF", 100, 8000), instrument: "put" },
    ]),
    previous: snapshot("tech-demo-1", "2026-03-31", "2026-05-15", [
      stock("NVDA", "NVIDIA", 500, 35000), stock("NBIS", "Nebius", 200, 18000), stock("MU", "Micron", 100, 12000), stock("AAPL", "Apple", 100, 10000),
    ]),
  },
  {
    id: "qqq-demo", kind: "etf", name: "QQQ", subtitle: "ETF · DISPLAY SAMPLE",
    current: snapshot("qqq-demo-2", "2026-10-09", "2026-10-09", [
      stock("NVDA", "NVIDIA", 100, 30000), stock("AAPL", "Apple", 100, 24000), stock("MSFT", "Microsoft", 100, 22000), stock("AMZN", "Amazon", 100, 16000), stock("MU", "Micron", 100, 8000),
    ]),
    previous: snapshot("qqq-demo-1", "2026-10-08", "2026-10-08", [
      stock("NVDA", "NVIDIA", 100, 28000), stock("AAPL", "Apple", 100, 25000), stock("MSFT", "Microsoft", 100, 22000), stock("AMZN", "Amazon", 100, 17000), stock("MU", "Micron", 100, 8000),
    ]),
  },
  {
    id: "smh-demo", kind: "etf", name: "SMH", subtitle: "ETF · DISPLAY SAMPLE",
    current: snapshot("smh-demo-2", "2026-10-09", "2026-10-09", [
      stock("NVDA", "NVIDIA", 100, 35000), stock("TSM", "TSMC", 100, 25000), stock("AVGO", "Broadcom", 100, 20000), stock("MU", "Micron", 100, 12000), stock("ASML", "ASML", 100, 8000),
    ]),
    previous: snapshot("smh-demo-1", "2026-10-08", "2026-10-08", [
      stock("NVDA", "NVIDIA", 100, 33000), stock("TSM", "TSMC", 100, 27000), stock("AVGO", "Broadcom", 100, 20000), stock("MU", "Micron", 100, 12000), stock("ASML", "ASML", 100, 8000),
    ]),
  },
];
