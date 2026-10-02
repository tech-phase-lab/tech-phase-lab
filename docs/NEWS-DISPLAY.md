# News display requirements

Owner correction, 2026-10-02: Japanese headlines should be concise. Avoid
repeating a company name and its parenthesized ticker, particularly endings
such as `（$WBD）。`. For the current Nasdaq-100 announcement, use the index
name as the label and `追加予定 $MRNA　除外予定 $WBD` as the headline. Keep
scheduled/completed status, signs, digits, units and instrument associations.

The home rotation should use a short informative headline; clicking it expands
the complete published headline (not an article body). Ellipsis is only a
narrow-screen fallback, not a substitute for writing a concise headline.

Implementation checkpoint: market-news-display handles the exact existing
Nasdaq-100/S&P 500 scheduled-add/remove template for both list and rotation.
Unknown wording, effective dates and extra facts are preserved instead of
silently discarded. The current four official stories in the latest-five
rotation have editorial short Japanese headlines in official-news-ja.ts.
Future official-headline and X market translations now request optional Japanese
and English short headlines in the same provider call as their complete copy.
They are not tied to a known URL. Before publication, numeric/sign/quantity,
known semantic/qualifier, ticker and bilingual checks run; X copy also retains
market-specific maturity, index-role and original-post validation. These checks
catch specified contradictions but do not prove arbitrary semantic equivalence.
Short copy is bound to the exact source revision and original headline input.

Missing, unsafe or malformed short copy falls back to the complete headline and
CSS ellipsis, without withholding the story or creating an extra model retry.
Click still expands the complete headline. No arbitrary text slicing is used.
Older cached translations, result briefs and the separate reviewed general-news
pipeline may use this full-headline fallback; existing approved material is not
regenerated just to obtain a short title. When a research/result headline replaces
an official title, any short title derived from the old title is discarded.

The shared call cap and source-monitor schedule are unchanged. The official
headline response allowance is 600 tokens (previously 300) to fit the optional
pair; its existing output-limit retry remains 1200. No additional provider call
is requested solely for shortening. This worker change must be recorded within
the existing 24-hour observation window; synthetic new-story tests do not prove
future live delivery or full-day acceptance.
