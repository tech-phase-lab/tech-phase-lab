import type { Copy } from "./data";
import type { WatchTile } from "./company-watch";
import { parseDive, type DiveHistory, type DiveNumbers, type DiveSummary } from "./watch-earnings.ts";
import { DIVE_CURRENCIES, diveMoney, divePerShare, type DiveCurrency } from "./dive-money.ts";
import { proPageAllowed, type PageMember } from "../membership/pro-access.ts";

/** The 21 監視銘柄 besides MU whose company page reads lib/research/dives/<TICKER>.json (owner, Nov 25). */
export const DIVE_TICKERS = ["NVDA", "AMD", "AVGO", "CRWV", "ARM", "TSM", "ASML", "MRVL", "ANET", "CRDO", "SKHY", "SNDK", "NBIS", "VRT", "GEV", "BE", "LITE", "MSFT", "GOOGL", "ALAB", "PLTR"] as const;

export type DiveSource = { url: string; title: string; location: string };
export type DiveEvidence = { field: string; url: string; quote: string };
/** Whether a margin or EPS is the issuer's GAAP / IFRS figure or its adjusted (non-GAAP) one; it decides the label. */
export type DiveBasis = "gaap" | "adjusted";
/** One ticker's deep dive file, checked. `numbers` and `summary` are the same shapes MU's live dive uses. */
export type CompanyDive = {
  ticker: string; name: string; exchange: string; quoteTicker: string;
  /** The issuer's own fiscal label ("Q3 2026", "Q3 FY2027"). */
  period: string; periodQuarter: number;
  releasedOn: string; periodEnd: string; reviewedOn: string;
  currency: DiveCurrency;
  sources: DiveSource[]; evidence: DiveEvidence[];
  numbers: DiveNumbers; history: DiveHistory[]; summary: DiveSummary;
  /** The top of the company page (直近決算). From the file when it gives them, otherwise derived from `numbers`. */
  tiles: WatchTile[];
  grossMarginBasis: DiveBasis | null; epsBasis: DiveBasis | null;
};

const DATE = /^20\d{2}-\d{2}-\d{2}$/;
const CARD_KEYS = ["growth", "change", "caution", "next"] as const;
const fail = (reason: string): never => { throw new Error(reason); };
const record = (value: unknown, at: string): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail(`${at} is not an object`);
const text = (value: unknown, at: string, max = 800): string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max ? value : fail(`${at} is not text (1-${max} chars)`);
const date = (value: unknown, at: string): string => {
  const s = text(value, at, 10);
  return DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s ? s : fail(`${at} is not a YYYY-MM-DD date`);
};
const https = (value: unknown, at: string): string => {
  const s = text(value, at, 2000);
  let url: URL;
  try { url = new URL(s); } catch { return fail(`${at} is not a URL`); }
  return url.protocol === "https:" && !url.username && !url.password ? s : fail(`${at} is not an https URL`);
};
const finite = (value: unknown, at: string): number => typeof value === "number" && Number.isFinite(value) ? value : fail(`${at} is not a number`);
const copy = (value: unknown, at: string): Copy => { const r = record(value, at); return { ja: text(r.ja, `${at}.ja`), en: text(r.en, `${at}.en`) }; };
const basis = (value: unknown, at: string): DiveBasis | null =>
  value === undefined || value === null ? null : value === "gaap" || value === "adjusted" ? value : fail(`${at} must be "gaap" or "adjusted"`);

/** Every number in `numbers` and `history` that must be backed by a quoted source line, as "numbers.revenue.current",
 * "numbers.segments.<key>.revenue" and "history.<index>.value". */
