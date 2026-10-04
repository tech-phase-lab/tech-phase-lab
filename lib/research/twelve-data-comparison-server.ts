import "server-only";
import { unstable_cache } from "next/cache";
import { normalizeTwelveComparison, prepareTwelveComparison, twelveComparisonRevision } from "./twelve-data-comparison";

/** Ingestion-side preparation, intentionally not connected to the comparison route yet.
 * Feed a verified API response here after the licensed server-side collector is enabled.
 * No user/comparison ID in the key: MU's prepared evidence is reused for every pairing.
 */
export async function prepareTwelveComparisonPayload(ticker: string, income: unknown, cashFlow: unknown = null) {
  const snapshot = normalizeTwelveComparison(ticker, income, cashFlow);
  const revision = twelveComparisonRevision(snapshot);
  const prepared = await unstable_cache(async () => prepareTwelveComparison(snapshot),
    ["twelve-comparison-preparation-v1", ticker, revision], { revalidate: 86400 })();
  return { ...prepared, snapshot };
}
