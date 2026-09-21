import test from "node:test";
import assert from "node:assert/strict";
import { annualDraftGenerationMethod, annualReviewPreflight, businessDraftEvidence, referencedQuotes } from "../lib/research/annual-draft-evidence.ts";

test("annual edits preserve AI provenance and require an explicit method for new drafts", () => {
  assert.equal(annualDraftGenerationMethod("human", "ai-assisted"), "ai-assisted");
  assert.equal(annualDraftGenerationMethod("ai-assisted", "human"), "ai-assisted");
  assert.equal(annualDraftGenerationMethod("human", "human"), "human");
  assert.equal(annualDraftGenerationMethod("ai-assisted"), "ai-assisted");
  assert.throws(() => annualDraftGenerationMethod(null));
  assert.throws(() => annualDraftGenerationMethod(""));
});

const company = "The company designs and manufactures memory products.";
const model = "Revenue is generated through sales to enterprise customers.";
const shared = "Products are sold through both direct and distribution channels.";

test("editing preserves separate, ordered evidence for overview and business model", () => {
  const original = businessDraftEvidence([company, shared], [model, shared]);
  assert.equal(original.evidence.length, 3);
  assert.notDeepEqual(original.summaryEvidenceIds, original.businessModelEvidenceIds);
  const summary = referencedQuotes(original.evidence, original.summaryEvidenceIds);
  const business = referencedQuotes(original.evidence, original.businessModelEvidenceIds);
  assert.deepEqual(summary, [company, shared]);
  assert.deepEqual(business, [model, shared]);
  assert.deepEqual(businessDraftEvidence(summary, business), original);
});

test("legacy shared evidence remains shared without duplicating or losing quotes", () => {
  const draft = businessDraftEvidence([company, company], [company]);
  assert.equal(draft.evidence.length, 1);
  assert.deepEqual(draft.summaryEvidenceIds, draft.businessModelEvidenceIds);
});

test("missing, oversized, and excessive quotes are rejected before submission", () => {
  assert.throws(() => businessDraftEvidence([], [model]));
  assert.throws(() => businessDraftEvidence(["short"], [model]));
  assert.throws(() => businessDraftEvidence([company], ["a".repeat(801)]));
  assert.throws(() => businessDraftEvidence(Array(9).fill(company), [model]));
});

test("annual review preflight binds the draft to the displayed SEC evidence", () => {
  const source = { ticker: "MU", accessionNumber: "0000723125-26-000001", sourceSha256: "a".repeat(64) };
  const record = {
    ...source, validationSha256: "b".repeat(64),
    evidence: [
      { id: "business-1", section: "business", quote: company },
      { id: "risk-1", section: "risk", quote: model },
    ],
    summaryEvidenceIds: ["business-1"], businessModelEvidenceIds: ["business-1"],
    riskPointsJa: [{ evidenceIds: ["risk-1"] }],
  };
  const result = annualReviewPreflight(
    record,
    { ...source, excerpt: company },
    { ...source, excerpt: model },
    model,
  );
  assert.deepEqual(result, { ready: true, blockers: [] });
});

test("annual review preflight identifies source drift and missing evidence", () => {
  const source = { ticker: "MU", accessionNumber: "0000723125-26-000001", sourceSha256: "a".repeat(64) };
  const record = {
    ...source, validationSha256: "b".repeat(64),
    evidence: [
      { id: "business-1", section: "business", quote: company },
      { id: "risk-1", section: "risk", quote: model },
    ],
    summaryEvidenceIds: ["business-1"], businessModelEvidenceIds: ["business-1"],
    riskPointsJa: [{ evidenceIds: ["risk-1"] }],
  };
  const result = annualReviewPreflight(
    record,
    { ...source, sourceSha256: "c".repeat(64), excerpt: "Changed business section without the quote." },
    { ...source, sourceSha256: "c".repeat(64), excerpt: "Changed risk section without the quote." },
    "Changed risk section without the quote.",
  );
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers, [
    "annual-source-revision-mismatch",
    "annual-business-evidence-mismatch",
    "annual-risk-evidence-mismatch",
  ]);
});
