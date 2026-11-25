/** マーケット「レバETF」tab (owner, Nov 25): long 2x / 3x ETFs on the stocks Tech Phase follows. Every ticker below was checked against the
 * provider on Nov 25, 2026 (Twelve Data's own fund name says "2X Long <underlying>" / "Bull 2X" / "UltraPro"); one that the provider cannot serve is
 * simply absent from the screen. Only long (bull) funds: no inverse ETF is listed.
 * - Owner's list: MUU … SOXL. AAOI's 2x long: AAOX (Tradr; AAOG from Leverage Shares also exists, but trades a fraction of AAOX's volume).
 *   SNDU is the T-REX 2X Long SNDK fund (checked). RAM is the Roundhill T-REX 2X Long DRAM fund; the provider still names it after the
 *   old SPAC that had the ticker (Aries I Acquisition), so the screen never shows the provider's name.
 * - Then every one of the 22 tracked stocks (監視22銘柄) and the Theme Ranking stocks that have a long 2x fund (none of them has a 3x one). */
export type LeveragedEtf = { etf: string; underlying: string; leverage: 2 | 3 };
const two = (etf: string, underlying: string): LeveragedEtf => ({ etf, underlying, leverage: 2 });
const three = (etf: string, underlying: string): LeveragedEtf => ({ etf, underlying, leverage: 3 });
export const LEVERAGED_ETFS: readonly LeveragedEtf[] = [
  // The owner's list (Nov 25).
  two("MUU", "MU"), two("SKHL", "SKHY"), two("AMUU", "AMD"), two("NVDL", "NVDA"), two("TSLL", "TSLA"), two("PTIR", "PLTR"), two("MSTU", "MSTR"),
  two("CONL", "COIN"), two("AVL", "AVGO"), two("TSMX", "TSM"), two("QLD", "QQQ"), two("NBIL", "NBIS"), two("SNDU", "SNDK"), two("RAM", "DRAM"),
  two("AAOX", "AAOI"), three("TQQQ", "QQQ"), three("SOXL", "SOXX"),
  // The rest of the 22 tracked stocks.
  two("ARMG", "ARM"), two("ASMG", "ASML"), two("MVLL", "MRVL"), two("ANEL", "ANET"), two("CRDU", "CRDO"), two("CWVX", "CRWV"), two("VRTL", "VRT"),
  two("GEVX", "GEV"), two("MSFU", "MSFT"), two("BEX", "BE"), two("GGLL", "GOOGL"), two("LITX", "LITE"), two("LABX", "ALAB"),
  // Theme Ranking stocks.
  two("IONL", "IONQ"), two("RGTX", "RGTI"), two("QBTX", "QBTS"), two("OKLL", "OKLO"), two("RKLX", "RKLB"), two("SMCX", "SMCI"), two("ORCX", "ORCL"),
  two("CRWL", "CRWD"), two("ASTX", "ASTS"), two("LLYX", "LLY"), two("CEGX", "CEG"), two("SMU", "SMR"), two("COHX", "COHR"), two("IREX", "IREN"),
  two("APLX", "APLD"),
];
/** Every symbol the tab reads, once each: the funds first, then the stocks under them. A cold read is spread over several requests (at most 48
 * symbols each, every 12-symbol batch leased separately), so the funds — the rows themselves — come first and a stock's change fills in after
 * (Nov 25: interleaved, a first answer could hold the stocks but not their funds and show nothing). */
export const LEVERAGED_SYMBOLS: readonly string[] = [...new Set([...LEVERAGED_ETFS.map(item => item.etf), ...LEVERAGED_ETFS.map(item => item.underlying)])];

export type LeveragedQuote = { price: number; percentChange: number | null; volume: number | null;
  extended?: { price: number; percentChange: number | null; session: "pre" | "post"; live?: boolean } | null };
