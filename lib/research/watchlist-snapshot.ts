import { parseFavoriteLists, usableFavoriteQuote, type FavoriteLists, type FavoriteQuote } from "./favorite-lists.ts";

/** The watchlist's last screen on this device (owner, Nov 25: the rows must show their price and chart the moment the page opens).
 * The page draws its rows from this copy at once and asks the server in the background as before, so it costs no provider credit:
 * the requests are the ones the page always made, only nothing waits for them. Quotes are public market data, kept per device.
 * A signed-in member's lists are kept beside them only with the sign-in they belong to (`owner`), and shown only while the same
 * sign-in is still loading; a stale price keeps its existing 「最終取得」 label (lib/research/watchlist-freshness.ts). */
export const watchlistSnapshotKey = "tech-phase:watchlist-snapshot:v1";
export const WATCHLIST_SNAPSHOT_QUOTES = 100;
const HISTORY_POINTS = 240;

type StoredQuote = Omit<FavoriteQuote, "history"> & { h?: [number, number[], number[]] };
export type WatchlistSnapshot = { quotes: Record<string, FavoriteQuote>; owner: string | null; lists: FavoriteLists | null };
export const emptyWatchlistSnapshot: WatchlistSnapshot = { quotes: {}, owner: null, lists: null };

/** A day's 5-minute path, packed: the first time (s), the gaps (min) and the prices. ~8 bytes a point instead of ~45. */
function pack(history: FavoriteQuote["history"]): StoredQuote["h"] {
  const points = (history ?? []).slice(-HISTORY_POINTS).filter(point => Number.isFinite(Date.parse(point.at)) && Number.isFinite(point.price));
  if (!points.length) return undefined;
  const seconds = points.map(point => Math.round(Date.parse(point.at) / 1000));
  return [seconds[0], seconds.slice(1).map((value, index) => (value - seconds[index]) / 60), points.map(point => Math.round(point.price * 1e4) / 1e4)];
}
function unpack(h: unknown): FavoriteQuote["history"] {
  if (!Array.isArray(h) || h.length !== 3 || !Number.isFinite(h[0]) || !Array.isArray(h[1]) || !Array.isArray(h[2]) || h[2].length !== h[1].length + 1 || h[2].length > HISTORY_POINTS) return undefined;
  let at = h[0] as number;
  const out: { at: string; price: number }[] = [];
  for (let index = 0; index < h[2].length; index++) {
    if (index) { const gap = h[1][index - 1]; if (!Number.isFinite(gap) || gap <= 0) return undefined; at += gap * 60; }
    const price = h[2][index];
    if (!Number.isFinite(price) || price <= 0) return undefined;
    out.push({ at: new Date(at * 1000).toISOString(), price });
  }
  return out;
}

export function parseWatchlistSnapshot(raw: string | null): WatchlistSnapshot {
  try {
    if (!raw || raw.length > 1_000_000) return emptyWatchlistSnapshot;
    const value = JSON.parse(raw);
    const quotes: Record<string, FavoriteQuote> = {};
    for (const [ticker, stored] of Object.entries((value?.quotes ?? {}) as Record<string, StoredQuote>)) {
      if (!stored || typeof stored !== "object") continue;
      const { h, ...rest } = stored;
      const history = unpack(h);
      const quote = { ...rest, ...(history ? { history } : {}) } as FavoriteQuote;
      if (usableFavoriteQuote(quote, ticker) && ["regular", "pre", "post", "closed"].includes(quote.session)) quotes[ticker] = quote;
    }
    const owner = typeof value?.owner === "string" && value.owner.length <= 200 ? value.owner : null;
    const lists = owner && value?.lists && Array.isArray(value.lists.lists) && value.lists.lists.length
      ? parseFavoriteLists(JSON.stringify(value.lists), JSON.stringify(value.lists.lists[0]?.tickers ?? [])) : null;
    return { quotes, owner: lists ? owner : null, lists };
  } catch { return emptyWatchlistSnapshot; }
}

/** The new answer's quotes replace the old ones; the most recent WATCHLIST_SNAPSHOT_QUOTES symbols are kept. A quote without a path keeps
 * the path it had the same market day (the chart helper drops one from another day anyway). */
export function withQuotes(snapshot: WatchlistSnapshot, next: Record<string, FavoriteQuote>): WatchlistSnapshot {
  const quotes: Record<string, FavoriteQuote> = {};
  for (const [ticker, quote] of Object.entries(snapshot.quotes)) if (!(ticker in next)) quotes[ticker] = quote;
  for (const [ticker, quote] of Object.entries(next)) {
    if (!usableFavoriteQuote(quote, ticker)) continue;
    const before = snapshot.quotes[ticker]?.history;
    quotes[ticker] = !quote.history?.length && before?.length ? { ...quote, history: before } : quote;
  }
  const tickers = Object.keys(quotes);
  for (const ticker of tickers.slice(0, Math.max(0, tickers.length - WATCHLIST_SNAPSHOT_QUOTES))) delete quotes[ticker];
  return { ...snapshot, quotes };
}
/** `owner` null: forget the signed-in lists (signed out). */
export const withLists = (snapshot: WatchlistSnapshot, owner: string | null, lists: FavoriteLists | null): WatchlistSnapshot =>
  owner && lists ? { ...snapshot, owner, lists: { lists: lists.lists, names: lists.names } } : { ...snapshot, owner: null, lists: null };

export function serializeWatchlistSnapshot(snapshot: WatchlistSnapshot): string {
  const quotes: Record<string, StoredQuote> = {};
  for (const [ticker, quote] of Object.entries(snapshot.quotes)) {
    const { history, ...rest } = quote;
    const h = pack(history);
    quotes[ticker] = { ...rest, ...(h ? { h } : {}) };
  }
  return JSON.stringify({ quotes, ...(snapshot.owner && snapshot.lists ? { owner: snapshot.owner, lists: snapshot.lists } : {}) });
}

/** Which sign-in this browser holds, from the identity SDK's own readable cookie (`__client_uat`, the time of the last sign-in; "0" when
 * signed out), before the SDK has loaded. "out": signed out. null: unknown (no cookie: sign-in not configured, or never loaded here). */
export function signInHint(cookie: string): string | null {
  const values = cookie.split(";").map(part => part.trim()).filter(part => /^__client_uat(_[A-Za-z0-9-]+)?=/.test(part)).map(part => part.slice(part.indexOf("=") + 1)).sort();
  if (!values.length) return null;
  return values.every(value => value === "0" || value === "") ? "out" : `uat:${values.join(",")}`;
}
