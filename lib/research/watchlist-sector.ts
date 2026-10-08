export type SectorLabel = { ja: string; en: string };
const label = (ja: string, en: string): SectorLabel => ({ ja, en });

// Watchlist investment themes, reviewed 2026-10-08. Sources and scope:
// docs/WATCHLIST-SECTORS-2026-10-08.md. Never mutate the news registry here.
const themes: Record<string, SectorLabel> = {
  AEHR: label("半導体検査装置", "Semiconductor test equipment"),
  MSTR: label("クリプト関連", "Crypto-related"),
  CAN: label("クリプト関連", "Crypto-related"),
  COIN: label("クリプト関連", "Crypto-related"),
  HUT: label("クリプト関連", "Crypto-related"),
  CRCL: label("クリプト関連", "Crypto-related"),
  BTBT: label("クリプト関連", "Crypto-related"),
  BTGO: label("クリプト関連", "Crypto-related"),
  HOOD: label("クリプト関連", "Crypto-related"),
  RIOT: label("クリプト関連", "Crypto-related"),
  CLSK: label("クリプト関連", "Crypto-related"),
  MARA: label("クリプト関連", "Crypto-related"),
  HIVE: label("クリプト関連", "Crypto-related"),
  BTDR: label("クリプト関連", "Crypto-related"),
  GLXY: label("クリプト関連", "Crypto-related"),
  GEMI: label("クリプト関連", "Crypto-related"),
  BLSH: label("クリプト関連", "Crypto-related"),
  CNCK: label("クリプト関連", "Crypto-related"),
  BMNR: label("クリプト関連", "Crypto-related"),
  ALAB: label("ネットワーク", "Networking"),
  APH: label("ネットワーク", "Networking"),
  AAOI: label("光・フォトニクス", "Optics & Photonics"),
  LITE: label("光・フォトニクス", "Optics & Photonics"),
  COHR: label("光・フォトニクス", "Optics & Photonics"),
  POET: label("光・フォトニクス", "Optics & Photonics"),
  MU: label("メモリ", "Memory"),
  SKHY: label("メモリ", "Memory"),
  SNDK: label("メモリ", "Memory"),
  AMAT: label("半導体製造装置", "Chip equipment"),
  IREN: label("AIクラウド", "AI cloud"),
  ASML: label("半導体製造装置", "Chip equipment"),
  TSM: label("半導体受託製造", "Chip foundry"),
};

export function watchlistSector(ticker: string, registered?: SectorLabel): SectorLabel | undefined {
  return Object.hasOwn(themes, ticker) ? themes[ticker] : registered;
}

