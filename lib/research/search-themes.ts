/** The 17 themes of the stock search's first screen (銘柄検索「テーマから探す」, owner, Nov 26), shared by the page and by the server's
 * 「今日の注目」 snapshot (lib/research/search-focus.ts), whose candidates include every stock listed here.
 * `short`: the English name in the theme list only, where every name stays on one line (owner, Nov 26: Chipmaking, Optical, Networking;
 * Consumer and Quantum because "Consumer & retail" and "Quantum computing" do not fit the 150px column). */
export type SearchTheme = { id: string; ja: string; en: string; short?: string; stocks: readonly (readonly [ticker: string, name: string])[] };

export const SEARCH_THEMES: readonly SearchTheme[] = [
  { id: "chips", ja: "AI半導体", en: "AI chips", stocks: [["NVDA", "NVIDIA"], ["AMD", "AMD"], ["AVGO", "Broadcom"], ["MRVL", "Marvell"], ["CBRS", "Cerebras"], ["ARM", "Arm"]] },
  { id: "memory", ja: "メモリ", en: "Memory", stocks: [["MU", "Micron"], ["SKHY", "SK hynix"], ["DRAM", "Roundhill"], ["SNDK", "SanDisk"], ["WDC", "Western Digital"], ["STX", "Seagate"]] },
  { id: "cloud", ja: "AIクラウド", en: "AI cloud", stocks: [["NBIS", "Nebius"], ["CRWV", "CoreWeave"], ["IREN", "IREN"]] },
  { id: "manufacturing", ja: "半導体製造・検査", en: "Chip manufacturing & testing", short: "Chipmaking", stocks: [["ASML", "ASML"], ["TSM", "TSMC"], ["AEHR", "Aehr Test"]] },
  { id: "optical", ja: "光通信", en: "Optical links", short: "Optical", stocks: [["LITE", "Lumentum"], ["COHR", "Coherent"], ["CRDO", "Credo"], ["GLW", "Corning"], ["AAOI", "Applied Opto"], ["CIEN", "Ciena"]] },
  { id: "network", ja: "ネットワーク・接続", en: "Networking & connectivity", short: "Networking", stocks: [["ALAB", "Astera Labs"], ["ANET", "Arista"], ["APH", "Amphenol"]] },
  { id: "power", ja: "電力・冷却", en: "Power & cooling", stocks: [["VRT", "Vertiv"], ["GEV", "GE Vernova"], ["BE", "Bloom Energy"], ["VST", "Vistra"]] },
  { id: "software", ja: "ソフトウェア", en: "Software", stocks: [["MSFT", "Microsoft"], ["CRM", "Salesforce"], ["NOW", "ServiceNow"], ["ADBE", "Adobe"], ["PLTR", "Palantir"], ["APP", "AppLovin"]] },
  { id: "security", ja: "サイバーセキュリティ", en: "Cybersecurity", stocks: [["CRWD", "CrowdStrike"], ["PANW", "Palo Alto"], ["ZS", "Zscaler"], ["FTNT", "Fortinet"]] },
  { id: "space", ja: "宇宙関連", en: "Space", stocks: [["RKLB", "Rocket Lab"], ["ASTS", "AST SpaceMobile"], ["IRDM", "Iridium"], ["SPCX", "SpaceX"], ["PL", "Planet Labs"]] },
  { id: "drones", ja: "ドローン", en: "Drones", stocks: [["AVAV", "AeroVironment"], ["ONDS", "Ondas"], ["RCAT", "Red Cat"]] },
  { id: "quantum", ja: "量子コンピュータ", en: "Quantum computing", short: "Quantum", stocks: [["IONQ", "IonQ"], ["RGTI", "Rigetti"], ["QBTS", "D-Wave Quantum"]] },
  { id: "gold", ja: "金・金鉱山", en: "Gold & miners", stocks: [["NEM", "Newmont"], ["AEM", "Agnico Eagle"], ["KGC", "Kinross Gold"], ["GLDM", "SPDR Gold Mini"]] },
  { id: "energy", ja: "エネルギー", en: "Energy", stocks: [["XOM", "Exxon Mobil"], ["CVX", "Chevron"], ["COP", "ConocoPhillips"]] },
  { id: "finance", ja: "金融", en: "Financials", stocks: [["JPM", "JPMorgan Chase"], ["V", "Visa"], ["MA", "Mastercard"]] },
  { id: "health", ja: "ヘルスケア", en: "Healthcare", stocks: [["LLY", "Eli Lilly"], ["JNJ", "Johnson & Johnson"], ["ABBV", "AbbVie"]] },
  { id: "consumer", ja: "消費・小売", en: "Consumer & retail", short: "Consumer", stocks: [["AMZN", "Amazon"], ["COST", "Costco"], ["WMT", "Walmart"], ["PM", "Philip Morris"]] },
];

/** Every stock the themes list, once. */
export const THEME_TICKERS: readonly string[] = [...new Set(SEARCH_THEMES.flatMap(theme => theme.stocks.map(([ticker]) => ticker)))];
/** The name a theme row shows under its ticker. */
export const THEME_NAMES: Readonly<Record<string, string>> = Object.fromEntries(SEARCH_THEMES.flatMap(theme => theme.stocks.map(([ticker, name]) => [ticker, name])));
