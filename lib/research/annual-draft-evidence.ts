type Evidence = { id: string; section: "business" | "risk"; quote: string };
type GenerationMethod = "human" | "ai-assisted";

export function annualDraftGenerationMethod(selected: unknown, previous?: GenerationMethod): GenerationMethod {
  if (selected !== "human" && selected !== "ai-assisted") throw new Error("下書きの作成方法を選択してください。");
  // Editing an AI-assisted draft does not erase its provenance.
  return previous === "ai-assisted" ? previous : selected;
}
type ReviewRecord = {
  ticker: string; accessionNumber: string; sourceSha256: string;
  validationSha256: string | null; evidence: Evidence[];
  summaryEvidenceIds: string[]; businessModelEvidenceIds: string[];
  riskPointsJa: { evidenceIds: string[] }[];
};
type ReviewSource = {
  ticker: string; accessionNumber: string; sourceSha256: string; excerpt: string;
};

export function referencedQuotes(evidence: Evidence[], ids: string[]) {
  return ids.map(id => evidence.find(item => item.id === id)?.quote ?? "").filter(Boolean);
}

export function businessDraftEvidence(summaryQuotes: string[], modelQuotes: string[]) {
  const evidence: Evidence[] = [];
  const byQuote = new Map<string, string>();
  function references(quotes: string[]) {
    if (quotes.length < 1 || quotes.length > 8) throw new Error("各項目の事業根拠は1〜8件にしてください。");
    return [...new Set(quotes.map(value => {
      const quote = value.trim();
      if (quote.length < 24 || quote.length > 800) throw new Error("根拠引用は1件24〜800文字にしてください。");
      let id = byQuote.get(quote);
      if (!id) {
        id = `business-${evidence.length + 1}`;
        byQuote.set(quote, id);
        evidence.push({ id, section: "business", quote });
      }
      return id;
    }))];
  }
  const summaryEvidenceIds = references(summaryQuotes);
  const businessModelEvidenceIds = references(modelQuotes);
  return { evidence, summaryEvidenceIds, businessModelEvidenceIds };
}

export function annualReviewPreflight(
  record: ReviewRecord | null,
  business: ReviewSource | null,
  risks: ReviewSource | null,
  riskText: string,
) {
  const blockers: string[] = [];
  if (!record) blockers.push("annual-draft-missing");
  if (!business || !risks) blockers.push("annual-source-unavailable");
  if (!record || !business || !risks) return { ready: false, blockers };
  if (record.ticker !== business.ticker || record.ticker !== risks.ticker
      || record.accessionNumber !== business.accessionNumber
      || record.accessionNumber !== risks.accessionNumber
      || record.sourceSha256 !== business.sourceSha256
      || record.sourceSha256 !== risks.sourceSha256) {
    blockers.push("annual-source-revision-mismatch");
  }
  if (!/^[a-f0-9]{64}$/.test(record.validationSha256 ?? "")) {
    blockers.push("annual-draft-fingerprint-missing");
  }
  const evidence = new Map<string, Evidence>();
  for (const item of record.evidence) {
    if (evidence.has(item.id) || !item.quote) blockers.push("annual-draft-evidence-invalid");
    evidence.set(item.id, item);
    const corpus = item.section === "business" ? business.excerpt : riskText;
    if (!corpus.includes(item.quote)) {
      blockers.push(item.section === "business"
        ? "annual-business-evidence-mismatch" : "annual-risk-evidence-mismatch");
    }
  }
  const businessIds = [...record.summaryEvidenceIds, ...record.businessModelEvidenceIds];
  const riskIds = record.riskPointsJa.flatMap(point => point.evidenceIds);
  if (!businessIds.length || businessIds.some(id => evidence.get(id)?.section !== "business")
      || !riskIds.length || riskIds.some(id => evidence.get(id)?.section !== "risk")) {
    blockers.push("annual-draft-evidence-invalid");
  }
  const uniqueBlockers = [...new Set(blockers)];
  return { ready: uniqueBlockers.length === 0, blockers: uniqueBlockers };
}
