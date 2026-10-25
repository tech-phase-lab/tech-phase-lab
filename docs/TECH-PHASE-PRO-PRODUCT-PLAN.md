# Tech Phase PRO product design — 2026-10-25 JST

Status: owner decisions below supersede the earlier abstract pillar proposal.
Capital Map FREE access is implemented in the accompanying change; the news delay,
22-company refresh, theme ranking, personal review and retention items remain unshipped.
Keep the existing Capital Map presentation. Railway connection/reauthentication is
prohibited. Work on codex/research-preview only; no main edits or force pushes.

## Owner requests and candidates

- High-tech theme rankings (semiconductors, optical networking, AI cloud, etc.)
  are a key PRO feature. Connect real prices only after the Twelve Data contract.
- Confirmed: FREE general high-tech news is delayed 15 minutes with only a short
  summary; PRO is real time. Earnings results and economic-indicator results must
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

1. テーマ別ランキング — standalone entry and ranking detail; may link onward to
   related companies, explanations and theme history. Twelve Data contract first.
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

Keep the mobile news entry. FREE receives general-news headlines and short summaries
15 minutes after the Tech Phase first-publication timestamp; PRO receives immediate
access plus implications, assessment changes and alerts. Retain true source and
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
FREE keeps public earnings/results and the allowed delayed general-news summary.
Measure release-to-ingestion and ingestion-to-card latency separately, including
missed-update/recovery tests. A specific seconds/minutes SLA is not yet agreed.

Price OFF hides the price, percentage change and price sparkline together. Keep
company fundamentals, assessment information allowed by the member's plan, and
upcoming events visible. Remember the setting and avoid a price flash on reload.
Do not treat this display preference as a news filter or suppress adverse facts.

### Standalone theme ranking

Direct menu/home entry named テーマ別ランキング -> ranking detail, after the Twelve Data contract. Provide
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
Notification delivery/channel and opt-in details are still to be designed.
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
