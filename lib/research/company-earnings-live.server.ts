import "server-only";
import { readMonitor } from "./tech-news-server";
import { liveRelease, type LiveDecision, type Shown } from "./company-earnings-live.ts";
import { loadCompanyDive } from "./company-dive-loader.ts";
import { validateCompanyDive, type CompanyDive } from "./company-dive.ts";

/** How long one read of the monitor's stored results serves every company page of this server instance. A release reaches the
 * page within this plus the monitor's own detection (seconds after the filing). One shared read a minute, never one per reader. */
const TTL_MS = 60_000;
const DAY = 86_400_000;
let memo: { at: number; briefs: Promise<unknown> } | null = null;

/** The monitor's stored earnings results of the last 94 days (its bound is 95), shared for TTL_MS; null when the monitor cannot answer. */
export function recentBriefs(now: number): Promise<unknown> {
  if (memo && now - memo.at < TTL_MS) return memo.briefs;
  const from = new Date(now - 93 * DAY).toISOString().slice(0, 10), to = new Date(now).toISOString().slice(0, 10);
  const briefs = readMonitor("earnings-results", 1_500_000, 4_000, { from, to })
    .then(value => (value as { resultBriefs?: unknown } | null)?.resultBriefs ?? null)
    .catch(() => null);
  memo = { at: now, briefs };
  return briefs;
}

/** The newer quarter for a company page, or the file's own quarter (release null) when there is none or the monitor is unavailable. */
export async function loadLiveRelease(shown: Shown, now = Date.now()): Promise<LiveDecision> {
  const decision = liveRelease(await recentBriefs(now), shown, now);
  if (decision.hold) console.warn(`[company-earnings-live] ${shown.ticker}: a newer release is held (${decision.hold}); the page keeps ${shown.period}`);
  return decision;
}

let dives: { at: number; value: Promise<Record<string, unknown> | null> } | null = null;
/** The monitor's checked drafts of a new quarter's deep dive (scripts/research/earnings_dive_generate.py; none unless the owner turned the
 * model on), shared for TTL_MS like the results. */
function generatedDives(now: number): Promise<Record<string, unknown> | null> {
  if (dives && now - dives.at < TTL_MS) return dives.value;
  const value = readMonitor("company-dives", 2_000_000, 4_000)
    .then(answer => { const d = (answer as { dives?: unknown } | null)?.dives; return d && typeof d === "object" && !Array.isArray(d) ? d as Record<string, unknown> : null; })
    .catch(() => null);
  dives = { at: now, value };
  return value;
}

/**
 * The deep dive a company page shows: the committed file, or the monitor's checked draft for a newer quarter when there is one and it
 * passes the same strict check as a file (validateCompanyDive). A draft that does not pass is dropped and logged; the file stays.
 */
export async function loadEffectiveDive(ticker: string, now = Date.now()): Promise<CompanyDive | null> {
  const file = loadCompanyDive(ticker);
  const raw = (await generatedDives(now))?.[ticker];
  if (!file || !raw) return file;
  try {
    const draft = validateCompanyDive(raw, ticker);
    return draft.releasedOn > file.releasedOn && draft.period !== file.period ? draft : file;
  } catch (error) {
    console.error(`[company-dive] ${ticker}: the monitor's draft was dropped (${(error as Error).message}); the committed file stays`);
    return file;
  }
}
