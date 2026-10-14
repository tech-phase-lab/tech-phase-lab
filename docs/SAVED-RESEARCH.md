# Saved research

## 2026-10-14: appearance pass

- Scope: `/research#saved` only. Navy panels, mint and cyan accents, compact ticker-led cards, bilingual collection heading and saved count. Selected cards and keyboard focus use matching mint.
- Empty collection has a bookmark illustration and an Explore research action. A nonempty collection with no filter matches still offers Clear search and filters. No fabricated saved articles.
- Search is 16px to avoid mobile input zoom; touch controls have generous targets. Mobile cards stay in one column. Reduced-motion preference disables card transitions.
- Existing browser storage key and membership checks are unchanged. Cross-device/account sync is NOT implemented. The page retains a short, accurate browser-only storage note.
- No news acquisition, translation, delivery, company-introduction data or RESOLUTE changes.
- Next: account-bound persistence, saving timestamps, list scroll restoration, and saving entry points for other content types. These are not part of this appearance pass.
- Verification: run repository gates on the final integrated tree before preview publication. Publication and browser verification must be reported separately from implementation.

## 2026-10-14: FREE plan styling correction

- Saved research uses navy, mint and cyan. Gold is reserved for PRO and RESOLUTE.
- Header copy explains collecting useful articles for later reading; existing storage and access rules remain intact.
- Removed the preparation label from the capital-map benefit in both Japanese and English PRO plan copy.

## 2026-10-14: personal annotations and PDF print view

- Saved article detail: underline, highlighter, box and notes; red/yellow/blue; hide/show, individual deletion and 30-step session undo. No gold styling.
- Enable Annotate, select text (long-press on touch), then choose a tool. Selection tools appear at the bottom of the viewport. Notes can be edited. Text wraps naturally at different widths.
- Versioned per-article/per-language browser storage; storage errors are reported. No account sync or server storage. Existing saved IDs are unchanged. Concurrent-tab writes are rejected rather than silently replacing newer annotations.
- Anchors include text path, length, fingerprint and exact quote. Changed passages are not assigned old offsets. Unmatched records are retained; their quoted content is not displayed in the annotation list or export. Access to PRO text continues to use the existing membership gate; only current rendered content is exported.
- PDF save opens a clean white print view with the visible text marks, selected language, article dates, source links and personal notes. User chooses PDF in the system print dialog; on iPhone, share the print preview to Files. This is a browser print flow, not a generated PDF download or automatic write to the phone. Hidden marks are excluded. Exported personal text uses DOM textContent, not HTML interpolation.
- Deferred: selected-region image export and cross-device sync. iPhone/Android physical-device print and selection validation remain required.
- Added anchor/overlap/Unicode/corrupt-storage regression checks. Run all AGENTS gates on the integrated tree before publication; live selection/reload/export verification follows deployment.

## 2026-10-14: explicit save entry point

- Article cards now show Save / Saved beside the bookmark icon.
- Article detail begins with a labelled Save article button, saved confirmation and a link to the saved collection. This stays outside the annotated body so existing text anchors do not shift.
- Empty collection instructions describe the actual open-article → save → collection flow. Storage failures are also shown beside the detail action.
- Opening an article remains a read action; storage is changed only through an explicit save action.

## 2026-10-14: continuous annotation flow

- Saving from article detail immediately enables annotation and PDF tools in that same view; returning through the menu is unnecessary.
- Editing toolbar stays at the bottom from opening to completion, with a Done action and safe-area spacing. Selection preview reserves its height.
- Memoized article text stays stable while selecting/changing colors; selection scanning is debounced until native selection pauses, and mouse tool clicks preserve the text range. Physical mobile handle behavior still needs device verification.