export type LeveragedRow = LeveragedEtf & {
  price: number; percentChange: number | null; volume: number | null; underlyingChange: number | null;
  /** The pre-market / after-hours price, only while that session is the one under way. */
  extended: { price: number; percentChange: number; session: "pre" | "post" } | null;
};
/** One row per fund the provider answered for. The stock's own day change comes from its own quote (never derived from the fund's). */
export function leveragedRows(quotes: Record<string, LeveragedQuote | undefined>): LeveragedRow[] {
  return LEVERAGED_ETFS.flatMap(item => {
    const q = quotes[item.etf];
    if (!q || !Number.isFinite(q.price) || q.price <= 0) return [];
    const ext = q.extended;
    return [{ ...item, price: q.price, percentChange: q.percentChange ?? null, volume: q.volume ?? null, underlyingChange: quotes[item.underlying]?.percentChange ?? null,
      extended: ext && ext.live && Number.isFinite(ext.price) && ext.price > 0 && ext.percentChange !== null && Number.isFinite(ext.percentChange) ? { price: ext.price, percentChange: ext.percentChange, session: ext.session } : null }];
  });
}

export type LeveragedSort = "gainers" | "losers" | "volume";
export const LEVERAGED_SORTS: readonly LeveragedSort[] = ["gainers", "losers", "volume"];
/** 上昇率 (largest rise first), 下落率 (largest fall first), 出来高 (most shares first). A row without the figure goes last; ties keep the list's order. */
export function sortLeveraged(rows: readonly LeveragedRow[], sort: LeveragedSort): LeveragedRow[] {
  const value = (row: LeveragedRow) => sort === "volume" ? row.volume : row.percentChange;
  const sign = sort === "losers" ? 1 : -1;
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const x = value(a.row), y = value(b.row);
    if (x === null || !Number.isFinite(x)) return y === null || !Number.isFinite(y) ? a.index - b.index : 1;
    if (y === null || !Number.isFinite(y)) return -1;
    return (x - y) * sign || a.index - b.index;
  }).map(item => item.row);
}

/** Prices: three decimals under $100 as the sheet shows them (4.100, 13.330), two above. */
export const leveragedPrice = (value: number) => value.toFixed(Math.abs(value) < 100 ? 3 : 2);
export const leveragedPercent = (value: number, digits = 2) => `${value > 0 ? "+" : value < 0 ? "-" : ""}${Math.abs(value).toFixed(digits)}%`;

/** What the レバETF list shows while it reads (owner, Nov 25: "読み込み中…" must never stay forever). `rows` null: nothing answered yet.
 * Rows that arrive are shown at once and kept (merged by fund) while the rest are still being read; 「データを取得できませんでした」 only when
 * the server has answered completely with no fund, or LEVERAGED_GIVE_UP answers in a row (errors and timeouts included) brought none. */
export type LeveragedView = { rows: LeveragedRow[] | null; failed: boolean; empty: number };
export const LEVERAGED_GIVE_UP = 3;
export const LEVERAGED_START: LeveragedView = { rows: null, failed: false, empty: 0 };
/** `answer` null: the request failed or timed out. */
export function nextLeveragedView(view: LeveragedView, answer: { rows: LeveragedRow[]; missing: number } | null): LeveragedView {
  const merged = answer ? mergeLeveragedRows(view.rows ?? [], answer.rows) : view.rows ?? [];
  if (merged.length) return { rows: merged, failed: false, empty: 0 };
  const empty = view.empty + 1, done = view.failed || (answer !== null && answer.missing === 0) || empty >= LEVERAGED_GIVE_UP;
  return { rows: done ? [] : null, failed: done, empty };
}
/** The newer answer wins for a fund it holds; a fund it lacks keeps the row already on the screen. The list's own order. */
export function mergeLeveragedRows(old: readonly LeveragedRow[], incoming: readonly LeveragedRow[]): LeveragedRow[] {
  const by = new Map(old.map(row => [row.etf, row]));
  for (const row of incoming) by.set(row.etf, row);
  return LEVERAGED_ETFS.flatMap(item => by.get(item.etf) ?? []);
}
