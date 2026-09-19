export type VerifiedChangeMetric = {
  id: string;
  label: { ja: string; en: string };
  previous: number | null;
  current: number;
  unit: "billion" | "percent";
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
}];

export const verifiedChangeByTicker = Object.fromEntries(verifiedChanges.map((item) => [item.ticker, item]));

export function verifiedChangeIssues(item: VerifiedChange): string[] {
  const issues: string[] = [];
  const allowedSourceHosts = new Set(["www.sec.gov", "ir.amd.com", "investors.broadcom.com"]);
  if (!item.metrics.length || new Set(item.metrics.map((metric) => metric.id)).size !== item.metrics.length) issues.push("invalid-metrics");
  let sourceHost = "";
  try { sourceHost = new URL(item.source.url).hostname; } catch { /* reported below */ }
  if (item.source.publishedOn > item.reviewedOn || !allowedSourceHosts.has(sourceHost)) issues.push("invalid-source");
  for (const metric of item.metrics) {
    if (!Number.isFinite(metric.current) || (metric.previous !== null && !Number.isFinite(metric.previous)) || !Number.isFinite(metric.change.value)) issues.push("invalid-value");
    if (metric.change.unit === "pp" && metric.unit !== "percent") issues.push("invalid-point-change");
    if (metric.previous === null && !metric.change.companyReported) issues.push("unsupported-change");
  }
  return [...new Set(issues)];
}
