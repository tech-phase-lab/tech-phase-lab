# Approved product priorities — 2026-09-27

## Latest checkpoint — manual PRO columns, September 28

Stock News API and OpenAI API/model setup are explicitly deferred by the owner.
Priority 2 is not complete. Continue priority 3: manual bilingual weekly PRO,
Research Q&A and RIZEL notes now have draft storage, revision-bound publication,
withdrawal and membership-filtered display. See `EDITORIAL-COLUMNS.md`. No real
article has been published or AI provider activated by this implementation.


## Latest implementation checkpoint — September 28

Ordinary-news editor UI, evidence-backed manual corrections, bilingual generation,
revision/fingerprint-bound review and approved-only public selection are
implemented; see `NEWS-DRAFT-REVIEW.md`. Live paid generation and public
distribution remain OFF. Next: live provider entitlement/model evaluation,
explicit failed-generation retry controls and source-to-screen timing.
Do not mark priority 2 complete yet.

## Current checkpoint — September 28, 12:05 JST

Owner confirmed test push receipt and pressed Received. VAPID URL correction is
deployed in `9eed003`; member test provider acceptance was 201. Continue approved
priority 2 (acquisition → bilingual display, missed-event/duplicate checks).
See `DELIVERY-VERIFICATION.md` for the live baseline, target replay defect/fix,
and remaining measurement limits. This checkpoint supersedes older pending
phone-receipt wording below, not the separate Free/expiry browser checks.

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

### September 28 rollout after explicit owner approval

- Owner approved storing the Vercel automation bypass key in Railway research-staging and continuing deployment. Saved WEB_PUSH_MEMBERSHIP_URL and WEB_PUSH_MEMBERSHIP_BYPASS; applied both staged variables. No secret values are recorded here.
- Advanced only codex/research-preview to 91fb3057461ded6c356951f3a57427adc1afb4fb (non-force fast-forward). Local/GitHub tree was dc79ee953b9a1c3478c3dae6adfa4b3733b6d092. Both GitHub verification runs succeeded.
- Vercel deployment dpl_6RKhMPZ94WjehjnB6U4mBGxiuR11 is READY and aliased to the usual research preview. Railway research-staging shows ACTIVE / Deployment successful for the same membership commit, deployment 28ec63d5-a7ce-4e7f-8e82-e0ccceb1b12a.
- Live anonymous notification API returned 200 with enabled:false / reason:sign-in and private no-store headers. Browser notification settings render without the pilot-code field. The agent browser reports Notification permission denied and is signed out of Clerk; Vercel operator login is separate from Tech Phase member login.
- NOT YET VERIFIED: Railway-to-Vercel entitlement callback response, authenticated Free/PRO/expiry transitions and phone receipt. Railway web console showed Connected but did not produce output for diagnostic commands, so do not claim its callback probe succeeded. No phone notification sent. Next: owner opens the usual account page, selects PRO preview if expired, then enables notifications on their phone and sends the explicitly labeled test. Complete priority 1 verification before starting priority 2.


## 2026-09-28 14:49 JST owner-approved priorities

1. Investigate/reduce Vercel transfer before paying. Observed Hobby Fast Origin Transfer 9.19 GB/10 GB (91.9%), 99.1% outgoing; CPU 16.7%. Route-level attribution not yet proven. Intake dashboard polls the entire snapshot every 3 seconds; reduce this operational screen to 60 seconds (95% fewer scheduled fetches per visible tab). Real news detection, direct SSE and push timing remain unchanged. Verify actual post-deploy usage slope; do not claim total transfer fell 95%.
2. Compact mobile menu to 48px list rows. Separate RIZEL Notes, Research Q&A and Weekly with direct home/menu destinations. Add dedicated authoring buttons; existing editor authentication stays required. Notes are the owner's real words, not generated personal opinions.
3. Further work: simplified Japanese-first notes composer, owner-only authoring entry, latest note on home, authenticated private question submission + moderation inbox and separate answered-question view. Separate pages alone do not implement question receipt. Never present an unsent form as received.
4. AFTER the above: free beginner guide and FAQ. Separate investment learning from service help. Cover account opening, orders, earnings and beginner/intermediate concepts. Broker content segmented by residency, not just language; start Japan, expand countries deliberately. Affiliate links only after confirmed program approval/terms and with ad disclosure. Owner explicitly requested remembering this across chats.
5. Stock News/OpenAI activation remains deferred to early December for January launch. No Vercel upgrade authorized or performed. Hobby is not a lifetime bucket; official docs say no billing cycle and in most limit-exceed cases a 30-day wait. Do not promise an October 1 reset. Hobby is personal/non-commercial; evaluate plan eligibility separately from usage.

## 2026-09-28 23:41 JST body-only notes checkpoint

