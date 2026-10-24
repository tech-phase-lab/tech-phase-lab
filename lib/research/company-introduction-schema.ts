export const companyIntroductionFields = ["business", "revenue", "strength", "risks", "competition", "relationships"] as const;
export type CompanyIntroductionField = typeof companyIntroductionFields[number];
export type CompanyConnection = {
  kind: "company" | "industry";
  name: string;
  nameJa?: string;
  ticker?: string;
  role: "competitor" | "supplier" | "customer" | "partner" | "investor" | "investee" | "ecosystem";
  label: { ja: string; en: string };
  sourceIndexes: number[];
};
export type CompanyIntroduction = {
  cik: number;
  tickers: string[];
  name: string;
  reviewedOn: string;
  sources: { label: string; url: string }[];
  ja: Record<CompanyIntroductionField, string>;
  en: Record<CompanyIntroductionField, string>;
  maps: { competition: CompanyConnection[]; relationships: CompanyConnection[] };
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Company introductions: ${message}`);
}

// Shared by the server, batch importer and CI. An invalid batch never reaches disk.
export function validateCompanyIntroductions(value: unknown): asserts value is CompanyIntroduction[] {
  check(Array.isArray(value) && value.length > 0, "expected a non-empty array");
  const identities = new Set<number>();
  for (const item of value) {
    check(object(item), "invalid record");
    check(Number.isSafeInteger(item.cik) && Number(item.cik) > 0, "invalid CIK");
    const cik = Number(item.cik);
    check(!identities.has(cik), `duplicate CIK ${cik}`);
    identities.add(cik);
    check(text(item.name), `${cik}: missing name`);
    check(Array.isArray(item.tickers) && item.tickers.length > 0 && item.tickers.every(t => typeof t === "string" && /^[A-Z][A-Z0-9.-]{0,14}$/.test(t)), `${cik}: invalid tickers`);
    check(new Set(item.tickers).size === item.tickers.length, `${cik}: duplicate ticker`);
    check(typeof item.reviewedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.reviewedOn) && Number.isFinite(Date.parse(item.reviewedOn)) && new Date(item.reviewedOn).toISOString().slice(0, 10) === item.reviewedOn, `${cik}: invalid review date`);
    check(Array.isArray(item.sources) && item.sources.length > 0, `${cik}: missing sources`);
    for (const source of item.sources) {
      check(object(source) && text(source.label) && text(source.url), `${cik}: invalid source`);
      const url = new URL(source.url);
      check(url.protocol === "https:" && !url.username && !url.password, `${cik}: sources must use public HTTPS URLs`);
    }
    for (const lang of ["ja", "en"]) {
      const answers = item[lang];
      // Competition and relationships may both be empty (answer and map) for a company whose filings name nothing to show.
      check(object(answers) && companyIntroductionFields.every(field => typeof answers[field] === "string") && ["business", "revenue", "strength", "risks"].every(field => text(answers[field])), `${cik}: missing ${lang} answer`);
    }
    check(object(item.maps), `${cik}: missing maps`);
    for (const topic of ["competition", "relationships"]) {
      const entries = item.maps[topic];
      check(Array.isArray(entries), `${cik}: missing ${topic} map`);
      for (const lang of ["ja", "en"]) check(text((item[lang] as Record<string, unknown>)[topic]) === entries.length > 0, `${cik}: ${lang} ${topic} answer and map must both be present or both be empty`);
      const seen = new Set<string>();
      for (const entry of entries) {
        check(object(entry) && text(entry.name), `${cik}: invalid map entry`);
        check(entry.kind === "company" || entry.kind === "industry", `${cik}: invalid entity kind`);
        check(entry.nameJa === undefined || text(entry.nameJa), `${cik}: invalid localized name`);
        check(entry.ticker === undefined || (entry.kind === "company" && typeof entry.ticker === "string" && /^[A-Z][A-Z0-9.-]{0,14}$/.test(entry.ticker)), `${cik}: invalid entity ticker`);
        check(!entry.ticker || !item.tickers.includes(entry.ticker), `${cik}: self connection`);
        check(["competitor", "supplier", "customer", "partner", "investor", "investee", "ecosystem"].includes(String(entry.role)), `${cik}: invalid role`);
        check(topic === "competition" ? entry.role === "competitor" : entry.role !== "competitor", `${cik}: role in wrong map`);
        check(object(entry.label) && text(entry.label.ja) && text(entry.label.en), `${cik}: missing bilingual relation`);
        check(Array.isArray(entry.sourceIndexes) && entry.sourceIndexes.length > 0 && entry.sourceIndexes.every(i => Number.isInteger(i) && i >= 0 && i < (item.sources as unknown[]).length), `${cik}: missing relation evidence`);
        // One company can supply infrastructure and separately collaborate on
        // advertising, or buy chips while supplying EDA compute. Keep the facts
        // and their evidence separate; duplicates within a role remain invalid.
        const entity = String(entry.ticker ?? entry.name).toUpperCase();
        const identity = topic === "relationships" ? `${entity}:${entry.role}` : entity;
        check(!seen.has(identity), `${cik}: duplicate map entity ${identity}`);
        seen.add(identity);
      }
    }
  }
}
