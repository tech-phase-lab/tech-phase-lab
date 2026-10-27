# Production setup — 2026-10-27 JST

## Deployment follow-up (later on the same day)

Production deployment of approved commit `91e064a85d19b3f09ac200dcf74232255b22f741`
completed READY: `dpl_9sXcSRNapog8M1nXzGsGwq7LbWCL`,
`https://tech-phase-7lceba5sx-chehon7144-5412.vercel.app`.
Rebuilt from the exact preview deployment with target Production, not from main.
Authenticated Vercel fetch returned HTTP 200 for `/research`, `/privacy`, `/terms`.
`/api/research/member` returned signed-out/FREE, no admin, no owner, no testing,
with private/no-store and Secure/HttpOnly/SameSite=lax display-cookie clearing.
This does not verify an authenticated owner's full browser flow.

The redeploy also moved the branch alias automatically; it was explicitly restored
to Preview deployment `dpl_CEC8wjW1D6BsSXhc72M4BX7okDka` and verified afterwards.
Root DNS now uses `216.150.1.1` and `216.150.16.1`; Vercel reports no
misconfiguration. TLS was issued and the owner confirms HTTPS opens. Preserve
all five Clerk DNS records. Authenticated owner acceptance remains outstanding.
Billing remains disabled. Backend/media setup and Google publication remain pending.
The earlier status sections below describe the pre-deployment checkpoint.

## Confirmed progress

- Domain: `techphase.app`, purchased at Porkbun by the owner.
- Existing Vercel project: `prj_CCegV1VWucYpppYuMCDbBOAGF9s4`.
- Clerk Production created. Owner reports all five Clerk DNS records configured.
- Production-only Clerk publishable/secret variable presence was verified through
  Vercel metadata; secret values were not retrieved.
- Google OAuth web client created; owner saved credentials in Clerk.
- Google OAuth remains Testing. Branding/public URLs and public release remain pending.
- Owner confirmed their account appears in Clerk Production after Google login:
  `user_3LHR1K8f8zwyDcVzMg7ud6KB9Wb` (identifier, not a credential).
- Root DNS and HTTPS have now been verified. The original TLS failure is resolved.

## Owner access change

Retain the development owner ID and Sandbox integrations. Recognize the explicitly
approved Production ID in the shared owner predicate and member-export label.
Production operational PRO access is limited to the Production owner with verified
server identity and the existing administrator MFA gate. Other admins do not get
automatic Production PRO. Ordinary members continue to use the Live billing ledger.
Owner operational access does not create a subscription, charge, or payment record.

## Still required before launch

- Production now runs reviewed preview-branch code; do not change main.
- Complete Production API/media configuration and verify actual feature access.
- Finish Google branding URLs,
  domain verification/publication requirements and public Google sign-in acceptance.
- Enroll owner MFA/recovery before enabling the administrator MFA requirement.
- Dedicated Live billing API/DB/migrations (including 007), PayPal integration,
  webhook verification and Live acceptance remain pending. All three Web Live
  enable/sales/entitlement flags remain false; no sales activation in this change.
- RESOLUTE has separate owner-specific backend checks and requires its own
  Production configuration/acceptance; this change is not proof those paths work.

Railway connection/reauthentication prohibited. No news changes, real purchases,
DNS switch or Production deployment were performed as part of the owner patch.

## Validation

Integrated base `ea8f8649c899d2741b7fac45de048f7f7c898416`: lint passed
(0 errors, 9 existing warnings), Node 1592/1592, Python 2648/2648,
Next.js production build/typecheck, Python compileall and diff check passed.
New integration tests verify operational PRO, ordinary Live billing precedence,
MFA denial and absence of Production Sandbox controls. These are local automated
checks, not an acceptance receipt for the deployed Production site.

## Account recovery correction

A signed-in Clerk client could mount SignIn against a stale signed-out server
snapshot, causing an automatic redirect to the remembered home page before
membership recovery completed. Wait for server membership instead. If the server
still cannot verify that session after recovery, keep the account page with its
retry action; never grant access from client state. Regression coverage exercises
both SignIn and SignUp with that mismatched initial state.

Anonymous production browser inspection displays the login form normally. This
is not an authenticated owner test. Owner entitlement recognition is deployed,
but the user's actual session and owner display still need acceptance. Production
lacks RESEARCH_MONITOR_URL/TOKEN; the price-target API requires both. Home shows
missing data; no news code or Railway connection was changed. Full performance
resolution is not claimed.

