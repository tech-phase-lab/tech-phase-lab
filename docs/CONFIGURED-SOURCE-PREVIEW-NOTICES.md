# Configured-source metadata preview notices

This local patch extends the existing **preview-only, capability-gated** original
lane. It does not enable production, fetch a provider, translate a headline,
license content, alter a hostname circuit, or change source/budget configuration.

## Added retained-evidence paths

- Configured issuer article URLs with a retained, safe title can publish a
  metadata notice before the linked body succeeds. Missing source dates stay
  unknown. The body/error is not copied. Existing held/rejected/withdrawn source
  and canonical-alias decisions remain authoritative. Current feed/index titles
  are retained separately from the historical first title/body/review evidence.
  Title-only withdrawals and unsafe current titles revoke the canonical family;
  absent titles do not erase a known withdrawal. A bounded canonical-family
  lookup binds notice age, source link and known date to the earliest retained
  discovery, including aliases outside the recent scan.
- TWSE disclosures require the exact configured endpoint, company code, strict
  date/time/hash query, current inline revision digest, and matching retained
  title/date/company/time fields. Their class is **exchange disclosure**, not an
  issuer IR article. The link opens the configured source endpoint with the
  retained record identity; it is not represented as a standalone article URL.
- The two configured Nebius document roots require enabled official-document
  configuration and a matching, complete current retained event/body digest.
  They are **official document metadata**. The collector's configured document
  name is a source label, not a scraped headline. No publication date is invented.
- The four exact Nebius PDF seeds in `sources.json` are **seeded document
  metadata**, with their configured historical publication dates. No arbitrary
  asset URL, query parameter or PDF is admitted. A missing original title stays
  absent. An old discovery does not become new when this patch is installed.

Only the existing writer creates immutable publication receipts. A metadata
notice that was published first remains one notice when its body arrives;
availability improves without changing first acquisition or publication clocks.
Original body cards that were published first keep their existing path.
Actually emitted verified cards always take precedence. No original/notice is
added to the home/news header or production response.

## Limits and explicit remaining gaps

This is **not all-items delivery** and is not an exhaustive historical queue.

- The unchanged selection window is seven days, scanning at most 200 rows per
  retained lane before filters. This patch adds two bounded metadata lanes, so
  the maximum eligible-in-scan counter is 1,200. The per-lane scan limit and
  total card/response bounds stay unchanged.
- The newest 30 canonical candidates are selected **before** visible verified
  URL suppression. Only selected candidates receive receipts. Verified overlap,
  missing receipts and byte trimming can all reduce the displayed originals.
- The API still has a 30-card bound and 450 kB target / 500 kB hard payload limit.
  Five-card UI pagination pages only this returned feed; it does not access older
  retained receipts. Receipts are not deleted by this patch.
- A bounded, cursor-addressable history endpoint plus writer-side resumable
  admission would be a separate change. It needs stable snapshot/cursor semantics,
  revision/denial revalidation, verified-card precedence, overflow accounting,
  capability gating, payload budgets and cancellation-safe client navigation.
  Increasing a constant or unbounded database reads is not a substitute.
- Failed first HTML child fetches lack a retained title/date contract. This patch
  does not invent titles from slugs or call URL discovery a fetched article.
- SemiAnalysis remains excluded: `reuse=permission-required` does not establish
  a license or an existing bibliographic publication authorization. No body,
  title or excerpt is redistributed through this patch. Operator action is to
  establish the permitted use/notice contract before adding a public path.
- Disabled Marvell Blog and TSMC Press Center signal routes remain unchanged;
  technical access restrictions are not bypassed. Existing primary fallback
  behavior is unchanged. No source expansion or X query/budget changes occur.

## Verification scope

Synthetic Python fixtures prohibit source fetches, DNS and socket access. The
focused gate also runs under an original-URL (pre-proxy), DNS/socket audit guard
and reports attempted external requests. Frontend tests render notices, reject
malformed/query/source/date/class/secret inputs, preserve two distinct TWSE
identities, and check production/official-only/header isolation and existing
card bounds. These are offline assertions, not proof of live delivery or complete
runtime acquisition. Aggregate integrated gates and live review belong to the
integration owner before publication.
