# Read-only news acceptance audit

`scripts/audit/news_acceptance.py` reads a consistent snapshot of an existing
SQLite database with `mode=ro` and `query_only`. It never imports monitor schema
helpers, fetches news, calls a model, updates queues or publishes content. It is
outside the Railway Docker image's `scripts/research` copy, so it is an operator
audit utility, not an added production worker. The current observation window in
`NEWS-ACCEPTANCE-2026-10-02-baseline.json` remains authoritative.

## Run

```bash
python3 scripts/audit/news_acceptance.py \
  --db /data/automatic.sqlite \
  --start 2026-10-02T04:43:12.282254Z \
  --end 2026-10-03T04:43:12.282254Z \
  --required-source primary-ir-NBIS \
  --required-source primary-ir-MU > acceptance-observation.json
```

These two example required sources are NOT the complete approved inventory.
Repeat `--required-source` for every enabled source being audited. Include X
price-target sources, TrendSpider's index posts and Barchart's approved topics.
The Fly and the explicitly suspended routes remain excluded. Do not silently
turn excluded sources into covered sources. With no declared scope the report
says `inventoryScope: not-specified`; it never declares complete coverage.

Use actual current time by default, or an explicit timezone-aware `--as-of` for
a reproducible historical snapshot. The interval is half-open `[start,end)`.
An in-progress report stops at `asOf`; it does not pretend a full day elapsed.
Do not make a raw copy of only a WAL database's main file while it is live.
Read directly with SQLite, or use an authorized consistent backup.

## Interpret correctly

- New **source publications** require both a source clock in the window and a
  first `new` intake record. Baselines, historical backfills, revisions, missing
  source clocks and impossible clock order are separate categories.
- `newPublicationEligibilityCounts` separately marks reviewed eligible,
  excluded, unreviewed and conflicting scope decisions. An unrelated press
  release must not become a service delivery success. The primary `latency`
  population includes only independently reviewed eligible new publications;
  `intakeLatencyAllNewCandidates` is a separate raw discovery diagnostic.
- Each sample retains source, URL, revision, detection and available stored-output
  clocks. No summary count or average stands in for individual missing items.
- Latencies report count, mean, median, nearest-rank p95 and maximum. No sample
  yields `null`, never a zero-second delivery success.
- Stored bilingual text is not proof of API eligibility, accurate translation or
  screen display. Publication rows may be overwritten on regeneration, so their
  timestamps are not always first-ever publication. No publication clock is
  invented for price targets rendered directly from events.
- Timestamped retries, model failures, route transitions and incident events are
  reported within the exact window. Incidents open at the start are retained.
  Later recovery does not erase a failure. Rolling 24h totals are not subtracted.
- A route transition labelled `failed/other` is not proof of an upstream outage.
  The first October 2 observation found X transitions consistent with intentional
  shared-budget pacing, but their raw cause was not retained. Keep those records
  as unresolved diagnostic evidence; neither count them as proven HTTP failures
  nor remove them to manufacture a clean report.
- Duplicate DB rows are reported separately; this does not establish whether the
  same news appeared twice to a user or whether different accounts describe the
  same analyst action. Review those with original posts and frontend evidence.
- The tool always returns `acceptance: not-assessed`. The owner decides after
  bilingual evidence review, independent source reconciliation and UI checks.
  This is a diagnostic collection tool, not a universal translation verifier.

## Independent source inventory input

Pass `--inventories inventory.json`, a list of objects with this shape:

```json
[
  {
    "sourceId": "primary-ir-NBIS",
    "windowStart": "2026-10-02T04:43:12.282254Z",
    "windowEnd": "2026-10-03T04:43:12.282254Z",
    "checkedAt": "2026-10-03T04:45:00Z",
    "method": "independent-source-inventory",
    "evidence": "path or reference to independently captured source listing",
    "complete": true,
    "items": [
      {
        "url": "https://example.com/replace-with-real-source-url",
        "publishedAt": "2026-10-02T05:00:00Z",
        "eligible": true
      }
    ]
  }
]
```

This is an input format example, not a real observation. List what was actually
checked on the source, not what the intake DB already contains. Preserve capture
references, full-window pagination coverage and scope decisions. Unknown
publication time or eligibility prevents a complete-inventory declaration.
Partial inventories can identify a suspected missing URL but cannot prove no
misses. `declared-complete` means the supplied evidence claims coverage; the tool
cannot independently verify the truth of the supplied capture. A missed URL in
an independent inventory is reported even when absent from the DB entirely.
For in-progress checks set `--as-of` to the inventory's actual checked-through
clock; later unobserved time must stay unverified.
Individual eligibility decisions must match source ID, URL and publication clock.
Opposite decisions stay `conflicting-review`, not silently last-write-wins.

## Browser observation input

Pass `--browser-observations browser.json`, with one entry per actual language
observation: `sourceId`, `url`, `sha`, `language` (`ja` or `en`), `observedAt`,
and `evidence` (screenshot/session reference). The revision must match a stored
intake event, and observation cannot precede detection. An API fetch, translation
completion or a cached article from a previous revision is not a browser observation.

## October 2 development checkpoint

The owner authorized useful work while the 24-hour observation runs. This adds
only an offline audit utility, regression tests and these instructions. No
translation rules, source eligibility, prices, membership, polling interval,
provider contract or billing cap changes. Do not reset the accepted observation
window for this utility; retain any deployment/restart evidence separately.

## Live smoke check — October 2 15:03 JST

The first published audit utility (`ae4fa82ddfd8005f9acf404f86903a36fe024e04`)
was read from this repository by commit and SHA-256 checked before execution.
It read the live DB with no schema initialization or worker action. At
06:03:59.061882 UTC it found three historical backfills and one newly published
PR Newswire candidate. No evidence tables were missing, no duplicate stored
event ID was counted and no in-window translation/model failure was stored.
The new candidate was a hotel announcement (event 1167), with a raw discovery
lag of 73.581 seconds and no stored bilingual output. It is not proof of an
eligible Tech Phase story delivered in that time. No independent source listing
or browser observation input was supplied to this smoke check; all 51 declared
source inventories remained unverified by this invocation.

The audit also retained 360 route transitions and 21 incidents open before the
window according to the incident-event journal. These are all-database records,
including historical body-fetch blocks; they are not 21 newly failing enabled
news routes. Keep this scope separate from the 06:00:23 UTC health observation:
24/24 enabled official routes fresh, route errors/pending zero; headline49/49,
research4/4, market1/1, with no pending job. Historical evidence must remain
visible without relabeling it as a present upstream outage.

Railway explicitly skipped worker deployment for the utility commit because no
watched runtime path changed. Vercel preview succeeded and Actions36971709957
passed. The original 04:43:12.282254 UTC acceptance start remains unchanged.
