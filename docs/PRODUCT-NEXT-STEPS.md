# Approved product priorities — 2026-09-27

User approved this order. Preserve across sessions.

1. Finish one bilingual “What changed?” research example, verified against primary sources, with a clear lead, comparisons, independent interpretation, uncertainty and next checks. First example: existing MU FQ3 2026 note (June 24 historical release), improved in place; do not duplicate it as breaking news.
2. Define the Free / PRO boundary using the finished example. Not yet implemented or finalized. Do not add a paywall without completing the membership design.
3. Clarify device notification on/off status and provide a test-notification flow. Not yet implemented in this batch; confirm actual delivery rather than just browser permission.

The approved PRO copy is “変化を読み、一歩先へ。” / “Read the shifts. Think ahead.”
The user will arrange legal review before launching the paid service. Do not present buy/hold actions as the user's recommendations.

## Example editorial format

- Keep the actual announcement date visible, with review date separate.
- Lead with the change and why it matters, not a description of the research process.
- Separate reported actuals, company forecasts and our interpretation.
- Compare like-for-like accounting bases and distinguish margin percentage points from growth percentages.
- End with a short actionable research checklist, not trading instructions.
- Keep sources accessible without burying the conclusion in technical caveats.
- MU example source: Micron IR, fiscal Q3 2026 earnings release, June 24, 2026.
- Arithmetic checked: (41,456 / 23,860 - 1) × 100 = 73.7468567%; 84.6 - 74.4 = 10.2 percentage points.
- Direct preview entry: /research#what-changed/mu-q3-2026.

## Editorial revision — MU v2

The user rejected v1 as too shallow for paid research. Removed colored uncertainty treatment. V2 uses the official prepared remarks alongside the release to distinguish pricing-driven growth, contract floors versus ceilings, and cost exposure. Adds forward scenarios and explicit thesis-reassessment conditions in Japanese and English. This remains a June 24 historical case, not a current forecast. Priority 1 awaits user review; priorities 2 and 3 remain pending.

## MU v3 — deeper valuation and cycle research

V2 was again rejected as too generic. MU now distinguishes September 27 analysis, September 25 market/consensus snapshots, and June 24 historical financials. Includes industry DRAM/HBM/NAND mechanisms, fiscal-year adjusted EPS valuation, analyst target comparisons explicitly not claimed as proprietary models, and EPS stress sensitivity. Free/PRO definition remains pending user assessment. Latest observed CI failure (run 36304544043) was truncated calendar handoff content, restored in 1b7dc165; subsequent runs succeeded. Added mandatory local/remote Git tree equality before publication to prevent clipped-file uploads.

## September 27 user acceptance and priority 2 proposal

Priority 1 accepted. Headlines must combine earnings identity, important numbers (with comparison basis), and the forward question. MU title now includes revenue +73.7% quarter over quarter and GAAP gross margin 84.6%. Avoid unsupported superlatives.

Priority 2 is now a reviewable Free/PRO proposal on the comparison page; billing and access restrictions remain inactive. Free: search, quotes/charts, markets, watchlist, calendar, earnings key figures and concise changes with source links, plus selected full research samples. PRO: full industry/cycle analysis, earnings-based valuation, scenarios and reassessment triggers, dated analyst reactions/estimate revisions, related-company implications, bilingual news and price-target notifications. No guaranteed delivery latency or promise to deeply cover every listed stock.

For MU, free scope is headline, reported results and concise change summary with original sources. PRO scope begins with the forward thesis and includes HBM/DRAM/NAND analysis, EPS/P/E sensitivity, scenarios and subsequent revisions. Keep the current complete MU example accessible for evaluation. Implement actual entitlements only after membership design is agreed.

Apply the same editorial depth to other covered companies using sector-appropriate drivers, not a memory template. Post-earnings expert reactions must include named source, date, rationale and estimate revisions; distinguish these from our interpretation. Future collection is not yet scheduled by this change. Priority 3 remains notification delivery/status testing.

