/** クジラの足あと / Whale Moves (PRO, owner Nov 22). The research monitor collects 13F institutional totals, FINRA short interest,
 * Form 4 open-market trades and buybacks (scripts/research/ownership_data.py); the site only checks membership and shows them.
 * Facts and numbers only: no comment or rating. Per-ticker totals only, never a list of institutions (that is Capital Map). */

export type WhaleTab = "institutions" | "short" | "insiders" | "buybacks";
export const WHALE_TABS: readonly { id: WhaleTab; ja: string; en: string }[] = [
  { id: "institutions", ja: "機関", en: "Institutions" },
  { id: "short", ja: "空売り", en: "Short interest" },
  { id: "insiders", ja: "役員売買", en: "Insider trades" },
  { id: "buybacks", ja: "自社株買い", en: "Buybacks" },
];
export const SORTS: Record<WhaleTab, readonly { id: string; ja: string; en: string }[]> = {
  institutions: [{ id: "up", ja: "増えた順", en: "Biggest rise" }, { id: "down", ja: "減った順", en: "Biggest fall" }, { id: "high", ja: "比率の高い順", en: "Highest share" }],
  short: [{ id: "high", ja: "比率の高い順", en: "Highest share" }, { id: "up", ja: "増えた順", en: "Biggest rise" }, { id: "days", ja: "日数の長い順", en: "Most days" }],
  insiders: [{ id: "all", ja: "すべて", en: "All" }, { id: "buy", ja: "買いだけ", en: "Buys only" }, { id: "sell", ja: "売りだけ", en: "Sells only" }],
  buybacks: [{ id: "new", ja: "新しい順", en: "Newest" }, { id: "amount", ja: "金額の大きい順", en: "Largest" }],
};

type Named = { ticker: string; ja: string; en: string };
export type InstitutionRow = Named & { pct: number; change: number | null; holders: number; holdersChange: number | null };
export type ShortRow = Named & { pct: number; change: number | null; days: number | null };
export type InsiderRow = Named & { date: string; role: string; side: "buy" | "sell"; planned: boolean; value: number };
export type BuybackRow = Named & { kind: "authorization" | "quarter"; date: string; start?: string; end?: string; amount: number };
export type WhaleSnapshot = { ok: true; institutionalAsOf: string | null; shortAsOf: string | null;
  institutional: InstitutionRow[]; short: ShortRow[]; insiders: InsiderRow[]; buybacks: BuybackRow[] };

/** The release switch (default off). The owner's accounts may always use it (AGENTS.md, operator access). */
// Read as a literal so Next.js inlines it into the browser bundle (the menu needs it too).
export const whaleMovesEnabled = (env: Record<string, string | undefined> = { NEXT_PUBLIC_WHALE_MOVES_ENABLED: process.env.NEXT_PUBLIC_WHALE_MOVES_ENABLED }) => env.NEXT_PUBLIC_WHALE_MOVES_ENABLED === "true";

type Member = { status: string; plan: string; accessExpiresAt?: number; ownerAccount?: boolean; ownerMode?: boolean };
/** 404 while the switch is off (except the owner), then PRO only, like the other PRO tools. */
export function whaleMovesAccess(member: Member, enabled: boolean, now = Date.now()): 200 | 401 | 403 | 404 | 503 {
  if (member.status === "unavailable") return 503;
  if (member.status === "signed-in" && (member.ownerAccount === true || member.ownerMode === true)) return 200;
  if (!enabled) return 404;
  if (member.status !== "signed-in") return 401;
  return member.plan === "pro" && Number.isFinite(member.accessExpiresAt) && member.accessExpiresAt! > now ? 200 : 403;
}

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown, min = -Infinity, max = Infinity) => { if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw Error("Invalid number"); return v; };
const opt = (v: unknown, min?: number, max?: number) => v === null || v === undefined ? null : num(v, min, max);
const text = (v: unknown, max = 160) => { if (typeof v !== "string" || v.length > max) throw Error("Invalid text"); return v; };
const day = (v: unknown) => { if (typeof v !== "string" || !DAY.test(v)) throw Error("Invalid date"); return v; };
function named(raw: unknown): Named & Record<string, unknown> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ticker = text(r.ticker, 10);
  if (!TICKER.test(ticker)) throw Error("Invalid ticker");
  return { ...r, ticker, ja: text(r.ja) || ticker, en: text(r.en) || ticker };
}
const rows = <T>(v: unknown, map: (raw: unknown) => T): T[] => { if (!Array.isArray(v)) throw Error("Invalid list"); return v.slice(0, 600).map(map); };
const base = (r: Named) => ({ ticker: r.ticker, ja: r.ja, en: r.en });