- Owner correction implemented and pushed to codex/research-preview: RIZEL notes have no headline or public
  intro. The compact owner composer accepts only a Japanese body, shows clear
  save/publish/withdraw pending states, and places the editor before history.
  History uses body excerpts instead of synthetic titles.
- The owner API and Python persistence layer both force note title/intro fields
  empty. Publishing requires only the Japanese body. The reader never renders a
  heading/intro for notes, while Free/anonymous responses continue to omit the
  PRO body. The disabled future translator is body-only too.
- The home now checks a dedicated latest-note endpoint and shows only the newest
  publication date plus a PRO label. That endpoint always applies the Free
  projection and then returns only ID/date/translation status; it cannot return
  a body or legacy headline, even to a signed-in PRO user.
- No owner opinion was invented and no real note was published. The next product
  priority is authenticated private question intake and moderation/answered
  views.
- Application commit `858a521a66f31fa1007a6725ad8a61991a46e3b2`
  deployed successfully to Vercel Preview as
  `dpl_GimvYXAXNqggrAsA2wKBjyxev8Ri`; Vercel and Railway commit statuses both
  reported success. Local/GitHub tree SHA matched exactly at
  `7290d34d94e5e7569971e7a7dfde56c79eb24ff3`. The protected preview returned an
  SSO redirect to the automated fetch, so no new authenticated browser save or
  live DOM claim is made for this revision. Existing real/synthetic note state
  was not changed.

Private weekly sample: staging id weekly-sample-20260622-micron, revision 2, draft. Saved/re-edited/read back; excluded from published feed. User saw empty columns page; explained draft is not visible to PRO. No sample published.


## September 28 late-evening owner workflow checkpoint

- Owner upgraded Vercel to Pro and set additional budget $10; do not repeat upgrade reminders or modify billing.
- Existing Railway staging RESEARCH_EDITOR_TOKEN saved as Vercel Secret scoped only codex/research-preview, with explicit owner consent. Redeploy FdFLiS3tbA8Vd6FgkZJFiPugfwDv Ready. Live owner composer listing, publication, withdrawal, and draft save verified; test note remains private.
- Owner clarified notes are casual X-like posts: no headline input or reader headline. Composer accepts body alone. The current persistence layer now stores note title/intro fields empty; owner-only history uses a body excerpt, while Free readers never receive the body. Mobile editor comes before collapsed history; publish control stays near bottom; pending operations have explicit status.
- Owner unavailable and authorizes autonomous continuation. Existing hourly Tech Phase development task updated, no duplicate created. The latest-note home entry is now implemented with metadata-only projection. Next: private question submission and moderation inbox / answered view, then beginner FAQ. Paid APIs remain deferred until early December. Never invent owner posts or claim untested mobile-device behavior.

## September 29 private-question implementation checkpoint

- Added signed-in private question submission with same-origin writes, bounded
  text, explicit pending/error states, and idempotent retry IDs. The monitor
  stores an HMAC-derived owner key rather than the Clerk user ID.
- Added an owner-only moderation inbox. A question can be closed or linked as
  answered only to a published Research Q&A post; raw member text is never
  automatically published. The answered reader page is separate from intake.
- Reader and owner copy says selected questions may be answered and never
  promises a response to every submission. No real question or answer content
  was created during implementation.
- Local isolated storage, HTTP, Next route, identity-proxy and UI-source tests
  cover privacy boundaries and state transitions. Live signed-in submission and
  moderation remain a post-deploy verification item; do not report them as
  completed until observed.
- Next finite product priority after deployment verification is the Free
  beginner guide and service FAQ. Keep investment learning separate from account
  and product help, beginning with Japan-resident brokerage context.

### Preview deployment verification

- Advanced only `codex/research-preview` to application commit
  `a0ed3316dd9a41d91bbacc9e2442014489dfa2fd`. Vercel Preview deployment
  `dpl_2qwiicJ5FY56re9wjJhHYLBSokRB` reached Ready, and the Vercel and Railway
  commit statuses both reported success.
- Local and GitHub final trees matched exactly at
  `a61977319923f7ad2822a216cda24ecd769d1776` before local branch alignment.
  No main or production ref was updated.
- The protected preview's signed-in question submission, member-owned history,
  moderation actions and exact answered-post link still require a live owner
  session. No real question, answer, post or note was created for this check.
- Next finite product work is the Free beginner guide and service FAQ. Keep the
  two information types separate and preserve Japan-resident brokerage context.

## September 29 Free learning and service-help checkpoint

- Added separate public pages for a Japan-resident-first US stock guide and the
  Tech Phase service FAQ. The guide covers account checks, orders, earnings and
  intermediate research concepts; it links only to primary FSA and Investor.gov
  references and contains no broker ranking or affiliate promotion.
- The FAQ separately explains Free/PRO visibility, private question handling,
  the no-answer guarantee, body-only RIZEL notes, periodic calendar verification,
  measured latency versus refresh intervals, translation status and the
  educational-not-advisory boundary.
