# Watchlist verification — 2026-10-09 JST

## Confirmed by the user's actual devices

- The user renamed list 2 to `同期確認` and added AAPL. The list and AAPL appeared on their PC as well. Changing the displayed plan retained the list (reported 01:17 JST).
- After the pending-save recovery release `b2d51ae`, the user followed the deletion check: remove AAPL on PC, immediately visit Home, return to the watchlist, and check the phone. They reported that AAPL was absent and there was no problem (02:24 JST).
- These reports cover those operations only; they do not establish all account, browser, or connection scenarios.

## Price-alert settings — 19:30 JST

- In the signed-in cloud browser, AAPL in list 2 (同期確認) retained 200.1234 USD above after reload; editing to 210 USD above, adding 180 USD below, and removing only the below condition succeeded. A fresh tab read back only 210 USD above.
- The user changed this setting on their phone to 220 USD above. The existing cloud-browser page displayed 220 USD above without signing out. This confirms this round trip between those devices, not every failure/offline scenario.
- AAPL and the 220 USD above test setting remain in 同期確認. Delivery remains inactive.

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

## Signed-in follow-up — 2026-10-10 00:12–00:18 JST

Verified through the existing authenticated cloud-browser session; no logout,
cookie clearing, new account, payment, or notification delivery was performed.

- A new browser tab initially showed the loading placeholder, then loaded the
  account's saved lists. It did not display guest tickers in that initial view.
- Renamed list 2 to `同期確認・保存テスト`, clicked Home immediately after Save,
  returned, and read the saved name and AAPL / 220 USD above setting. The existing
  tab also received the changed name. Restored the name to `同期確認`.
- Switched to English: the same list, AAPL, sector, and 220 USD above setting
  remained; the alert explicitly said delivery was not live.
- Used the preview's own no-billing membership controls: FREE could save an
  above-price setting of 221.1234 USD. Reloading after switching to PRO retained
  the exact value. Restored 220 USD above.
- Used the one-minute expiry test. After expiry, the header became FREE and a
  newly opened PRO columns page showed the membership gate instead of full
  bodies. Reloading the watchlist retained list 2, AAPL, and 220 USD above.
- Found that the account card could keep its old PRO label after the shared
  header expired. Manual Refresh membership corrected it. The account screen
  now re-reads the server at expiry and on resume/membership changes, and
  cancels stale responses. Post-deployment verification is pending.
- Returned the test account to owner mode and the language to Japanese.

Limits: these are same-session cloud-browser checks, not new phone/device,
real billing, offline reconnection, or account-switching acceptance. The prior
user-confirmed phone round trip above remains the separate cross-device evidence.

### Concurrent-tab conflict — 00:19–00:21 JST

Two tabs submitted different temporary names for list 2 concurrently. One saved
`同期確認・競合B`; the other retained its draft `同期確認・競合A` with the explicit
conflict notice and disabled editing. Using the saved-list recovery action
returned the latter tab to the B version without overwriting it. Renamed the
list back to `同期確認`; AAPL and 220 USD above stayed present. This verifies this
actual same-browser race, not simultaneous edits across separate devices.