// SIC major groups, not guessed company themes. Short bilingual display labels.
// https://www.osha.gov/data/sic-manual
// https://www.sec.gov/search-filings/standard-industrial-classification-sic-code-list
const sicGroups: Record<string, SectorLabel> = Object.fromEntries(([
  ["01", "農業", "Crops"], ["02", "畜産", "Livestock"], ["07", "農業サービス", "Agricultural services"],
  ["08", "林業", "Forestry"], ["09", "漁業・狩猟", "Fishing & hunting"],
  ["10", "金属鉱業", "Metal mining"], ["12", "石炭", "Coal"], ["13", "石油・ガス", "Oil & gas"], ["14", "非金属鉱業", "Nonmetallic mining"],
  ["15", "建設", "Construction"], ["16", "土木", "Civil construction"], ["17", "専門工事", "Specialty construction"],
  ["20", "食品", "Food"], ["21", "たばこ", "Tobacco"], ["22", "繊維", "Textiles"], ["23", "衣料品", "Apparel"],
  ["24", "木材", "Lumber"], ["25", "家具", "Furniture"], ["26", "紙・パルプ", "Paper"], ["27", "出版・印刷", "Publishing & printing"],
  ["28", "化学", "Chemicals"], ["29", "石油精製", "Petroleum refining"], ["30", "ゴム・樹脂", "Rubber & plastics"],
  ["31", "皮革製品", "Leather goods"], ["32", "ガラス・建材", "Glass & mineral products"], ["33", "金属素材", "Primary metals"],
  ["34", "金属製品", "Metal products"], ["35", "機械・コンピューター", "Machinery & computers"],
  ["36", "電機・電子部品", "Electrical & electronics"], ["37", "輸送機器", "Transport equipment"],
  ["38", "精密・医療機器", "Instruments & medical devices"], ["39", "その他製造", "Other manufacturing"],
  ["40", "鉄道", "Railroads"], ["41", "旅客輸送", "Passenger transport"], ["42", "陸運・倉庫", "Trucking & warehousing"],
  ["43", "郵便", "Postal services"], ["44", "海運", "Shipping"], ["45", "航空輸送", "Air transport"],
  ["46", "パイプライン", "Pipelines"], ["47", "輸送サービス", "Transport services"], ["48", "通信・放送", "Communications"],
  ["49", "電力・ガス・水道", "Utilities"], ["50", "耐久財卸売", "Durable-goods wholesale"], ["51", "非耐久財卸売", "Nondurable wholesale"],
  ["52", "建材小売", "Building-supply retail"], ["53", "総合小売", "General retail"], ["54", "食品小売", "Food retail"],
  ["55", "自動車小売", "Automotive retail"], ["56", "衣料品小売", "Apparel retail"], ["57", "家具・家電小売", "Home-goods retail"],
  ["58", "外食", "Restaurants"], ["59", "その他小売", "Other retail"], ["60", "銀行", "Banking"], ["61", "融資・金融", "Credit & lending"],
  ["62", "証券・金融サービス", "Securities services"], ["63", "保険", "Insurance"], ["64", "保険代理", "Insurance brokerage"],
  ["65", "不動産", "Real estate"], ["67", "持株・投資会社", "Holding & investment"],
  ["70", "宿泊", "Lodging"], ["72", "生活サービス", "Personal services"], ["73", "事業サービス", "Business services"],
  ["75", "自動車サービス", "Automotive services"], ["76", "修理サービス", "Repair services"], ["78", "映画", "Motion pictures"],
  ["79", "娯楽", "Entertainment"], ["80", "医療サービス", "Healthcare services"], ["81", "法律サービス", "Legal services"],
  ["82", "教育", "Education"], ["83", "福祉サービス", "Social services"], ["84", "文化施設", "Cultural institutions"],
  ["86", "会員組織", "Membership organizations"], ["87", "専門サービス", "Professional services"],
  ["88", "個人世帯", "Private households"], ["89", "その他サービス", "Other services"],
  ["91", "行政", "Government"], ["92", "司法・公安", "Justice & public safety"], ["93", "財政・税務", "Public finance"],
  ["94", "社会行政", "Human-resource administration"], ["95", "環境・住宅行政", "Environmental administration"],
  ["96", "経済行政", "Economic administration"], ["97", "国防・外交", "National security"],
] as string[][]).map(([code, ja, en]) => [code, label(ja, en)]));

// More useful labels where the reported SIC code supports that precision.
const sicDetails: Record<string, SectorLabel> = {
  "2834": label("医薬品", "Pharmaceuticals"), "2836": label("バイオ医薬品", "Biopharma"),
  "3571": label("コンピューター", "Computers"), "3572": label("ストレージ機器", "Storage hardware"),
  "3559": label("産業機械", "Industrial machinery"),
  "3661": label("通信機器", "Telecom equipment"), "3663": label("通信機器", "Telecom equipment"),
  "3674": label("半導体", "Semiconductors"), "3678": label("電子部品", "Electronic components"),
  "3841": label("医療機器", "Medical devices"), "4813": label("通信サービス", "Telecom services"),
  "4911": label("電力", "Electric utilities"), "6021": label("銀行", "Banking"),
  "6798": label("REIT", "REIT"), "6770": label("SPAC・白紙会社", "Blank-check companies"),
  "7370": label("ITサービス", "IT services"), "7371": label("ソフトウェア", "Software"),
  "7373": label("ITサービス", "IT services"), "7375": label("ネットサービス", "Online services"),
  "7372": label("ソフトウェア", "Software"), "7374": label("データ処理", "Data processing"),
};

export type SicSector = SectorLabel & { sic: string; description: string };
export function sectorFromProfile(ticker: string, payload: unknown): SicSector | undefined {
  if (!payload || typeof payload !== "object") return;
  const data = payload as { ok?: unknown; profile?: { ticker?: unknown; sic?: unknown; sicDescription?: unknown } };
  const profile = data.profile;
  if (data.ok !== true || !profile || profile.ticker !== ticker || typeof profile.sic !== "string" || !/^\d{3,4}$/.test(profile.sic)) return;
  const sic = profile.sic.padStart(4, "0");
  const sector = sicDetails[sic] ?? sicGroups[sic.slice(0, 2)];
  if (!sector) return; // 0000 / 9995 / unclassified are not real sector labels.
  return { ...sector, sic, description: typeof profile.sicDescription === "string" ? profile.sicDescription.slice(0, 160) : "" };
}
