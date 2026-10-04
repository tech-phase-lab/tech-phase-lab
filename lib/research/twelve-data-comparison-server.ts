import "server-only";
import { unstable_cache } from "next/cache";
import { normalizeTwelveComparison, prepareTwelveComparison, twelveComparisonRevision } from "./twelve-data-comparison";
import { prepareTwelveDisplay, type TwelveComparisonBundle } from "./twelve-data-financials";
import { comparisonScores } from "./comparison-scorecard";
import { currentComparisonAnalysis } from "./comparison-analysis";

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

// Called once by an ingestion job for its saved bundle, reused across all comparison pairs.
const display = unstable_cache(async (bundle:TwelveComparisonBundle) => prepareTwelveDisplay(bundle),
  ["twelve-comparison-display-v1"], {revalidate:86400});
export async function prepareTwelveComparisonForDisplay(bundle:TwelveComparisonBundle) {
  const saved=await display(bundle);
  const now=Date.now();
  const financials={...saved.financials,preparedAnalysis:currentComparisonAnalysis(saved.financials,now)};
  // Serving a cached result must not preserve an expired market score or bullet.
  return {...saved,financials,scores:comparisonScores(financials,now)};
}
