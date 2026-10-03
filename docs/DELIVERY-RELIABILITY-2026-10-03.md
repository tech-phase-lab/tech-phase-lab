# October 3 delivery and article-detail follow-through

The morning check at 00:10 UTC found all three public APIs responding with HTTP
200, five retained price-target records and a ready worker. The supplemental
sources were 23/24 fresh, with one persistent article failure; primary issuer
access restrictions/timeouts remained separate. The current branch was
`610c492cf7e5f29138e2e4c62730208eea747026`, two documentation-only commits after
the eight tested repairs. Japanese and English home displays were checked.
This does not supersede the original failed MU, employment or ASTS timings.

## Three pending issuer articles

Protected, read-only diagnostics identified these current candidates at
00:18:58 UTC. Rejected prose was not exposed by the diagnostic endpoint.

- VRT `1227`: the original issuer release is dated **July 29, 2026**, despite
  being acquired in September with a missing publication date. The original
  revenue is $3,274 million; a rounded $3.27 billion claim is not an exact
  equivalent. This historical release must not be treated as current news.
- NVDA `1213`: the games announcement is dated October 1, 2026. The failed
  note introduced 2024 dates. Those remain invalid. Its actual abbreviated
  dates such as Oct. and Sept. exposed a separate calendar-parser omission.
- NVDA `1214`: the AI-factory article had differences between the selected
  source excerpt and the two languages' quantities/years. A duration is not
  permission to derive a calendar year. Diagnostics alone cannot identify
  every original wording difference, so no new unit/fraction aliases were
  added on speculation.

Original pages:

- [Vertiv quarterly release](https://investors.vertiv.com/news/news-details/2026/Vertiv-Reports-Strong-Second-Quarter-2026-with-Diluted-EPS-Growth-of-53-Adjusted-Diluted-EPS-Growth-of-60-Raises-Full-Year-2026-Guidance-Across-All-Key-Metrics/default.aspx)
- [NVIDIA October games](https://blogs.nvidia.com/blog/geforce-now-thursday-october-2026-games-list/)
- [NVIDIA AI-factory returns](https://blogs.nvidia.com/blog/productive-durable-fungible-ai-factories/)

## Bounded corrections

Retry feedback now identifies each `facts[n]` field and supplies the same
quantity, date and quarter differences as the protected diagnostic view.
Literal evidence constraints are bounded and attached only when the prior
quote still belongs to the current retained body. An old quote cannot become
current evidence. The prompt explicitly rejects rounding, invented years,
unequal bilingual quantities and unsupported combinations of separate facts.
Retries retain existing budgets, leases and backoff.

Standard English month abbreviations are recognized while exact date/year
relationships stay enforced. Tests reject wrong years, dates assembled from
unrelated supported digits, invalid calendars and ungrounded year inference.

Vertiv's missing original date is recovered only from its exact issuer-specific
PRNewswire dateline in the current retained body and canonical release URL.
No guessed DOM selector or new fetch is used. Only a missing date is filled;
existing original dates, observation clocks, evidence revisions and failure
audit history remain intact. The ordinary seven-day/current-revision gates
then exclude the July article. Removing historical material from the current
queue is not a successful new publication or a numeric-validation override.

## Detail controls require additional information

News rows now expose an expansion control only when the selected language has
substantive information beyond its headline. Exact repetitions, punctuation
changes and a rearrangement of the same headline facts do not qualify. A short
source-only story retains its headline and an accessible original-source link.
The Treasury post contains no additional yield figure and therefore has no
empty expansion. Real issuer summaries and additional facts remain expandable.

Economic result details may include forecast, previous and revised-from values
only when the retained source text explicitly assigns them to the same metric.
These optional comparisons have separate labels and do not replace actual
reported values. Ambiguous or malformed comparisons are omitted without hiding
otherwise valid actual results. Current-revision reprojection needs no extra
provider request and preserves original source/acquisition/publication clocks.

## Timing remains a separate acceptance question

The prior genuinely new Treasury sample took 36.778 seconds to acquire and
3.240 seconds from acquisition to persisted publication. A 20-second
source-to-publication goal is not established by these article fixes. Stream
activation, provider budgets and acquisition strategy remain separately scoped.

## Integrated checks

The final candidate passed 256 Node and 734 Python tests (990 total), lint
(zero errors and one pre-existing unused-variable warning), production build
and type checking, compileall and whitespace checks. The Python gate recorded
zero external DNS/socket attempts. Independent review caught and corrected
two optional-comparison defects before publication: unrelated period/prose
could be scanned past, and conflicting prior revisions could select the first
value. The strict final grammar rejects both while preserving actual results.
The independent recheck found no remaining blocking issue in this scope.

Deployment, browser verification and the two NVIDIA jobs' scheduled retries
remain distinct runtime acceptance stages; test success alone does not establish
that those saved jobs have regenerated or been published.

## Ninth rollout: verified runtime state

Commit `fe5762a9858046de2e997a5530a0b917a8a5b90e` deployed with the exact
checked tree `29c30c4f253664dad5e64e68d5e3d82f2d50e738`. Actions
`37085481051`, Vercel `dpl_3ED86kiYcVt3oysUxgynzjGuz3zs` and Railway
`3370f94d-c335-4604-a6db-a5aaf00e42b3` succeeded. The new worker started at
01:17:17.899 UTC.

At 01:18 UTC, Vertiv's stored original date was July 29 and its September
discovery/body clocks and body revision were unchanged. Current candidates
fell from 23 to 22, with two pending NVIDIA notes. Treasury's main list row
had no disclosure in either language. Employment details added only the
source's unemployment forecast of 4.1%, distinct from the 4.2% actual; both
languages and a 388-CSS-pixel responsive layout were verified without horizontal
overflow. A remaining Japanese index-name-only disclosure was identified and
is corrected by treating every current market-update payload as headline-only.

The two NVIDIA notes had retried at 01:09 UTC, before this deployment, and
failed under the old policy. Their next ordinary deadlines were 07:09:01 and
07:09:19 UTC. Those attempts are not evidence that the new prompt failed or
succeeded. A bounded repair of those exact retained revisions is tracked
separately, preserving the prior failures, budgets and original clocks.

The persistent CoreWeave article failure and primary-source access gaps remain
separate. A passing fresh, continuous 24-hour acceptance window has not been
established; the historical failed window is not relabeled after these repairs.

## One-time repair for the two older-policy failures

The existing worker can admit one audited attempt for exactly NVDA events
1213 and 1214, pinned to their current source URL, title, publication day and
retained revision. The latest same-lease failure must be `unsupported-number`,
after the original observation and before the new prompt's 01:17:17.899 rollout.
Running jobs, provider failures, different or stale source bodies, already
published revisions and other events cannot use this override. The cohort
expires on October 4 at 01:17:17.899 UTC.

A durable policy/revision audit stores the old attempt count, retry deadline
and failure identity. Its reservation shares the existing budget/lease
transaction; normal attempts consume the same marker. Source clocks and
failure history remain unchanged, and a failed repaired attempt returns to
ordinary backoff. No new HTTP action, credentials, source request or spending
limit is introduced. This is not a recurring retry reset or bulk regeneration.

The combined one-time repair and remaining headline-only display correction
passed 258 Node and 746 Python tests (1,004 total), the required lint/build/type,
compile and whitespace gates, and independent review. External DNS/socket
audit: zero attempts. Runtime regeneration results must still be observed.
