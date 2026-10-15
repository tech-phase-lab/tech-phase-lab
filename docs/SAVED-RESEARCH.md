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

## 2026-10-14: explicit collection selection and compact article actions
- Saved view starts with its collection only. Entering/re-entering clears its independent selected article; filters never fall back to opening another saved article. Initial URL restoration uses a neutral loading surface rather than briefly rendering Home.
- Removed the saved-detail save bar and redundant saved confirmation text. Saved collection bookmark remains an icon-only removal control with an accessible label.
- Article actions are Annotate, Save PDF and a More menu for occasional ink-management/visibility actions. Notes show their complete referenced passage without an expansion step.

## 2026-10-14: compact notes and collapsed marks
- Reduced note panel/card spacing and Edit/Delete buttons to 30px height. Referenced passages remain fully visible.
- Removed the permanent 300px bottom spacer; it is reserved only while the fixed annotation editor is open. Collapsed mark management now takes only its summary height and expands with its contents.
- Selection logic, annotation storage, undo and PDF export are unchanged.

## 2026-10-14: return to collection, annotation hints and save order
- Saved detail has Back to collection; browser Back also closes the selected detail. Filters and sort remain in state. Return scroll uses the originating card's viewport offset so changing from two columns to a full-width list does not lose the reading position. Focus returns to that card. Selecting another detail replaces the same history entry.
- Saved cards show a small accessible mint pen icon when the current language has stored annotations. Same-tab and cross-tab storage changes refresh it; no note text is exposed in the list.
- Added Recently saved / Newest announcement selector. Existing saved-ID append order is reused, without migrating storage or inventing timestamps. Re-saving puts an article last in the stored order and first in Recently saved.
- Account sync remains separate; no server storage or membership changes in this pass.

## 2026-10-14: account sync
- Signed-in saved IDs and per-article/per-language annotations use `/api/research/saved`, authenticated by the existing membership server. The backend uses a distinct HMAC identity namespace and `member_saved_research` table on the existing staging persistent volume; no news acquisition, translation or delivery behavior changes.
- Guest browser keys remain intact. An explicit import action copies existing articles and annotations into the account collection, including when another device has already populated it; conflicting note IDs are copied under a new ID and identical content is not duplicated. Importing never deletes the source browser data. Account data is never written into guest keys. Initial authentication does not flash guest notes. Membership-change events immediately release the previous account view and reset notebook undo/drafts.
- Revision comparison and writes are atomic. Three-way merges preserve edits to different annotations and independent saves/removals. Same-annotation edit/edit or edit/delete conflicts stop syncing; retain the local draft, offer its JSON download, and require an explicit discard action before loading the account version.
- Account-scoped localStorage journals precede uploads and survive reload/closed tabs. A compare-before-write guard prevents another tab overwriting the pending journal. Online/focus/visible-page refresh retries interrupted saves. Lost responses are reconciled against the exact submitted snapshot. Sync failures are visibly distinct from successful synchronization.
- Server validates collection size (2,000 saved IDs, 4,000 language notebooks, 200 marks per notebook, 1 MB document), annotation fields and UTF-16 quote offsets. Private responses are no-store; backend access requires a configured bearer token even in development. Request origin and authenticated account must match before a browser write is forwarded.
- Existing article membership/anchor checks still control display and print. Pen selection, line selection, partial erasing, undo, compact notes and explicit collection opening remain unchanged. Physical phone verification is separate from automated and desktop-browser checks.
- Undo applies the inverse local change through the same merge rules, retaining unrelated remote marks. If the note being edited changes remotely, the editor offers Save as a separate note rather than replacing the updated original.
- Live verification for `262cd12`: Vercel READY and Railway staging SUCCESS; imported the existing three visible saved articles and annotations, confirmed persistence after reload, created a temporary note and observed it in a second tab, then used Undo to remove only that test addition. Original two visible MU marks remained. Removed the obsolete browser-only note footer found during this check. This is desktop/two-tab verification, not a physical cross-device test.

## 2026-10-14: find saved research by personal notes
- Saved search includes authored notes in the current language, alongside the existing title, company, ticker and summary. Stored source quotes/anchors are never indexed or exposed as snippets. Full-width input and case are normalized.
- A compact With annotations toggle filters the current-language notebooks, consistent with the card pen badge. Category, ticker and sort compose with it; Reset clears the toggle too. Other research views do not search personal notes or apply this filter.
- This is read-only collection filtering; account persistence and article annotation interactions are unchanged.

## 2026-10-14: simplify saved collection controls at user request
- Removed topic/ticker filters and With annotations from the saved view; hidden filters from other views cannot restrict saved results. Search remains, with a shorter placeholder, and sort sits beside the collection heading without a large framed control.
- Removed routine synced/guest status from the collection. Failures and conflicts remain actionable. Browser import is collapsed below the articles and only runs on an explicit click.
- Do not add, import or remove the user's saved articles or annotations for testing without a specific request. Verify this layout without changing saved data.

## 2026-10-14: article opening position and action labels
- Explicit saved-card selection waits for committed layout and places the article top below the measured sticky header with a 12px gap, on desktop and mobile. This keeps Back to collection fully visible. Initial visits still do not open an article; collection return positioning is retained.
- Annotate and Save PDF have small pen/notebook outline icons to the right of their labels. Accessible names and annotation behavior are unchanged.
- Article company links use the existing monitored-company name followed by the ticker, e.g. Micron（MU） and NVIDIA（NVDA）, without the duplicate ticker/arrow label. When the company name and ticker are identical (ASML), show the name only. Article body/annotation anchor structure is preserved.

## 2026-10-15: quieter collection return
- Back to collection uses a small muted, frameless label with a left triangle. Mobile touch height and keyboard focus indication remain, as do navigation and scroll restoration.

## 2026-10-15: dismiss selection tools and readable export
- Deselecting an article passage closes the pen tray; toolbar selection restoration and pending note drafts are preserved.
- Mobile Back to top stays at a fixed bottom-right offset above navigation instead of deriving its height from the menu rectangle.
- Export includes a mobile viewport and larger screen/print typography (18px preview, 14pt print body). The native print/PDF flow and annotations remain intact. Physical phone preview validation remains separate.

## 2026-10-15: compact print action
- Removed the export instruction paragraph and large tinted panel in both languages. A single 44px-minimum-height Save PDF / Print button sits at the upper right and stays available while scrolling.
- Controls remain excluded from printed output. Article typography, annotations and the native PDF flow are unchanged.
