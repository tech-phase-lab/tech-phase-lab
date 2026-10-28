# News review with the existing owner login

`/research/review` reuses the existing verified Clerk administrator session for
news review. Reloads and new tabs on the same site therefore do not require an
editor token while that session is valid. No new credentials or cookies are
issued, no token is stored in browser storage, and the Clerk session lifetime is
not extended. Sign out through `/research/account`.

The existing `getMembership()` check is authoritative on every request. Only a
signed-in account that the existing server-side `resolveAdmin` policy recognizes
is accepted. FREE/PRO membership, browser role fields, and caller-supplied bearer
headers do not confer access to the owner route. Removing the admin role or
ending the Clerk session rejects subsequent requests. The review UI clears its
private loaded state when the existing membership provider reports loss of the
owner session and requests immediate membership revalidation after a rejected
owner API request.

## Exact access scope

The new `/api/research/editor-owner` route calls the existing editor handler with
`RESEARCH_EDITOR_TOKEN` taken only from the server environment.

- GET with no `kind`: existing official-IR brief queue.
- GET `kind=news`: ordinary-news drafts/reviews.
- GET `kind=signals`: existing saved-source and price-target diagnostics.
- GET `kind=official-research`: existing official-research diagnostics, including
  pipeline and terminal-review results.
- POST actions: `generate`, `draft`, `review`, `news-generate`, `news-retry`,
  `news-draft`, `news-review`.

The underlying handler still applies its bounded filters, payload validation,
source/revision checks, verification requirements, publication switches, and
existing generation budgets. The verified Clerk user ID replaces a
browser-supplied reviewer name for `review` and `news-review` audit records.

Annual-report and post-desk reads and writes are explicitly denied by the new
route. `/research/editorial`, `/api/research/editor`, and existing direct-token
clients are unchanged. The annual-report tools in `/research/review` still use
the original in-memory token flow under “年次報告書・従来のトークン認証”.

## Request protections

Mutations require an exact matching Origin and an `application/json` body.
Cross-site/same-site-other-origin Fetch Metadata is refused. Read requests also
reject an explicit foreign Origin. Bodies are streamed with a 64 KiB byte limit.
The response is `private, no-store` and varies by Cookie; upstream cookies and
authorization headers are never forwarded. Errors do not return credential or
identity-provider failure details. No CORS grant is introduced.

## Release checks

- Confirm the intended owner can already sign in to the existing Clerk account
  on the deployed site's origin and has the existing admin role.
- Confirm the existing server editor credential is configured without displaying
  or copying it. Missing/invalid configuration fails closed with `setup-required`.
- Run the repository's full lint, Node, Python, compile, diff, and build gates.
- In the deployed browser, verify a read-only review reload and a second tab
  without token entry; then verify signed-out and ordinary-member requests fail.
- Do not claim the session remains valid indefinitely: expiry, revocation,
  browser-cookie deletion, a different browser/profile, or a different site
  origin can require the normal account sign-in again.

The regression tests use synthetic credentials and mocked identities only;
production browser/session verification is a separate release check.
