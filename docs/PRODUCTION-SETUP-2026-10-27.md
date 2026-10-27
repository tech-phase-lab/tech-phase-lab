# Production setup — 2026-10-27 JST

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
- Vercel DNS inspection still reports root domain misconfigured, pointing to
  `207.207.210.107` / `207.207.210.229`, not Vercel. The root-site TLS failure is
  not evidence of a failed Clerk account creation. Root DNS was not changed.

## Owner access change

Retain the development owner ID and Sandbox integrations. Recognize the explicitly
approved Production ID in the shared owner predicate and member-export label.
Production operational PRO access is limited to the Production owner with verified
server identity and the existing administrator MFA gate. Other admins do not get
automatic Production PRO. Ordinary members continue to use the Live billing ledger.
Owner operational access does not create a subscription, charge, or payment record.

## Still required before launch

- Deploy the reviewed preview-branch code with Production configuration; existing
  Production deployment is old main code. Do not redeploy it or change main.
- Complete Production API/media configuration and verify actual feature access.
- Connect root DNS to Vercel and verify HTTPS, then finish Google branding URLs,
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
