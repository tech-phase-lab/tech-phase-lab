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
}];

export const verifiedChangeByTicker = Object.fromEntries(verifiedChanges.map((item) => [item.ticker, item]));

export function verifiedChangeIssues(item: VerifiedChange): string[] {
  const issues: string[] = [];
  if (!item.metrics.length || new Set(item.metrics.map((metric) => metric.id)).size !== item.metrics.length) issues.push("invalid-metrics");
  if (item.source.publishedOn > item.reviewedOn || !item.source.url.startsWith("https://www.sec.gov/Archives/edgar/")) issues.push("invalid-source");
  for (const metric of item.metrics) {
    if (!Number.isFinite(metric.current) || (metric.previous !== null && !Number.isFinite(metric.previous)) || !Number.isFinite(metric.change.value)) issues.push("invalid-value");
    if (metric.change.unit === "pp" && metric.unit !== "percent") issues.push("invalid-point-change");
    if (metric.previous === null && !metric.change.companyReported) issues.push("unsupported-change");
  }
  return [...new Set(issues)];
}

