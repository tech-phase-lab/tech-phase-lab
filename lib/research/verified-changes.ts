export type VerifiedChangeMetric = {
  id: string;
  label: { ja: string; en: string };
  previous: number | null;
  current: number;
  unit: "billion" | "eur-billion" | "percent";
  change: { value: number; unit: "percent" | "pp"; companyReported?: boolean };
  note: { ja: string; en: string };
};

export type VerifiedChange = {
  ticker: string;
  title: { ja: string; en: string };
  previousPeriod: string;
  currentPeriod: string;
  reviewedOn: string;
  source: { title: string; publisher: string; publishedOn: string; url: string; location: string };
  additionalSources?: { title: string; publisher: string; publishedOn: string; url: string; location: string }[];
  metrics: VerifiedChangeMetric[];
  reading: { ja: string; en: string };
  unknown: { ja: string; en: string };
  outlookHeading?: { ja: string; en: string };
  outlook: { ja: string; en: string }[];
};

export const verifiedChanges: VerifiedChange[] = [{
  ticker: "NVDA",
  title: { ja: "Q2 FY2027：前四半期からの変化", en: "Q2 FY2027: changes from the prior quarter" },
  previousPeriod: "Q1 FY2027",
  currentPeriod: "Q2 FY2027",
  reviewedOn: "2026-09-19",
  source: {
    title: "NVIDIA Announces Financial Results for Second Quarter Fiscal 2027",
    publisher: "NVIDIA filing on SEC EDGAR",
    publishedOn: "2026-08-26",
    url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/q2fy27pr.htm",
    location: "Q2 Fiscal 2027 Summary; Outlook; Data Center",
  },
  metrics: [
    { id: "revenue", label: { ja: "売上高", en: "Revenue" }, previous: 81.615, current: 96.221, unit: "billion", change: { value: 17.895, unit: "percent" }, note: { ja: "GAAP・全社。会社発表の前四半期比は18%。", en: "GAAP, total company. NVIDIA reports 18% quarter-on-quarter." } },
    { id: "data-center", label: { ja: "データセンター売上", en: "Data Center revenue" }, previous: null, current: 89.0, unit: "billion", change: { value: 18, unit: "percent", companyReported: true }, note: { ja: "会社発表の前四半期比。前四半期の金額はこの比較表では表示しない。", en: "Company-reported quarter-on-quarter change; the prior-quarter amount is not shown here." } },
    { id: "gross-margin", label: { ja: "GAAP粗利益率", en: "GAAP gross margin" }, previous: 74.9, current: 75.0, unit: "percent", change: { value: 0.1, unit: "pp" }, note: { ja: "増減率ではなくパーセントポイント差。", en: "Percentage-point difference, not percentage growth." } },
    { id: "operating-income", label: { ja: "GAAP営業利益", en: "GAAP operating income" }, previous: 53.536, current: 63.734, unit: "billion", change: { value: 19.048, unit: "percent" }, note: { ja: "会社発表の前四半期比は19%。", en: "NVIDIA reports 19% quarter-on-quarter." } },
  ],
  reading: { ja: "売上と営業利益はいずれも前四半期比で約18〜19%増え、GAAP粗利益率は75.0%でほぼ横ばいでした。データセンター売上は$89.0Bで、全社売上の約92.5%です。", en: "Revenue and operating income rose roughly 18–19% quarter-on-quarter, while GAAP gross margin was nearly flat at 75.0%. Data Center revenue was $89.0B, about 92.5% of total revenue." },
  unknown: { ja: "Q3見通しの達成可否、Vera Rubinの量産が今後の売上に寄与する時期、中国向けデータセンター売上の回復は、このQ2発表だけでは確定しません。", en: "This Q2 release does not establish whether Q3 guidance will be met, when Vera Rubin production will contribute to revenue, or whether China Data Center revenue will recover." },
  outlook: [
    { ja: "Q3売上見通し：$108.0B ±2%", en: "Q3 revenue outlook: $108.0B ±2%" },
    { ja: "Q3 GAAP粗利益率：74.0% ±0.5pt", en: "Q3 GAAP gross margin: 74.0% ±0.5pt" },
    { ja: "見通しに中国向けデータセンターCompute売上を含めていない", en: "The outlook assumes no Data Center compute revenue from China" },
  ],
}, {
  ticker: "AMD",
  title: { ja: "Q2 2026：前四半期からの変化", en: "Q2 2026: changes from the prior quarter" },
  previousPeriod: "Q1 2026",
  currentPeriod: "Q2 2026",
  reviewedOn: "2026-09-19",
  source: {
    title: "AMD Reports Second Quarter 2026 Financial Results",
    publisher: "AMD Investor Relations",
    publishedOn: "2026-08-04",
    url: "https://ir.amd.com/news-events/press-releases/detail/1295/amd-reports-second-quarter-2026-financial-results",
    location: "GAAP Quarterly Financial Results; Segment Summary; Current Outlook",
  },
  metrics: [
    { id: "revenue", label: { ja: "売上高", en: "Revenue" }, previous: 10.253, current: 11.536, unit: "billion", change: { value: 12.513, unit: "percent" }, note: { ja: "GAAP・全社。会社発表の前四半期比は13%。", en: "GAAP, total company. AMD reports 13% quarter-on-quarter." } },
    { id: "gross-margin", label: { ja: "GAAP粗利益率", en: "GAAP gross margin" }, previous: 53, current: 54, unit: "percent", change: { value: 1, unit: "pp" }, note: { ja: "増減率ではなくパーセントポイント差。", en: "Percentage-point difference, not percentage growth." } },
    { id: "operating-income", label: { ja: "GAAP営業利益", en: "GAAP operating income" }, previous: 1.476, current: 1.990, unit: "billion", change: { value: 34.824, unit: "percent" }, note: { ja: "会社発表の前四半期比は35%。", en: "AMD reports 35% quarter-on-quarter." } },
    { id: "net-income", label: { ja: "GAAP純利益", en: "GAAP net income" }, previous: 1.383, current: 2.297, unit: "billion", change: { value: 66.088, unit: "percent" }, note: { ja: "会社発表の前四半期比は66%。", en: "AMD reports 66% quarter-on-quarter." } },
  ],
  reading: { ja: "売上は前四半期比約13%増、GAAP営業利益は約35%増でした。データセンター売上は$6.7Bで全社売上の58%を占めましたが、同じ表に前四半期値がないため比較カードには混ぜていません。", en: "Revenue rose about 13% quarter-on-quarter and GAAP operating income rose about 35%. Data Center revenue was $6.7B, or 58% of total revenue, but it is not mixed into the comparison cards because the same table does not provide its prior-quarter value." },
  unknown: { ja: "Q3見通しの達成可否、Heliosの立ち上がりが売上に寄与する時期、データセンター売上の製品別内訳は、この発表だけでは確定しません。", en: "This release does not establish whether Q3 guidance will be met, when the Helios ramp will contribute to revenue, or the product-level mix of Data Center revenue." },
  outlook: [
    { ja: "Q3売上見通し：約$13.0B ±$0.3B", en: "Q3 revenue outlook: approximately $13.0B ±$0.3B" },
    { ja: "Q3非GAAP粗利益率：約56%", en: "Q3 non-GAAP gross margin: approximately 56%" },
    { ja: "売上レンジ中央値は前四半期比約13%増", en: "Revenue range midpoint implies approximately 13% sequential growth" },
  ],
}, {
  ticker: "AVGO",
  title: { ja: "Q3 FY2026：前四半期からの変化", en: "Q3 FY2026: changes from the prior quarter" },
  previousPeriod: "Q2 FY2026",
  currentPeriod: "Q3 FY2026",
  reviewedOn: "2026-09-19",
  source: {
    title: "Broadcom Inc. Announces Third Quarter Fiscal Year 2026 Financial Results and Quarterly Dividend",
    publisher: "Broadcom Investor Relations",
    publishedOn: "2026-09-02",
    url: "https://investors.broadcom.com/news-releases/news-release-details/broadcom-inc-announces-third-quarter-fiscal-year-2026-financial",
    location: "Third Quarter Fiscal Year 2026 Financial Highlights; Consolidated Statements of Operations; Business Outlook",
  },
  metrics: [
    { id: "revenue", label: { ja: "売上高", en: "Net revenue" }, previous: 22.187, current: 29.591, unit: "billion", change: { value: 33.37, unit: "percent" }, note: { ja: "GAAP・全社。四半期財務諸表から計算。", en: "GAAP, total company; calculated from the quarterly statements." } },
    { id: "gross-profit", label: { ja: "GAAP粗利益", en: "GAAP gross profit" }, previous: 15.415, current: 20.456, unit: "billion", change: { value: 32.702, unit: "percent" }, note: { ja: "同じ四半期財務諸表の金額を比較。", en: "Comparable amounts from the same quarterly statements." } },
    { id: "operating-income", label: { ja: "GAAP営業利益", en: "GAAP operating income" }, previous: 10.788, current: 15.955, unit: "billion", change: { value: 47.896, unit: "percent" }, note: { ja: "非GAAP営業利益とは分けて表示。", en: "Shown separately from non-GAAP operating income." } },
    { id: "ai-semiconductor", label: { ja: "AI半導体売上", en: "AI semiconductor revenue" }, previous: null, current: 16.7, unit: "billion", change: { value: 54, unit: "percent", companyReported: true }, note: { ja: "会社発表の前四半期比。前四半期の金額はこの比較表では表示しない。", en: "Company-reported quarter-on-quarter change; the prior-quarter amount is not shown here." } },
  ],
  reading: { ja: "全社売上は前四半期比約33%、GAAP営業利益は約48%増えました。AI半導体売上は$16.7Bで、会社発表では前四半期比54%増です。", en: "Total revenue rose about 33% quarter-on-quarter and GAAP operating income rose about 48%. AI semiconductor revenue was $16.7B, which Broadcom reports as 54% higher sequentially." },
  unknown: { ja: "Q4見通しの達成可否、AI売上の顧客別構成、特定顧客への依存度は、この発表だけでは確定しません。", en: "This release does not establish whether Q4 guidance will be met, the customer mix of AI revenue, or the degree of customer concentration." },
  outlook: [
    { ja: "Q4売上見通し：約$34.8B", en: "Q4 revenue guidance: approximately $34.8B" },
    { ja: "Q4非GAAP営業利益：約売上高の66%", en: "Q4 non-GAAP operating income: approximately 66% of projected revenue" },
    { ja: "Q4 AI半導体売上見通し：$21.7B、前年同期比236%増", en: "Q4 AI semiconductor revenue outlook: $21.7B, up 236% year-on-year" },
  ],
}, {
  ticker: "CRWV",
  title: { ja: "Q2 2026：前年同期からの変化", en: "Q2 2026: changes from the prior-year quarter" },
  previousPeriod: "Q2 2025",
  currentPeriod: "Q2 2026",
  reviewedOn: "2026-09-19",
  source: {
    title: "CoreWeave Reports Strong Second Quarter 2026 Results",
    publisher: "CoreWeave filing on SEC EDGAR",
    publishedOn: "2026-08-11",
    url: "https://www.sec.gov/Archives/edgar/data/1769628/000176962826000362/coreweave2q26earningspress.htm",
    location: "Second Quarter 2026 Financial Highlights; Additional Financial Highlights; Business Outlook",
  },
  metrics: [
    { id: "revenue", label: { ja: "売上高", en: "Revenue" }, previous: 1.212, current: 2.575, unit: "billion", change: { value: 112.459, unit: "percent" }, note: { ja: "GAAP・全社。前年同期との比較。", en: "GAAP, total company; compared with the prior-year quarter." } },
    { id: "operating-margin", label: { ja: "GAAP営業利益率", en: "GAAP operating margin" }, previous: 2, current: -2, unit: "percent", change: { value: -4, unit: "pp" }, note: { ja: "利益から損失へ転じたため、成長率ではなくポイント差。", en: "Moved from profit to loss, so this is a point difference rather than a growth rate." } },
    { id: "adjusted-ebitda", label: { ja: "調整後EBITDA", en: "Adjusted EBITDA" }, previous: 0.753, current: 1.510, unit: "billion", change: { value: 100.531, unit: "percent" }, note: { ja: "会社定義の非GAAP指標。", en: "A company-defined non-GAAP measure." } },
    { id: "adjusted-operating-margin", label: { ja: "調整後営業利益率", en: "Adjusted operating margin" }, previous: 16, current: 5, unit: "percent", change: { value: -11, unit: "pp" }, note: { ja: "会社定義の非GAAP指標。前年同期比11ポイント低下。", en: "A company-defined non-GAAP measure, down 11 percentage points year-on-year." } },
  ],
  reading: { ja: "売上は前年同期比約112%増え、調整後EBITDAは約2倍になりました。一方、GAAP営業利益率は2%からマイナス2%へ、調整後営業利益率も16%から5%へ低下しており、成長と収益性を分けて見る必要があります。", en: "Revenue rose about 112% year-on-year and adjusted EBITDA roughly doubled. However, GAAP operating margin moved from 2% to negative 2%, while adjusted operating margin fell from 16% to 5%, so growth and profitability need to be assessed separately." },
  unknown: { ja: "$104Bの売上バックログがいつ売上化されるか、Q3初期に追加された$25B超のコミットメントの契約条件、資本支出と資金調達の今後の負担は、この資料だけでは確定しません。", en: "This filing does not establish when the $104B revenue backlog will convert to revenue, the contract terms behind more than $25B of early-Q3 commitments, or the future burden of capital spending and financing." },
  outlookHeading: { ja: "会社の先行指標・見通し", en: "COMPANY LEADING INDICATORS / OUTLOOK" },
  outlook: [
    { ja: "6月末の売上バックログ：約$104B", en: "Revenue backlog at June 30: approximately $104B" },
    { ja: "Q3初期の純増顧客コミットメント$25B超はバックログに未算入", en: "More than $25B of early-Q3 net new customer commitments is excluded from that backlog" },
    { ja: "このSEC提出資料には数値ガイダンスを記載せず、同日の決算説明会で提供すると明記", en: "This SEC-filed release does not state numerical guidance; it says guidance would be provided on the same-day earnings call" },
  ],
}, {
  ticker: "ARM",
  title: { ja: "Q1 FYE27：前年同期からの変化", en: "Q1 FYE27: changes from the prior-year quarter" },
  previousPeriod: "Q1 FYE26",
  currentPeriod: "Q1 FYE27",
  reviewedOn: "2026-09-19",
  source: {
    title: "Arm delivers record first-quarter for total revenue",
    publisher: "Arm Newsroom",
    publishedOn: "2026-07-29",
    url: "https://newsroom.arm.com/news/arm-q1-fye27-results",
    location: "Q1 FYE27 financial results infographic; quarterly highlights",
  },
  metrics: [
    { id: "revenue", label: { ja: "売上高", en: "Total revenue" }, previous: null, current: 1.29, unit: "billion", change: { value: 22, unit: "percent", companyReported: true }, note: { ja: "会社発表の前年同期比。前年同期の金額はこの比較表では表示しない。", en: "Company-reported year-on-year change; the prior-year amount is not shown here." } },
    { id: "royalty", label: { ja: "ロイヤルティ収入", en: "Royalty revenue" }, previous: null, current: 0.715, unit: "billion", change: { value: 22, unit: "percent", companyReported: true }, note: { ja: "会社発表の前年同期比。データセンターの金額内訳とは別。", en: "Company-reported year-on-year change; this is separate from the undisclosed data-center dollar mix." } },
    { id: "licensing", label: { ja: "ライセンス収入", en: "License revenue" }, previous: null, current: 0.574, unit: "billion", change: { value: 23, unit: "percent", companyReported: true }, note: { ja: "会社発表の前年同期比。前年同期の金額はこの比較表では表示しない。", en: "Company-reported year-on-year change; the prior-year amount is not shown here." } },
  ],
  reading: { ja: "売上高は$1.29Bで前年同期比22%増。ロイヤルティ収入とライセンス収入も22〜23%増え、いずれも第1四半期として過去最高でした。データセンターのロイヤルティは前年同期比で2倍超と説明されていますが、金額は開示されていません。", en: "Revenue reached $1.29B, up 22% year-on-year. Royalty and license revenue also rose 22–23%, both reaching first-quarter records. Arm says data-center royalties more than doubled, but it does not disclose the dollar amount." },
  unknown: { ja: "データセンターのロイヤルティ金額、$2B超の需要がいつ売上に転換するか、今後も同じ成長率を維持できるかは、この発表だけでは確定しません。", en: "This release does not establish the dollar value of data-center royalties, when more than $2B of demand will convert into revenue, or whether the same growth rate can be sustained." },
  outlookHeading: { ja: "会社が示した先行材料", en: "COMPANY LEADING INDICATORS" },
  outlook: [
    { ja: "Arm AGI CPUの顧客需要はFYE27〜FYE28で$2B超", en: "Customer demand for the Arm AGI CPU exceeds $2B across FYE27 and FYE28" },
    { ja: "初期製品を複数顧客へ納入済み", en: "Initial product has been delivered to multiple customers" },
    { ja: "FYE27〜FYE28の$1B機会を支える製造能力を確保", en: "Manufacturing capacity is secured for the stated $1B opportunity across FYE27 and FYE28" },
  ],
}, {
  ticker: "TSM",
  title: { ja: "Q2 2026：前四半期からの変化", en: "Q2 2026: changes from the prior quarter" },
  previousPeriod: "Q1 2026",
  currentPeriod: "Q2 2026",
  reviewedOn: "2026-09-19",
  source: {
    title: "TSMC Reports Second Quarter EPS of NT$27.25",
    publisher: "TSMC Press Center",
    publishedOn: "2026-07-16",
    url: "https://pr.tsmc.com/english/news/3326",
    location: "Second-quarter results; third-quarter business outlook",
  },
  additionalSources: [{
    title: "TSMC 2026 Q1 Quarterly Results",
    publisher: "TSMC Investor Relations",
    publishedOn: "2026-04-16",
    url: "https://investor.tsmc.com/english/quarterly-results/2026/q1",
    location: "Q1 actual net revenue, gross margin, and operating margin",
  }],
  metrics: [
    { id: "revenue", label: { ja: "売上高", en: "Net revenue" }, previous: 35.9, current: 40.2, unit: "billion", change: { value: 11.978, unit: "percent" }, note: { ja: "米ドル換算。会社発表の前四半期比は12.0%。", en: "US-dollar basis. TSMC reports 12.0% quarter-on-quarter." } },
    { id: "gross-margin", label: { ja: "粗利益率", en: "Gross margin" }, previous: 66.2, current: 67.7, unit: "percent", change: { value: 1.5, unit: "pp" }, note: { ja: "増減率ではなくパーセントポイント差。", en: "Percentage-point difference, not percentage growth." } },
    { id: "operating-margin", label: { ja: "営業利益率", en: "Operating margin" }, previous: 58.1, current: 60.3, unit: "percent", change: { value: 2.2, unit: "pp" }, note: { ja: "増減率ではなくパーセントポイント差。", en: "Percentage-point difference, not percentage growth." } },
  ],
  reading: { ja: "米ドル建て売上は前四半期比12.0%増の$40.2B。粗利益率は1.5ポイント、営業利益率は2.2ポイント上昇しました。2nmはウェハ売上の3%、7nm以下の先端技術は77%を占めました。", en: "US-dollar revenue rose 12.0% quarter-on-quarter to $40.2B. Gross margin increased 1.5 points and operating margin increased 2.2 points. Two-nanometer accounted for 3% of wafer revenue, while 7nm and below accounted for 77%." },
  unknown: { ja: "Q3見通しの達成可否、2nmの急拡大が製品別・顧客別売上に与える影響、海外生産拡大による将来の利益率への影響は、この発表だけでは確定しません。", en: "This release does not establish whether Q3 guidance will be met, how the 2nm ramp will affect product or customer mix, or the future margin impact of overseas manufacturing expansion." },
  outlook: [
    { ja: "Q3売上見通し：$44.6B〜$45.8B", en: "Q3 revenue outlook: $44.6B–$45.8B" },
    { ja: "Q3粗利益率：65%〜67%", en: "Q3 gross margin: 65%–67%" },
    { ja: "Q3営業利益率：56%〜58%", en: "Q3 operating margin: 56%–58%" },
  ],
}, {
  ticker: "ASML",
  title: { ja: "Q2 2026：前四半期からの変化", en: "Q2 2026: changes from the prior quarter" },
  previousPeriod: "Q1 2026",
  currentPeriod: "Q2 2026",
  reviewedOn: "2026-09-19",
  source: {
    title: "ASML reports €9.3 billion total net sales and €2.9 billion net income in Q2 2026",
    publisher: "ASML",
    publishedOn: "2026-07-15",
    url: "https://www.asml.com/en/news/press-releases/2026/q2-2026-financial-results",
    location: "Q1/Q2 financial table; CEO statement and outlook",
  },
  metrics: [
    { id: "sales", label: { ja: "売上高", en: "Total net sales" }, previous: 8.767, current: 9.326, unit: "eur-billion", change: { value: 6.376, unit: "percent" }, note: { ja: "ユーロ建て。公式表のQ1とQ2を比較。", en: "Euro basis; compares Q1 and Q2 in the official table." } },
    { id: "installed-base", label: { ja: "保守・アップグレード売上", en: "Installed Base Management sales" }, previous: 2.488, current: 2.762, unit: "eur-billion", change: { value: 11.013, unit: "percent" }, note: { ja: "ネットサービスおよびフィールドオプション売上。", en: "Net service and field-option sales." } },
    { id: "gross-margin", label: { ja: "粗利益率", en: "Gross margin" }, previous: 53.0, current: 54.0, unit: "percent", change: { value: 1.0, unit: "pp" }, note: { ja: "増減率ではなくパーセントポイント差。", en: "Percentage-point difference, not percentage growth." } },
    { id: "net-income", label: { ja: "純利益", en: "Net income" }, previous: 2.757, current: 2.918, unit: "eur-billion", change: { value: 5.84, unit: "percent" }, note: { ja: "公式表のQ1とQ2を比較。", en: "Compares Q1 and Q2 in the official table." } },
  ],
  reading: { ja: "売上高は前四半期比約6.4%増の€9.326B、純利益は約5.8%増の€2.918Bでした。保守・アップグレード売上は約11.0%増え、粗利益率は1.0ポイント上昇しました。", en: "Sales rose about 6.4% quarter-on-quarter to €9.326B and net income rose about 5.8% to €2.918B. Installed Base Management sales increased about 11.0%, while gross margin improved by 1.0 point." },
  unknown: { ja: "Q3見通しの達成可否、顧客別の注文構成、増産計画が将来の納入時期と利益率へ与える影響は、この発表だけでは確定しません。", en: "This release does not establish whether Q3 guidance will be met, the customer mix of orders, or how capacity expansion will affect future delivery timing and margins." },
  outlook: [
    { ja: "Q3売上見通し：€11.0B〜€12.0B", en: "Q3 sales outlook: €11.0B–€12.0B" },
    { ja: "Q3粗利益率：55%〜57%", en: "Q3 gross margin: 55%–57%" },
    { ja: "2026年売上見通し：€43B〜€45B、粗利益率54%〜56%", en: "2026 outlook: €43B–€45B sales and 54%–56% gross margin" },
  ],
}];

