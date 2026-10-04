# Analyst-rating intake handoff — September 30, 2026

## Completed

- Added an authenticated `ratings` view to the private signal queue and stable
  content labels for analyst ratings, numeric targets, earnings,
  company-official and other publisher posts.
- Rating language is the primary label when one post also includes a price
  target. The numeric target filter still includes that item.
- Public health and the intake dashboard expose only the rolling API budget,
  route state and 24-hour aggregate item counts. Rating and target counters can
  overlap while the total counts unique items; the UI states this explicitly.
- The public aggregate contains no account, ticker, title, URL, query, post body
  or credential. It proves only what the bounded routes retrieved, not complete
  X coverage or subscriber-delivery latency.
- Offline regression coverage verifies the private rating filter, overlapping
  target classification, 24-hour aggregate and public-field privacy.

## Verification

- ESLint: zero errors and one pre-existing unused-variable warning.
- Node tests: 168 passed.
- Python tests: 461 passed.
- Next.js production build, Python `compileall` and `git diff --check`: passed.

## Live checkpoint before deployment

The canonical preview was connected. It showed 21 of 25 official routes fresh,
four route errors, 19 of 19 eligible headlines translated, one measured
detection-to-body sample at 8.8 seconds and two publication-to-monitor samples
averaging 106 seconds with a 122-second maximum. These are observations, not an
SLA. The protected raw MU health was not reread in this pass; the last verified
state remains `waiting-for-release`, so no result should be inferred until the
persisted metrics change.

## Next

After deployment, confirm that the aggregate X line renders on the canonical
preview. To establish whether a particular NBIS rating was captured, use the
authenticated private rating queue; do not infer a specific post from the
aggregate counters. Keep the bounded X budget and no-auto-publication policy.
