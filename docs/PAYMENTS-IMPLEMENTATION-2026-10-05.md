# Payment implementation preparation — 2026-10-05

This is an implementation specification, not deployed billing functionality.
No provider account, application, checkout or paid entitlement was changed.

## Current provider position (owner correspondence)

| Provider | Confirmed position | Next dependency |
| --- | --- | --- |
| Stripe | Owner reports refusal; not awaiting approval | Do not implement Stripe on the assumption it will be available |
| Alpha Note / Another Lane | Representative considers service eligible subject to final underwriting; overseas customers and monthly recurring card payments supported; JPY only, not USD | Owner sent review URL and requested costs, timing and disclosure details; await written quotation and underwriting |
| PayPal | Owner submitted inquiry with public website on October 5 | Exact service eligibility, USD subscriptions and customer-facing name unconfirmed |
| ZEUS / ROBOT PAYMENT | Owner inquiries pending | Await answers; no permission inferred |
| PAY.JP | Application possible, final underwriting incomplete | Actual site and operator details required |
| UnivaPay | Fees/privacy concerns raised by owner | No confirmed final refusal recorded here |
| Telecom Credit | Owner considers feasible, cannot apply until approximately second week of December | Preserve as fallback; not currently approved for Tech Phase |

Alpha Note representative's letter permits an application with disclosure-on-request wording. This records their underwriting guidance, not a legal determination that all seller details may be omitted. Exact fields, disclosure process and virtual-office conditions remain to be confirmed.

Public service overview: https://tech-phase-research.vercel.app/index.html
English: https://tech-phase-research.vercel.app/en.html
Interactive layout demonstration: https://tech-phase-research.vercel.app/product.html
These are public review pages, not operational subscriptions. The app preview stays protected.

## Existing boundary

`lib/membership/server.ts` reads Clerk private metadata; it does not verify payments.
`app/research/account/screen.tsx` is the existing account entry point.
Payment records, production checkout, renewal/cancellation handlers and billing portal are absent.
Preserve owner/preview controls separately from production purchases.

## Account flow to implement after provider selection

1. Signed-in member opens PRO application from the account page.
2. Server creates a pending order bound to that member. The selected offer snapshots amount, currency, monthly interval and accepted terms version.
3. Display the complete recurring charge, next renewal information, cancellation procedure and seller/contact information before the member pays.
4. Redirect to provider-hosted checkout, where available. Do not collect or store full card details in Tech Phase.
5. A return URL displays payment confirmation in progress. It never grants PRO.
6. Verified provider payment establishes the paid access interval, then synchronizes Clerk metadata. The account page reads the resulting entitlement from the server.
7. Account page shows current plan, paid-through date, renewal/cancellation state and a provider-supported management action.

An interrupted redirect must be recoverable from the account page and the server's payment state. Do not charge a second time just because a member retries a page load.

## Durable records

Use a persistent transactional store outside ephemeral Vercel filesystem. Confirm deployment topology before choosing a database; `/data/automatic.sqlite` currently belongs to the news monitor and is not assigned to billing by this specification.

- Orders: internal ID, authenticated member ID, offer/version, integer amount in currency's minor unit, currency, status, provider reference, created/paid timestamps.
- Subscriptions: internal/member IDs, provider subscription/customer references, normalized lifecycle state, verified paid-through timestamp, scheduled cancellation, last reconciliation timestamp.
- Payments: provider transaction ID (unique per provider), amount/currency, settlement status, actual service interval and linkage to order/subscription.
- Provider events: provider/event identity when available, unique deduplication key, received/verified/processed timestamps, minimal audit data and error state.
- Entitlement synchronization: subscription version, intended paid-through timestamp, sync result and retry status.

Never store PAN, CVV or unnecessary personal information in logs. Never use current exchange rates to rewrite an existing order. JPY and USD require distinct amount handling.

## Access rules

| Verified event/state | Access behavior |
| --- | --- |
| Initial payment pending or declined | FREE; no payment-created PRO access |
| Initial paid invoice/transaction | PRO through the verified paid period |
| Successful renewal | Extend through the newly paid period; duplicate messages cannot extend twice |
| Cancellation scheduled | Stop future renewals; preserve already paid access until its end |
| Failed renewal | Do not extend beyond paid-through; any grace period needs an approved policy |
| Old event delivered after a newer event | Reconcile with provider state; do not shorten or extend access from arrival order alone |
| Refund or chargeback | Record and reconcile; access handling follows approved policy, not an invented rule |
| Missing callback or metadata sync failure | Retry/reconcile from durable records; return page alone cannot confirm payment |

Use provider-supported signature verification or another documented server-side authenticity mechanism. Actual payloads, signature algorithms, retry behavior and cancellation API are unknown until official integration materials arrive. Do not invent a webhook contract.

## Release acceptance scenarios

- First purchase, abandoned checkout, declined card and reload/retry.
- Successful and failed renewal, duplicate and out-of-order callbacks.
- Cancellation before renewal, cancellation retry, re-subscription and period-end access expiry.
- Refund/chargeback under the agreed policy.
- Paid provider state with missed callback, downtime or failed Clerk update; recover without double charge.
- Account mismatch and browser-forged plan/member/amount; reject without access escalation.
- Domestic and overseas test customer, correct amount/currency, JA/EN receipts and renewal dates.
- FREE users always denied paid server APIs; owner preview access preserved independently.

These are future acceptance requirements, not completed test results.

## Decisions still requiring owner/provider confirmation

Fees (including international cards, recurring charges, minimums and reserves), payout schedule, integration/API availability, exact underwriting timeline, buyer countries, customer statement descriptor and name exposure.

Domestic planned price remains JPY 2,980 tax included. Overseas planned USD 20 is not converted or changed automatically: if Alpha Note is selected, owner must approve the overseas JPY price. Tax treatment, cancellation deadlines, refund/outage handling, final support contact and disclosure process remain unresolved. No final public terms are invented while waiting.

## Next concrete action

Obtain quotation plus integration documentation from the selected provider. Then implement sandbox purchase, durable payment processing and entitlement sync first, followed by renewal/cancellation and the acceptance scenarios above. Production activation is a separate step after underwriting and approved terms.
