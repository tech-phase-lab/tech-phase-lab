import records from "./company-introductions.data.json" with { type: "json" };
import { validateCompanyIntroductions } from "./company-introduction-schema.ts";
import type { CompanyIntroduction } from "./company-introduction-schema.ts";
export { companyIntroductionFields } from "./company-introduction-schema.ts";
export type { CompanyIntroduction, CompanyIntroductionField, CompanyConnection } from "./company-introduction-schema.ts";

// Server registry. Only the selected issuer is sent in the profile response.
validateCompanyIntroductions(records);
export const companyIntroductions: CompanyIntroduction[] = records;
const byCik = new Map(companyIntroductions.map(item => [item.cik, item]));

export function companyIntroductionFor(issuer: { cik: number; ticker: string }): CompanyIntroduction | null {
  const ticker = issuer.ticker.trim().toUpperCase();
  const item = byCik.get(issuer.cik);
  return item?.tickers.includes(ticker) ? item : null;
}
