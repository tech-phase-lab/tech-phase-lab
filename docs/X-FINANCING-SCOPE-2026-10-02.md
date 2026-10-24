# X financing intake scope

Owner instruction at 2026-10-02 20:57 JST adds financing and convertible debt
to the market-reporters intake. Before this instruction these topics were
outside the requested X scope. The Wall St Engine AVGO post
`2105965357492232306`, published at 10:17:22 UTC, was not a miss against the
previously agreed scope. Do not relabel it as a timely-delivery failure.

The existing Wall St Engine / TipRanks / FABYMETAL4 aggregate now searches for
資金調達, 転換社債, funding, financing, fundraising, capital raise, convertible
notes, convertible bonds and convertible debt (including senior/unsecured
adjectives and singular forms). Its search uses convertible with a precise
parser filter rather than plural-only phrases. Its query is 440 characters,
within the adapter's 512-character limit. The post parser accepts these topics
only with the new financingUpdates flag and a monitored company match. The
private editorial queue labels them 資金調達・転換社債. Full source text and its
original publication timestamp retain proposals, cancellations, uncertainties,
signs, digits and amounts; no rewriting is performed during intake.

This change extends acquisition into the existing private editorial queue.
It does not establish automatic bilingual public publication for these new
reporter topics, nor prove end-to-end translation fidelity. Do not claim these
posts have been displayed publicly based on acquisition alone. Existing
price-target/earnings publication paths and restricted TrendSpider/Barchart
topics are unchanged. Request limits and pacing remain unchanged.

Synthetic checks cover proposed, unsecured, cancelled, completed and Japanese
financing wording, X-only monitored companies, unrelated companies and an
unrelated use of “convertible”. Live acceptance must use new information;
backfilled old posts are not latency successes.
