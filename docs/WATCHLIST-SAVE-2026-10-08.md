# Watchlist save and sync — 2026-10-08

Scope: watchlist persistence only. No news, targets, ingestion, translation or delivery code changed.

## Changes
- Extracted the existing cloud save queue into a disposable, testable controller.
- Edits remain serialized; each successive save uses the acknowledged revision.
- A stale in-flight read (including a failed read) cannot replace the status or document of a newer edit.
- If a save response was lost, a retry that finds the exact same document on the server acknowledges that save. A different document or account still stops as a conflict; no automatic overwrite or merge.
- Requests have a 12-second client timeout. Network recovery retries pending work; returning to a visible tab refreshes clean state.
- Disposed mounts cannot publish late results or send the remaining queued edits.

## Verification limits
Controller tests use simulated transport responses. Existing Python tests cover persistent storage, revision conflicts and owner isolation. These are not proof of live multi-device synchronization.
Actual signed-in account, separate-device round trips and mobile app lifecycle still require observation. Guest UI persistence is checked separately on the deployed page.
Pending edits remain in memory and retain the existing browser unload warning. Durable offline drafts and automatic conflict merging are not implemented. Price alerts are saved settings only; notification delivery is not running.
