import "server-only";
import { calendarEvents, dateOnlyEarnings } from "./calendar";
import { parseCompanyWire } from "./company-wire";
import { companyDisplayName } from "./company-display-names";
import { checkedBriefs } from "./earnings-results-history";
import { FLASH_TICKERS, flashRows } from "./flash-rows";
import type { Bar } from "./market-quote";
import { loadSnapshotDailyBars } from "./market-data";
import { buildPublicNews } from "./public-news-response";
import { FOCUS_BARS, earningsOn, flashOn, focusDue, focusSession, focusStat, rankFocus, settledSession, validTicker, type FocusFlags, type FocusRow, type FocusStat } from "./search-focus";
import { THEME_NAMES, THEME_TICKERS } from "./search-themes";
import { readMonitor } from "./tech-news-server";
import { STALE_LIMIT_MS, type ReadSpec } from "./twelve-budget";
import { sharedReader } from "./twelve-gateway";
import { shortCompanyName } from "./company-short-name";

/** 銘柄検索「今日の注目」 and the theme rows' day change (owner, Nov 26): ONE shared snapshot, the same pattern as the マーケット「レバETF」
 * snapshot (lib/research/market-data.ts refreshLeveragedSnapshot). The site's minute job (app/api/research/compare/warm, called by the
 * Railway monitor every minute) keeps it; a member's page only reads it and never asks the provider.
 *
 * Credits: each candidate's daily bars once per settled session (one credit a stock, ~90 a trading day: 85 stocks plus that day's flagged ones, at most FOCUS_PER_MINUTE a
 * minute, through the allocator's warm tier). A copy of the five-year daily series a stock page already read for that session is used
 * instead, for no credit. The 速報 and earnings flags come from the site's own monitor (no provider credit), every FLAGS_EVERY_MS. */

export const FOCUS_PER_MINUTE = 24;
const FLAGS_EVERY_MS = 10 * 60_000;
/** A failed read is tried again after RETRY_MS; a stock whose last bar is older than the settled session after RETRY_BEHIND_MS. */
const RETRY_MS = 20 * 60_000, RETRY_BEHIND_MS = 2 * 3_600_000;
export type FocusSnapshot = {
  /** The session shown ("2026-11-25"); null before any stock was read. */
  session: string | null;
  rows: FocusRow[];
  /** Every candidate's figures; `read`: the settled session each was last read for, `tried`: the last attempt. */
  stats: Record<string, FocusStat>; read: Record<string, string>; tried: Record<string, number>;
  flags: FocusFlags & { session: string | null; at: number };
};
const SNAPSHOT_SPEC: ReadSpec = { name: "md-focus-snap-v1", slotMs: 60_000, staleMs: STALE_LIMIT_MS + 86_400_000 };
/** The stock page's five-year daily series (lib/research/market-data.ts loadDailyCloses): a copy read after the session settled is used. */
const DAILY_COPY_SPEC: ReadSpec = { name: "md-bars-v1", slotMs: 30 * 60_000, staleMs: STALE_LIMIT_MS };

export const focusName = (ticker: string) => THEME_NAMES[ticker] ?? shortCompanyName(companyDisplayName(ticker).en);

export async function currentFocusSnapshot(): Promise<FocusSnapshot | null> {
  return (await sharedReader.read<FocusSnapshot>(SNAPSHOT_SPEC, "all", null).catch(() => null))?.value ?? null;
}

