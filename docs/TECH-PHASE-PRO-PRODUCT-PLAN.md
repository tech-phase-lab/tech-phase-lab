# Tech Phase PRO product design — 2026-10-25 JST

Authoritative policy: [2026-10-25 FREE / PRO decision](TECH-PHASE-FREE-PRO-POLICY-2026-10-25.md).
That decision overrides earlier proposals here. This file retains implementation
notes and unapproved retention candidates; it is not a completion receipt.
Capital Map FREE access and the price-display switch are implemented.
The FREE news projection is implemented in `TECH-PHASE-NEWS-ACCESS-2026-10-25.md`;
live browser acceptance remains pending. Automatic 22-company earnings refresh,
theme ranking, personal review and retention items are not completed by this change.
Keep the existing Capital Map presentation. Railway connection/reauthentication is
prohibited. Work on codex/research-preview only; no main edits or force pushes.

## Owner requests and candidates

- High-tech theme rankings (semiconductors, optical networking, AI cloud, etc.)
  are a key PRO feature. Connect real prices only after the Twelve Data contract.
- Confirmed: FREE high-tech alerts are delayed 30 minutes, newest first, latest five
  eligible headlines only, with no summary or full text; PRO is real time. Earnings results and economic-indicator results must
  remain available FREE; do not put these results behind the general-news delay.
  PRO adds deeper earnings interpretation and implications.
- Capital Map is FREE, including actual disclosed holdings and existing comparisons.
  Remove its PRO-only access gate and PRO-benefit listing.
- Theme ranking is a standalone, clearly named entry; do not nest it under
  a vague "market strength/weakness" category.
- The 22 tracked companies should not merely duplicate stock-search prices.
  Owner wants a price-display ON/OFF option, including during market selloffs.
- Track company changes inside the existing 22-company list, not a separate feature.
- Personal review uses the user's watchlist: weekly earnings, price-target changes
  and news counts; upcoming earnings; notifications about verified business
  counterparties in the relationship map.
- Evaluate a real usage recap before cancellation, a 1–2 month pause, and an
  annual plan discounted by about two monthly payments. None is yet approved pricing.

## Concrete destinations (owner correction)

1. テーマランキング — standalone entry and ranking detail; may link onward to
   related companies, explanations and theme history. Official English: Theme Ranking.
   Claude builds definitions, calculations and the UI with clearly marked sample
   prices before the contract; real Twelve Data integration follows the contract.
2. 監視22銘柄リスト — rapidly receive tracked high-tech company information and
   see earnings/important-news implications at a glance.
3. ウォッチリストの振り返り — weekly changes and upcoming events for selected names,
   with relevant relationship-map counterparty alerts.

The earlier labels "市場の強弱を調べる" and "企業の変化を追いかける" are design
concepts, not extra navigation categories/pages. Do not add a generic three-pillar
container that hides the theme ranking. Saturday's weekly changes, Sunday's next
week checks and holiday deep dives remain possible delivery formats for these tools.
The user explicitly rejects generic AI-generated prose as sufficient PRO value.

## Implementation design

### News access

Keep the mobile news entry. FREE high-tech alerts expose only the newest five
headlines eligible after a 30-minute delay, with no summary or full text. The earlier
15-minute/short-summary proposal is superseded. Show the approved notice:
「PROでは30分早く、要約付きで読めます」. PRO receives real-time alerts, full summaries,
related companies and cross-checks against earnings, plus entitled notifications.
The delay clock anchor remains an implementation detail to finalize against source
and first-publication timestamps; do not treat this note as an implemented gate. Retain true source and
publication timestamps and label delayed access. Never reset the delay on cosmetic
edits; corrections must remain identifiable. Enforce release/access on the server,
not by hiding complete PRO responses in CSS. Earnings/economic result values and
public result pages are FREE exceptions, with actual release times, units, periods,
forecast/prior values where verified. Preserve these exceptions when a result also
appears in the news feed; PRO interpretation is separately entitled. Delayed news
alone is not the PRO moat.

### 22-company list

Reuse the existing menu link to /research#monitored-companies, separately from the
news feed and personal favourites. The owner requires prompt visible updates after
earnings/important news: an unchanged card after a material new release is not a
credible result. Proposed event path: validated source -> factual event/update time
-> before/after operating metrics -> directional implications/review -> assessment
history. Show newly available factual results promptly without waiting for the full
PRO interpretation; show analysis progress only for a real queued/running job.
Do not force a rating change on every event: explicitly record "assessment unchanged"
and why when evidence supports it. PRO receives immediate implications/history;
FREE keeps public earnings/results and the allowed delayed high-tech headlines only.
Measure release-to-ingestion and ingestion-to-card latency separately, including
missed-update/recovery tests. A specific seconds/minutes SLA is not yet agreed.

Price OFF hides the price, percentage change and price sparkline together. Keep
company fundamentals, assessment information allowed by the member's plan, and
upcoming events visible. Remember the setting and avoid a price flash on reload.
Do not treat this display preference as a news filter or suppress adverse facts.

