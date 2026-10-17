# Private RIZEL review

The owner approves each article revision independently in Japanese and English
at /resolute/rizel-admin. The page and API require the existing verified owner
identity; a browser-supplied user ID or administrator label does not grant access.
Pending counts act as an in-app notification. No email is sent.

Approval records use optimistic revisions, append an audit event, and serialize
with article selection. A newer article cannot inherit an older approval.
All selections and copy revisions remain publication=withheld. There is no
customer reader and no automatic switch to public display. The first one to two
weeks are intended for manual review; enabling automatic display remains a
separate owner decision, not a date-triggered operation.

Copy replacement: select ID/language, paste, preview, approve/save unpublished.
A new immutable approved revision is appended; the other language and historical
article snapshots stay unchanged. Public copy is not replaced by a draft.

Selection counts the exact Japanese substring ルール across conclusion plus three
reasons and rejects combinations exceeding one occurrence. Zero is allowed.
If three suitable reasons cannot fit, only the conclusion is retained. The model
ranks approved IDs only and is asked to avoid semantic repetition. Human review
is still required to assess meaning. Numerical conditions require trusted data.

The worker accepts trusted ingested articles and verified evidence, reads the
private bank, shares the monthly USD 5 budget with summaries and saves each
article revision once. Page views never invoke the model. There is no enabled
schedule. The one-time connection check uses the dated three-article review
fixture, separately identified with review-sample: IDs; these are not live news.

Private SQL migrations 009, 011 and 012 are additive. Runtime roles are limited;
ordinary entitlement readers and the risk writer cannot read the copy bank.
Private approved wording and secrets are not part of the repository.
