# RESOLUTE home — preview publication authorized

Owner reviewed the change summary and authorized preview publication on October 17.
RIZEL comments remain hidden pending owner-supplied approved wording. Production
renewals and the 07:00 update remain incomplete. Work is on
`codex/research-preview`; main untouched.

## Implemented

- Root RESOLUTE entry and initial authenticated owner workspace now show home.
  Diagnosis moved to `/resolute/diagnosis`, with existing draft-preserving owner
  workspace and saved settings retained. Internal diagnosis links updated.
- Home follows supplied `resolute-3features-v2.zip` and home screenshot: anchor,
  TODAY, four YOUR RULES tiles, three ALERTS rows, quiz and disclaimer footer.
  Language/menu controls remain below the home content. Mock mode buttons omitted.
- Owner home shows the existing dated three-news fixture (two on home), explicitly
  marked provisional and not live. Real customers use the entitlement-gated feed.
- Star colours 1–5; any article >=4 adds red border and amber rules reminder.
  Staggered entry, star twinkles and ambient background; reduced motion disables
  animations, transitions and press transforms. No needle or icon movement.
- Current JST date is real; no sample expiry or market judgement. Alert expiry and
  morning setting only use actual snapshots. The unconnected gauge has no needle.
- Expired alert access locks news. Display-only renewal offer resolves actual Clerk
  private metadata on server, without owner preview overrides. No order/access
  mutation. **Renewal remains disabled because production checkout is not live.**
- Diagnosis result links to wallpaper after save. Tonight omits its entire news
  section on missing/failed feed. Risk footer uses the newly approved exact text.
- Existing preview article copy unchanged. **Preview RIZEL comments are all marked
  approved:false in source. They no longer bypass approval filtering.** No draft
  was silently approved; approved feed comments still display (up to two reasons).
- Local font subsets preserve existing glyphs and add new home/weekday glyphs.

## Verification

Local real-component browser harness with mocked access/feed responses:
320/390/430px, JA/EN home, no horizontal overflow or tile text/icon overlap;
three news tabs; tonight missing-news omission; wallpaper navigation; no JS errors.
Separate component checks: high-risk styling, expired lock hides articles,
server-provided PRO amount, and zero animations under reduced motion.
This is local UI evidence, not proof of production API or payment operation.

ESLint: 0 errors, 2 existing unrelated warnings. Node: 969 passed. Python: 2474
passed. Production build passed again after final font expansion; final build result
is in `/tmp/resolute-home-final-build.log`. compileall and diff check passed.
QA images and harness: `/tmp/resolute-home-qa/`; logs `/tmp/resolute-home-*.log`.

## Still separate / not enabled

- Weekday 07:00 JST risk publication runtime has NOT been verified. Existing
  three-feature spec describes `0 22 * * 0-4` UTC as proposed, not provisioned.
- Production checkout/entitlement grants and email delivery are not activated.
  Existing secure Sandbox member-order flow and payment checks were not changed.
- Need reconcile approved RIZEL wording with source approval flags before claiming
  RIZEL comments are finished. Do not invent new comments or mark drafts approved.

## 2026-10-18 JST — Match Claude's original star animation

Replaced the approximate text-shadow animation on home and news with the supplied
`resolute-reference-v2/home/index.html` star/twinkle keyframes: 0.5s entrance,
6s sparkle cycle, original easing, 1.35 scale and 6px pale-gold drop shadow.
Adjacent stars start 0.12s apart (previous approximation: 0.28s). Home row start
times match the reference: 0.60s first row, 0.95s second normal row, 1.30s second
high-risk row. Reduced-motion still disables animation. No copy, publication,
pricing, or private review configuration changes. Source keyframes and animation
parameters compared directly with the supplied HTML. Browser launch unavailable
(missing Chromium); mobile visual motion is not claimed verified.
