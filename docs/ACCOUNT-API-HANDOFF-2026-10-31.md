# Account API handoff (2026-10-31)

Implementation in this branch; NOT a claim of production deployment. UI/CSS untouched.
All new routes use existing Clerk session cookies, no browser userId/role/token. Owner routes require approved owner ID AND existing server MFA/admin gate. Responses private/no-store. Mutations require same-origin JSON. Never log request bodies or upstream errors.

## Profile
GET /api/research/account/profile
Returns displayName,email,plan (free/pro/owner),ownerAccess,passwordEnabled,twoFactorEnabled,icon,iconEditable,security.
Owner is the account identity, not a paid subscription. Owner icon="owner" is fixed. UI reuses its owner artwork.
PATCH same endpoint: {displayName?:string,icon?:string}. Name 1–60 code points, trimmed. Only specified keys accepted. Icons:
initial,rocket,chart,diamond,crown,bolt,fire,moon,sun,wave,mountain,compass,shield,anchor,target,eagle,bull,bear,lion,dragon,robot,brain,telescope,coin.
No photos, arbitrary metadata, role or user ID accepted. Storage: Clerk firstName (lastName cleared) and privateMetadata.accountIcon; no other metadata replaced. Separate provider writes may partially succeed; refetch on error.

## Email / password / MFA
Existing /research/account/security uses Clerk UserProfile. Reuse it, or Clerk client verified user flows, including verification/reverification. Do NOT implement these as admin Backend API resets. Show password change only if passwordEnabled. Owner MFA is required for admin access; do not offer owner a disable control. No raw password/MFA secret endpoints added.

## PRO
GET /api/research/account/contract
Uses existing live billing service GET /live/account (new read-only action, existing service authentication). Deploy backend BEFORE frontend.
status: active=利用中, renewal-stopped=自動更新停止済み, none=契約なし, null=確認できません.
verification: verified / pending / unavailable. autoRenew:boolean|null; accessPlan:free|pro|null. State labels and access are separate; ACTIVE alone is not a paid entitlement.
amount: provider fixed-price decimal string|null; currency:JPY|USD|null; nextBillingAt:ISO|null; accessExpiresAt:verified paid ledger ISO|null. unavailableFields names missing evidence. Never use constants/last-payment amount/estimated dates as monthly price or next bill. PayPal GET subscription?fields=plan is read-only, matched to stored contract/plan/custom binding. Unsupported/suspended/review states stay unknown, never "none".
Owner uses same contract endpoint; no fabricated subscription for owner access.
Existing POST /api/research/billing/live/cancel body {id} and reconcile body {id} remain unchanged; status endpoint provides contract id. Existing create remains unchanged. No payment made during development.

## RESOLUTE (already implemented)
GET /api/resolute/entitlements. Existing verified session endpoint.
use.status=active => purchased and currently usable; revoked is not ordinary unpurchased. alerts.expiresAt is notification expiry; canReceiveNotifications also considers both entitlements. 503 must display unknown, not unpurchased.

## Owner member directory
GET /api/research/account/admin/members?q=...&plan=all|free|pro|owner&cursor=0
Search uses Clerk query; returns items {id,displayName,email,plan,contract}, nextCursor, scanned, unverified, filterScope.
Scans 10 identity matches per page; plan filter applied AFTER actual contract lookups. Empty filtered page may still have nextCursor. Continue to exhaustion for complete results; do not claim identity totalCount is a filtered total. Unknown plans are not FREE. Provider lookup concurrency bounded to 5.
Append &format=csv for current page; X-Next-Cursor response header. CSV formula escaping reused. For full export UI walks cursors and combines pages (one header), displaying progress; no unbounded server enumeration. Old /api/research/member/export is legacy metadata-based and must NOT be wired into redesigned account.
RESOLUTE for arbitrary members NOT exposed by existing self-session service; admin RESOLUTE inspection remains unavailable (not required by this request's admin field list).

## Owner delivery
GET /api/research/account/admin/delivery reads existing monitor /health; no news logic altered.
news requested counts/times currently null (unavailable); lastPollCompletedAt is separately labeled discovery poll time, NOT news acquisition.
push.successCount maps accepted24Hours if supplied; this means push provider accepted, not handset read. lastAttemptAt, uncertainCount, expiredCount separate. lastSentAt and failureCount remain null: worker failures/success timestamps are not delivery outcomes. window last-24-hours. Null fields => 確認できません, never 0. Existing monitor may not fill durable delivery counts; add source aggregation with Claude before claiming complete stats.

## Deletion — BLOCKED, not complete
GET /api/research/account/deletion returns canDelete:false and reason:
owner-account / auto-renew-active / contract-unverified / deletion-orchestration-unavailable.
Also affectedData, retainedData, proAccessLostAtDeletion (verified expiry or null), warning.
DELETE same path always 409 after auth/origin check; NO user or data deleted.
No safe unified deletion exists for saved research, watchlists, push devices, RESOLUTE data and Clerk. Missing: distributed deletion ledger/retries, checkout fence, authoritative all-contract recheck, billing/security retention, local storage cleanup, final session revocation. Do not wire Clerk direct delete as fallback. This explicit blocker follows instruction to skip troubled items and continue.

## Not included
This original API change did not include the UI redesign or owner preview extension. Subsequent commits 8f55 and 7f704 enabled production owner FREE/PRO view switching and immediate UI updates. Do not treat the earlier Preview-only limitation as current. Infrastructure credentials/config changes and live payments are outside this account follow-up.

Provider reference: https://developer.paypal.com/api/subscriptions/v1/subscriptions-get/ (fields=plan, plan.billing_cycles fixed_price, billing_info.next_billing_time). No provider write is added.

Deletion deployment prerequisite: existing Clerk UserProfile may expose provider self-deletion depending on instance settings. Verify/disable Clerk's delete_self capability before claiming active subscriptions cannot delete an account. Hiding a button is not enforcement. No Clerk dashboard setting has been changed or verified in this task. This is a blocking item for enabling account deletion.
