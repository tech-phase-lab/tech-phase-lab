# Payment-provider service preview — 2026-10-05

Public static site source: `public/intro`. Interactive source: `scripts/review`.
Build with `npm run build:review` after changing shared comparison components.
The generated viewer imports the same company cards, seven-factor radar,
snapshot, scoring and expandable detail panels as the research app.

The standalone viewer uses clearly labeled fictional DEMO-A/B/C inputs. No
real ticker is assigned fabricated financials. The 22-company directory is
generated from the actual coverage registry but includes only names, tickers
and sectors. Individual coverage pages demonstrate layout, not live results.
Screenshots on the overview remain explicitly dated October 2 records.

JA/EN pages include service description, planned FREE/PRO tiers, monthly
pricing, planned signup/access/cancellation flow and policy drafts. No signup,
checkout, current quotes or live news operate on this standalone preview.
Final operator identity, contact details, cancellation deadline and refund
conditions remain unresolved. This is suitable for showing the service in an
initial inquiry, not a claim that underwriting or commercial launch is ready.

Hosting: separate Vercel project `tech-phase-research`, root `public/intro`,
static output `.`, no install/build commands or API credentials. Only this
public static project's SSO protection is disabled. The existing
`tech-phase-lab` preview protection, membership checks and `main` are unchanged.
The public branch deployment should follow `codex/research-preview`; do not
promote the full research app just to expose this static reviewer website.

Verified public URL: https://tech-phase-research.vercel.app/index.html
English: https://tech-phase-research.vercel.app/en.html
Interactive demonstration: https://tech-phase-research.vercel.app/product.html
The owner shared the overview with Alpha Note / Another Lane and submitted a
PayPal inquiry on October 5. Current provider status and remaining billing work
are recorded in `PAYMENTS-IMPLEMENTATION-2026-10-05.md`.

The public bundle must not import Clerk, service/admin APIs, paid articles or
server credentials. Registration/payments are not simulated as successful.
Provider inquiry forms and emails are submitted by the owner, not automated.

Existing Python fixtures in three containment/enrichment tests now freeze the
service request clock to their fixture NOW, so retention filtering cannot
make those tests fail simply because the calendar advanced. Production news
code is unchanged.
