/** Theme Ranking (PRO): the high-tech themes and their member stocks, edited here and nowhere else.
 * Equal-weighted: every member counts the same, so one large stock cannot decide a theme's rank. */
export type ThemeDefinition = { id: string; ja: string; en: string; tickers: readonly string[] };

export const THEMES: readonly ThemeDefinition[] = [
  { id: "ai-chips", ja: "AI半導体", en: "AI chips", tickers: ["NVDA", "AMD", "AVGO", "MRVL", "TSM", "ARM"] },
  { id: "memory", ja: "メモリ", en: "Memory", tickers: ["MU", "SNDK", "WDC", "STX"] },
  { id: "chip-equipment", ja: "半導体製造装置", en: "Chip equipment", tickers: ["AMAT", "LRCX", "KLAC", "ASML", "TER"] },
  { id: "optical", ja: "光通信", en: "Optical links", tickers: ["LITE", "COHR", "CRDO", "AAOI", "CIEN"] },
  { id: "ai-cloud", ja: "AIクラウド", en: "AI cloud", tickers: ["NBIS", "CRWV", "IREN"] },
  { id: "ai-servers", ja: "AIサーバー", en: "AI servers", tickers: ["DELL", "SMCI", "HPE"] },
  { id: "power-cooling", ja: "電力・冷却", en: "Power & cooling", tickers: ["VRT", "GEV", "BE", "VST", "CEG"] },
  { id: "software", ja: "ソフトウェア", en: "Software", tickers: ["MSFT", "CRM", "NOW", "ADBE", "PLTR"] },
  { id: "cybersecurity", ja: "サイバーセキュリティ", en: "Cybersecurity", tickers: ["CRWD", "PANW", "ZS", "FTNT", "OKTA"] },
  { id: "space", ja: "宇宙", en: "Space", tickers: ["RKLB", "ASTS", "IRDM", "LUNR"] },
  { id: "quantum", ja: "量子コンピューター", en: "Quantum", tickers: ["IONQ", "RGTI", "QBTS"] },
];

export const THEME_TICKERS: readonly string[] = [...new Set(THEMES.flatMap(theme => theme.tickers))];
