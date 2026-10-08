# Watchlist verification — 2026-10-09 JST

## Confirmed by the user's actual devices

- The user renamed list 2 to `同期確認` and added AAPL. The list and AAPL appeared on their PC as well. Changing the displayed plan retained the list (reported 01:17 JST).
- After the pending-save recovery release `b2d51ae`, the user followed the deletion check: remove AAPL on PC, immediately visit Home, return to the watchlist, and check the phone. They reported that AAPL was absent and there was no problem (02:24 JST).
- These reports cover those operations only; they do not establish all account, browser, or connection scenarios.

## Automated coverage

`tests/favorite-sync.test.mjs` exercises delayed reads, serialized edits, lost responses, account isolation, conflicts, and tab-local pending-save recovery after controller disposal/remount. Additional resume coverage checks retrying a failed save on page return, overlapping wake-ups, and preserving conflicting edits without automatic writes.

Pending changes use account-scoped `sessionStorage`, separate from guest favorites. A fresh server response must establish the account before restoring its pending changes. Recovery only continues against the same revision or an exact matching previous save. Other changes remain in conflict until the user explicitly discards the pending draft in favor of the saved list.

## Still unverified / limits

- Real-device offline editing and reconnection; simulated transport tests are not device verification.
- Real-device simultaneous edits and account switching with unsaved changes.
- Tab closure or browser/process termination recovery: the tab-local journal is not a durable cross-session backup.
- Stock-price data: Twelve Data is not connected. Normal missing prices remain `—`; sample prices/charts are fictional.
- Price-alert delivery is not running. Only settings are stored.

## Scope boundary

Claude owns news, target prices, and the current Home/menu decoration work. Do not modify those as part of watchlist reliability work. Work on `codex/research-preview`, preserving collaborator changes and following `AGENTS.md` publication checks.