export const verifiedChangeByTicker = Object.fromEntries(verifiedChanges.map((item) => [item.ticker, item]));

export function verifiedChangeIssues(item: VerifiedChange): string[] {
  const issues: string[] = [];
  const allowedSourceHosts = new Set(["www.sec.gov", "ir.amd.com", "investors.broadcom.com", "newsroom.arm.com", "pr.tsmc.com", "investor.tsmc.com", "www.asml.com"]);
  if (!item.metrics.length || new Set(item.metrics.map((metric) => metric.id)).size !== item.metrics.length) issues.push("invalid-metrics");
  let sourceHost = "";
  try { sourceHost = new URL(item.source.url).hostname; } catch { /* reported below */ }
  if (item.source.publishedOn > item.reviewedOn || !allowedSourceHosts.has(sourceHost)) issues.push("invalid-source");
  for (const source of item.additionalSources ?? []) {
    let additionalHost = "";
    try { additionalHost = new URL(source.url).hostname; } catch { /* reported below */ }
    if (source.publishedOn > item.reviewedOn || !allowedSourceHosts.has(additionalHost)) issues.push("invalid-source");
  }
  for (const metric of item.metrics) {
    if (!Number.isFinite(metric.current) || (metric.previous !== null && !Number.isFinite(metric.previous)) || !Number.isFinite(metric.change.value)) issues.push("invalid-value");
    if (metric.change.unit === "pp" && metric.unit !== "percent") issues.push("invalid-point-change");
    if (metric.previous === null && !metric.change.companyReported) issues.push("unsupported-change");
  }
  return [...new Set(issues)];
}
