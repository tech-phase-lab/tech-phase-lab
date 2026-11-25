import rosters from './thermometer-rosters.json' with { type: 'json' };
/** Shock Gauge single-company news (owner, Nov 25): which company a headline names, and which TP basket is its industry.
 * Only companies the thermometer prices (its two rosters) can be measured: their daily closes are already read every day.
 * A chip company's industry is TP半導体40; any other rostered company's is TP大型株100 (the only other basket we have).
 * Names are matched as whole words in the headline (English and the usual Japanese names); a bare ticker counts only in
 * capitals ("NVDA", "MU"). Pure data and functions: the same headline always names the same company. */
export type IndustryBasket = 'sox' | 'nas100';
const SEMIS = new Set<string>(rosters.semiconductors.tickers);
const LARGE = new Set<string>(rosters.nasdaq100.tickers);
/** The industry basket of a rostered ticker; null when neither basket prices it (never measurable). */
export function industryOf(ticker: string): IndustryBasket | null { return SEMIS.has(ticker) ? 'sox' : LARGE.has(ticker) ? 'nas100' : null; }

// Ticker → company names (rostered companies only; one alternation each).
const NAMES: Record<string, string> = {
  NVDA: 'Nvidia|NVIDIA|エヌビディア', TSM: 'TSMC|Taiwan Semiconductor(?: Manufacturing)?|台湾積体電路|台積電', AVGO: 'Broadcom|ブロードコム',
  SKHY: 'SK ?[Hh]ynix|SKハイニックス', AMD: 'AMD|Advanced Micro Devices', MU: 'Micron|マイクロン', ASML: 'ASML', INTC: 'Intel|インテル',
  AMAT: 'Applied Materials|アプライド・マテリアルズ', LRCX: 'Lam Research|ラムリサーチ', TXN: 'Texas Instruments|テキサス・インスツルメンツ',
  KLAC: 'KLA', ARM: 'Arm Holdings|アーム', ADI: 'Analog Devices', QCOM: 'Qualcomm|クアルコム', MRVL: 'Marvell|マーベル',
  ASX: 'ASE Technology', MPWR: 'Monolithic Power', NXPI: 'NXP', STM: 'STMicro(?:electronics)?', TER: 'Teradyne', UMC: 'United Microelectronics|UMC',
  ALAB: 'Astera Labs', MCHP: 'Microchip Technology|Microchip', ON: 'onsemi|ON Semiconductor', CRDO: 'Credo', GFS: 'GlobalFoundries',
  CBRS: 'Cerebras', ENTG: 'Entegris', MTSI: 'MACOM', TSEM: 'Tower Semiconductor', LSCC: 'Lattice Semiconductor', MKSI: 'MKS Instruments',
  SITM: 'SiTime', SWKS: 'Skyworks', SMTC: 'Semtech', NVMI: 'Nova Ltd', ONTO: 'Onto Innovation', AEIS: 'Advanced Energy', RMBS: 'Rambus',
  AAPL: 'Apple|アップル', ABNB: 'Airbnb', ADBE: 'Adobe|アドビ', ADP: 'Automatic Data Processing', ADSK: 'Autodesk', AMZN: 'Amazon|アマゾン',
  APP: 'AppLovin', AXON: 'Axon', BKNG: 'Booking Holdings', CDNS: 'Cadence Design|Cadence', CEG: 'Constellation Energy', CMCSA: 'Comcast',
  COST: 'Costco|コストコ', CRWD: 'CrowdStrike|クラウドストライク', CRWV: 'CoreWeave|コアウィーブ', CSCO: 'Cisco|シスコ', DASH: 'DoorDash',
  DDOG: 'Datadog', FTNT: 'Fortinet', GOOGL: 'Alphabet|Google|アルファベット|グーグル', INTU: 'Intuit', ISRG: 'Intuitive Surgical', LITE: 'Lumentum',
  MELI: 'MercadoLibre', META: 'Meta Platforms|Meta|メタ・プラットフォームズ', MSFT: 'Microsoft|マイクロソフト', MSTR: 'MicroStrategy|Strategy Inc',
  NBIS: 'Nebius|ネビウス', NFLX: 'Netflix|ネットフリックス', PANW: 'Palo Alto Networks', PDD: 'PDD Holdings|Temu', PEP: 'PepsiCo',
  PLTR: 'Palantir|パランティア', PYPL: 'PayPal', RKLB: 'Rocket Lab', SHOP: 'Shopify', SNDK: 'SanDisk|Sandisk', SNPS: 'Synopsys',
  STX: 'Seagate', TMUS: 'T-Mobile', TSLA: 'Tesla|テスラ', WDAY: 'Workday', WDC: 'Western Digital', WMT: 'Walmart|ウォルマート',
};
const ESCAPE_TICKER = (t: string) => t.replace(/\./g, '\\.');
// Ticker forms are case-sensitive capitals; names are case-insensitive whole words (Japanese names need no word boundary).
const PATTERNS: [string, RegExp, RegExp][] = Object.entries(NAMES).filter(([t]) => industryOf(t)).map(([t, names]) => [t,
  new RegExp(`(?:^|[^A-Za-z0-9])(?:${names})(?:['’]s)?(?![A-Za-z0-9])`, 'i'), new RegExp(`(?:^|[^A-Za-z0-9$])\\$?${ESCAPE_TICKER(t)}(?![A-Za-z0-9])`)]);
// Short or common-word names that must match in their exact capitalization only (never "arm", "on", "axon" as plain words).
const EXACT = new Set(['ARM', 'ON', 'AXON', 'META', 'APP', 'TER', 'KLAC', 'AMD', 'ASML', 'NXPI', 'UMC']);
// Bare symbols that are also ordinary words or other names (the Australian exchange "ASX", "ON", "APP"): matched by name only.
const NO_SYMBOL = new Set(['ASX', 'ON', 'APP', 'ARM', 'TER', 'STM']);
/** The rostered companies a headline names, in the order they appear. */
export function namedCompanies(title: string): string[] {
  const t = typeof title === 'string' ? title.normalize('NFKC') : '';
  const found: [number, string][] = [];
  for (const [ticker, name, symbol] of PATTERNS) {
    const byName = EXACT.has(ticker) ? new RegExp(name.source, '').exec(t) : name.exec(t), bySymbol = NO_SYMBOL.has(ticker) ? null : symbol.exec(t);
    const at = Math.min(byName ? byName.index : Infinity, bySymbol ? bySymbol.index : Infinity);
    if (Number.isFinite(at)) found.push([at, ticker]);
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, ticker]) => ticker);
}