- Both pages are linked from the home quick tools, desktop research tools and
  mobile menu. They require no login. Local validation passed: lint, 133 Node
  tests, 427 Python tests, production build, Python compilation and whitespace
  checks.
- Application commit `6a777cfa18c104474cc4af045f1ecae30262bc04`
  deployed successfully to Vercel Preview as
  `dpl_CmHpAVAwmsDvhHFawYqYY76pkkK3`; Vercel and Railway commit statuses both
  reported success. Local and GitHub trees matched exactly at
  `174ef9ddf5d204b1db344b62cd1980a1c6a7a12b`. This completes the currently
  authorized finite product backlog; retain the separately authorized calendar
  maintenance and do not activate paid news or translation services.

## September 29 owner navigation correction

- Moved beginner/service help from the six-card home grid to a quiet text-link
  section below price targets; the four primary quick tools omit diagonal arrows.
- Renamed Service FAQ to ご利用ガイド / Service guide across visible entry points.
  Existing answers are preserved except the renamed label; owner will supply
  substantive corrections later.
- Moved beginner/help mobile links to the end. Mobile Notes, Research Q&A and
  Weekly PRO links now require a fresh signed-in PRO response when opening the
  menu. Free, signed-out, pending and failed checks hide those entries. Changes
  to membership and window focus recheck; stale requests cannot restore old PRO
  links. Server content authorization remains authoritative.
- Verified locally with lint, 134 Node tests, 427 Python tests; production build, Python compilation and whitespace checks also passed. No authenticated live Free/PRO
  verification was performed in this change. Home PRO discovery panel is retained;
  this request changes the mobile menu visibility, not home promotional content.

### 2026-09-29 Free homepage / help visibility
- Keep RIZEL’s Desk entry links visible on Free with a darker background and explicit lock / PRO-only badge. Paid text remains server-protected; styling is display-only.
- Keep help below the primary content, enlarge into readable cards, add beginner mark to US stock basics. Rename service guide consistently to よくある質問・使い方 (FAQ & help), distinct from Ask RIZEL.


### September 29 integrated verification follow-up
- Preserved and fast-forwarded the parallel owner UI update `81847f7`; no UI or
  FAQ answer content changed in this follow-up. The previous navigation commit
  `5208776` is confirmed Ready in Vercel Preview (`dpl_GMzaavwnWSHUyjWdTGmB5oSEj8KT`).
- Vercel and Railway commit statuses for `81847f7` both report success.
- Re-ran the integrated tree: lint, 134 Node tests, 427 Python tests, production
  build and Python compilation pass. These are local automated checks, not a
  signed-in browser verification.
- Local mobile browser verification is blocked: agent-browser is unavailable,
  Playwright has no installed Chrome executable, and the attempted Chrome
  Headless Shell download fails with an invalid/truncated ZIP archive. No real
  membership or content was changed. Keep live Free/PRO/downgrade/failure-state
  verification pending; do not report it as passed.
- Product backlog remains complete apart from verification and owner-provided
  FAQ corrections. Continue calendar maintenance using the dated handoff.

### 2026-09-29 07:04 visual correction
- Free RIZEL’s Desk uses an 84% black overlay over the original design with centered PRO membership label; underlying text remains barely visible. This is a PRO gate, not a coming-soon claim.
- Homepage help removes card backgrounds/borders, retaining only bottom rules. Both links remain side by side on mobile with a beginner mark and short descriptions. Supersedes earlier card design.

### 2026-09-29 07:12 lock / help finishing
- Add the requested lock to the left of PRO会員限定 and a subdued diagonal chain over the black overlay; keep the central caption legible.
- Simplify homepage help to two side-by-side icon/title links, removing descriptions and individual bottom rules to avoid competing with the footer separator.

### 2026-09-29 07:21 visual refinement
- Replace the single chain with dense corner-to-corner crossed chains (61 links each), keeping the PRO caption clear.
- Align help icons in equal-sized centered slots, retain small text and no cards/descriptions, add a short central divider for grouping.

### 2026-09-29 07:27 chain proportions / footer / theme tracker
- Restore clearly shaped chain loops. Measure the overlay with ResizeObserver and draw chains in actual pixel proportions, retaining corner-to-corner X geometry without stretching the links.
- Footer help is now 2x2: beginner guide, FAQ/help, notification settings, My account.
- User asks about screenshot-style theme performance (memory, neocloud, optical interconnect), not only broad sectors. Proposed first version: defined constituent baskets and equal-weight period returns (1D/5D/1M), clear as-of time and coverage; rotation map later. Not implemented or supplied with live data yet. Need an approved historical price source and external-display rights; TradingView embed alone does not supply custom calculation data. No paid activation authorized.
