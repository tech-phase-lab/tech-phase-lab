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

## 2026-10-14: direct selection, erasing and rectangular boxes

- Saved article text selection now opens the bottom pen tray automatically, without first pressing Annotate. Stable article padding and memoized text keep opening the tray from shifting the selected text.
- Color, four pen tools, and erase/undo are separate rows with touch-sized targets. Whole paragraph expands a selection within its paragraph/heading/metadata cell.
- Tapping an existing text mark makes Erase marks available; selecting marked text can erase overlapping annotations. Manage marks also opens and scrolls to the individual deletion list. Session undo can restore deletion.
- Box marks use a noninteractive measured overlay: one rectangle for each wrapped text block, with no per-line outline protrusions or added text height. Resize/font changes recalculate geometry. A new box on the same text block replaces its prior box parts; marks on other blocks and other pen types are preserved. Print view recomputes boxes in its own layout.
- Native mobile selection handles remain controlled by the browser. Physical iPhone handle smoothness is not claimed as verified.

## 2026-10-14: precise erasing and usable selection tools

- Erase selection subtracts only the selected character intervals, splitting stored annotation parts and keeping unselected text, other blocks and attached notes. Tapping a mark without a text selection instead offers the distinctly named Delete this mark action. Undo restores the original record. Added exact-range, overlapping-selection, persistence and Unicode regression checks.
- Box fragments keep distinct geometry after partial deletion; split passages use line fragments so an erased gap is not enclosed again by a merged bounding rectangle.
- Pen-tray pointer handling preserves native selection for touch as well as mouse. Color changes explicitly restore a cloned native Range while the memoized text DOM stays unchanged; real deselection clears that snapshot.
- Replaced Whole paragraph with Select this line, measured from rendered grapheme positions at the start of the selection. It does not select the rest of a wrapped paragraph.
- Rebuilt the tray as four equal icon-and-label tool buttons, round color choices, a separate line-selection pill, and two equal erase/undo buttons. Touch targets remain at least 44px on phones. No gold brand styling.
- Re-run final integrated gates and live regression checks before reporting completion; physical mobile selection remains a separate unverified check.

## 2026-10-14: compact tools and visual line boundary
- Tool top row is red/yellow/blue, Select this line, Done; removed the instruction header.
- Read individual glyph client rectangles rather than a bounding union at wrapped boundaries; ignore zero-width caret rectangles and stop at the first adjacent line. This prevents a following-line currency symbol from entering the selected range.
- Opening the site menu clears the native selection and closes the pen tray without deleting marks or a pending memo draft.
- Physical iPhone selection still requires device verification.

## 2026-10-14: separate personal notes
- Personal notes have a dedicated always-visible section and shortcut, separate from the collapsed underline/highlight/box manager. Note text comes first; its referenced passage is expandable. Edit/delete remain available per note.
- Existing storage, export, undo and changed-passage access checks are preserved; no data migration.
