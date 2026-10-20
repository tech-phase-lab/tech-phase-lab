# Membership expiry and notification lifecycle — October 20, 2026

Account and registration routes now preserve the server-provided access expiry in
initial rendering. Actual PRO members can read that timestamp in JA/EN with an
explicit Japan timezone. Owner mode and preview test memberships do not present
synthetic expiry as a paid period. This is an access end time, not a receipt,
subscription renewal date, or proof that payment integration is complete.

Notification configuration now rejects missing or elapsed PRO expiry before
contacting the monitor. On the client, expiry timers ask the server again so a
renewal is recognized. The browser timer ceiling (approximately 24.9 days) no
longer causes a premature PRO-required display. Confirmed membership loss,
service unavailability, and an unconfirmed device registration remain distinct.

Each inspection aborts and supersedes the previous read. Older configuration and
device-status responses cannot overwrite a newer membership result. Window focus,
page restoration, network recovery and visibility restoration trigger a coalesced
inspection. A running device action invalidates older reads and defers new
inspections until the action settles. Device-registration lookups share a bounded
timeout. Connection failures offer an explicit retry.

Behavioral regression tests cover stale configuration and device responses,
renewal, actual expiry, timer ceilings, unavailable services, wake-event batching,
cleanup and invalid expiry. Account rendering tests cover both languages and
exclude owner/test/invalid timestamps. These are simulated lifecycle tests, not
real smartphone push-delivery or new-login acceptance evidence. No notification
was sent, billing activated, or member metadata changed in this work.