## Current operating policy — approved September 27, 18:56 JST

This section supersedes older pending/proposed wording where it conflicts. Preserve this policy across chats.

- Earnings headlines: include the company/earnings identity and the most important result with numbers and comparison basis. Make strong, weak or mixed results apparent. Do not repeat revenue growth for every company; select guidance, margins, orders, profit or another material driver. Keep detailed analysis inside the article. MU numeric headline approved.
- Japanese and English are available in FREE as well as PRO. Language choice is not a paid advantage. Comparison page copy must not imply otherwise (copy correction still pending).
- Adopt three recurring editorial pillars: **週刊 Tech Phase PRO** (name explicitly approved), a member question corner (name pending), and RIZEL's personal perspective (name pending).
- Weekly report: important changes, revised theses and next week's checkpoints. Selected member questions can be answered within the weekly report; do not promise an individual answer to every submission.
- Personal perspective: occasional short commentary based on the user's actual notes or statements, edited/translated by the assistant. Never invent the user's opinions or trading actions.
- Additional PRO-only broadcasts may happen very occasionally if the user has capacity. They are optional, not a regular membership entitlement or fixed schedule.
- Expert reaction summaries: identify source/date, consensus and disagreement, rationale and estimate/target revisions. Separate outside views from Tech Phase analysis. Do not invent reasons from target prices alone or claim access to unseen analyst reports.
- Consistent research quality across covered companies: sector-specific drivers, valuation, scenarios and conditions that change the thesis.
- Naming suggestions are not final until the user selects them. No recurring automation, billing or new access restriction is activated by this editorial agreement.

## September 27 PRO benefit copy approved for implementation

User approved ten benefits and requested one-line rows on mobile. Implement concise bilingual wording, remove redundant language-as-paid-benefit claim, and put Everything in Free above the list. Final three names: 週刊 Tech Phase PRO / Tech Phase PRO Weekly; リゼルに聞く / Ask RIZEL; リゼルのひとりごと / RIZEL’s Notes. Each includes a short descriptive phrase. Preserve full text and accessibility wrapping under enlarged text; no clipping or horizontal scrolling. This changes marketing copy only, not entitlements or scheduling.

## September 27, 20:28 JST visual/copy refinement

Align Free and PRO bullet insets at zero list padding. Keep only the approved page-level tagline; remove the second slogan below the PRO CTA. Reduce repeated middle-dot enumerations in benefits. Replace generic scenario wording with growth turning points and what comes next. User requested a stronger question-section name; current trial label is リサーチQ&A / Research Q&A, preserving 会員の疑問を深掘り. Ten benefits remain.

## Priority 3 — real device notification controls

Replaced display-only toggle with actual PushManager registration, server registration status, unsubscribe, and rate-limited server test delivery. On requires confirmed registration; browser permission alone is not success. Test provider acceptance and user-confirmed receipt are separate. Reloaded subscriptions start unverified until checked. Private pilot code remains required on authenticated server actions and is held in memory only; production membership authentication is not yet implemented. The user must verify receipt on their own phone. No unsolicited test sent to existing devices.

## New priorities approved September 27, 22:45 JST

Supersedes the previous numbered task queue (not editorial policy):
1. Membership: sign in/out, server-side Free/PRO entitlement, then restricted research and member notifications. Production notification UX must be a simple on/off switch with no pilot-code entry.
2. Measure intake → bilingual display with missed-event and duplicate checks.
3. Editorial publishing UI for weekly PRO, Research Q&A and RIZEL notes.

Started membership foundation: Clerk SDK, optional configured middleware, account page and no-store member-status endpoint. PRO comes only from server-fetched private metadata `{plan:"pro",proExpiresAt:"ISO timestamp"}` and expires closed. No client-side role selector. No billing, signup provider provisioning or real account creation performed. Existing MU sample remains public. Notification pilot security remains unchanged until member identity and per-user device ownership can be verified end to end.

