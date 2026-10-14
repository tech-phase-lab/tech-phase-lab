# RESOLUTE three additions — 2026-10-14

## Decisions and reference boundary

Owner-supplied `resolute-3features.zip` contains wall/index.html, tonight/index.html, news/index.html. Originals are preserved under lib/resolute/preview-ref/three-*.html. Scoped CSS retains the supplied colors, cards, borders and hierarchy. Product pages omit reference-only notices. The RESOLUTE menu remains available, separate from Tech Phase's global menu. Small-screen controls may compact spacing to avoid overlapping labels. Dynamic text comes from saved rules; sample financial data is never treated as user data.

- `/resolute/wall`: use.active, local canvas PNG 1080×2279, 4 styles × 3 sizes × 4 backgrounds. Local JPEG/PNG/WebP only (20 MB / 40 MP limit); no uploads or persistence. Clock and date are preview overlays and not burned into the image. Missing values remain unset. Display font sizing adapts for up to 10 saved purchase lines.
- `/resolute/tonight`: use.active. No repeat of alert line/amount. Saved cash-reserve months and user-selected no-buy conditions; no invented promises about actual cash. Optional video list in lib/resolute/tonight-videos.ts, independent language/style selection, initial video rotates by JST date, manual selection allowed. URLs absent until owner supplies videos. Alert templates accept optional tonightUrl; example uses /resolute/tonight. No emails sent by this work.
- `/resolute/news`: both use.active and alerts.active checked on the Railway server. PRO alone never grants access. Initial purchased notification period also qualifies while active. Latest instruction overrides earlier assumed renewal period: ¥5,980 FREE / ¥3,980 PRO; **renewal period now undecided**, no new period encoded here.
- `/resolute/news/owner`: exact verified owner identity. Does not rely on PRO or a client role. Paste public text + source URL + publication time; no arbitrary URL fetching. Replace bilingual approved quotes, hide articles, stop publication. Revision checks protect switches and quote edits. No email-command interface or notification emails enabled.

## Reference differences requiring real inputs

Video placeholder cannot play before video delivery. `最初のラインまで` shows an em dash, not the reference's invented 12%, until symbol/reference-price/current-price binding is supplied and tested. Article tabs use available news, never sample stories as real news. Eight bilingual editorial drafts are provided in lib/resolute/rizel-quote-drafts.ts and the owner screen; all are unapproved. The default published bank of RIZEL quotes is empty; arbitrary generated quotes cannot be published under the owner's name. Approved bank entries are selected deterministically by date/article and approved star range. Use general-purpose quotes for the selected range, not article-specific facts. Owner preview may read the owner API; it cannot grant customer entitlements.

The definitive note is: ※RIZEL個人の見方であり、特定の銘柄の売買をすすめるものではありません。
English: This is RIZEL’s personal view, not a recommendation to buy or sell any particular stock.

## Fixed rubric v1 — proposal, not yet approved for public operation

AI extracts scope, explicit duration and earnings impact with verbatim supporting text. Source type comes from source host classification, not the model. Unknown or unsupported classification is withheld. Model supplies no stars. lib/resolute/risk.ts is the single rubric definition.

| Dimension | 0 points | 1 point | 2 points |
|---|---|---|---|
| Source | SNS | reported article | allowlisted primary/official source |
| Scope | one company | sector | whole market |
| Explicit duration | days | months | years |
| Direct earnings impact | opinion | possible | confirmed |

Total 0–1 = ★1, 2–3 = ★2, 4–5 = ★3, 6 = ★4, 7–8 = ★5. These are an information-review priority, not a probability or predicted price loss. Longer-lasting damage raises priority; it does not mean an imminent crash. A verified low-impact announcement can rank below an unverified broad claim depending on the other dimensions; source certainty and severity are not identical.

Examples (hypothetical, not real news):
- SNS opinion, one company, explicitly days, no earnings fact: 0 → ★1.
- Report, one company, explicitly months, possible earnings effect: 3 → ★2.
- Official, sector, explicitly months, possible earnings effect: 5 → ★3.
- Official, sector, explicitly months, confirmed earnings effect: 6 → ★4.
- Official, market-wide, explicitly years, confirmed earnings effect: 8 → ★5.

At least one visible ★4–5 story makes the day's action `ルールを読み返す`; otherwise `なし`. Scope/duration/impact still involve model extraction, so fixed arithmetic alone cannot guarantee factual correctness.

## Collection and generation

Standalone commands: `node services/resolute-api/risk-job.mjs collect` and `... publish`.
Proposed collector cron `*/15 * * * *` UTC; publisher `0 22 * * 0-4` UTC = JST Mon–Fri 07:00 including holidays. Sat/Sun keep latest weekday with explicit date. Before 07:00 the previous release remains current. The list endpoint is bounded; collection reduces omissions but is not proof of complete coverage.

