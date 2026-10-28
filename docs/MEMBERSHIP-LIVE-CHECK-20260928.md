# Membership live checks — September 28, 2026

The owner signed into the shared preview browser. Checks ran after 16:13 JST.
These are observed browser outcomes, not a claim that every launch gate is complete.

## Observed

- Initial signed-in account was FREE, with owner testing controls available.
- FREE notification settings showed that notifications require PRO.
- Selecting the existing, non-billing PRO test changed the account to PRO.
- The protected analysis, unknowns and next-check sections of the Nebius
  ClusterMAX historical research appeared for PRO.
- PRO notification settings reached device permission handling. This browser
  denies notifications; no subscription or push delivery was attempted here.
- Selected the one-minute expiry test and reloaded the article before expiry.
  The protected sections appeared, then disappeared automatically at expiry,
  replaced by the PRO requirement. This observation did not require a reload
  after expiry.
- Refreshing membership showed FREE; notification settings again required PRO.
- Ended the preview test and confirmed the account returned to ordinary FREE.
- Signed out and observed the sign-in form. Reloaded research withheld protected
  analysis; notification settings required sign-in.

## Evidence and limits

- Focused local checks: 10 Node tests for membership/article/notification routes
  and preview overrides; 24 Python push tests passed, including ownership,
  expiry and delivery-time entitlement rejection. These are automated checks,
  not phone-delivery observations.
- Earlier phone test receipt was confirmed by the owner in this conversation.
- Actual phone delivery suppression after downgrade/expiry remains unobserved.
  No test push was sent during these checks. Cross-account device ownership was
  tested locally, not with a second live member.
- Signing out blocks authenticated UI/actions; it does not globally unsubscribe
  a member's devices. Existing push delivery uses device registration plus live
  account entitlement/expiry, rather than the browser login session.
- Direct API navigation was blocked by the browser client. Browser evidence above
  comes from normal application screens; route response rules are covered by tests.
- Editorial columns have no published verification article. Their live Free/PRO
  body transition is not proven by the historical research article check.
- No paid API activation, real-plan change, publication, or billing occurred.

## Next

Keep paid-provider latency/coverage checks deferred until approved API activation.
Do not mark priorities 1–3 universally complete. The existing editorial UI can be
improved independently; preserve the phone-delivery and live-column checks as
explicit launch gates.
