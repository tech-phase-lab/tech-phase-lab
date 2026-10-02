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
Other incoming stories fall back to their published headline: automatic short
headline generation for every future story is not implemented. Do not claim
otherwise. The acquisition/translation workers and acceptance window were not
changed for this display-only patch.
