# Overseas subscription readiness — 2026-10-02

Owner priority: resolve whether Tech Phase can accept overseas membership
payments before spending more time on cosmetic improvements. The owner has
sent inquiries; no provider approval, contract or live payment activation has
been established. See the current status below.

## Existing implementation

`lib/membership/server.ts` resolves Free/PRO from server-fetched Clerk private
metadata and expiration. `app/research/account/screen.tsx` displays membership;
preview testing is explicitly without billing. No checkout, payment webhook,
subscription ledger or customer billing portal exists in app/api or lib.
The FAQ already describes monthly billing from the join date and continued
access through the paid period after cancellation. These are intended product
terms, not evidence that payment or cancellation is implemented.

## Provider shortlist, subject to actual underwriting

1. **Stripe: owner inquiry escalated, eligibility unconfirmed.** Japan-specific
   prohibited categories include consulting/advisory offerings providing guidance,
   information or tools on profiting from financial-product/crypto trading or
   investment. Do not describe this solely as a restricted-category review or
   assume the publication is eligible. Its actual news, analysis, valuation
   scenarios and Q&A need assessment. On October 2 at about 17:30 JST, support
   agent Ayush said the owner's request would be transferred immediately; no
   response timeline was available. The owner supplied contact details and the
   account ID. Email follow-up is expected but was not explicitly confirmed.
   Prior sales-form attempts rejected Gmail and iCloud with Japan selected;
   cause unconfirmed. Sales email auto-replied with the same form; the owner
   also emailed Japanese support. Do not repeat inquiries or change country.
2. **PAY.JP: inquiry sent by owner, awaiting response.** Overseas-issued cards
   are supported, but payments are JPY-denominated. Investment-related tools and
   consulting may be submitted but are flagged as likely to fail review; actual
   Tech Phase eligibility is unknown.
3. **UnivaPay: owner used inquiry form; no eligibility answer yet.** The form
   groups stock investment under “investment / finance / gambling”; selecting
   that group is not evidence of rejection. The official digital-content page
   explicitly describes investment information and member communities with
   recurring payments. Ask about this exact content, operator entity type,
   overseas cards, and USD recurring billing. External-currency processing and
   MCP are distinct products; do not assume MCP supports subscriptions.
4. **PayPal: backup candidate.** Publication eligibility and overseas recurring
   billing remain unconfirmed.
5. **Paddle: low priority.** Its AUP lists investment/financial advice, trading
   signals and strategies among prohibited offerings. A software interface or
   merchant-of-record arrangement does not establish eligibility.

Official sources checked on 2026-10-02:
- https://stripe.com/jp/legal/restricted-businesses (updated 2026-09-22)
- https://stripe.com/jp/billing
- https://support.stripe.com/questions/why-some-messages-do-not-appear-in-the-support-center?locale=ja-JP
- https://help.pay.jp/ja/
- https://univapay.com/digital-contents/
- https://univapay.com/contactus-onlinepaymentservice/
- https://univapay.com/service/credit/credit-multiple-currency/
- https://univapay.com/service/credit/multi-currency-pricing/
- https://www.paypal.com/jp/legalhub/paypal/acceptableuse-full
- https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle

## Material to prepare for the provider

Describe the paid offering completely: bilingual company/news research,
earnings analysis, valuation scenarios, third-party analyst target-price
information and notifications, weekly research, author's notes, and selected
answers on the shared member question board. Include actual sample pages.
The FAQ says buy/sell recommendations and promises of returns are not offered;
this statement must agree with the actual content. Do not omit analysis/Q&A
or relabel the product to evade underwriting.

Confirm operator identity and country/entity type (not established by this
inspection), launch sales countries, the intended domestic ¥2,980 and overseas
$20 monthly prices, and whether prices include applicable taxes. Ask about:

- Eligibility of this exact content, any additional review or documentation,
  and which changes to the offering require reassessment.
- Recurring USD customer charges and supported settlement currency/bank account
  for the actual operator, conversion and cross-border costs, payout timing,
  reserves/holds and dispute handling. No rate or payout option is promised here.
- Cancellation, refund, receipt/invoice and customer-service requirements.
- Restrictions by buyer country and responsibility for applicable indirect taxes.

Provider approval does not itself determine financial-services registration or
other legal obligations; obtain an assessment of the actual content and selling
jurisdictions where needed before launch.

## Site work in order

1. Prepare accurate JA/EN service and pricing pages plus operator/contact,
   commercial disclosures, terms, privacy, refund/cancellation details. Obtain
   missing operator facts and policy decisions before publishing them.
2. Confirm provider eligibility and the launch-country/currency scope.
3. Implement test-mode checkout, server-side signed/idempotent webhook handling,
   persistent subscription records, billing portal, and Clerk entitlement sync.
   Never grant PRO solely from a return URL or a browser-supplied plan.
4. Verify initial purchase, renewal, duplicate/out-of-order webhooks, declined
   renewal, cancellation at period end, refund and account mismatch. Ensure paid
   access and the user-visible expiry agree. Then arrange live activation.

Commercial permission for displayed market/news data remains a separate launch
dependency. The owner's Alpaca/FMP correspondence does not authorize commercial
redistribution. This inspection did not change providers or their subscriptions.

## Public introduction (owner requested publication October 2, 17:32 JST)

`public/intro/` is a self-contained JA/EN static introduction: index.html,
en.html, style.css and mark.svg. It can be deployed separately with that folder
as the project root, Framework “Other”, no build/install command and no
application environment variables. It contains planned prices/features and an
explicitly illustrative interface, with no live news, customer information,
authentication, checkout or data-provider integration. Do not make the entire
research preview public merely to expose this page.

The existing Vercel project has SSO protection on `all_except_custom_domains`.
A signed-in preview screenshot does not establish public accessibility. The
connected Vercel deployment tool returned UNAVAILABLE on October 2; no CLI token
was configured. Publication is incomplete until the standalone public deployment
is created and anonymous GET requests verify both languages and local assets.

Before taking paid orders, obtain actual operator/contact/disclosure details,
final tax/cancellation/refund terms, provider eligibility and commercial data
permissions. None of those unknown details is fabricated on the introduction.