/** Validates the monitor's payload; throws when it does not fit (the screen then says the data could not be read). */
export function parseWhaleSnapshot(raw: unknown): WhaleSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.ok !== true) throw Error("Invalid snapshot");
  return {
    ok: true,
    institutionalAsOf: r.institutionalAsOf ? day(r.institutionalAsOf) : null,
    shortAsOf: r.shortAsOf ? day(r.shortAsOf) : null,
    institutional: rows(r.institutional, x => { const n = named(x); return { ...base(n), pct: num(n.pct, 0, 1000), change: opt(n.change, -1000, 1000),
      holders: num(n.holders, 0), holdersChange: opt(n.holdersChange) }; }),
    short: rows(r.short, x => { const n = named(x); return { ...base(n), pct: num(n.pct, 0, 1000), change: opt(n.change, -1000, 1000), days: opt(n.days, 0) }; }),
    insiders: rows(r.insiders, x => { const n = named(x); return { ...base(n), date: day(n.date), role: text(n.role ?? ""), side: n.side === "buy" ? "buy" as const : "sell" as const,
      planned: n.planned === true, value: num(n.value, 0) }; }),
    buybacks: rows(r.buybacks, x => { const n = named(x); return { ...base(n), kind: n.kind === "authorization" ? "authorization" as const : "quarter" as const, date: day(n.date),
      start: n.start ? day(n.start) : undefined, end: n.end ? day(n.end) : undefined, amount: num(n.amount, 0) }; }),
  };
}

