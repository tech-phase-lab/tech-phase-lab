# Company watch: proposed assessment updates (not implemented)

UI delivered: rounded/system ticker font stack with Geist Sans fallback, shorter ticker tiles, related news collapsed by default and fetched only while open. Quotes remain unchanged until Twelve Data integration.

Current boundary: MU facts and PRO analysis are manually saved. New earnings or material news do not recalculate them. The public news readout polls while open; that interval is not source-to-publication latency. Green directory dots indicate source-checked research, not collector heartbeat.

Proposed next product slice, requiring agreement before changing the analysis system:
- Earnings: show actual versus prior/consensus/guidance with explicit fiscal periods, then explain the effect on growth, profitability and financing. Consensus only when a licensed source supplies it.
- Small developments: qualification versus sampling versus production, order/contract scope, capacity schedules, financing terms. Use existing collected records first; separately coordinate collection expansion with the news owner.
- Assessment history: event, changed fact, affected thesis, prior view, revised or maintained view, source and assessment timestamp. Reporting a claim must not turn it into an established company fact. Missing evidence must not produce an invented score change.
- Speed measurement: source publication -> first observation -> fact extraction -> analysis publication -> first UI observation. Record actual timestamps separately; no promised latency until measured on new events. Fast factual publication and deeper analysis completion are distinct.

No new alerts, collectors, subscriptions or automated scoring are implemented by this UI change.
