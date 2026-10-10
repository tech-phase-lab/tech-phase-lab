# PRO question board — 2026-09-29

New questions are shared only among PRO members. Next API requires signed-in PRO membership for reads and writes. New clients must explicitly submit audience=pro-board; old private-form requests are rejected rather than silently published. Backend uses trusted service authentication.

Existing SQLite questions migrate with audience=private and remain visible only to their original owner and the administrator. Board responses never return owner keys. Moderator closed status immediately excludes a post from board results; clients refresh every 60 seconds and on focus. Restoring pending returns a board post. Ten new posts per owner per UTC day; retries are idempotent. Public display includes no member names.

This supersedes previous handoffs describing all new questions as private intake. Do not restore Free posting or auto-publish historical private questions. Answer selection remains optional. No paid APIs activated. Stock News API is not the price feed required for thematic performance tracking.
