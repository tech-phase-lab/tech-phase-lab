import "server-only";
import { unstable_cache } from "next/cache";
import { secCik, secText } from "./comparison-server";
import { radarGenres } from "./radar";
import { filedPeriod, staleItems, type FreshnessEntry, type StaleItem } from "./radar-filings";
import { readRows, storeConfig } from "./radar-store";
import { loadRadarFacts } from "./radar-server";

/** Is the Financial Radar behind the filings? (owner, Nov 18: "本当に見てる？"). For every company: the period the radar holds (the stored
 * row, or the live calculation without the storage) against the newest period the SEC lists, a foreign filer's 6-K statements included.
 * Reads the SEC's submissions lists (no company facts), one request at a time, and is kept for an hour. */
export type Freshness = { checkedAt: string; storage: boolean; total: number; stale: StaleItem[] };

async function check(): Promise<Freshness> {
  const config = storeConfig();
  const shown = new Map<string, string | null>();
  for (const genre of radarGenres) {
    const rows = config ? await readRows(genre.id, config) : null;
    for (const ticker of genre.tickers) {
      const period = rows?.get(ticker)?.period_end ?? null;
      // a company in two genres: the older of its two rows is what someone may still see
      if (!shown.has(ticker) || (period ?? "") < (shown.get(ticker) ?? "")) shown.set(ticker, period);
    }
  }
  let last = 0;
  const fetchText = async (url: string, limit: number) => {
    const wait = last + 150 - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    last = Date.now();
    return secText(url, limit);
  };
  const entries: FreshnessEntry[] = [];
  for (const [ticker, period] of shown) {
    try {
      const cik = await secCik(ticker);
      if (!cik) { entries.push({ ticker, stored: period, filing: null }); continue; }
      const submissions = JSON.parse(await fetchText(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, 5_000_000));
      const stored = config ? period : (await loadRadarFacts(ticker)).latest?.end ?? null;
      entries.push({ ticker, stored, filing: await filedPeriod(cik, submissions, fetchText) });
    } catch { entries.push({ ticker, stored: period, filing: null, unreadable: true }); }
  }
  const stale = staleItems(entries);
  const line = stale.map(item => `${item.ticker}:${item.code}`).join(",");
  if (line) console.warn(`radar-stale ${line}`); else console.info(`radar-fresh all ${entries.length}`);
  return { checkedAt: new Date().toISOString(), storage: !!config, total: entries.length, stale };
}

/** Checked at most once an hour for everyone. */
export const radarFreshness = unstable_cache(check, ["radar-freshness-v1"], { revalidate: 3600 });
