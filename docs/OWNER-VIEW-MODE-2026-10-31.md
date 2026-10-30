# Owner FREE / PRO view mode — 2026-10-31

The account switch previously changed only localStorage and the account card. It did not change `/api/research/member`, protected-page membership, the shared header, or the menu badge.

The switch now calls the existing POST `/api/research/member/preview` with `{mode:"free"}`, `{mode:"pro"}`, or `{mode:"restore"}`, and reloads only after a successful save. Failures retain the current state and show a retry message. Old local presentation hints are removed on success.

Production use is restricted to the exact approved production owner with the existing server-side administrator/MFA checks. Preview-environment administrator testing retains its previous behavior. No request-supplied user ID or payment fields are used. Membership preview is stored only in Clerk private metadata and expires after one hour. Restoring clears it. Actual PayPal contracts and payment records are unchanged.

During owner member-preview, the membership response carries the chosen plan, `testing:true`, `ownerMode:false`, and `ownerAccount:false`. The existing header and menu therefore render FREE or PRO / PRO MEMBER. The owner retains access to the account switch so they can restore owner mode. Account preview does not enable payment/cancellation buttons or alter the fixed owner icon.

Regression checks exercise the real membership resolver and preview route with provider boundaries stubbed: owner FREE/PRO/restore, ordinary users and unrelated admins denied in production, origin/body bounds, and MFA rejection. Production browser verification with an authenticated owner remains a separate acceptance step.
