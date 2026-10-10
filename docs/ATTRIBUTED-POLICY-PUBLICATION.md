# Source-bound attributed-policy publication

## Scope

The new adapter admits only the reviewed `PolicyReport` grammar in
`financing_policy_source.py`. Its vocabulary and three source constructions are
closed. It consumes the complete source, preserving the Hassett attribution,
past approximate jobs assessment, the president's commitment, and negative
first-person-plural desire. It does not infer a first name, official title,
identity of “we,” month, metric, figure, or company. Financing grammar remains
unwired. Unknown clauses and different headers gain no new authority.

A recognized source does **not** establish materiality. Fresh eligible reports
use the existing single, budgeted assessment and response schema. A positive
assessment renders three complete bilingual paragraphs and a useful title from
the typed source. Explicit negative decisions remain terminal. Existing optional
related ticker metadata remains unchanged in stored source/audit history, while
this policy-only public type has empty tickers. Source URL and source clocks
survive; the adapter creates no ticker mapping or company attribution. The public
transport is `officialUpdates` with `generalSource: 1`, `newsCategory: "policy"`
and the existing `Reported economic news` publisher classification. Its existing
card displays only the narrow Policy news / 政策ニュース category branch; no
other category label or layout changes. Normalizers retain and validate the
classification through both server and browser passes. Audited short title
alternatives preserve the existing 64-unit rotating-header limit, with a
policy-only fallback rather than company-news wording. Full lower copy stays
unchanged.

## Historical proof and recovery

The historical worker first checked provider status `completed`, extracted and
parsed its assessment JSON, and then retained `json.dumps(value)` when copy
validation failed. The archived payload is the complete **retained schema
assessment**, not a raw HTTP provider envelope or proof that model wording was
valid. Its original positive `publish/material-company-development` decision
must be present. It was not reassessed under the new policy-specific prompt.

Held recovery requires a unique current-source failed call and failure, exact
same-lease body proof and terminal job/review, current policy and ordering clocks,
a complete matching raw acquisition, current source policy/revision/representative
selection, and no independent publication owner. The derived publication and
append-only audit are one atomic transaction. The old source, call/cost/usage,
job, failure, review and retry history are not rewritten. Rendering happens
outside the writer lock; exact source/history/selection/policy inputs are checked
again under `BEGIN IMMEDIATE`. Recovery is idempotent and makes no model call.

Fresh copy/source validation likewise occurs before the writer transaction,
using one coherent deferred WAL read snapshot and relevant-input rechecks at
commit. Unrelated cache/feed writes do not strand a completed assessment;
ABA writes cannot mix predicate versions. Ambiguous or previously reserved calls
cannot authorize another paid request after audit loss, parser drift, interrupted
commit, missing job, or expired lease. This conservatively holds an interrupted
reservation whose dispatch was not established; it does not fabricate dispatch
or reset a job. A healthy first running assessment still reports as pending.

## Reads, ownership and diagnostics

Read-only publication projection verifies one request-scoped proof per policy
item after the existing single candidate selection. There is no cross-request
cache. Source withdrawal, changed revision, proof/audit loss, changed policy and
concurrent mutation withdraw the output. The result worker's denial-only receipt
prevents a competing partial flash. Existing independently owned publications
remain unchanged.

The existing authenticated owner terminal-review diagnostic can show a bounded
`editor-only-policy-recovery` check. Only fixed refusal codes and booleans are
added. It exposes no raw source, stored assessment, provider fields, lease or
secret, performs no write, and never claims atomic recheck/publication authority.
No public health schema or public diagnostic expansion is added.

## Offline verification boundary

Event 1247's separately inspected raw source is 152 bytes, with source SHA
`51763f76686bf0ca9319379a621d3aa72a44c8a86397ce11eaa2421734c1c7b7`
and body SHA
`9afddc9eeefe442b6ac398aa99982ac09547fadd3c6bfd5a675b948da973c9f8`.
The offline old-worker/recovery replay uses those exact bytes and source clocks,
with explicitly synthetic historical assessment/call/job records. It proves
code behavior, **not** actual event 1247's historical materiality eligibility or
live publication. Runtime must verify the unavailable full historical records
or refuse with an owner-only reason. Event 1174's raw acquisition proof remains
unestablished and its financing route remains blocked by this adapter.

Focused tests cover the real collector/service/worker/public path, both worker
orders, restarts, negative assessments, zero-call historical correction, source
withdrawal, revisions, proof loss, stale jobs, rollback, concurrent writers,
no paid fallthrough, exact existing-story parity and query-only reads. All
transport/provider responses are offline stubs; none is a real paid request.
