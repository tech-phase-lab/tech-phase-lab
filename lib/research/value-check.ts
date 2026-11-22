/** 割安判別ツール / Value Check (PRO, owner Nov 22). The research monitor computes the scores once a day after the close
 * (scripts/research/value_check.py); the site only checks membership and shows them. Mechanical and the same for every member. */

export type ValueUniverse = "tech" | "all";
export const VALUE_UNIVERSES: readonly { id: ValueUniverse; ja: string; en: string }[] = [
  { id: "tech", ja: "ハイテク", en: "Tech" },
  { id: "all", ja: "全セクター", en: "All sectors" },
];
export const CHEAP_FROM = 70;
export const FIRST_ROWS = 7; // the podium (1-3) and the list down to 7th; the rest behind すべて見る

export type ValueItem = { ticker: string; ja: string; en: string; score: number; previous: number | null; pe: number | null; ps: number; revenueGrowth: number; in: boolean };
export type ValueChange = { ticker: string; from: number; to: number };
export type ValueList = { total: number; items: ValueItem[]; changes: { in: ValueChange[]; out: ValueChange[] }; excluded: Record<string, string[]> };
export type ValueSnapshot = { ok: true; basis: "trailing" | "forward"; asOf: string; computedAt: string; universes: Record<ValueUniverse, ValueList> };

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

function item(raw: unknown): ValueItem {
  const r = raw as Record<string, unknown>;
  const ticker = text(r.ticker, 10);
  if (!TICKER.test(ticker)) throw Error("Invalid ticker");
  return { ticker, ja: text(r.ja), en: text(r.en), score: percent(r.score), previous: r.previous === null || r.previous === undefined ? null : percent(r.previous),
    pe: r.pe === null || r.pe === undefined ? null : num(r.pe, 0), ps: num(r.ps, 0), revenueGrowth: num(r.revenueGrowth, 0), in: r.in === true };
}
const change = (raw: unknown): ValueChange => {
  const r = raw as Record<string, unknown>;
  const ticker = text(r.ticker, 10);
  if (!TICKER.test(ticker)) throw Error("Invalid ticker");
  return { ticker, from: percent(r.from), to: percent(r.to) };
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
  return { ok: true, basis: r.basis === "forward" ? "forward" : "trailing", asOf: String(r.asOf), computedAt: text(r.computedAt, 40),
    universes: { tech: list(u.tech), all: list(u.all) } };
}

/** "11/20" from "2026-11-20". */
export const monthDay = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
export const ratio = (value: number | null) => value === null ? "—" : value >= 1000 ? Math.round(value).toLocaleString("en-US") : value.toFixed(1);
export const growth = (value: number) => `${value >= 0 ? "+" : ""}${Math.round(value)}%`;
export const stockHref = (ticker: string) => `/research/stocks?q=${encodeURIComponent(ticker)}`;

/** The footer line under the list (owner's wording; 実績値 when the history is the trailing one). */
export function footerLine(asOf: string, basis: ValueSnapshot["basis"], ja: boolean) {
  return ja ? `${monthDay(asOf)}の終値で更新・PERとPSRは${basis === "forward" ? "予想値" : "実績値"}・売上は前年比`
    : `Updated at the ${monthDay(asOf)} close · ${basis === "forward" ? "Forward" : "Trailing"} P/E and P/S · Revenue year over year`;
}

/** The "i" text, verbatim from the owner's sheet (the trailing version drops 予想 / forward as the sheet says). */
export function aboutText(basis: ValueSnapshot["basis"], ja: boolean) {
  if (ja) return `割安度は、${basis === "forward" ? "予想PERと予想PSR" : "PERとPSR"}がその銘柄の過去5年の中でどれだけ低い位置にあるかを0〜100%で表したものです。100%に近いほど過去5年の中で安い位置にあります。売上が前年より減っている銘柄はのぞいています。毎日の終値で更新します。`;
  return `The Value Score shows where a stock's ${basis === "forward" ? "forward P/E and forward P/S" : "P/E and P/S"} sit within its own five-year range, from 0% to 100%. The closer to 100%, the cheaper it is compared with its own past five years. Stocks with falling year-over-year revenue are excluded. Updated daily at the close.`;
}
