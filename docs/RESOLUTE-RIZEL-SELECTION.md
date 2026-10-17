# RIZEL selection — private implementation, October 17

## Owner decisions

90 Japanese and 90 English entries approved, publication withheld. Withdraw
D-executive-03 in both languages. Seven English price-level corrections are
approved; other I/you usage stays unchanged. Approved source and translations
are private Library artifacts, not tracked files or public client assets.

Admin mock shown in conversation: choose Japanese/English → paste draft →
preview text, risk group, conditions and diff → approve/save unpublished →
separate publication after owner OK. Each language approved separately. A new
revision never overwrites the current published revision. Actual admin editing
and approval UI is not implemented yet.

## Implemented locally

- Pure selector takes private approved bank, article ID/revision, trusted evidence,
  history and an AI ranking callback. AI returns relevant IDs only; server rejects
  unknown, duplicate, wrong-group and unverified-condition IDs and generated prose.
- D conditions take priority; other reasons come from the star group. Three
  reasons or conclusion only if fewer than three are relevant. No matching
  conclusion produces a recorded no-relevant-conclusion result, not invented text.
- Recent reuse excluded within JST calendar windows (7/10 days), while eligible
  alternatives remain. Exhaustion falls back to least recently used candidates.
- PostgreSQL transaction and advisory lock serialize selection; article revision
  is idempotent. Snapshot contains selected bilingual text/hashes/revisions,
  article, evidence, eligible IDs, AI output and history. Table is private and
  publication is constrained to withheld.
- Evidence comes only from trusted ingestion, never browser or model input.
  Numerical predicates require verified data, not editor/model claims. Thresholds
  such as “slight miss” remain unset: do not supply evidence until defined and
  verified. No price-target/rating API is connected.
- AI adapter requires explicit budget authorization and is not called on reload.
  It has no enabled job and no newly allocated budget.
- Owner review scenario context covers low/mid/high, expired, failed and live.
  Overrides change only presentation; real news copy and account rights remain.
- Private comment layout endpoint requires preview environment and authenticated
  owner. Reads twelve layout-only entries from the branch-scoped server secret
  RESOLUTE_RIZEL_LAYOUT_PREVIEW_JSON (preview only).
  Returns only four selected display examples, not the full registry. No customer
  screen displays comments, even when legacy risk quotes are approved.

## Not yet activated / verification limits

No deploy, migration, job activation, paid API request or email send. The full private bank and DB are not connected. The owner layout preview uses
only twelve approved examples in a preview-only secret. Missing or invalid
configuration returns a private 503; ordinary visitors cannot read the secret.
The fixed layout examples are explicitly not AI news selections. AI integration
must be attached to trusted article create/update after budget/worker setup;
real-model selection quality is not verified by synthetic tests.

Migration 011 must be applied by a database administrator. Grant its SELECT and
INSERT to the selected private worker only (not the public/web role); current
risk writer is deliberately not granted access automatically.

## Publication boundary

Owner approval of text is distinct from permission to publish. This implementation
has no public-publish operation. Keep comments hidden until an explicit publish
workflow and owner permission exist. Never copy the private bank into GitHub,
NEXT_PUBLIC variables, a public static preview bundle, or public risk_quotes.
