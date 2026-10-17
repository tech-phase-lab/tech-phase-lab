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

Editorial repetition guard (v3): the selected Japanese conclusion and reasons
may each contain ルール, ニュース and 今日 at most once in total. Known
paraphrases of inaction, unchanged plans, rereading rules, waiting until
tomorrow, price levels and avoiding haste are rejected when repeated.
Rejected combinations and their reasons are saved in the selection audit.
These conservative checks do not prove semantic quality; owner review remains
mandatory. Approved wording is unchanged, and insufficient compatible reasons
produce a conclusion alone. The policy revision prevents old cached selections
from being reused when an article is explicitly processed again. Existing saved
reviews are not silently rewritten and remain unpublished.

## Private morning preparation (not activated)

`node services/resolute-api/rizel-daily-review-cli.mjs` is a separate private path.
It defaults to disabled. It reads the existing HTTPS news endpoint, filters and
summarizes at most three recent candidates, then selects approved copy and saves
pending Japanese/English reviews. It never writes risk_days, risk_quotes or a
publication switch. No email or customer display occurs.

Migration 013 records a once-per-JST-day claim, source failure versus a verified
empty intake, and references to saved selections. Claims survive failure so an
automatic retry cannot repeat paid summaries. Partial selections remain private
and auditable. No D conditions are inferred from an AI summary: trusted evidence
integration remains pending. Word/meaning filtering still applies.

Deployment prerequisites: apply additive migration 013; provide the existing
scoped RIZEL and risk database connections, existing OpenAI key, and an approved
RESOLUTE_NEWS_ORIGIN reachable by the worker. Set
RESOLUTE_RIZEL_DAILY_REVIEW_ENABLED=true only after the private dry run and cost
review. The intended scheduler expression is `0 22 * * 0-4` UTC (weekdays 07:00
JST). The worker also rejects weekends and hours outside 07:00–07:59 JST.
This code does not create or enable a scheduler. The monthly shared USD 5 budget
continues to apply to summaries and selections. No new subscription is required
by the code; actual Railway running costs have not been measured.

Unfinished: migration application, real feed dry run, cron activation and actual
07:00 execution verification. The risk scoring rubric still needs a separate
public-operation decision. RIZEL publication remains withheld after approval.

## Real source inspection — 2026-10-17

Read-only inspection through the authenticated preview endpoint succeeded:
81 official updates, 56 with body text and 14 with publication timestamps.
The general-news `enabled` flag was false, independently of official updates.
The collector now respects that lane distinction, ignores disabled general
items, and rejects malformed/unavailable feeds.

Private daily intake additionally accepts a validated publishedOn date when
publishedAt is missing. It preserves YYYY-MM-DD without manufacturing a time.
Freshness uses the earliest possible instant across UTC offsets; future checks
use the latest possible instant. This intentionally delays uncertain recent
dates and excludes uncertain old dates. Public collection remains timestamp-only.
A malformed supplied timestamp is never repaired from a fallback date.

Observed positive announcements were matching risk terms in their bodies.
Intake now requires a downside term in the headline too. This conservative filter
can miss indirectly worded headlines; it does not establish a risk rating.
Summary evidence validation and owner review remain mandatory.

No paid model call or customer publication occurred during source inspection.
Unattended source authentication, migration 013, scheduler activation and actual
07:00 operation remain pending. The existing monitor token also grants other
operations: do not extract a protected token or hand broad credentials to a new
worker just to make intake work. A dedicated read-only connection is still needed.
Twelve Data is not contracted; the owner plans to subscribe in mid-November.
Price-dependent verification waits until access is available.

## Dedicated read-only source connection

The private worker now reads the monitor directly through GET
`/internal/resolute/news`, using `RESOLUTE_NEWS_READ_TOKEN` on both services and
`RESOLUTE_NEWS_ORIGIN` pointing to the intended monitor's HTTPS root. The new
reader token must be independently generated (at least 32 characters), not the
general API or editor credential. No value belongs in this repository or logs.
The endpoint fails closed when unconfigured, rejects query options, and returns
only the existing published feed. Reader credentials are rejected on POST and
cannot use the general API authorization path. Existing monitor callers remain
unchanged when the new setting is absent. The worker sanitizes the result with
the site's shared feed builder; original preview items remain excluded.

Implementation does not install a token, deploy the monitor, apply migration 013
or enable a schedule. Those operational steps and a real authenticated read are
still required. Keep customer publication withheld throughout the private run.

Operational follow-up: a new independent reader credential has been configured
on the intended staging monitor and RESOLUTE API, with redeployment skipped.
Its value is not stored in this repository. This does not confirm that running
processes have loaded it, nor that a reader request succeeds. No worker schedule
or publication flag was enabled.
