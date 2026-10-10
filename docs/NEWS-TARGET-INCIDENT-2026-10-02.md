# New X target omitted from public feed — October 2, 2026

The owner reported no visible news updates at 18:41 JST. Do not classify this
as “no new news” from a healthy status or empty translation queue.

## Evidence

Read-only live inspection found event 1170 on `x-wallstengine`: an AST
SpaceMobile downgrade and price-target reduction from USD 85 to USD 65 by
B. Riley. Source publication was 08:43:48 UTC; observation was
08:44:16.476 UTC (17:44:16 JST), a 28.476-second acquisition delay. The full
post mentions VSAT as a competitor; it is not the target-change subject.
At 18:43 JST, refreshing the home feed still showed only the older AMZN,
MSFT and AMD price targets. This is a confirmed publication miss, not a
source-fetch failure. Its translation queue had no job because targets use
structured bilingual field labels.

Two parser gates suppressed it: `price target of $65, down from $85` was not
recognized, and the general matched ticker list contained both ASTS and VSAT.
The existing parser also used a 500-character title rather than the complete
revision-bound source text. There was one other post-16:00 JST candidate:
event 1169, a karaoke-product PR mentioning Google, outside company-news scope.
This database inspection is not an independent census of all source posts.

At 18:42 JST the worker was running, 24/24 enabled supplemental routes were
fresh with zero current route/article errors, headline translation was 49/49
with no pending/running/retrying/exhausted job, and all four enabled X accounts
had successful fetches around 18:44–18:45 JST. These signals did not catch
the parser omission. Legacy body-fetch access restrictions and 21 carry-in
incidents remain separate from the supplemental news feed; do not call the
entire system error-free. CoreWeave also had an articlePartial failure at
07:31 UTC, recovered at 07:35 UTC, after the prior worker restart.

## Repair

Support the explicit `of/at $new, up/down from $old` grammar and enforce its
numeric direction. Parse full saved text only when its SHA matches the event.
For multiple mentioned tickers, require an explicit opening cashtag/analyst
action, a recognized firm before the target statement, and no other cashtag
before that statement ends. Continue rejecting multiple target actions and
ambiguous firms. Competitor mentions after a clearly attributed statement no
longer exclude that statement. No source-specific numeric override, extra paid
request or relaxed number-direction check is used.

Regression cases cover both directions, contradictory direction words,
competitor attribution, ambiguous subjects, and a second action hidden after
the old 500-character boundary. Record deployment and live publication below
once observed. Preserve the original 24-hour observation window; this miss
means that interval must not be described as error-free or fully passed.

## Deployment and observed recovery

Repair commit: `b173d8e680346cce9821b69bd4a46379010448d5`. GitHub Actions
run 36992334095 completed successfully; Vercel and Railway deployment checks
succeeded. Local gates passed: 207 Node tests, 599 Python tests, build,
compileall and diff check. Lint had zero errors and one existing warning.

The replacement worker started at 2026-10-02T09:53:28.138Z. Its health was
ready at 09:54:29 UTC. The Japanese home feed was confirmed recovered by
18:54:11 JST, showing ASTS / B. Riley / USD 85 → USD 65 / 引き下げ. Switching
to English showed the same numbers with Lowered. The exact first-publication
time was not measured; the first confirmed recovery was about 70 minutes
after acquisition. A Japanese screenshot at 18:55:36 JST also shows the row.

This repairs the reproduced parser omission, not proof of complete source
coverage or future translation correctness. The original observation interval
remains failed for timely publication.
