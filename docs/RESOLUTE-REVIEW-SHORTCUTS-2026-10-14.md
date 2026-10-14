# RESOLUTE owner review shortcuts — 2026-10-14

The owner preview at `/resolute/review` now offers direct buttons for the rule wallpaper, rulebook and tonight screen. If no plan exists, clicking a shortcut explicitly creates a fictional preview fixture through the same plan validator. Existing plans are never replaced. The ordinary diagnosis still starts unanswered when no plan has been saved or loaded.

Owner-only device persistence is opt-in through the checkbox above the preview. Saved plans (including answers and financial amounts) and saved notification settings are stored locally under `resolute-owner-review-v1`, versioned and validated before restoration. Unsaved quiz progress, photos, session credentials and real customer data are not added to this storage. Unchecking deletes the local copy while retaining current tab state. Storage failures are displayed; they do not prevent memory-only review. This supersedes earlier statements that owner preview data always disappears on reload.

This is not customer plan persistence or a change to entitlement checks. The workspace still mounts only after the existing exact-owner preview authorization. No plan/notification writes reach the real APIs or DB and no email is sent. Device copies are not encrypted and the UI asks the owner to use a personal device. Same-origin storage is not an access-control boundary. Reloading on another browser/device or clearing site data does not restore this copy.

The sample uses fictional JPY assets of 10,000,000, invested amount of 3,000,000, tolerance of 30%, stock cap of 20% and three purchase lines. It is only for reviewing the design, not an investment recommendation. No fees, infrastructure, other teams' surfaces or main branch are changed.
