import { parseValueFigure, type ValueFigure } from "./comparison-value.ts";
/** トレジャーハント / Treasure Hunt (PRO, owner Nov 22; first named 割安判別ツール / Value Check, which stays the internal name). The research monitor computes the scores once a day after the close
 * (scripts/research/value_check.py); the site only checks membership and shows them. Mechanical and the same for every member. */

export type ValueUniverse = "tech" | "all";
export const VALUE_UNIVERSES: readonly { id: ValueUniverse; ja: string; en: string }[] = [
  { id: "tech", ja: "ハイテク", en: "Tech" },
  { id: "all", ja: "全セクター", en: "All sectors" },
];
/** 割安 for the IN / OUT band: a Value Score of 30% or more (owner, Nov 22). */
export const CHEAP_FROM = 30;
export const FIRST_ROWS = 7; // the podium (1-3) and the list down to 7th; the rest behind すべて見る

/** period: why the look-back is shorter than five years ("listed" recently, or SEC "data" that starts later); null for the full five years. */
export type ValuePeriod = "listed" | "data" | null;
export type ValueItem = { ticker: string; ja: string; en: string; score: number; previous: number | null; pe: number | null; ps: number; revenueGrowth: number; in: boolean; low: boolean; period: ValuePeriod };
export type ValueChange = { ticker: string; from: number; to: number };
export type ValueList = { total: number; items: ValueItem[]; changes: { in: ValueChange[]; out: ValueChange[] }; excluded: Record<string, string[]> };
/** values: every ticker the monitor could calculate, ranked or not, for the Stock Comparison's valuation (absent on snapshots before Nov 26). */
export type ValueSnapshot = { ok: true; basis: "trailing" | "forward"; asOf: string; computedAt: string; universes: Record<ValueUniverse, ValueList>;
  values?: Record<string, ValueFigure> };

/** The release switch (default off). The owner's accounts may always use it (AGENTS.md, operator access). */
// Read as a literal so Next.js inlines it into the browser bundle (the menu needs it too).
export const valueCheckEnabled = (env: Record<string, string | undefined> = { NEXT_PUBLIC_VALUE_CHECK_ENABLED: process.env.NEXT_PUBLIC_VALUE_CHECK_ENABLED }) => env.NEXT_PUBLIC_VALUE_CHECK_ENABLED === "true";

type Member = { status: string; plan: string; accessExpiresAt?: number; ownerAccount?: boolean; ownerMode?: boolean };
/** 404 while the switch is off (except the owner), then the same rule as the other PRO tools. */
export function valueCheckAccess(member: Member, enabled: boolean, now = Date.now()): 200 | 401 | 403 | 404 | 503 {
  if (member.status === "unavailable") return 503;
  const owner = member.status === "signed-in" && (member.ownerAccount === true || member.ownerMode === true);
  if (owner) return 200;
  if (!enabled) return 404;
  if (member.status !== "signed-in") return 401;
  return member.plan === "pro" && Number.isFinite(member.accessExpiresAt) && member.accessExpiresAt! > now ? 200 : 403;
}

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const num = (v: unknown, min = -Infinity, max = Infinity): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw Error("Invalid number");
  return v;
};
const text = (v: unknown, max = 120) => { if (typeof v !== "string" || !v || v.length > max) throw Error("Invalid text"); return v; };
const percent = (v: unknown) => Math.round(num(v, 0, 100));
// The day before can be at or above the five-year mean (zero or below).
const signedPercent = (v: unknown) => Math.round(num(v, -10_000, 100));

function item(raw: unknown): ValueItem {
  const r = raw as Record<string, unknown>;
  const ticker = text(r.ticker, 10);
  if (!TICKER.test(ticker)) throw Error("Invalid ticker");
  return { ticker, ja: text(r.ja), en: text(r.en), score: percent(r.score), previous: r.previous === null || r.previous === undefined ? null : signedPercent(r.previous),
    pe: r.pe === null || r.pe === undefined ? null : num(r.pe, 0), ps: num(r.ps, 0), revenueGrowth: num(r.revenueGrowth, 0), in: r.in === true, low: r.low === true,
    period: r.period === "listed" || r.period === "data" ? r.period : null };
}
const change = (raw: unknown): ValueChange => {
  const r = raw as Record<string, unknown>;
  const ticker = text(r.ticker, 10);
  if (!TICKER.test(ticker)) throw Error("Invalid ticker");
  return { ticker, from: signedPercent(r.from), to: signedPercent(r.to) };
};
function list(raw: unknown): ValueList {
  const r = raw as Record<string, unknown>;
  const changes = (r.changes ?? {}) as Record<string, unknown>;
  if (!Array.isArray(r.items) || !Array.isArray(changes.in) || !Array.isArray(changes.out)) throw Error("Invalid list");
  const excluded: Record<string, string[]> = {};
  for (const [reason, tickers] of Object.entries((r.excluded ?? {}) as Record<string, unknown>)) if (Array.isArray(tickers)) excluded[reason.slice(0, 40)] = tickers.filter((t): t is string => typeof t === "string" && TICKER.test(t));
  // The monitor ranks; the order is checked here so a bad payload can never show a different ranking.
  const items = r.items.map(item);
  for (let i = 1; i < items.length; i++) if (items[i].score > items[i - 1].score) throw Error("Not ranked");
  return { total: num(r.total, 0), items, changes: { in: changes.in.map(change), out: changes.out.map(change) }, excluded };
}

