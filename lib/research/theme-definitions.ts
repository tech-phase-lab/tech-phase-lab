/** Theme Ranking (PRO): the high-tech themes and their member stocks, edited here and nowhere else.
 * Equal-weighted: every member counts the same, so one large stock cannot decide a theme's rank. */
export type GroupId = "tech" | "resources" | "finance" | "health" | "consumer" | "defensive";
export const GROUPS: readonly { id: GroupId; ja: string; en: string }[] = [
  { id: "tech", ja: "ハイテク", en: "High-tech" },
  { id: "resources", ja: "資源・エネルギー", en: "Resources & energy" },
  { id: "finance", ja: "金融", en: "Finance" },
  { id: "health", ja: "ヘルスケア・バイオ", en: "Health & biotech" },
  { id: "consumer", ja: "消費・小売", en: "Consumer & retail" },
  { id: "defensive", ja: "高配当・産業", en: "Dividend & industrials" },
];
export type ThemeDefinition = { id: string; group: GroupId; ja: string; en: string; tickers: readonly string[] };

export const THEMES: readonly ThemeDefinition[] = [
  { group: "tech", id: "ai-chips", ja: "AI半導体", en: "AI chips", tickers: ["NVDA", "AMD", "AVGO", "MRVL", "TSM", "ARM"] },
  { group: "tech", id: "memory", ja: "メモリ", en: "Memory", tickers: ["MU", "SNDK", "WDC", "STX"] },
  { group: "tech", id: "chip-equipment", ja: "半導体製造装置", en: "Chip equipment", tickers: ["AMAT", "LRCX", "KLAC", "ASML", "TER"] },
  { group: "tech", id: "optical", ja: "光・フォトニクス", en: "Optical & photonics", tickers: ["LITE", "COHR", "AAOI", "CIEN", "FN", "CRDO"] },
  { group: "tech", id: "networking", ja: "ネットワーキング", en: "Networking", tickers: ["ANET", "CSCO", "EXTR", "CALX", "ALAB"] },
  { group: "tech", id: "ai-cloud", ja: "AIクラウド", en: "AI cloud", tickers: ["NBIS", "CRWV", "IREN"] },
  { group: "tech", id: "data-centers", ja: "データセンター", en: "Data centers", tickers: ["EQIX", "DLR", "IRM", "APLD", "CORZ"] },
  { group: "tech", id: "ai-servers", ja: "AIサーバー", en: "AI servers", tickers: ["DELL", "SMCI", "HPE"] },
  { group: "tech", id: "power-cooling", ja: "電力・冷却", en: "Power & cooling", tickers: ["VRT", "GEV", "BE", "VST", "CEG"] },
  { group: "tech", id: "software", ja: "ソフトウェア", en: "Software", tickers: ["MSFT", "CRM", "NOW", "ADBE", "PLTR"] },
  { group: "tech", id: "cybersecurity", ja: "サイバーセキュリティ", en: "Cybersecurity", tickers: ["CRWD", "PANW", "ZS", "FTNT", "OKTA"] },
  { group: "tech", id: "robotics", ja: "ロボティクス", en: "Robotics", tickers: ["ISRG", "SYM", "TER", "ROK", "SERV"] },
  { group: "tech", id: "drones", ja: "ドローン", en: "Drones", tickers: ["AVAV", "KTOS", "RCAT", "ONDS", "UMAC"] },
  { group: "tech", id: "space", ja: "宇宙", en: "Space", tickers: ["RKLB", "ASTS", "IRDM", "LUNR"] },
  { group: "tech", id: "nuclear", ja: "原子力・SMR", en: "Nuclear & SMR", tickers: ["OKLO", "SMR", "NNE", "LEU", "CCJ"] },
  { group: "tech", id: "crypto", ja: "暗号資産関連", en: "Crypto-linked", tickers: ["COIN", "MSTR", "MARA", "CLSK", "RIOT"] },
  { group: "tech", id: "quantum", ja: "量子コンピューター", en: "Quantum", tickers: ["IONQ", "RGTI", "QBTS"] },

  // Resources & energy
  { group: "resources", id: "gold", ja: "金鉱山", en: "Gold miners", tickers: ["NEM", "AEM", "KGC", "AU", "HMY", "GFI"] },
  { group: "resources", id: "silver", ja: "銀・貴金属", en: "Silver & precious metals", tickers: ["PAAS", "HL", "CDE", "AG", "WPM"] },
  { group: "resources", id: "copper", ja: "銅・レアメタル", en: "Copper & critical metals", tickers: ["FCX", "SCCO", "MP", "ALB", "TECK"] },
  { group: "resources", id: "oil-major", ja: "石油メジャー", en: "Oil majors", tickers: ["XOM", "CVX", "COP", "OXY", "EOG"] },
  { group: "resources", id: "oil-service", ja: "石油サービス", en: "Oilfield services", tickers: ["SLB", "HAL", "BKR"] },
  { group: "resources", id: "gas", ja: "天然ガス・LNG", en: "Natural gas & LNG", tickers: ["LNG", "EQT", "EXE", "AR", "CTRA"] },
  { group: "resources", id: "solar", ja: "太陽光・再エネ", en: "Solar & renewables", tickers: ["FSLR", "ENPH", "NEE", "RUN", "SEDG"] },
  // Finance
  { group: "finance", id: "big-banks", ja: "大手銀行", en: "Big banks", tickers: ["JPM", "BAC", "C", "WFC", "GS", "MS"] },
  { group: "finance", id: "regional-banks", ja: "地方銀行", en: "Regional banks", tickers: ["KEY", "RF", "HBAN", "CFG", "FITB", "MTB"] },
  { group: "finance", id: "payments", ja: "決済", en: "Payments", tickers: ["V", "MA", "PYPL", "AXP", "COF"] },
  { group: "finance", id: "insurance", ja: "保険", en: "Insurance", tickers: ["PGR", "TRV", "CB", "ALL", "AIG"] },
  { group: "finance", id: "asset-managers", ja: "資産運用・PE", en: "Asset managers & PE", tickers: ["BX", "KKR", "APO", "BLK", "ARES"] },
  { group: "finance", id: "exchanges", ja: "取引所", en: "Exchanges", tickers: ["ICE", "CME", "NDAQ", "CBOE"] },
  // Health & biotech
  { group: "health", id: "big-pharma", ja: "大手製薬", en: "Big pharma", tickers: ["LLY", "JNJ", "MRK", "PFE", "ABBV"] },
  { group: "health", id: "obesity", ja: "肥満症薬", en: "Obesity drugs", tickers: ["LLY", "NVO", "AMGN", "VKTX"] },
  { group: "health", id: "med-devices", ja: "医療機器", en: "Medical devices", tickers: ["MDT", "ISRG", "SYK", "BSX", "ABT"] },
  { group: "health", id: "biotech", ja: "バイオ", en: "Biotech", tickers: ["VRTX", "REGN", "GILD", "MRNA", "BIIB"] },
  { group: "health", id: "managed-care", ja: "医療保険", en: "Managed care", tickers: ["UNH", "ELV", "CI", "CVS", "HUM"] },
  // Consumer & retail
  { group: "consumer", id: "retail", ja: "小売大手", en: "Big retail", tickers: ["WMT", "COST", "HD", "LOW", "TGT"] },
  { group: "consumer", id: "restaurants", ja: "外食", en: "Restaurants", tickers: ["MCD", "SBUX", "CMG", "YUM", "DPZ"] },
  { group: "consumer", id: "travel", ja: "旅行・宿泊", en: "Travel & lodging", tickers: ["BKNG", "ABNB", "MAR", "HLT", "EXPE"] },
  { group: "consumer", id: "staples", ja: "日用品・食品", en: "Staples", tickers: ["PG", "KO", "PEP", "CL", "KMB"] },
  { group: "consumer", id: "autos", ja: "自動車", en: "Autos", tickers: ["TSLA", "GM", "F"] },
  { group: "consumer", id: "airlines", ja: "航空", en: "Airlines", tickers: ["DAL", "UAL", "AAL", "LUV"] },
  { group: "consumer", id: "apparel", ja: "アパレル・ブランド", en: "Apparel & brands", tickers: ["NKE", "LULU", "RL", "TPR"] },
  // Dividend & industrials
  { group: "defensive", id: "utilities", ja: "公益", en: "Utilities", tickers: ["SO", "DUK", "NEE", "D", "AEP"] },
  { group: "defensive", id: "reits", ja: "REIT", en: "REITs", tickers: ["O", "PLD", "SPG", "AMT", "PSA"] },
  { group: "defensive", id: "telecom-tobacco", ja: "通信・タバコ", en: "Telecom & tobacco", tickers: ["T", "VZ", "MO", "PM"] },
  { group: "defensive", id: "defense", ja: "防衛・航空宇宙", en: "Defense & aerospace", tickers: ["LMT", "RTX", "NOC", "GD", "LHX"] },
  { group: "defensive", id: "rails-logistics", ja: "鉄道・物流", en: "Rails & logistics", tickers: ["UNP", "CSX", "NSC", "UPS", "FDX"] },
  { group: "defensive", id: "machinery", ja: "重工業・機械", en: "Heavy industry & machinery", tickers: ["CAT", "DE", "HON", "GE", "ETN"] },
];

export const themesOf = (group: GroupId) => THEMES.filter(theme => theme.group === group);
export const tickersOf = (group: GroupId): string[] => [...new Set(themesOf(group).flatMap(theme => theme.tickers))];
export const THEME_TICKERS: readonly string[] = [...new Set(THEMES.flatMap(theme => theme.tickers))];
export const isGroupId = (value: unknown): value is GroupId => GROUPS.some(group => group.id === value);