async function readFlags(session: string): Promise<FocusFlags> {
  const next = new Date(Date.parse(`${session}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const [news, wire, results] = await Promise.all([
    readMonitor("news", 500_000, 8_000).then(raw => buildPublicNews(raw)).catch(() => null),
    readMonitor("company-wire", 400_000, 5_000).then(raw => parseCompanyWire(raw).items).catch(() => ({})),
    readMonitor("earnings-results", 1_500_000, 8_000, { from: session, to: next }).then(raw => checkedBriefs((raw as { resultBriefs?: unknown }).resultBriefs)).catch(() => null),
  ]);
  // The monitor could not be reached at all: keep the flags read before (the caller's fallback).
  if (!news && !Object.keys(wire).length && !results) throw new Error("monitor-unavailable");
  // Both languages: a story shown only in English (or only in Japanese) is still a 速報 row.
  const rows = news || Object.keys(wire).length ? [...flashRows(news, wire, "ja"), ...flashRows(news, wire, "en")] : [];
  const flash = flashOn(session, rows);
  const earnings = earningsOn(session, { calendar: calendarEvents, dateOnly: dateOnlyEarnings, results: [...(results ?? []), ...(news?.resultBriefs ?? [])] });
  return { flash: flash.flash, earnings: [...new Set([...earnings, ...flash.earnings])].sort() };
}


let run: Promise<{ spent: number; read: number; copies: number; failed: number }> | null = null;
/** One minute of the background refresh: the stocks still to be read for the settled session (copies first, then the provider), the
 * flags every ten minutes, the ranking, and the snapshot written again (so every instance finds it in the current or previous slot). */
export function refreshFocusSnapshot(now = Date.now()): Promise<{ spent: number; read: number; copies: number; failed: number }> {
  return run ??= (async () => {
    const old = await currentFocusSnapshot();
    const snap: FocusSnapshot = old ?? { session: null, rows: [], stats: {}, read: {}, tried: {}, flags: { session: null, at: 0, earnings: [], flash: [] } };
    const settled = settledSession(now);
    // A stock with earnings or a 速報 row is a candidate even outside the themes and the tracked companies.
    const flagged = [...snap.flags.earnings, ...snap.flags.flash];
    const candidates = [...new Set([...THEME_TICKERS, ...FLASH_TICKERS, ...flagged])].filter(validTicker);
    const due = focusDue(candidates, snap.read, snap.tried, settled, now, RETRY_MS);
    let spent = 0, read = 0, copies = 0, failed = 0;
    /** `answered`: the provider answered for this stock. With the settled session's bar, or with no bars at all (a symbol it does not
     * serve), it is not asked again for this session; with an older last bar (the provider still behind, or a market holiday) it is asked
     * again in two hours. */
    const take = (ticker: string, bars: Bar[], answered = false) => {
      snap.tried[ticker] = now;
      const stat = focusStat(bars, settled);
      if (stat) snap.stats[ticker] = stat;
      if (stat?.date === settled || (answered && !stat)) snap.read[ticker] = settled;
      else if (stat) snap.tried[ticker] = now + RETRY_BEHIND_MS - RETRY_MS;
      return !!stat;
    };
    // A stock page's five-year series read after this session settled already holds the session's bar: no credit.
    const fromProvider: string[] = [];
    await Promise.all(due.map(async ticker => {
      const copy = await sharedReader.read<Bar[]>(DAILY_COPY_SPEC, `${ticker}|1day|1300`, null).catch(() => null);
      if (copy?.value?.length && settledSession(copy.at) === settled && take(ticker, copy.value)) copies++;
      else fromProvider.push(ticker);
    }));
    // The shared snapshot mechanism of the マーケット tabs (#877, refreshBoardSnapshot): each stock's daily bars through the shared bar copy
    // (one credit a stock, none when a member already read it this slot), on the warm tier. A refused or failed read keeps the last good
    // copy, which is not taken for this session: the stock is tried again in RETRY_MS.
    await Promise.all(fromProvider.slice(0, FOCUS_PER_MINUTE).map(async ticker => {
      try {
        const got = await loadSnapshotDailyBars(ticker, FOCUS_BARS, () => { spent++; });
        if (got.fresh && settledSession(got.at) === settled) { if (take(ticker, got.value, true)) read++; else failed++; }
        else { snap.tried[ticker] = now; failed++; }
      } catch { snap.tried[ticker] = now; failed++; }
    }));
    // A stock no longer read (a flag of an earlier day) leaves the snapshot after ten days.
    const oldest = new Date(now - 10 * 86_400_000).toISOString().slice(0, 10);
    for (const [ticker, stat] of Object.entries(snap.stats)) if (stat.date < oldest) { delete snap.stats[ticker]; delete snap.read[ticker]; delete snap.tried[ticker]; }
    snap.session = focusSession(snap.stats);
    if (snap.session && (snap.flags.session !== snap.session || now - snap.flags.at >= FLAGS_EVERY_MS)) {
      snap.flags = { session: snap.session, at: now, ...await readFlags(snap.session).catch(() => ({ earnings: snap.flags.session === snap.session ? snap.flags.earnings : [], flash: snap.flags.session === snap.session ? snap.flags.flash : [] })) };
    }
    snap.rows = rankFocus(snap.stats, snap.flags, snap.session, focusName);
    if (snap.session) await sharedReader.save(SNAPSHOT_SPEC, "all", { value: snap, at: Date.now() });
    return { spent, read, copies, failed };
  })().finally(() => { run = null; });
}

/** What the search page shows: the six rows, the session, and every theme stock's day change. Snapshot only: never the provider. */
export type FocusView = { session: string | null; rows: { ticker: string; name: string; change: number | null }[]; changes: Record<string, number | null> };
export async function loadFocusView(): Promise<FocusView | null> {
  const snap = await currentFocusSnapshot();
  if (!snap) return null;
  const changes: Record<string, number | null> = {};
  for (const ticker of THEME_TICKERS) { const stat = snap.stats[ticker]; if (stat && stat.date === snap.session) changes[ticker] = stat.change; }
  return { session: snap.session, rows: snap.rows.map(({ ticker, name, change }) => ({ ticker, name, change })), changes };
}
