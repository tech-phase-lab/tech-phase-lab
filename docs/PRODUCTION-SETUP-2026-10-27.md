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