Collector reads only `/api/research/news` at configured HTTPS origin. Reuses complete approved stories or available approved summaries; never creates missing full text. No new X subscriptions, no existing news pipeline edits. Filter AI/semiconductor context and adverse-event terms, exclude old/future/partial/pending/low-confidence items. Deduplicate canonical source URLs and identical normalized titles. Store candidates for 14 days; publication considers unprocessed past 96 hours, recent/manual first, up to 3 generation attempts/day. A fresh successful collection within 20 minutes is required. Sources lacking explicit duration will often be skipped; three stories/day is not guaranteed.

The model is GPT-5.4-mini through Responses API with strict JSON schema, no tools, no user plan input, store:false. Bilingual shared output, one generation per candidate. Evidence must appear verbatim in supplied body. New numeric strings, missing facts, malformed output or inconsistent stars reject the output. A crash after daily claim cannot trigger duplicate paid generation through automatic retries; the day stays unavailable. Failure logs are generic and never include article bodies, keys or personal data.

A truly successful collection with no eligible candidate gives `今日は、気にするニュースはありません`. Acquisition/model/validation failures give `ニュースを更新できていません`. Stopped publication or hiding all published stories is not converted into a quiet day. The same feed controls the news block on tonight.

## Persistence and deployment gate

Migration db/resolute/009_risk.sql is additive and **not yet applied**. Tables risk_control, risk_candidates, risk_days, risk_quotes, risk_hidden, risk_budget, risk_health live only in RESOLUTE Postgres. Scoped resolute_risk_writer role has no write permission on entitlements/plans. Password setup is separate and values must remain Railway variables.

New variable names: RESOLUTE_RISK_DB_URL, RESOLUTE_NEWS_ORIGIN, RESOLUTE_OPENAI_API_KEY, RESOLUTE_RISK_PUBLISH_APPROVED. Existing Vercel→Railway service/session authentication is reused. Publication requires both the approval environment gate and the owner switch. Both default off. No migration-on-startup, no implicit recurring job, no paid setup in this implementation pass. Existing public API routes remain operational without risk variables.

No backup/restore or retention guarantee for these new tables has been demonstrated against the real DB. Existing database-wide backup should include them once added, but schema + data restore and role permissions must be tested before claiming coverage. Worker failure appears in owner health and nonzero job exit; proactive operator notification wiring remains a deployment task and requires recipient/test-send confirmation.

## Cost target

Verified official GPT-5.4-mini rate on 2026-10-14: input $0.75/M, output $4.50/M (https://developers.openai.com/api/docs/models/gpt-5.4-mini). 66 stories/month × 4k input + 1k bilingual output ≈ $0.50/month. Worker reserves $0.05/attempt before a request and refunds to measured token cost after a successful response; failures retain the reservation. Monthly AI reservation ceiling $2.00, shared with manual pasted candidates. No automatic retries, no generation per user. Price changes require this bound to be rechecked.

Three-feature operating target is < $3/month incremental, not a measured promise. Local wallpaper costs no AI/storage requests. API/DB marginal RAM/CPU, collector startup duration and video hosting/traffic remain unmeasured. Provisioning and cron activation must wait until a concrete total estimate is reported. Video bandwidth depends on the final delivery host and audience; missing videos cannot be treated as zero-cost production video delivery.


Railway current resource unit prices checked against https://docs.railway.com/pricing/plans: RAM $10/GB-month, CPU $20/vCPU-month, egress $0.05/GB. Illustrative collector scenario: 2,880 runs/month, 30–60 seconds/run, 0.25 GB RAM and at most 1 vCPU consumed ≈ $0.75–1.50/month. Plus $0.50 typical AI and marginal shared API/DB resources gives roughly $1.50–2.50/month before video delivery and substantial viewer traffic. This is an assumption-based estimate, not measured Railway usage and not a hard total spending cap. Collector latency, actual CPU time, memory and traffic must be observed after enabling. Publication gate stays off until rubric and operational cost review.

Owner review includes an explicitly selected, clearly labeled visual sample for the news cards while live generation is unavailable. Samples are never returned by the API and normal customers cannot activate this owner-review context. Sample source links are disabled; sample ratings are not live ratings.

## Owner news preview revision — October 14

The owner sample now has three dated reports: Jefferies' AI valuation view (Barron’s), Barclays' Dell/HPE/NetApp downgrades (Barron’s), and ASML CFO comments on the proposed Match Act (Reuters). Short topic tabs replace repeated full headlines; full titles appear only inside the news card. Source copy separates the speaker/rating firm from the reporting outlet. Narrow screens stack field labels above text. Article-specific unapproved RIZEL drafts are shown only in owner sample mode, explicitly marked as draft previews; they are not approved or written to the live quote bank. The selected article determines its action, rather than another article's stars. Ratings/duration categories remain provisional layout fixtures, not verified live assessments. No automatic publication, mail, billing or infrastructure changes.
