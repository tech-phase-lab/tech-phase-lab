# RESOLUTE AI spending cap

Owner approved a combined USD 5 per calendar month for news summaries and
RIZEL selection on October 17, 2026. Months use Asia/Tokyo. This does not alter
other Tech Phase budgets, OpenAI account billing, or automatic top-ups.

Both adapters use ai-budget.mjs and the same durable resolute.risk_budget row.
RESOLUTE_AI_MONTHLY_LIMIT_USD must be configured, positive and no greater than
5.00. Before every request an atomic SQL operation reserves USD 0.10. If the
remaining balance cannot cover that reservation, no API request is sent.
Model, output length, input bytes, paid tools and service tiers are bounded.
Known usage releases unused reservation, rounded upward to four decimals.
Failed calls, missing usage and crashes retain their full reservation. There
are no free retries. This can stop calls slightly before the nominal limit.

The reservation is based on GPT-5.4 mini standard rates of USD 0.75/M input and
4.50/M output, verified October 17, 2026. Reassess before changing prices/model.
Use a separately committing budget pool, not a transaction client used by an
article write. For selection workers use a dedicated budget connection pool so
workers waiting on article locks cannot occupy all budget connections.

AI jobs remain disabled. Risk DB provisioning/connection and actual production
usage verification are still pending. An absent DB/configuration fails closed.
No paid API calls or customer publication were enabled by this change.