Account recovery deployment receipt: commit `733af152bc24ae238aea29a37df67ad5e76e4d94`,
Production `dpl_DSPRDgNUx1DeBBqwfijFRCY6HHTd` READY. Preview branch alias assigned
back to Preview `dpl_FkjmpzPSW5uYiVQhhL9RKP7zkZcA`. Production `/research/account`
returned HTTP 200 after deploy. Local gates: lint (9 existing warnings), Node
1593/1593, Python 2648/2648, build, compileall and diff check passed. No authenticated
owner browser acceptance yet; incomplete production backend configuration remains.

## Continuing production authentication investigation

Owner reports the same membership error in a fresh Chrome incognito session.
Direct member API response is signed-out, not a verified FREE membership. Stale
browser state is not established as the cause. The account redirect guard does
not resolve the underlying authentication failure.

Add fixed-category diagnostics to the membership API: middleware auth status,
known reason codes, cookie-presence booleans (never values), and elapsed time.
Caught failures log only the stage and duration, never raw errors or credentials.
This is instrumentation, not proof of a repaired login or faster production site.

Diagnostics deployed as `816ba11ec80bc04fe5ae4e7ce338dc881ab59af3`, Production
`dpl_A1bfsZxTy6ExQKDvWZXoNxQ3m5j6` READY; Preview alias restored to
`dpl_ECPPEfgk9VTukBkX8njtppAfuuad`. Gates: Node1595, Python2648, lint/build/compileall.
Observed public production requests had no session cookie, middleware reason
session-token-and-uat-missing, and membership handler duration 0–6ms. These logs
have no user identifier and are not definitive attribution to the owner's session.
Public Clerk environment and shipped browser bundle both identify the Production
techphase.app instance. Its home/return domain is correct.

Startup correction: Clerk useAuth can report isLoaded=true from signed-out server
hints before Clerk JS is ready; getToken waits for SDK readiness. The account
previously renewed even signed-out sessions, then replaced the sign-in widget on
the ten-second timeout. Skip session renewal and account membership recovery while
signed out; retain the login form. When the SDK establishes a signed-in session,
normal server verification resumes. Never infer owner/PRO from browser state.
Regression tests cover signed-out startup, no-token-call behavior, signed-in renewal
deduplication, and the previous account redirect race. End-user acceptance pending.

