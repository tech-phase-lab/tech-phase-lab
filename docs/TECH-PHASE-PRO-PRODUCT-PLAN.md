# Tech Phase PRO product design — 2026-10-25 JST

Status: design discussion, not shipped UI, entitlement or billing changes.
Keep the existing Capital Map presentation. Railway connection/reauthentication is
prohibited. Work on codex/research-preview only; no main edits or force pushes.

## Owner requests and candidates

- High-tech theme rankings (semiconductors, optical networking, AI cloud, etc.)
  are a key PRO feature. Connect real prices only after the Twelve Data contract.
- Consider Claude's proposal: FREE news delayed 15 minutes, PRO real time.
  This is a candidate, not a finalized access-policy change.
- The 22 tracked companies should not merely duplicate stock-search prices.
  Owner wants a price-display ON/OFF option, including during market selloffs.
- Preserve and concretize the previously proposed three pillars.
- Evaluate a real usage recap before cancellation, a 1–2 month pause, and an
  annual plan discounted by about two monthly payments. None is yet approved pricing.

## Prior proposals retained without conflating them

The later functional framing was:
1. 市場の強弱を調べる — investigate market strength/weakness.
2. 企業の変化を追いかける — track changes in companies.
3. 自分の銘柄を振り返る — review one's tracked companies.

Earlier weekend programming was:
- Saturday: 今週、何が変わったか.
- Sunday: 来週、何を確認するか.
- Holidays: テーマ別の深掘り.

Use these as delivery formats for the functional pillars, not six separate tools.
The user explicitly rejects generic AI-generated prose as sufficient PRO value.

## Proposed implementation, pending agreement

### News access

Keep the mobile news entry. FREE initially receives headlines and short summaries
15 minutes after the Tech Phase first-publication timestamp; PRO receives immediate
access plus implications, assessment changes and alerts. Retain true source and
publication timestamps and label delayed access. Never reset the delay on cosmetic
edits; corrections must remain identifiable. Enforce release/access on the server,
not by hiding complete PRO responses in CSS. Delayed news alone is not the PRO moat.

### 22-company list

Reuse the existing menu link to /research#monitored-companies, separately from the
news feed and personal favourites. Make the list about company status, changes and
upcoming checkpoints. FREE: company/theme basics and public earnings schedule;
real-time assessment changes, reasons and history proposed for PRO.

Price OFF hides the price, percentage change and price sparkline together. Keep
company fundamentals, assessment information allowed by the member's plan, and
upcoming events visible. Remember the setting and avoid a price flash on reload.
Do not treat this display preference as a news filter or suppress adverse facts.

### Pillar 1: market strength/weakness

Home PRO entry -> theme ranking detail, after the Twelve Data contract. Provide
1-day/1-week/1-month rankings, both ends, constituent contributions, participation
(e.g. number of rising constituents) and links to source-backed company changes.
Before implementation fix the universe, overlapping membership, weighting, return
basis and missing-price rules. Price performance is not measured capital inflow.
Preserve dated snapshots to show persistence/reversals rather than only today's table.

### Pillar 2: changes in companies

Reuse the 22-company list and company detail. Store timestamped old/new values,
source URL, affected operating metric, assessment rationale and next checkpoint.
Show what changed and what did not; distinguish source facts from interpretations.
Assessment revisions need evidence and a logged rule/review decision, not an
unexplained AI-generated upgrade. Produce Saturday's weekly change view from these
records, with dated links back to the original evidence.

### Pillar 3: review one's tracked companies

Reuse existing favourites/watchlists; do not assume brokerage holdings are available.
Filter the change history and upcoming earnings/events to the user's selected names.
Link saved research to subsequent evidence and show which prior checkpoint has been
resolved or remains pending. Sunday: next week's checks, not generic predictions.
Holiday deep dives reuse theme/company evidence, dated comparisons and Capital Map
links; they must add comparative information rather than merely longer AI text.

### Placement and order

Home has one compact PRO entry section, routing to existing company/list/watchlist
pages. Only the theme ranking needs a distinct detail view if none exists; do not
create three disconnected article sections. Suggested order: agree the boundary and
price toggle, build reusable company change history, then weekly/personal views;
connect theme-price rankings after contract. No UI is changed by this design record.

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
