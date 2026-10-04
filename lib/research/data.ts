import type { Metric, Source } from "./quality";

export type Language = "ja" | "en";
export type Copy = Record<Language, string>;
export type ResearchEvent = {
  locked?: boolean;
  id: string; ticker: string; company: string;
  category: "cloud" | "memory" | "other";
  kind: "acquisition" | "partnership" | "earnings" | "capacity" | "financing" | "product" | "external-research";
  earningsPeriod?: string;
  dateBasis?: "publication" | "detection";
  publishedOn: string; reviewedOn: string;
  title: Copy; summary: Copy; change: Copy; interpretation: Copy;
  facts: { text: Copy; sourceIds: string[] }[];
  analysisAsOf?: string;
  valuation?: { price: number; priceDate: string; eps: number; fiscalYear: string; sourceId: string };
  analysis?: { heading: Copy; body: Copy }[];
  scenarios?: { heading: Copy; body: Copy }[];
  unknown: Copy; next: Copy;
  sources: Source[]; metrics: Metric[];
  previous?: Metric[];
};

const copy = (ja: string, en: string): Copy => ({ ja, en });
export const metricNames: Record<string, Copy> = {
  "adjusted-eps": copy("調整後EPS", "Adjusted EPS"),
  revenue: copy("売上高", "Revenue"),
  arr: copy("AIクラウド ARR", "AI cloud ARR"),
  "net-income-continuing": copy("継続事業の純損益", "Net income · continuing operations"),
  "contracted-power": copy("契約電力の目標", "Contracted-power target"),
  "gross-margin": copy("粗利益率", "Gross margin"),
  "operating-income": copy("営業損益", "Operating income / loss"),
  "capital-spending": copy("設備・無形資産への支出", "Property, equipment & intangible purchases"),
  "net-capex": copy("設備投資（純額）", "Capital expenditures, net"),
  "adjusted-fcf": copy("調整後フリーキャッシュフロー", "Adjusted free cash flow"),
};