Startup fix deployment receipt: commit `cbfe97ac3af772f3751ad96dff744bce743d86b6`.
Production `dpl_FiTafSoABaXZ7gcNTCxbG1FDrwTj` READY and root alias verified;
Preview alias verified on `dpl_3Ci5RyE2DKB1oSQoekui4wvw4Sfb`.
Gates: lint 0 errors/9 existing warnings, Node1599/1599, Python2648/2648,
build/typecheck, compileall, diff check passed. Public browser verified the account
page transitions from loading to the Google/email login form without a membership
error. No site console error (only the browser extension's unrelated metadata error).
The actual owner login and overall site performance remain unverified. A separate
public HTTP probe from this execution environment measured Clerk script download
at 11.74s; this is not the user's device timing or proof of universal network latency.

## Production incident audit — 2026-10-27 15:28 UTC

User still reports membership failure and slow loading. No successful owner login
has been verified. Do not ship additional production changes before authenticated
login/display acceptance, as explicitly requested by the user.

- Vercel environment metadata confirms RESEARCH_MONITOR_URL and
  RESEARCH_MONITOR_TOKEN exist only for Preview (codex/research-preview), not
  Production. The price-target route returns 503 before any backend call when
  either variable is absent. News code was not modified.
- Production logs at 15:19:05, 15:19:12 and 15:19:16 UTC show
  membership-session-unverified, unexpected-error, middlewareSignedIn=false,
  sessionCookiePresent=true and clientCookiePresent=true. These records contain
  no user identity; they do not definitively identify the owner. The earlier
  missing-cookie explanation is insufficient. Clerk verification fails before
  the membership lookup. Underlying exception remains unknown; do not assert a
  wrong secret or DB outage as the cause.
- Production Clerk public key points to clerk.techphase.app. Public environment
  home/return URLs use techphase.app; account URLs use accounts.techphase.app.
  Google console allowlists were not independently inspected.
- CLERK_SECRET_KEY is present as a Production Secret; presence does not verify
  correctness, formatting or pairing. Secret contents were not exposed.
- Application display cookie is HttpOnly, Secure in production, SameSite=Lax,
  path /, host-only. This is not the Clerk authentication cookie. Actual cookie
  attributes on the user's device remain unverified despite cookie presence logs.
- getMembership exits before user lookup/billing when auth has no userId.
  Current failure does not reach the application DB. Account/header have separate
  recovery paths; header polls every 60 seconds while visible and recovery can
  retry. This can duplicate auth requests, not SQL queries in this failing path.
- Railway credentials, database region and private-network wiring remain
  unverified because Railway access/reauthentication is prohibited. Vercel
  cannot directly use a Railway private hostname as an external client.
- Automatic approval review REJECTED adding Production to the existing Preview
  monitor Secret targets: reusing an unverified Preview credential across a
  production security boundary requires explicit approval. No environment change
  was applied. Do not bypass via secret copying or another API.

This audit made no application-code, DNS, Railway or production deployment changes.
Monitoring configuration repair and authenticated login verification are pending.

Follow-up: after the user said to proceed, the same monitor Secret target change
was again rejected by automatic approval review. It required explicit permission
for this exact Preview-to-Production credential promotion rather than a general
instruction. No retry via another API or secret-copy workaround was attempted.
SDK inspection confirms unexpected-error masks exceptions outside the SDK's typed
TokenVerificationError; it does not establish an invalid secret. Remote JWKS fetch
is part of verification when no local JWT public key is configured. Networkless
verification is supported by Clerk but has not been configured as a speculative
production workaround. Login remains unresolved; no deployment was performed.

Explicit approval follow-up: user authorized applying both named Preview monitor
variables to Production. Review allowed the request, but Vercel returned 400:
gitBranch-scoped variables can only target Preview. Native get_project_env confirms
the monitor token is sensitive and has no readable value. Existing Preview branch
scope was preserved; it was not broadened to other branches or removed.
Created a separate encrypted RESEARCH_MONITOR_URL for Production using the existing
Preview Config value. Production RESEARCH_MONITOR_TOKEN still requires original
credential input directly into Vercel. No token was exposed and no production
redeployment was performed; the live 503 is not claimed resolved.

2026-10-27 15:37 UTC: user reported completing the manual token entry. Vercel
metadata now confirms both RESEARCH_MONITOR_URL (encrypted) and
RESEARCH_MONITOR_TOKEN (sensitive) target Production separately. Existing
branch-scoped Preview entries remain intact. Token value/correctness was not
read back. No production redeployment performed; configuration save is not runtime
acceptance. Latest production logs at 15:35:56 and 15:35:59 UTC still show
unexpected-error with both cookie-presence booleans true. Auth remains unresolved.

## Authorized configuration-only production redeploy

User explicitly authorized redeploy before authenticated login acceptance, solely
for the monitor configuration on the same production code. Production deployment
`dpl_G5JLPbBTLzCjsDXcY9WRZ7srzwXK` is READY, commit
`cbfe97ac3af772f3751ad96dff744bce743d86b6`. Root techphase.app alias verified on it;
Preview branch alias restored and verified on `dpl_3Ci5RyE2DKB1oSQoekui4wvw4Sfb`.
No application code, news behavior, main branch or Railway configuration changed.

Public post-deploy probes: price-targets HTTP200 ok=true 20 items; company-wire
HTTP200 ok=true 22 keys; news HTTP200 ok=true but enabled=false, 0 items. Do not
claim complete high-tech feed recovery. Account HTML HTTP200. First concurrent
probes from this environment took 5.7–6.2 seconds, not end-user timings. Browser
home visibly shows company news and target-price changes. Authenticated owner
login and overall speed remain unverified.

## Clerk secret replacement follow-up

User reported Clerk production Secret key as Created Oct 27 / Never used. This is
a clue, not proof of an invalid key. User created a replacement via Add new key and
reported saving it into Vercel Production. Metadata confirms CLERK_SECRET_KEY
(sensitive, Production) updated at 1793116489322. Secret contents were not read.
Redeployed the same code cbfe97ac as dpl_4R8R6S1PxYtDWNTcatejELWfesAG (READY).
techphase.app alias confirmed on the new deployment; Preview alias restored and
confirmed on dpl_3Ci5RyE2DKB1oSQoekui4wvw4Sfb. Initial logs show anonymous missing
session requests only; absence of unexpected-error is not authenticated acceptance.
Owner login/PRO display must still be checked after this actual credential change.
Do not delete the previous Clerk key until replacement verification succeeds.

Owner acceptance: user confirms login works after Clerk Secret replacement and
reports loading is now very fast. Do not repeat login-failure troubleshooting.
Read-only public feed check following user's one-hour news gap concern:
company-wire HTTP200 contains 22 ticker groups, including articles at
2026-10-27T15:50:35Z (Oct28 00:50:35 JST). news HTTP200 contains officialUpdates
89 rows; newest NVIDIA article published 16:00:00Z, observed 16:01:11.532Z
(Oct28 01:00 / 01:01 JST). Previous NVIDIA article published 15:00Z.
Correction: enabled=false/items=[] describes one subsection; it does not mean
all news output is empty or collection stopped. officialUpdates is populated and
advancing. No claim that all sources have no missed news. No news code changed.
