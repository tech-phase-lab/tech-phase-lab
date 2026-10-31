# Live reconciliation incident — 2026-10-31 JST

## Production verification — 11:00 JST

- Owner applied the staged fix. Deployment `8ec1108a-88ec-4bb0-bee5-bbecc7e8a723` is SUCCESS and uses `e4885e99d89da31728a5d73b94c79bf154476ab5`.
- At 10:56 JST predeploy confirmed approval_pending=1 and made exactly one failed unpaid application eligible for retry. No payment or entitlement writes were performed by the retry preparation.
- At 11:00:32 JST the new runner processed the actual record: completed, checked=1, failed=0, reviewRequired=1, leaseLost=0. The record remains for review and a six-hour recheck; this is not payment verification or an inferred cancellation.
- Healthchecks was directly observed UP after this actual processing, not merely after an empty batch. No synthetic success ping or notification disabling was used.
- Removed the one-time preDeployCommand from future deployment configuration; read-back confirms empty, original startup, five-minute schedule, no pending changes.
- At 11:05:34 JST the next scheduled run also completed: checked=0, failed=0, reviewRequired=0, leaseLost=0. Healthchecks was directly observed UP again after its completion. The incident crash loop is resolved; the preserved missing application still requires review.
- The preceding failure history below is retained for audit; its statements of unreflected/pending state describe those earlier times.

## Confirmed diagnosis at 09:10 JST

- Owner applied the staged diagnostic; deployment `eb2521be-a11d-4f87-b735-18d6b82ae2f4` executed it at 00:10 UTC.
- Aggregate ledger: subscriptions=1, payments=0, periods=0, failed_queue=1, missing_queue=0, payments_without_period=0. No raw identifiers or provider bodies were logged.
- PayPal authentication returned HTTP 200, then the subscription lookup returned HTTP 404. Existing code flattened this response to PAYPAL_UNAVAILABLE, causing repeated recovery failures and crash emails.
- A missing provider subscription is not proof of cancellation or of a payment having/not having occurred. Do not delete the row, synthesize a payment, infer a paid expiry or grant PRO.
- Fix: distinguish the authenticated subscription GET 404 (not authentication/transaction/transport errors). In recovery only, an approval_pending application with no recorded payments becomes durable review-required, preserving its row and six-hour recheck. Active/previously paid contracts and other errors still fail. No schema migration or payment writes are introduced by this classification.
- Targeted regression checks: 14 passed, including non-grant/non-deletion, persistent review queue and recheck, paid/active failure preservation, auth 404/401/403/429/500 separation and sensitive-body suppression.
- Release checks: Node 1,688 passed; Python 2,678 passed; production build completed; lint 0 errors (11 existing warnings); Python compileall and diff whitespace checks passed. Production verification is pending at this entry.

## Earlier observations (before the confirmed diagnosis)

- Production service: `tech-phase-billing-recovery-live`; project radiant-magic.
- Running source was pinned to `f76cec90d984575a0cda1588efad2513bec4aaae`, the same revision used for successful processing before the incident. No evidence of a newly deployed application revision causing the first failure.
- At 02:31, 02:37, 02:42, 02:47 and 02:55 JST, each run reported `partial-failure`, checked=1, failed=1, leaseLost=0. These aggregate logs do not prove whether all attempts refer to the same subscription.
- The runner intentionally exits nonzero after an individual reconciliation failure. Existing logs suppress the underlying exception, so the precise provider/database/validation failure remains unknown.
- Subsequent runs at 02:52, 03:02, 03:05 and 03:10 reported completed with checked=0. This is not evidence that the failed item recovered: the queue has exponential retry backoff, capped at one hour.
- Healthchecks `Tech Phase PRO Live payment reconciliation` was directly observed as up. Its job-level green status can follow an empty successful batch while a failed item awaits retry. No synthetic/manual success ping was sent.

## Actions

- Prepared a temporary startup diagnostic which prints only aggregate database counts and allowlisted exception codes, using the service's existing credentials. It does not expose user IDs, payment IDs, credentials or provider error bodies.
- Updated startup configuration and requested redeployment `70419024-1441-4ad5-bc3e-c3d3b32daf59`. Its runtime still emitted only the original events; diagnostic execution was not observed. The redeploy path reused the earlier deployment configuration/build.
- A request to rebuild the same pinned source was rejected by automatic approval review: persistent source reassignment could affect other environments and was considered outside the recovery authorization. Did not retry through an indirect source-change path.
- Restored the original startup command and redeployed the earlier successful deployment `22f66077-eac4-4856-a07c-ac697005c946`. New deployment: `872ee0d4-4f23-45be-92b6-1b6a72910dfb`, SUCCESS. This uses the same application revision; rollback is not proof the underlying record failure is fixed.
- Verified original startup command, unchanged five-minute schedule, no staged changes. No checkout, capture, cancellation, refund, credentials change or direct ledger update was performed.

## Earlier pending actions (historical)

### Owner-approved diagnostic staging (later on 2026-10-31)

- Owner explicitly authorized production diagnostic rebuilding and requested urgent repair after repeated Railway crash email.
- Staged ONLY recovery-live in production: same repository, branch and pinned revision, plus a bounded diagnostic startup command. No other service, secret, networking or data change is staged.
- Diagnostics read aggregate ledger/queue counts and at most ten failed subscriptions. Provider reads print only operation categories and HTTP statuses; exception output is allowlisted. Normal reconciliation follows, with existing safeguards.
- `accept_deploy` returned: `Cancelled — the user did not approve this action. No changes were made.` This is a connector approval cancellation, not a completed deployment. Did not bypass it.
- At that time the diagnostic remained STAGED and had not executed. The owner subsequently applied it; see the confirmed diagnosis above.

- **Rollback verification failed:** at 03:15:16 JST, deployment `872ee0d4-4f23-45be-92b6-1b6a72910dfb` again reported checked=1, failed=1, partial-failure and became CRASHED. Healthchecks was then directly observed DOWN. The incident is not resolved. A successful empty batch must not be reported as recovery.

- Execute the prepared bounded diagnostic in this production service only, then restore normal startup.
- Identify the actual failed operation and verify queue backlog, missing queue records, and payments without verified periods with read-only aggregate queries.
- Verify a real due-item retry succeeds; an empty batch or green heartbeat is insufficient.
- Do not claim payment reconciliation completeness until provider/ledger evidence has been checked.

## Fix publication and deployment boundary — 09:25 JST

- Published tested fix `e4885e99d89da31728a5d73b94c79bf154476ab5` to codex/research-preview, without force or main changes. Git Data tree matched staged local tree exactly.
- Staged only production recovery-live: pinned fix SHA, restore original startup, and one-time predeploy retry of failed approval_pending records with no recorded payments and no active lease. No payment/subscription/entitlement writes are made by this retry setup.
- The deployment approval tool returned `Cancelled — the user did not approve this action. No changes were made.` No bypass attempted.
- Read-back confirms exactly three pending fields for this service and no destructive changes. The fix is NOT live. Owner must apply these three pending changes.
- After owner applies: inspect predeploy state counts and retry count; require actual checked item, reviewRequired=1 and failed=0 (if approval_pending/no-payments guard applies); verify monitor up after real processing. If guard does not apply, continue diagnosis rather than suppress failure.
- Clear the temporary preDeployCommand after successful execution. Verify next scheduled run. The missing provider record still needs review and is not proof of payment/cancellation.
