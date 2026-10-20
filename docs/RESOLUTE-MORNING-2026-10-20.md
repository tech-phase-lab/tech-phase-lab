# October 20 morning investigation (JST)

The scheduled worker started at 07:02:02 JST (22:02:02 UTC October 19).
Deployment 93dc0258-42b2-49ab-80be-30c17c5c455c logged RIZEL_DAILY_REVIEW,
day 2026-10-20, state ready, count 0, publication withheld. This is not evidence
of a generated article. The prior response overstated what the log proved.

An independent BEGIN READ ONLY query at 09:14 JST confirmed the actual daily row:
state ready, candidate_count 0, saved selection count 0, publication withheld.
No daily claim was deleted, no worker rerun and no AI request was made.
The old worker also stored the start time as finished_at; that was not a measured
completion timestamp.

The dedicated reader currently returns HTTP success from the staging monitor:
general lane disabled, zero general items, 70 official updates and 20 official
research items. Market updates are empty; the two analyst reports are a recent
INTC upgrade and an October 13 ADBE downgrade. The latter is outside the daily
96-hour window. Public analyst records omit provenance URLs and are not silently
converted into sourced risk articles. Current feed inspection is not a stored
snapshot of the exact 07:02 response.

The intake only considers the configured general/official lanes, requires a
sufficient body, AI/semiconductor relevance, downside wording in the headline,
and conservative publication-date bounds. A reachable feed is not proof of
complete risk coverage. General ingestion must not be enabled or supplied with
new paid calls as part of this diagnostic without the existing authorization.

Fix: candidate inspection now returns aggregate rejection reasons and lane
coverage counts using the same selection logic. Daily logs distinguish
no-candidates from ready; they do not equate zero output with a verified quiet
market. After finishing, the worker reads the row back and checks state, count,
references and withheld publication before reporting storageVerified. Readback
mismatches fail closed. Failure logs include the stage and bounded counts, never
article text, copy bank, credentials or user data. The completion timestamp now
uses completion time. No new schema or schedule is needed.

A temporary unscheduled diagnostic service e6c24007-1ffe-48ab-957b-eaa8b127d559
was used with the existing scoped RIZEL DB and dedicated GET-only news credential.
The DB transaction was read-only. No payment, mail, publication or AI setting was
changed. Its credentials must be cleared and disabled logs verified after use.

Remaining: positive-candidate live generation has not been demonstrated by this
run. Current source breadth remains a launch limitation; do not promise three
articles every day or infer absence of market risk from this restricted feed.

## Sanitized-path read-only verification at 09:18 JST

The actual reader plus shared public-feed sanitizer and candidate selector ran
without generation or writes in deployment e3a359c8-669e-4693-be49-6c9923159bff.
It inspected 72 sanitized official entries: 27 lacked sufficient body, 16 failed
relevance, 28 lacked a downside headline. One remaining candidate was outside
the daily 96-hour window, so zero reached daily selection. Sanitizer enrichment
explains the difference from 70 raw official records. General intake was disabled.
This reproduces zero selection on the 09:18 live feed; the exact 07:02 raw feed
was not retained and cannot be claimed as replayed. It does not demonstrate that
all real-world risk news was covered.

Diagnostic retirement: all three temporary credential/origin references cleared,
DIAGNOSTIC_ENABLED=false. Deployment d49ab6ae-6bc3-4f5d-996a-903e1970c051 logged
RIZEL_INTAKE_DIAGNOSTIC_DISABLED at 09:19:15 JST. No cron or domain was added.

## 09:40 JST deployment verification

Owner applied the pending single commit-pin update. Railway deployment
baf2b22a-fd02-491f-ab0b-662f8177121d is SUCCESS at f9c167f5.
Actual 00:40:38Z RIZEL_DAILY_PREFLIGHT log reports ready, approvedPairs90,
publication withheld, aiCalls0, writes0. No new daily generation/storage run
was observed. Cron remains `0 22 * * 0-4`; no staged changes. GitHub CI for
f9c167f5 completed successfully. This does not repair October20's zero rows.

## Intake follow-up implementation

The English downside matcher incorrectly admitted `Urban` via `ban`, and also
admitted bandwidth/cutting-edge/executive via fragments. It now matches bounded
words and explicit inflections, including downgrade/downgraded and Japanese
格下げ/引下げ. These changes are lexical screening, not semantic verification:
model evidence checks and withholding remain mandatory. This follow-up is not
included in f9c167f5's deployed image.

Daily age filtering, headline deduplication and the three-item cap now use one
pure selector shared with a GET-only diagnostic:

`node services/resolute-api/rizel-intake-check.mjs --read-only`

The command uses only RESOLUTE_NEWS_ORIGIN and RESOLUTE_NEWS_READ_TOKEN. It does
not open a database pool, claim/reset a day, call AI, publish, or send mail.
It runs the same authenticated reader and public sanitizer as the daily worker;
reports contain aggregate reasons/counts only. Do not paste credential values
into a terminal command or log. A current result is never a historical replay.

Coverage remains incomplete. General-news enabled=false is honored, and no
contract or source-wide flag is changed. The analyst public shape intentionally
omits the original source URL (`lib/research/analyst-news.ts`); using it directly
as sourced risk evidence would invent provenance. A separate authenticated,
source-validated upstream contract is needed before admitting that lane. The
shared news pipeline belongs to the other assigned developer; this follow-up
changes only RESOLUTE intake, not that pipeline. Do not relax evidence/date/body
requirements just to meet a daily count, or call zero candidates a quiet market.

## 09:54 JST follow-up deployed and live intake checked

Code26a329325eb615dc7e1acb861b9c5d4e01fb0c04 integrated coworker46ffd28e.
Final local gates: Node1175, Python2508 (211.597s), lint0 errors/5 existing
warnings, build, compileall and diff check passed. Git Data tree exactly matched
a5bf9faa1de72848175b42fc5c4c78c8202d9f85 before the non-force branch update.

Morning deployment21d15d62-07ff-484e-b740-3ba6b1caa943 reached SUCCESS.
Actual00:54:00.860Z preflight: ready, approvedPairs90, publication withheld,
aiCalls0, writes0. Cron unchanged; no customer publication or daily-claim reset.
This verifies deployment/preflight only, not the next scheduled generation/save.

Dedicated read-only diagnostic61245e09-ff98-4389-a013-0de5a2041df4 ran the bundled
unchanged reader/checkIntake/selector at00:54:12.280Z (09:54 JST):
- generalEnabled=false; generalCount0; officialCount72; inspected72.
- rejected: body27, unrelated16, noDownsideHeadline29; all other counters0.
- candidateCount0; outsideDailyWindow0; duplicateHeadline0; overDailyLimit0.
- unconsumed analyst2/market0; configured-feed-only; historicalReplay=false.
- aiCalls0; writes0; publication withheld.
The former Urban substring candidate is no longer admitted. Current candidate
coverage still yields zero: do not report a recovered daily news service or
infer that no relevant downside exists in the world.

Diagnostic DB reference remained empty. After the one GET-only check, enabled
was set false and both news references cleared. Retirement deployment
bd327cc7-7620-49eb-a27d-104418904032 reached SUCCESS; actual00:54:41.162Z log
RIZEL_INTAKE_DIAGNOSTIC_DISABLED confirmed. It has no cron, domains or listeners.
All existing morning/backup/confirmation schedules remain unchanged.
