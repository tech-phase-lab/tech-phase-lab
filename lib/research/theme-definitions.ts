/** Theme Ranking (PRO): the high-tech themes and their member stocks, edited here and nowhere else.
 * Equal-weighted: every member counts the same, so one large stock cannot decide a theme's rank. */
export type ThemeDefinition = { id: string; ja: string; en: string; tickers: readonly string[] };

export const THEMES: readonly ThemeDefinition[] = [
  { id: "ai-chips", ja: "AI半導体", en: "AI chips", tickers: ["NVDA", "AMD", "AVGO", "MRVL", "TSM", "ARM"] },
  { id: "memory", ja: "メモリ", en: "Memory", tickers: ["MU", "SNDK", "WDC", "STX"] },
  { id: "chip-equipment", ja: "半導体製造装置", en: "Chip equipment", tickers: ["AMAT", "LRCX", "KLAC", "ASML", "TER"] },
  { id: "optical", ja: "光・フォトニクス", en: "Optical & photonics", tickers: ["LITE", "COHR", "AAOI", "CIEN", "FN", "CRDO"] },
  { id: "networking", ja: "ネットワーキング", en: "Networking", tickers: ["ANET", "CSCO", "EXTR", "CALX", "ALAB"] },
  { id: "ai-cloud", ja: "AIクラウド", en: "AI cloud", tickers: ["NBIS", "CRWV", "IREN"] },
  { id: "data-centers", ja: "データセンター", en: "Data centers", tickers: ["EQIX", "DLR", "IRM", "APLD", "CORZ"] },
  { id: "ai-servers", ja: "AIサーバー", en: "AI servers", tickers: ["DELL", "SMCI", "HPE"] },
  { id: "power-cooling", ja: "電力・冷却", en: "Power & cooling", tickers: ["VRT", "GEV", "BE", "VST", "CEG"] },
  { id: "software", ja: "ソフトウェア", en: "Software", tickers: ["MSFT", "CRM", "NOW", "ADBE", "PLTR"] },
  { id: "cybersecurity", ja: "サイバーセキュリティ", en: "Cybersecurity", tickers: ["CRWD", "PANW", "ZS", "FTNT", "OKTA"] },
  { id: "robotics", ja: "ロボティクス", en: "Robotics", tickers: ["ISRG", "SYM", "TER", "ROK", "SERV"] },
  { id: "drones", ja: "ドローン", en: "Drones", tickers: ["AVAV", "KTOS", "RCAT", "ONDS", "UMAC"] },
  { id: "space", ja: "宇宙", en: "Space", tickers: ["RKLB", "ASTS", "IRDM", "LUNR"] },
  { id: "nuclear", ja: "原子力・SMR", en: "Nuclear & SMR", tickers: ["OKLO", "SMR", "NNE", "LEU", "CCJ"] },
  { id: "crypto", ja: "暗号資産関連", en: "Crypto-linked", tickers: ["COIN", "MSTR", "MARA", "CLSK", "RIOT"] },
  { id: "quantum", ja: "量子コンピューター", en: "Quantum", tickers: ["IONQ", "RGTI", "QBTS"] },
];

export const THEME_TICKERS: readonly string[] = [...new Set(THEMES.flatMap(theme => theme.tickers))];
