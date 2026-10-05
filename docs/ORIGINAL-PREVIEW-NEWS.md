# Original-language preview intake

This additive lane exposes short original-language source excerpts, explicitly
unreviewed and unfinished. It does not translate, summarize, classify tickers,
assert an issuer actor, or fetch anything. Full retained text remains private.

Access: the existing authenticated monitor endpoint returns the optional lane
only for `/news?originalPreview=1`, with a configured API token and matching
bearer always required for this capability. Ordinary `/news` is unchanged. The website
requests and forwards it only when its server deployment is a Vercel preview;
a browser query cannot enable it. The preview news page is public, not a private
editor queue. No new access permission or credential is created.

The existing no-model results worker runs receipt admission every normal cycle
(including while translation and AI drafting are disabled). Every unchanged
source version keeps its first admission clock. A genuine content revision has
a separate receipt; source/transport refreshes cannot reset an existing clock.
For primary releases, version identity uses title, extracted text and source
date, not changing HTML bytes. `previewPublishedAt` is first automatic backend
preview availability, not the original source time, acquisition or browser
paint. Receipts contain compact identifiers/clocks, never source text, and are
not deleted to impose a lifetime publication limit.

Bounds: seven-day acquisition/source window, newest 200 retained rows per lane
(raw X, signal articles, primary releases), at most 30 cards. The response states
eligible and omitted counts within that bounded scan and whether a scan ceiling
was reached; it does not claim exhaustive upstream coverage. Excerpts are a
single literal fragment of at most 20 whitespace-delimited words and 100 Unicode
characters, or 40 characters when CJK is present. No second copied title/body is
sent. Missing and date-only source clocks remain explicit.

Only configured enabled publisher sources and valid current revisions qualify.
Known promotions, reposts, withdrawals, non-news routes, credential/error text,
unsafe URLs and retained publisher taxonomy denials are excluded. Explicit primary
source holds bind canonical aliases; discovery or failed translation alone does not.
Only actually emitted, validated verified cards take precedence over originals.
Analyst source URLs are resolved privately from emitted current IDs for deduplication. Verified
sections and their byte budgets are preserved before this optional lane is added.
Reads do not create receipts or perform new schema/data writes. This statement
covers the new projection; pre-existing verified-news lifecycle behavior is
unchanged.

Validation: `python3 -m unittest discover -s tests -p test_original_preview_news.py`
uses only synthetic repository fixtures. It exercises actual collector saving,
the default no-model result loop, immutable receipts, read-only projection,
revision/withdrawal/ownership behavior, precision, limits and verified feed
preservation. Full integrated release checks are still required before rollout.
