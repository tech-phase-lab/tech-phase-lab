# Tech Phase Research launch readiness

This checklist prepares the existing preview for a later launch without moving it into production.

## Done in the development preview

- [x] Branded Next.js application and bilingual research workspace.
- [x] Company search, saved stocks, calendar, SEC research, historical source-linked notes, and labeled delayed market widget.
- [x] Fail-closed private review APIs; member delivery, billing, news feeds, and incident webhooks remain disabled by default.
- [x] Preview-branch checks for lint, JavaScript tests, Python service tests, and production-mode compilation.

## Before selecting a public domain

- [ ] Choose the exact brand domain and confirm registrar ownership, DNS access, renewal, and recovery contacts.
- [ ] Decide the public information site and authenticated product hostnames (for example, root domain plus `app.`), including Japanese and English URL strategy.
- [ ] Review Vercel project name, team ownership, Git integration, production branch, deployment protection, and environment-variable scopes.
- [ ] Ensure preview and production use separate credentials and data stores. Do not put API keys in `NEXT_PUBLIC_*` variables.
- [ ] Test the domain on a production candidate before switching aliases: HTTPS, redirects, canonical URLs, language routes, robots/indexing, and mobile pages.

## Before opening paid access

- [ ] Obtain written commercial display, translation, summary, derived-analysis, caching, and retention terms for each paid data source.
- [ ] Keep price data visibly marked by source and delay. Never use delayed prices to trigger a breaking-news classification.
- [ ] Review every launch research note against its current primary source; retire stale examples and show review dates.
- [ ] Complete authentication, account recovery, privacy, terms, subscription cancellation, tax and payment handling, support contact, and access-control review.
- [ ] Run end-to-end acceptance checks for Japanese/English, desktop/mobile, authentication boundaries, billing state, and accessibility.
- [ ] Define an operator for feed outages, stale schedules, security reports, refunds, and rollback; rehearse a rollback against a preview candidate.
- [ ] Approve the final production release explicitly, then attach the chosen domain to that release and verify DNS/TLS before announcing it.

## Release rule

A successful preview build does not by itself mean the product is ready for public or paid use. Domain registration, production aliases, paid services, commercial feeds, and external notifications stay off until their specific terms and launch checks are complete.
