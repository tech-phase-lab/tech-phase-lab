import records from "./annual-filing-briefs.json" with { type: "json" };
import type { BusinessSection, RiskSection } from "./stock-directory";

export type AnnualFilingBriefEvidence = {
  id: string;
  section: "business" | "risk";
  quote: string;
};

export type AnnualFilingBrief = {
  id: string;
  ticker: string;
  accessionNumber: string;
  sourceSha256: string;
  summaryJa: string;
  businessModelJa: string;
  riskPointsJa: { text: string; evidenceIds: string[] }[];
  summaryEvidenceIds: string[];
  businessModelEvidenceIds: string[];
  evidence: AnnualFilingBriefEvidence[];
  confidence: "high" | "medium" | "low";
  generationMethod: "human" | "ai-assisted";
  generatedAt: string;
  reviewedAt: string;
};

export type AnnualFilingBriefSource = {
  business: BusinessSection | null;
  risks: RiskSection | null;
};

type Candidate = AnnualFilingBrief & {
  status: "draft" | "held" | "rejected" | "approved";
  reviewer: string;
  reviewReason: string;
};

const idPattern = /^[a-z0-9][a-z0-9._:-]{2,79}$/;
const tickerPattern = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
const accessionPattern = /^\d{10}-\d{2}-\d{6}$/;
const shaPattern = /^[a-f0-9]{64}$/;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const statuses = new Set(["draft", "held", "rejected", "approved"]);
const confidences = new Set(["high", "medium", "low"]);
const generationMethods = new Set(["human", "ai-assisted"]);

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, minLength: number, maxLength: number) {
  if (typeof value !== "string" || value.length < minLength || value.length > maxLength) return null;
  if (/[\u0000-\u001f\u007f<>]/.test(value)) return null;
  return value.trim() === value ? value : null;
}

function ids(value: unknown, maximum = 8) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) return null;
  const result = value.map((item) => boundedText(item, 3, 80));
  return result.every(Boolean) && new Set(result).size === result.length ? result as string[] : null;
}

function timestamp(value: unknown) {
  const text = boundedText(value, 20, 32);
  return text && isoTimestampPattern.test(text) && !Number.isNaN(Date.parse(text)) ? text : null;
}

function japaneseText(value: unknown, minimum: number, maximum: number) {
  const text = boundedText(value, minimum, maximum);
  return text && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? text : null;
}

function numericTokens(value: string) {
  return new Set([...value.normalize("NFKC").matchAll(/\d+(?:[,.]\d+)*(?:%|％)?/g)].map((match) => match[0].replaceAll(",", "").replace("％", "%")));
}

function evidenceCorpus(source: AnnualFilingBriefSource, section: "business" | "risk") {
  if (section === "business") return source.business?.excerpt ?? "";
  const overview = source.risks?.overview?.groups.flatMap((group) => [group.heading ?? "", ...group.items]).join("\n") ?? "";
  return [source.risks?.excerpt ?? "", overview].filter(Boolean).join("\n");
}

function sourceIdentity(source: AnnualFilingBriefSource) {
  const sections = [source.business, source.risks].filter(Boolean) as (BusinessSection | RiskSection)[];
  if (!sections.length) return null;
  const first = sections[0];
  if (sections.some((section) => section.ticker !== first.ticker || section.accessionNumber !== first.accessionNumber || section.sourceSha256 !== first.sourceSha256)) return null;
  return { ticker: first.ticker, accessionNumber: first.accessionNumber, sourceSha256: first.sourceSha256 };
}

