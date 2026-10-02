# Unstrand the NBIS article publication retry

Owner requested continued work until the remaining processing queue is resolved.
At 04:13 UTC the live DB showed event 1119 (`primary-ir-NBIS`, Inferize
acquisition) in `retry`, one attempt, `invalid-copy`, with its retry deadline
already past. Rolling calls were 124 shared / 20 research. The separate hardcoded
20-call research quota prevented another attempt despite 76 unused shared slots.
Sandisk had 15/15 article bodies and PR Newswire 30/30, with no child errors.

Replace that fixed subquota with capacity reserved for currently pending official
headlines. The existing configured shared 200-call ceiling, atomic reservation,
per-item backoff, current-revision checks and all factual validation remain.
This does not change billing, provider credentials or the shared daily cap.
The provider instruction now states the output lengths that validation already
enforced, instead of silently rejecting overlong generated fields.

Regression cases reproduce 20 historical research calls plus the blocked retry,
verify automatic bilingual publication when shared capacity remains, preserve
the final slot for a pending headline, and retain the global cap and retry delay.

The 04:00:13 UTC observation was started with this known pending article and is
diagnostic only. Do not declare acceptance or manually write a fabricated
publication. Wait for the deployed worker's actual result, compare both languages
to the fetched original, verify the browser, then record the new start and end.
