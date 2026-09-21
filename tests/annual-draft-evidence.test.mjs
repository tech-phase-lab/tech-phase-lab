import test from "node:test";
import assert from "node:assert/strict";
import { businessDraftEvidence, referencedQuotes } from "../lib/research/annual-draft-evidence.ts";

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
