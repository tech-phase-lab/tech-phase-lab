import "server-only";
import type { ResultBrief } from "./market-results";
import { checkedBriefs } from "./earnings-results-history";
import backfill from "./earnings-results-history.json" with { type: "json" };

/** The committed SEC backfill of the calendar's results (scripts/research/earnings_history_backfill.py): figures only where the
 * deterministic parser read the company's own table; otherwise the results filing's link and time with no figures. */
export function backfillBriefs(): ResultBrief[] {
  return checkedBriefs((backfill as { resultBriefs?: unknown }).resultBriefs);
}
