# RESOLUTE entry from the redesigned Tech Phase home

The existing home card points to `/resolute`. On preview deployments this server-rendered entry now checks the existing Clerk session and redirects only the exact authorized owner to `/resolute/review`. The owner can inspect the tools without buying RESOLUTE or performing another login while the Tech Phase session remains valid.

No changes to the new home design, its labels, other cards, news or menus were required. Signed-out users, other members (including PRO and administrators), and production deployments retain the ordinary RESOLUTE entitlement checks. Anonymous identity cannot be inferred; an expired session still requires owner authentication. There is no secret URL, browser-claimed owner flag, purchase grant or new authentication credential.

The review workspace remains isolated from real plan and notification writes. Its existing direct tool shortcuts and opt-in device storage remain available. This change does not enable emails, paid jobs or production data services.