Still required: configure a Clerk application and its publishable/secret keys in Vercel Preview, configure allowed origins/redirects and JP/EN auth UI, test actual sign-in/out and expiry with Free/PRO test accounts, then attach account ownership to notification records and remove pilot-code dependence from the member flow. Premium content currently bundled in public research data must be moved server-side before claiming a paywall; hiding UI alone is not access control. Do not claim membership is operational before live identity-provider tests pass.

## 2026-09-27 会員ログイン・登録者管理の追記

- 無料の公開ページ閲覧は登録不要。匿名利用人数はアクセス解析による推定とし、登録者数と区別する。
- ログイン／新規登録後は `/research/account` に戻す。会員状態は認証変更後にサーバーへ再確認し、FREE/PROを表示する。
- 日本語の認証画面は「Tech Phaseにログイン」「無料で会員登録」など自然な文言に調整。
- 登録者CSVは `/api/research/member/export`。Clerk privateMetadata.role が `admin` の会員だけが取得可能。一般会員や未ログインは403。自動的な管理者付与は行わない。
- CSV項目: 会員ID、登録日時(UTC)、メール、確認済みフラグ、表示名、Free/PRO、有効期限、最終ログイン。パスワード・トークンは含めない。数式注入を無効化する。
- 未完了: 運営者のClerk会員IDの確認と権限設定、実データのCSV出力確認、保存先シートへの接続。現時点でシートの作成・自動同期が済んだとは案内しない。
- ユーザーのブラウザでログインは成功との報告。FREE表示は修正後の再確認待ち。こちらのブラウザとセッションは別。

### 2026-09-27 23:46 JST 会員UIの追加修正
- メール欄はラベルを残し、入力例のみ表示。続行ボタンの矢印を削除し、新規登録案内は中央に縦揃え。
- ホーム・検索・企業ページ・各機能ページのブランド下で、ログイン済み会員のFREE/PROを表示。未ログイン・取得失敗時にFREEと決めつけない。表示は権限判定には使用しない。
- 登録者の実データ取得はClerk運営画面への認証待ち。ユーザーのPCでの会員ログインと、運営管理画面の認証を混同しない。保存先シートは未接続。

### 2026-09-28 owner export access
- Clerk private metadata editor was unusable in Chrome and Edge; saving inserted `example: "data"`. This field has no entitlement effect.
- User explicitly supplied their Clerk user ID and authorized owner admin access. `resolveAdmin` now accepts that exact verified session ID, or an existing server-managed admin role. No client-provided ID is trusted; plan remains separate.
- Owner must verify the member CSV download while signed in. Real-data spreadsheet and automatic sheet synchronization are still pending.

### 2026-09-28 member sheet automation preparation
- CSV export was verified by the owner. Its one member is the owner, not a customer.
- Added read-only token-protected `/api/research/member/sync` and a bound Apps Script under `scripts/membership/google-sheets.gs`. Approximately 15-minute full snapshots; owner labeled 運営 and excluded from 一般会員. No browser polling or ChatGPT scheduled task.
- Script validates the complete snapshot before writing, uses a lock, rejects duplicate IDs and removes retired accounts from the current snapshot. Personal data is not logged. Dedicated sync token is separate from Clerk credentials.
- NOT LIVE: owner must import the workbook to private Google Sheets, add the script, run setupTechPhase, save its generated token in Vercel Preview as MEMBER_SHEET_SYNC_TOKEN, redeploy, then run startTechPhase. Verify initial row and recurring successful timestamp. Google Drive plugin connection alone does not provide runtime sync.


## 2026-09-28 membership continuation and sheet verification