/** Validates the monitor's payload; throws when it does not fit (the screen then says the data could not be read). */
export function parseValueSnapshot(raw: unknown): ValueSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.ok !== true || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.asOf))) throw Error("Invalid snapshot");
  const u = (r.universes ?? {}) as Record<string, unknown>;
  const asOf = String(r.asOf);
  // The comparison's list: an entry that does not fit is left out (that company's valuation is then 未取得); it never fails Treasure Hunt.
  const values: Record<string, ValueFigure> = {};
  if (r.values && typeof r.values === "object" && !Array.isArray(r.values)) for (const [ticker, raw] of Object.entries(r.values as Record<string, unknown>)) {
    const figure = TICKER.test(ticker) ? parseValueFigure(raw, asOf) : null;
    if (figure) values[ticker] = figure;
  }
  return { ok: true, basis: r.basis === "forward" ? "forward" : "trailing", asOf, computedAt: text(r.computedAt, 40),
    universes: { tech: list(u.tech), all: list(u.all) }, ...(r.values ? { values } : {}) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "11/20" from "2026-11-20"; "Nov 20" in English. */
export const monthDay = (iso: string, ja = true) => ja ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
export const ratio = (value: number | null) => value === null ? "—" : value >= 1000 ? Math.round(value).toLocaleString("en-US") : value.toFixed(1);
export const growth = (value: number) => `${value >= 0 ? "+" : ""}${Math.round(value)}%`;
export const stockHref = (ticker: string) => `/research/stocks?q=${encodeURIComponent(ticker)}`;

/** "2035年3月9日" / "Mar 9, 2035": the day with its year (the PRO feature tour's sample, whose made-up year must show). */
export const fullDay = (iso: string, ja = true) => ja ? `${iso.slice(0, 4)}年${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日` : `${monthDay(iso, false)}, ${iso.slice(0, 4)}`;

/** The footer line under the list (owner's wording; 実績値 when the history is the trailing one). withYear: the tour's sample (owner, Nov 22). */
export function footerLine(asOf: string, basis: ValueSnapshot["basis"], ja: boolean, withYear = false) {
  const day = withYear ? fullDay(asOf, ja) : monthDay(asOf, ja);
  return ja ? `${day}の終値で更新・PERとPSRは${basis === "forward" ? "予想値" : "実績値"}・売上は前年比`
    : `As of ${day} close · ${basis === "forward" ? "Forward" : "Trailing"} P/E and P/S · Revenue growth YoY`;
}

/** The "i" text, verbatim from the owner's sheet of Nov 22 (the trailing version drops 予想 / forward as the sheet says). */
export function aboutText(basis: ValueSnapshot["basis"], ja: boolean) {
  if (ja) return `割安度は、${basis === "forward" ? "予想PERと予想PSR" : "PERとPSR"}が、その銘柄の過去5年の平均と比べてどれだけ低いかを%で表したものです。数字が大きいほど、5年平均より安い位置にあります。「5年最安」は、過去5年で一番安い水準にある銘柄です。赤字の銘柄、PERが100倍を超える銘柄、売上が前年より減っている銘柄はのぞいています。毎日の終値で更新します。`;
  return `The Value Score shows how far a stock's ${basis === "forward" ? "forward P/E and forward P/S are" : "P/E and P/S are"} below their own five-year averages. The higher the number, the cheaper it is compared with its five-year average. "5Y Low" marks stocks at their lowest level in five years. Loss-making stocks, stocks with a P/E above 100 and stocks with falling year-over-year revenue are excluded. Updated daily at the close.`;
}

/** The small note on a row whose look-back is shorter than five years. */
export function periodNote(period: ValuePeriod, ja: boolean) {
  if (period === "listed") return ja ? "上場後の期間で計算" : "Since listing";
  if (period === "data") return ja ? "決算データのある期間で計算" : "Based on available filings";
  return null;
}
