import "server-only";
import { unstable_cache } from "next/cache";
import { pickConsensus, type EpsConsensus } from "./x-post-copy";

/** EPS consensus for a just-reported quarter, from Twelve Data /earnings (the only consensus on the contracted plan; revenue consensus is Ultra-only). */
const read = (ticker: string) => unstable_cache(async () => {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  const url = new URL(`${process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com"}/earnings`);
  url.searchParams.set("symbol", ticker); url.searchParams.set("outputsize", "4"); url.searchParams.set("apikey", key);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  const body = await response.json() as { status?: unknown };
  if (!response.ok || body?.status === "error") throw new Error("unavailable");
  return body;
}, ["earnings-raw-v1", ticker], { revalidate: 600 })();

export async function loadEpsConsensus(ticker: string, briefAt: string, issuerEps: number | null): Promise<EpsConsensus | null> {
  try { return pickConsensus(await read(ticker), briefAt, issuerEps); } catch { return null; }
}