export function validateAnnualFilingBrief(value: unknown, source: AnnualFilingBriefSource, trustedApproval = false) {
  const issues: string[] = [];
  const identity = sourceIdentity(source);
  if (!identity) issues.push("source-identity-invalid");
  if (!object(value)) return { brief: null, issues: [...issues, "record-invalid"] };

  const candidate = value as Record<string, unknown>;
  const id = boundedText(candidate.id, 3, 80);
  const ticker = boundedText(candidate.ticker, 1, 15);
  const accessionNumber = boundedText(candidate.accessionNumber, 20, 20);
  const sourceSha256 = boundedText(candidate.sourceSha256, 64, 64);
  const summaryJa = japaneseText(candidate.summaryJa, 20, 500);
  const businessModelJa = japaneseText(candidate.businessModelJa, 20, 800);
  const summaryEvidenceIds = ids(candidate.summaryEvidenceIds);
  const businessModelEvidenceIds = ids(candidate.businessModelEvidenceIds);
  const generatedAt = timestamp(candidate.generatedAt);
  const reviewedAt = timestamp(candidate.reviewedAt);
  const reviewer = boundedText(candidate.reviewer, 2, 120);
  const reviewReason = boundedText(candidate.reviewReason, 5, 500);
  const confidence = boundedText(candidate.confidence, 3, 8);
  const generationMethod = boundedText(candidate.generationMethod, 5, 16);

  if (!id || !idPattern.test(id)) issues.push("id-invalid");
  if (!ticker || !tickerPattern.test(ticker)) issues.push("ticker-invalid");
  if (!accessionNumber || !accessionPattern.test(accessionNumber)) issues.push("accession-invalid");
  if (!sourceSha256 || !shaPattern.test(sourceSha256)) issues.push("source-sha-invalid");
  if (!statuses.has(String(candidate.status))) issues.push("status-invalid");
  else if (candidate.status !== "approved") issues.push("not-approved");
  if (!summaryJa) issues.push("summary-invalid");
  if (!businessModelJa) issues.push("business-model-invalid");
  if (!summaryEvidenceIds) issues.push("summary-evidence-invalid");
  if (!businessModelEvidenceIds) issues.push("business-evidence-invalid");
  if (!confidence || !confidences.has(confidence)) issues.push("confidence-invalid");
  if (!generationMethod || !generationMethods.has(generationMethod)) issues.push("generation-method-invalid");
  if (!generatedAt) issues.push("generated-at-invalid");
  if (!reviewedAt) issues.push("reviewed-at-invalid");
  if (generatedAt && reviewedAt && Date.parse(reviewedAt) < Date.parse(generatedAt)) issues.push("review-before-generation");
  if (!trustedApproval && !reviewer) issues.push("reviewer-invalid");
  if (!trustedApproval && !reviewReason) issues.push("review-reason-invalid");
  if (identity && ticker !== identity.ticker) issues.push("ticker-mismatch");
  if (identity && accessionNumber !== identity.accessionNumber) issues.push("accession-mismatch");
  if (identity && sourceSha256 !== identity.sourceSha256) issues.push("source-sha-mismatch");

  const evidence: AnnualFilingBriefEvidence[] = [];
  const evidenceIds = new Set<string>();
  if (!Array.isArray(candidate.evidence) || candidate.evidence.length < 2 || candidate.evidence.length > 12) issues.push("evidence-invalid");
  else for (const item of candidate.evidence) {
    if (!object(item)) { issues.push("evidence-item-invalid"); continue; }
    const evidenceId = boundedText(item.id, 3, 80);
    const section = item.section === "business" || item.section === "risk" ? item.section : null;
    const quote = boundedText(item.quote, 24, 800);
    if (!evidenceId || !idPattern.test(evidenceId) || evidenceIds.has(evidenceId) || !section || !quote) { issues.push("evidence-item-invalid"); continue; }
    evidenceIds.add(evidenceId);
    if (!evidenceCorpus(source, section).includes(quote)) issues.push(`evidence-not-in-source:${evidenceId}`);
    evidence.push({ id: evidenceId, section, quote });
  }

  const riskPointsJa: { text: string; evidenceIds: string[] }[] = [];
  if (!Array.isArray(candidate.riskPointsJa) || candidate.riskPointsJa.length < 1 || candidate.riskPointsJa.length > 6) issues.push("risk-points-invalid");
  else for (const point of candidate.riskPointsJa) {
    if (!object(point)) { issues.push("risk-point-invalid"); continue; }
    const text = japaneseText(point.text, 12, 360);
    const pointEvidenceIds = ids(point.evidenceIds, 4);
    if (!text || !pointEvidenceIds) { issues.push("risk-point-invalid"); continue; }
    riskPointsJa.push({ text, evidenceIds: pointEvidenceIds });
  }

  const evidenceMap = new Map(evidence.map((item) => [item.id, item]));
  const referenced = [...(summaryEvidenceIds ?? []), ...(businessModelEvidenceIds ?? []), ...riskPointsJa.flatMap((point) => point.evidenceIds)];
  if (referenced.some((reference) => !evidenceMap.has(reference))) issues.push("evidence-reference-missing");
  if (summaryEvidenceIds?.some((reference) => evidenceMap.get(reference)?.section !== "business")) issues.push("summary-evidence-section-invalid");
  if (businessModelEvidenceIds?.some((reference) => evidenceMap.get(reference)?.section !== "business")) issues.push("business-evidence-section-invalid");
  if (riskPointsJa.some((point) => point.evidenceIds.some((reference) => evidenceMap.get(reference)?.section !== "risk"))) issues.push("risk-evidence-section-invalid");

  const checkNumbers = (text: string | null, references: string[] | null) => {
    if (!text || !references) return;
    const supported = numericTokens(references.map((reference) => evidenceMap.get(reference)?.quote ?? "").join(" "));
    if ([...numericTokens(text)].some((token) => !supported.has(token))) issues.push("number-not-grounded");
  };
  checkNumbers(summaryJa, summaryEvidenceIds);
  checkNumbers(businessModelJa, businessModelEvidenceIds);
  for (const point of riskPointsJa) checkNumbers(point.text, point.evidenceIds);

  if (issues.length || !id || !ticker || !accessionNumber || !sourceSha256 || !summaryJa || !businessModelJa || !summaryEvidenceIds || !businessModelEvidenceIds || !confidence || !generationMethod || !generatedAt || !reviewedAt) return { brief: null, issues: [...new Set(issues)] };
  const brief: AnnualFilingBrief = { id, ticker, accessionNumber, sourceSha256, summaryJa, businessModelJa, riskPointsJa, summaryEvidenceIds, businessModelEvidenceIds, evidence, confidence: confidence as AnnualFilingBrief["confidence"], generationMethod: generationMethod as AnnualFilingBrief["generationMethod"], generatedAt, reviewedAt };
  return { brief, issues: [] };
}

export function approvedAnnualFilingBrief(source: AnnualFilingBriefSource) {
  const identity = sourceIdentity(source);
  if (!identity) return null;
  for (const record of records as unknown[]) {
    if (!object(record) || record.ticker !== identity.ticker || record.accessionNumber !== identity.accessionNumber) continue;
    const validated = validateAnnualFilingBrief(record, source);
    if (validated.brief) return validated.brief;
  }
  return null;
}

export type AnnualFilingBriefRecord = Candidate;