/** Sorted copies for each tab's buttons. Over-100% institutional shares sort by the real value. */
export function sortInstitutions(items: InstitutionRow[], sort: string) {
  const change = (r: InstitutionRow) => r.change ?? 0;
  return [...items].sort(sort === "down" ? (a, b) => change(a) - change(b) : sort === "high" ? (a, b) => b.pct - a.pct : (a, b) => change(b) - change(a));
}
export function sortShort(items: ShortRow[], sort: string) {
  return [...items].sort(sort === "up" ? (a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity) : sort === "days" ? (a, b) => (b.days ?? -1) - (a.days ?? -1) : (a, b) => b.pct - a.pct);
}
export function filterInsiders(items: InsiderRow[], sort: string) {
  const kept = sort === "buy" || sort === "sell" ? items.filter(r => r.side === sort) : items;
  return [...kept].sort((a, b) => b.date.localeCompare(a.date) || b.value - a.value);
}
export function sortBuybacks(items: BuybackRow[], sort: string) {
  return [...items].sort(sort === "amount" ? (a, b) => b.amount - a.amount : (a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
}

const trim = (value: number, digits: number) => value.toFixed(digits).replace(/\.?0+$/, "");
const grouped = (value: number) => Math.round(value).toLocaleString("en-US");
/** 2.98億ドル / 420万ドル / 1,100億ドル; in English $298M / $4.2M / $110B. */
export function money(value: number, ja: boolean) {
  if (ja) {
    if (value >= 1e8) { const oku = value / 1e8; return `${oku < 10 ? trim(oku, 2) : grouped(oku)}億ドル`; }
    if (value >= 1e4) return `${grouped(value / 1e4)}万ドル`;
    return `${grouped(value)}ドル`;
  }
  const short = (v: number, unit: string) => `$${v < 10 ? trim(v, 1) : grouped(v)}${unit}`;
  if (value >= 1e9) return short(value / 1e9, "B");
  if (value >= 1e6) return short(value / 1e6, "M");
  if (value >= 1e3) return short(value / 1e3, "K");
  return `$${grouped(value)}`;
}
export const percent = (value: number, digits = 1) => `${value.toFixed(digits)}%`;
export function signedPoints(value: number | null, digits = 1) {
  if (value === null) return "";
  const shown = Math.abs(value).toFixed(digits);
  return `${Number(shown) === 0 ? "±" : value > 0 ? "+" : "−"}${shown}pt`;
}
export const monthDay = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
export const stockHref = (ticker: string) => `/research/stocks?q=${encodeURIComponent(ticker)}`;

/** "7〜9月" for the quarter that ends on `end` (an end in the first half of a month belongs to the month before: 52/53-week years). */
export function quarterLabel(end: string, ja: boolean) {
  const d = new Date(`${end}T00:00:00Z`);
  let month = d.getUTCMonth() + 1;
  if (d.getUTCDate() < 15) month = month === 1 ? 12 : month - 1;
  const first = ((month + 9) % 12) + 1;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return ja ? `${first}〜${month}月` : `${names[first - 1]}–${names[month - 1]}`;
}

/** The officer title in a few words (CEO, CFO, 取締役...); the filing's own text when it is none of these. */
export function roleLabel(role: string, ja: boolean) {
  const out: string[] = [];
  const add = (j: string, e: string) => { const v = ja ? j : e; if (!out.includes(v)) out.push(v); };
  for (const part of role.split(/,\s*/)) {
    if (/chief executive|\bceo\b/i.test(part)) add("CEO", "CEO");
    else if (/chief financial|\bcfo\b/i.test(part)) add("CFO", "CFO");
    else if (/chief operating|\bcoo\b/i.test(part)) add("COO", "COO");
    else if (/chief technology|\bcto\b/i.test(part)) add("CTO", "CTO");
    else if (/chair/i.test(part)) add("会長", "Chair");
    else if (/^president\b/i.test(part)) add("社長", "President");
    else if (/^director$/i.test(part)) add("取締役", "Director");
    else if (/10% owner/i.test(part)) add("大株主", "10% owner");
    else if (part.trim()) add("役員", "Officer");
  }
  return out.slice(0, 2).join(ja ? "・" : " · ");
}

/** The small line above each tab's list (owner's sheet). */
export function asOfLine(tab: WhaleTab, data: WhaleSnapshot, ja: boolean) {
  if (tab === "institutions") {
    const month = data.institutionalAsOf ? Number(data.institutionalAsOf.slice(5, 7)) : null;
    return ja ? `${month ?? "—"}月末時点・13F（四半期ごとに更新）` : `As of end-${month ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1] : "—"} · 13F (updated quarterly)`;
  }
  if (tab === "short") {
    const d = data.shortAsOf;
    return ja ? `${d ? `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日` : "—"}時点・FINRA（月2回更新）` : `As of ${d ? monthDay(d) : "—"} · FINRA (twice a month)`;
  }
  if (tab === "insiders") return ja ? "Form 4・提出から2営業日以内" : "Form 4 · filed within 2 business days";
  return ja ? "10-Q・10-K・8-K（発表から自動で反映）" : "10-Q, 10-K, 8-K (added automatically when filed)";
}

/** The "i" text, verbatim from the owner's sheet. */
export const ABOUT: Record<WhaleTab, { ja: string; en: string }> = {
  institutions: { ja: "その銘柄の発行済み株数のうち、機関投資家が持っている割合です。SECに提出される13F（四半期ごと・約2か月半遅れ）から計算しています。貸し出された株を二重に数えるため、100%を超える銘柄があります。",
    en: "The share of a company's outstanding shares held by institutional investors, calculated from 13F filings (quarterly, about 2.5 months delayed). Some stocks exceed 100% because lent-out shares are counted twice." },
  short: { ja: "発行済み株数に対する空売り残高の割合です。買い戻しは、空売りをすべて買い戻すのにかかる日数の目安です（空売り残高÷平均出来高）。FINRAが月2回公表しています。",
    en: "Short interest as a percentage of shares outstanding. Days to cover estimates how many days it would take to buy back all short positions (short interest ÷ average volume). Published twice a month by FINRA." },
  insiders: { ja: "役員や大株主が市場で自社株を売買したときにSECに出す届け出（Form 4）です。計画売買は、あらかじめ決めた計画どおりの売買です。外国企業は対象外です。",
    en: "Form 4 filings made when officers, directors or major shareholders buy or sell shares on the open market. \"Planned\" means trades made under a pre-set 10b5-1 plan. Foreign companies are not covered." },
  buybacks: { ja: "会社が自分の株を買い戻した金額と、新しく発表した買い戻しの枠です。", en: "The amount a company spent buying back its own shares, and newly announced buyback authorizations." },
};