function evidenceFields(numbers: DiveNumbers, history: DiveHistory[]): { field: string; alt: string[] }[] {
  const out: { field: string; alt: string[] }[] = [];
  const add = (value: number | null | undefined, field: string, alt: string[] = []) => { if (value !== null && value !== undefined) out.push({ field, alt }); };
  add(numbers.revenue.current, "numbers.revenue.current"); add(numbers.revenue.previous, "numbers.revenue.previous"); add(numbers.revenue.yearAgo, "numbers.revenue.yearAgo");
  add(numbers.adjustedEPS, "numbers.adjustedEPS"); add(numbers.epsEstimate, "numbers.epsEstimate");
  add(numbers.grossMargin?.current, "numbers.grossMargin.current"); add(numbers.grossMargin?.previous, "numbers.grossMargin.previous");
  add(numbers.guidance?.low, "numbers.guidance.low"); add(numbers.guidance?.high, "numbers.guidance.high"); add(numbers.guidance?.grossMarginPercent, "numbers.guidance.grossMarginPercent");
  (numbers.segments ?? []).forEach((s, i) => {
    for (const k of ["revenue", "previous", "operatingMargin", "previousOperatingMargin"] as const) add(s[k], `numbers.segments.${s.key}.${k}`, [`numbers.segments.${i}.${k}`]);
  });
  history.forEach((h, i) => add(h.value, `history.${i}.value`, [`history.${i}`, `history.${h.end}.value`, `history.${h.end}`]));
  return out;
}
/** "history[0].value" and "history.0.value" are the same field. */
const normalField = (field: string) => field.replace(/\[(\w+)\]/g, ".$1").replace(/^\./, "");