Implemented locally on 2026-10-25: the shared CompactQuote on monitored-company
pages (including MU) has a bilingual price switch. OFF removes the complete
quote iframe and chart/provider links. The browser remembers the choice across
companies/reloads; SSR waits for the preference before mounting any price widget.
Storage-blocked browsers retain the choice for the current session. The directory
itself contains no prices, so no redundant switch was added there. Stock search
is unchanged. Validation and publication status are recorded in
`TECH-PHASE-PRO-CHANGES-2026-10-25.md`.

### Standalone theme ranking

Direct menu/home entry named テーマランキング / Theme Ranking -> ranking detail.
Claude owns the pre-contract foundation (definitions/calculation/UI with sample
prices); connect live prices only after the Twelve Data contract. Do not duplicate
Claude's work. Provide
1-day/1-week/1-month rankings, both ends, constituent contributions, participation
(e.g. number of rising constituents) and links to source-backed company changes.
Before implementation fix the universe, overlapping membership, weighting, return
basis and missing-price rules. Price performance is not measured capital inflow.
Preserve dated snapshots to show persistence/reversals rather than only today's table.

### Company changes inside the 22-company list

Reuse the 22-company list and company detail. Store timestamped old/new values,
source URL, affected operating metric, assessment rationale and next checkpoint.
Show what changed and what did not; distinguish source facts from interpretations.
Assessment revisions need evidence and a logged rule/review decision, not an
unexplained AI-generated upgrade. Produce Saturday's weekly change view from these
records, with dated links back to the original evidence.

### Personal watchlist review

Reuse existing favourites/watchlists; do not assume brokerage holdings are available.
Filter the change history and upcoming earnings/events to the user's selected names.
Weekly view groups earnings, target-price changes (old/new, currency, analyst/source,
publication date) and deduplicated news counts; avoid counting one release copied by
several providers as several independent developments. Upcoming earnings show a
verified date/time and confirmation status, not an inferred guarantee.
Counterparty alerts require a sourced, typed, dated business relationship and a
material event linked to that counterparty. Distinguish customers/suppliers/partners
from an investment ownership edge in Capital Map. Do not notify on every unrelated
counterparty headline or manufacture a relationship from coincident news mentions.
Weekend delivery uses Web Push and in-site display. FREE sees counts only; PRO
sees the underlying watchlist review. Consent and delivery mechanics remain to be
implemented. Price-target display is FREE; its smartphone notifications are PRO.
Link saved research to subsequent evidence and show which prior checkpoint has been
resolved or remains pending. Sunday: next week's checks, not generic predictions.
Holiday deep dives reuse theme/company evidence, dated comparisons and Capital Map
links; they must add comparative information rather than merely longer AI text.

### Placement and order

Place theme ranking directly in navigation/home, company changes in the existing
22-company list, and the personal weekly/next-week view inside the existing watchlist.
Do not invent three disconnected article sections. First reconcile Capital Map FREE
access and record this scope; then build the timely 22-company update/evidence history
and price toggle, followed by watchlist weekly/upcoming/counterparty views. Connect
theme-price rankings after contract. Do not change billing as part of these steps.

## Additional confirmed access and naming rules

Company explanations 01–04 below stock search are all FREE. Capital Map is FREE.
Relationship maps are PRO except NVDA's free sample: label NVDA as a free sample,
link to it from other companies' PRO notices and from home, and describe the exception
on the PRO card. Do not conflate ownership data with business relationships.

RIZEL'S DESK contains 週刊 Tech Phase PRO, リゼルのひとりごと and リゼルに聞く.
The last replaces リサーチQ&A; English is Ask Rizel. Subscriber questions are
selected and answered by the operator. The notes accumulate a dated market journal
linked to company pages, earnings and maps, rather than duplicating X posts.

## Retention candidates

- Show a concise recap of genuine usage and relevant saved/tracked-company updates;
  no fabricated counts. Prefer also making it available during the month, rather
  than exposing value only when the member tries to leave.
- Keep cancellation directly accessible; do not force several persuasion screens.
- Annual price candidate: JPY 29,800 / USD 200 for 12 months (10 monthly payments
  at the currently proposed JPY 2,980 / USD 20). This is not an approved product or
  a claim that retention necessarily improves. Annual renewal needs separate measurement.
- Pause candidate: 1 or 2 months, beginning after the paid-through period, with
  preserved saved items/preferences and PRO access suspended during the pause.
  Decide restart date, automatic vs manual restart and advance notice before adding
  it to billing. Do not silently convert a cancellation into a resumable subscription.
- Prioritize recurring product value and an annual option over adding pause-state
  complexity before the December 16 completion target.

PayPal source consulted (documentation only; no account/payment operation):
https://developer.paypal.com/api/subscriptions/v1
Suspend/activate endpoints exist, but do not by themselves specify the complete
Tech Phase 1–2 month holiday, access and restart experience.