- User verified first private Google Sheet sync at 01:27:37 JST: zero ordinary members, one owner. Recurring execution still needs a later successful timestamp; do not claim the timed run was observed.
- Working Apps Script uses @OnlyCurrentDoc, the bound active spreadsheet, and VERCEL_BYPASS_SECRET in the x-vercel-protection-bypass header. Repository script now matches those security/connection changes. Existing user setup requires no replacement.
- The 15-minute sheet sync completes only member reporting, not priority 1. Outstanding priority 1 includes live Free/PRO, sign-out and expiry verification, actual server-side premium content separation, and device ownership/entitlement-aware notification delivery without a pilot code.
- Added self-service admin-only preview membership testing to avoid the unusable Clerk metadata editor. It changes only membershipPreview private metadata for the verified caller, never billing/real plan metadata or another user. Preview overrides expire after one hour and are ignored in production and for non-admins. Buttons include Free, Pro, expiry after one minute, and restore. No real plan has been changed by implementation.
- Existing MU evaluation sample remains public by prior agreement. Current public research data is NOT a paid-content boundary; do not claim that hiding controls protects it. Notification pilot remains unchanged until server ownership and delivery-time entitlement checks are implemented.
- User approves continuing the same queue: (1) membership and access, (2) real intake-to-bilingual-display timing/missed-event/duplicate checks, (3) editor for weekly PRO, Research Q&A and RIZEL notes.
- Screenshots inspected include names, emails, user IDs and project metadata. No password/secret exposure identified in inspected images; unavailable historical images cannot be certified. Do not ask user to share secret values.

## 2026-09-28 continuation in replacement chat

- Owner reports PRO test display succeeded. This does not establish article or push entitlement enforcement in the deployed preview.
- Recovered unfinished work in `codex/member-content-20260928`, based on `2212766`: public article projection, server-only full content, authenticated article API, client article retrieval, and partial Python push ownership work. These changes are local and have not been published by this continuation.
- Added article access regression tests and explicit expiry validation at the article API boundary. Anonymous, Free, expired/missing-expiry PRO, and identity-provider failures return no full article; MU evaluation sample remains public. Local verification: 113 Node tests and 347 Python tests pass; lint, production build, Python compilation and diff whitespace checks pass.
- Notification integration remains unfinished: the Next.js notification API/UI still uses the private pilot code. Complete verified account ownership from the Next.js route through the monitor, delivery-time entitlement handling and the member UI before publishing this combined batch. Do not present the partial Python changes as a working member notification flow.
- Still required before priority 1 completion: authenticated browser verification (Free/PRO, sign-out and expiry), integrated notification verification and preview deployment. Then proceed to priority 2 timing/duplicates/missed events, and priority 3 publishing UI.

### Member notification integration implementation (replacement chat)

- Removed pilot-code dependency from the member notification API/UI. All mutations use verified Clerk identity, strict same-origin JSON, bounded payloads, fixed monitor routes and server-selected owner/expiry. Free members may remove their own device. Browser unsubscribe remains available even when membership/configuration fails.
- Monitor stores per-device account ownership, refuses other owners/keys, enforces expiry and deduplication, and rechecks authoritative entitlement before automated delivery and test delivery. Callback errors deny delivery. Legacy unowned devices are not automatically adopted for delivery; they require member registration. Legacy delivery is disabled unless WEB_PUSH_ALLOW_PILOT is explicitly enabled.
- The callback uses the existing server-to-server monitor token and returns only PRO eligibility/expiry. Railway research-staging needs WEB_PUSH_MEMBERSHIP_URL pointing to the preview /api/research/notifications/entitlement route. A protected Vercel preview additionally needs WEB_PUSH_MEMBERSHIP_BYPASS. Do not disable Vercel protection. New member configuration advertises unavailable until a callback URL is set.
- Local integrated verification (includes upstream 1a319c4): lint, 113 Node tests, 351 Python tests, production build, Python compilation, whitespace checks pass. Seventeen premium passages are absent from public generated HTML/RSC/client JS. Phone receipt and authenticated live-state transitions remain unverified.
- Rollout gate: configure and verify the protected callback, then publish this batch to codex/research-preview and verify Railway/Vercel/CI. Do not call priority 1 complete or proceed to priority 2 before actual member-flow checks. No notification was sent by this continuation.