/** The three tiles at the top of the page when the file does not give its own. */
export function derivedTiles(d: Pick<CompanyDive, "numbers" | "currency" | "grossMarginBasis" | "epsBasis">): WatchTile[] {
  const n = d.numbers, cur = d.currency;
  const money = (m: number): Copy => ({ ja: diveMoney(m, cur, "ja"), en: diveMoney(m, cur, "en") });
  const pct = (a: number, b: number) => { const v = (a / b - 1) * 100; return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`; };
  const tiles: WatchTile[] = [{
    label: { ja: "売上高", en: "Revenue" }, value: money(n.revenue.current),
    note: n.revenue.yearAgo ? { ja: `前年同期比 ${pct(n.revenue.current, n.revenue.yearAgo)}`, en: `${pct(n.revenue.current, n.revenue.yearAgo)} YoY` }
      : { ja: `前四半期比 ${pct(n.revenue.current, n.revenue.previous)}`, en: `${pct(n.revenue.current, n.revenue.previous)} QoQ` },
  }];
  if (n.grossMargin) {
    const adjusted = d.grossMarginBasis === "adjusted";
    tiles.push({ label: adjusted ? { ja: "調整後粗利益率", en: "Adjusted gross margin" } : { ja: "粗利益率", en: "Gross margin" },
      value: { ja: `${n.grossMargin.current.toFixed(1)}%`, en: `${n.grossMargin.current.toFixed(1)}%` },
      note: { ja: `前四半期 ${n.grossMargin.previous.toFixed(1)}%`, en: `Prior quarter ${n.grossMargin.previous.toFixed(1)}%` } });
  } else if (n.adjustedEPS !== null) {
    const gaap = d.epsBasis === "gaap";
    tiles.push({ label: gaap ? { ja: "EPS", en: "EPS" } : { ja: "調整後EPS", en: "Adjusted EPS" },
      value: { ja: divePerShare(n.adjustedEPS, cur, "ja"), en: divePerShare(n.adjustedEPS, cur, "en") }, note: { ja: "1株あたり利益", en: "Earnings per share" } });
  }
  if (n.guidance) {
    tiles.push({ label: { ja: "次四半期の売上見通し", en: "Next-quarter revenue guidance" },
      value: n.guidance.low === n.guidance.high ? money(n.guidance.low) : { ja: `${diveMoney(n.guidance.low, cur, "ja").replace(/[^\d.,−]+$/, "")}〜${diveMoney(n.guidance.high, cur, "ja")}`, en: `${diveMoney(n.guidance.low, cur, "en")}–${diveMoney(n.guidance.high, cur, "en")}` },
      note: { ja: "会社予想", en: "Company guidance" } });
  } else {
    tiles.push({ label: { ja: "前四半期の売上高", en: "Prior-quarter revenue" }, value: money(n.revenue.previous), note: { ja: "比較対象", en: "Comparison base" } });
  }
  return tiles.slice(0, 3);
}

/**
 * The strict check of one lib/research/dives/<TICKER>.json. Throws an Error whose message names the first problem; the loader then
 * drops that ticker's dive only. The numbers and summary go through parseDive (MU's own check) and then stricter rules: every card
 * present, 1-3 chips and 3-4 distinct sections each, 4+ earlier quarters of revenue oldest first, dates in order, and an evidence
 * line for every number.
 */
export function validateCompanyDive(raw: unknown, expectedTicker: string): CompanyDive {
  const r = record(raw, "file");
  const ticker = text(r.ticker, "ticker", 10);
  if (ticker !== expectedTicker) fail(`ticker ${ticker} does not match the file name ${expectedTicker}`);
  if (!(DIVE_TICKERS as readonly string[]).includes(ticker)) fail(`${ticker} is not one of the 21 dive tickers`);
  const period = text(r.period, "period", 24);
  const periodQuarter = r.periodQuarter;
  if (typeof periodQuarter !== "number" || !Number.isInteger(periodQuarter) || periodQuarter < 1 || periodQuarter > 4) fail("periodQuarter must be 1-4");
  const releasedOn = date(r.releasedOn, "releasedOn"), periodEnd = date(r.periodEnd, "periodEnd"), reviewedOn = date(r.reviewedOn, "reviewedOn");
  if (!(periodEnd < releasedOn && releasedOn <= reviewedOn)) fail("dates must run periodEnd < releasedOn <= reviewedOn");
  const currency = DIVE_CURRENCIES.includes(r.currency as DiveCurrency) ? r.currency as DiveCurrency : fail(`currency must be one of ${DIVE_CURRENCIES.join(", ")}`);
  if (!Array.isArray(r.sources) || r.sources.length < 1 || r.sources.length > 10) fail("sources must list 1-10 sources");
  const sources = (r.sources as unknown[]).map((v, i) => { const s = record(v, `sources[${i}]`); return { url: https(s.url, `sources[${i}].url`), title: text(s.title, `sources[${i}].title`, 200), location: text(s.location, `sources[${i}].location`, 200) }; });
  if (!Array.isArray(r.evidence) || r.evidence.length < 1) fail("evidence is empty");
  const evidence = (r.evidence as unknown[]).map((v, i) => { const e = record(v, `evidence[${i}]`); return { field: text(e.field, `evidence[${i}].field`, 120), url: https(e.url, `evidence[${i}].url`), quote: text(e.quote, `evidence[${i}].quote`, 2000) }; });

  const parsed = parseDive({ numbers: r.numbers, summary: r.summary });
  if (!parsed?.numbers) fail("numbers do not pass parseDive");
  if (!parsed!.summary) fail("summary does not pass parseDive");
  const numbers = parsed!.numbers!, summary = parsed!.summary!;
  // parseDive lets some numbers through as null; a file must give real ones.
  if (numbers.revenue.current <= 0 || numbers.revenue.previous <= 0) fail("revenue must be positive");
  if (numbers.grossMargin) { finite(numbers.grossMargin.current, "numbers.grossMargin.current"); finite(numbers.grossMargin.previous, "numbers.grossMargin.previous"); }
  if (numbers.guidance) {
    finite(numbers.guidance.low, "numbers.guidance.low"); finite(numbers.guidance.high, "numbers.guidance.high");
    if (numbers.guidance.low <= 0 || numbers.guidance.low > numbers.guidance.high) fail("guidance must be 0 < low <= high");
  }
  for (const [i, s] of (numbers.segments ?? []).entries()) for (const k of ["revenue", "previous", "operatingMargin", "previousOperatingMargin"] as const) finite(s[k], `numbers.segments[${i}].${k}`);
  if (new Set((numbers.segments ?? []).map(s => s.key)).size !== (numbers.segments ?? []).length) fail("segment keys repeat");
  if (summary.conclusion.length < 1 || summary.conclusion.length > 3) fail("conclusion must have 1-3 items");
  for (const key of CARD_KEYS) {
    const card = summary.cards[key];
    if (!card) fail(`card ${key} is missing`);
    if (card!.chips.length < 1 || card!.chips.length > 3) fail(`card ${key} must have 1-3 chips`);
    if (card!.sections.length < 3 || card!.sections.length > 4) fail(`card ${key} must have 3-4 sections`);
    if (new Set(card!.sections.map(s => s.key)).size !== card!.sections.length) fail(`card ${key} repeats a section`);
    if (card!.segment && !numbers.segments?.some(s => s.key === card!.segment)) fail(`card ${key} names an unknown segment ${card!.segment}`);
  }

  if (!Array.isArray(r.history) || r.history.length < 4 || r.history.length > 12) fail("history must list 4-12 earlier quarters");
  const history = (r.history as unknown[]).map((v, i) => { const h = record(v, `history[${i}]`); return { label: text(h.label, `history[${i}].label`, 12), end: date(h.end, `history[${i}].end`), value: finite(h.value, `history[${i}].value`) }; });
  history.forEach((h, i) => {
    if (h.value <= 0) fail(`history[${i}].value must be positive`);
    if (i > 0 && h.end <= history[i - 1].end) fail("history must be oldest first");
  });
  if (history.at(-1)!.end >= periodEnd) fail("history must end before periodEnd");

  const given = new Set(evidence.map(e => normalField(e.field)));
  const missing = evidenceFields(numbers, history).filter(f => !given.has(f.field) && !f.alt.some(a => given.has(a))).map(f => f.field);
  if (missing.length) fail(`no evidence for ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` (+${missing.length - 5})` : ""}`);

  const grossMarginBasis = basis(r.grossMarginBasis, "grossMarginBasis"), epsBasis = basis(r.epsBasis, "epsBasis");
  let tiles: WatchTile[];
  if (r.tiles === undefined || r.tiles === null) tiles = derivedTiles({ numbers, currency, grossMarginBasis, epsBasis });
  else {
    if (!Array.isArray(r.tiles) || r.tiles.length < 1 || r.tiles.length > 4) fail("tiles must list 1-4 tiles");
    tiles = (r.tiles as unknown[]).map((v, i) => { const t = record(v, `tiles[${i}]`); return { label: copy(t.label, `tiles[${i}].label`), value: copy(t.value, `tiles[${i}].value`), note: copy(t.note, `tiles[${i}].note`) }; });
  }
  return {
    ticker, name: text(r.name, "name", 80), exchange: text(r.exchange, "exchange", 20), quoteTicker: text(r.quoteTicker, "quoteTicker", 20),
    period, periodQuarter: periodQuarter as number, releasedOn, periodEnd, reviewedOn, currency, sources, evidence, numbers, history, summary, tiles, grossMarginBasis, epsBasis,
  };
}

/** What the page receives. The deep dive itself (numbers, chart, cards, conclusion) is PRO: for anyone else it is left out on the
 * server, never sent and hidden. The facts and the top tiles are the same as the legacy page shows to everyone. */
export type CompanyDiveView = Omit<CompanyDive, "evidence" | "numbers" | "history" | "summary"> & {
  dive: { numbers: DiveNumbers; history: DiveHistory[]; summary: DiveSummary } | null;
};
export function companyDiveView(dive: CompanyDive, paid: boolean): CompanyDiveView {
  const { evidence: _evidence, numbers, history, summary, ...facts } = dive;
  void _evidence;
  return { ...facts, dive: paid ? { numbers, history, summary } : null };
}

/** The server boundary of a company page's dive: paid for a signed-in PRO member with unexpired access, and always for the owner
 * accounts (AGENTS.md operator access), also while the owner tries the app as FREE. Everyone else gets the facts only. */
export function companyDiveForMember(dive: CompanyDive, member: PageMember, now = Date.now()): CompanyDiveView {
  return companyDiveView(dive, proPageAllowed(member, now));
}
