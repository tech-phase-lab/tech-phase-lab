# News display requirements

Owner correction, 2026-10-02:

- Render the selected language only. One economic release has one calendar row;
  a verified official result replaces the corresponding social flash.
- Green labels describe the news category. Company tickers may follow the category.
  Never put X account names, publisher names or an index name in the category field.
  Keep the index identity in the story itself.
- A news-row click expands its published story inside Tech Phase. It does not
  navigate to a source site. Keep source metadata for internal evidence.
- Show the complete approved story when one exists. A headline-only record does
  not constitute a full-article translation; never invent missing article text.
- Use concise, natural Japanese without repeated company/parenthesized tickers
  or endings such as `（$WBD）。`. Preserve planned/completed status.
- The home strip uses optional short copy and opens the published detail in place.
  Fall back to the full headline with CSS ellipsis when shortening loses meaning.
- Presentation rules live in the display code. Translation prompts contain the
  language task and source-fidelity requirements; optional short-copy instructions
  do not repeat the main translation policy.
- Missing or invalid optional short copy never suppresses a news item. Preserve
  numeric, sign, unit, negation and status checks independently of display copy.

A deployment or synthetic test pass is not evidence of live delivery speed or
complete source coverage. Existing acquisition and translation budgets remain
subject to their separately recorded authorization.
