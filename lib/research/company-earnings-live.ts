import registry from "./providers.json" with { type: "json" };
import type { WatchTile } from "./company-watch";
import { diveMoney, divePerShare, type DiveCurrency } from "./dive-money.ts";

/**
 * 直近決算 on a 監視銘柄 company page, updated as soon as the company reports (owner, Nov 26).
 *
 * The page's own quarter comes from lib/research/dives/<TICKER>.json, which changes only with a deploy. The monitor already reads
 * every roster company's results release the moment it is filed (scripts/research/issuer_result_flash.py: the SEC 8-K Exhibit 99.1,
 * the 6-K of a foreign issuer, or the company's own results page) and copies the figures out of its results table with fixed
 * patterns. When that flash is for a newer quarter than the file, the top of the page (heading, release date and the three tiles)
 * shows the flash instead; the deep dive below keeps its own quarter, labelled with it, until a new dive is published.
 *
 * Accuracy first: only the deterministic issuer-table flash is used (never the "announced" line, never a figure read back from a
 * model-written article), from the company's own hosts, and only when its revenue reads in the file's currency. Every value on a
 * tile is the release's own figure; the only change is the site's unit format (115.8B dollars shown as 1,158億ドル). A flash that
 * does not meet every rule is not shown (`hold` says why) and the page keeps the file's quarter.
 */
export type FlashFact = { key: string; ja: string; en: string; value: string; comparisons?: { yearAgo?: string; growth?: string } };
export type FlashBrief = {
  id?: string; researchId?: string; kind?: string; ticker?: string; period?: string; facts?: FlashFact[]; url?: string; publisher?: string;
  publishedAt?: string; observedAt?: string; method?: string | null;
};
export type LiveRelease = { ticker: string; period: string; releasedOn: string; sourceUrl: string; publisher: string; tiles: WatchTile[] };
export type Shown = { ticker: string; period: string; releasedOn: string; currency: DiveCurrency };
export type LiveDecision = { release: LiveRelease | null; hold: string | null };

const DAY = 86_400_000;
/** The same release, seen a day apart in two time zones, is not a newer one (lib/research/dive-staleness.ts uses the same week). */
const SAME_RELEASE_DAYS = 7;
const FLASH_ID = /^ir-flash-\d{1,20}$/;
const DETERMINISTIC = new Set<string | null | undefined>([undefined, null, "deterministic-issuer-table"]);
const HOSTS = new Map((registry as { ticker: string; allowedHosts?: string[] }[]).map(p => [p.ticker, new Set(p.allowedHosts ?? [])]));

/** "Q2 FYE27" / "Q3 FY2027" / "Q3 2026" → the dive files' own labels ("Q2 FY2027", "Q3 2026"); null for anything else. */
export function normalizePeriod(label: unknown): string | null {
  if (typeof label !== "string") return null;
  const m = /^Q([1-4]) (FYE?)?\s?(\d{2}|20\d{2})$/.exec(label.trim());
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return m[2] ? `Q${m[1]} FY${year}` : `Q${m[1]} ${year}`;
}

const PREFIX: Record<string, DiveCurrency> = { "$": "USD", "NT$": "TWD", "€": "EUR", "₩": "KRW" };
const SCALE: Record<string, number> = { K: 0.001, M: 1, B: 1_000, T: 1_000_000 };
/** "$115.8B" → {USD, 115800}; "$-37.5M" → {USD, -37.5}; "₩104.615483T" → {KRW, 104615483}. Anything else (ranges, "±", words): null. */
export function parseAmount(value: string): { currency: DiveCurrency; millions: number } | null {
  const m = /^(NT\$|\$|€|₩)(-?\d+(?:\.\d+)?)([KMBT])$/.exec(value.trim());
  if (!m) return null;
  const millions = Number(m[2]) * SCALE[m[3]];
  return Number.isFinite(millions) ? { currency: PREFIX[m[1]], millions } : null;
}
/** "$2.70" → {USD, 2.7}; "NT$29.43"; "$-1.27". */
export function parsePerShare(value: string): { currency: DiveCurrency; value: number } | null {
  const m = /^(NT\$|\$|€|₩)(-?\d+(?:\.\d+)?)$/.exec(value.trim());
  return m ? { currency: PREFIX[m[1]], value: Number(m[2]) } : null;
}
const PERCENT = /^-?\d+(?:\.\d+)?%$/;

/** A figure in the site's unit format, or the release's own text when it is not a single amount (a guidance range stays as printed).
 * null: an amount in another currency than the page's (never converted). */
function shownValue(fact: FlashFact, currency: DiveCurrency): { ja: string; en: string } | null {
  const amount = parseAmount(fact.value);
  if (amount) return amount.currency === currency ? { ja: diveMoney(amount.millions, currency, "ja"), en: diveMoney(amount.millions, currency, "en") } : null;
  const share = parsePerShare(fact.value);
  if (share) return share.currency === currency ? { ja: divePerShare(share.value, currency, "ja"), en: divePerShare(share.value, currency, "en") } : null;
  if (PERCENT.test(fact.value)) return { ja: fact.value, en: fact.value };
  // A guidance range or band ("$65B ± 2%", "€14.2B-€15.2B") is shown exactly as the release states it.
  return fact.key.startsWith("guidance-") && fact.value.length <= 40 ? { ja: fact.value, en: fact.value } : null;
}
function note(fact: FlashFact, currency: DiveCurrency): { ja: string; en: string } {
  if (fact.key.startsWith("guidance-")) return { ja: "会社予想", en: "Company guidance" };
  const prior = fact.comparisons?.yearAgo;
  const priorShown = prior ? shownValue({ ...fact, value: prior }, currency) : null;
  return priorShown ? { ja: `前年同期 ${priorShown.ja}`, en: `Prior-year quarter ${priorShown.en}` } : { ja: "四半期実績", en: "Quarterly actual" };
}
/** Revenue, then the margin or EPS, then the outlook or a profit line: the same order as a dive file's derived tiles. */
const SECOND = ["gross-margin", "adjusted-eps", "eps"];
const THIRD = ["guidance-revenue", "operating-income", "net-income", "adjusted-ebitda"];
export function flashTiles(facts: FlashFact[], currency: DiveCurrency): WatchTile[] | null {
  const pick = (keys: string[]) => keys.map(k => facts.find(f => f.key === k)).find(f => f && shownValue(f, currency));
  const revenue = facts.find(f => f.key === "revenue");
  const revenueAmount = revenue ? parseAmount(revenue.value) : null;
  if (!revenue || !revenueAmount || revenueAmount.currency !== currency || revenueAmount.millions <= 0) return null;
  const chosen = [revenue, pick(SECOND), pick(THIRD)].filter((f): f is FlashFact => !!f);
  if (chosen.length < 2) return null;
  return chosen.map(f => ({ label: { ja: f.ja, en: f.en }, value: shownValue(f, currency)!, note: note(f, currency) }));
}

const newYorkDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
/** The release day: New York date of the publication time; a date-only stamp (midnight UTC, e.g. SK hynix) is its own date. */
export function releaseDay(iso: string): string | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return /T00:00:00(?:\.000)?(?:Z|\+00:00)$/.test(iso) ? iso.slice(0, 10) : newYorkDate(iso);
}

function hostAllowed(ticker: string, url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  return parsed.protocol === "https:" && !parsed.username && !parsed.password && (HOSTS.get(ticker)?.has(parsed.hostname) ?? false);
}

/**
 * The newest issuer-table flash for `shown.ticker` that is a newer quarter than the page's file, or null with the reason it is held.
 * hold null and release null: nothing newer (the normal case between reports).
 */
export function liveRelease(briefs: unknown, shown: Shown, now = Date.now()): LiveDecision {
  if (!Array.isArray(briefs)) return { release: null, hold: null };
  const shownAt = Date.parse(`${shown.releasedOn}T00:00:00Z`);
  const candidates = (briefs as FlashBrief[]).filter(b => b && typeof b === "object" && b.ticker === shown.ticker && b.kind === "earnings")
    .map(b => ({ b, day: typeof b.publishedAt === "string" ? releaseDay(b.publishedAt) : null }))
    .filter((c): c is { b: FlashBrief; day: string } => !!c.day && Date.parse(`${c.day}T00:00:00Z`) - shownAt > SAME_RELEASE_DAYS * DAY && Date.parse(c.b.publishedAt!) <= now)
    .sort((a, b) => b.day.localeCompare(a.day));
  if (!candidates.length) return { release: null, hold: null };
  // Only the newest release counts: a held newest release never lets an older one take its place. Its "announced" line and a
  // fallback can sit beside its table flash (same release, a day apart at most across time zones); the table flash is the one used.
  const top = Date.parse(`${candidates[0].day}T00:00:00Z`);
  const newest = candidates.find(c => top - Date.parse(`${c.day}T00:00:00Z`) <= 2 * DAY && FLASH_ID.test(String(c.b.researchId ?? "")) && DETERMINISTIC.has(c.b.method));
  if (!newest) return { release: null, hold: "not-issuer-table" };
  const b = newest.b;
  const period = normalizePeriod(b.period);
  if (!period) return { release: null, hold: "period-unreadable" };
  if (period === shown.period) return { release: null, hold: null };
  if (typeof b.url !== "string" || !hostAllowed(shown.ticker, b.url)) return { release: null, hold: "source-host" };
  if (!Array.isArray(b.facts)) return { release: null, hold: "no-facts" };
  const facts = b.facts.filter(f => f && typeof f.key === "string" && typeof f.value === "string" && typeof f.ja === "string" && typeof f.en === "string"
    && f.ja.length > 0 && f.ja.length <= 40 && f.en.length > 0 && f.en.length <= 60);
  const tiles = flashTiles(facts, shown.currency);
  if (!tiles) return { release: null, hold: "figures-unreadable" };
  return { release: { ticker: shown.ticker, period, releasedOn: newest.day, sourceUrl: b.url, publisher: typeof b.publisher === "string" && b.publisher.length <= 80 ? b.publisher : "Official earnings release", tiles }, hold: null };
}

/** "$115.8B", "NT$1,494.24B", "₩104.6T", "€11.66B", "$584.9M" (a tile's English value) → its amount, and half a unit of its last
 * printed digit (the rounding a matching figure may differ by). null when the tile is not a single amount. */
export function tileAmount(value: string): { currency: DiveCurrency; millions: number; tolerance: number } | null {
  const m = /^(−|-)?(NT\$|\$|€|₩)(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)([KMBT])$/.exec(value.trim());
  if (!m) return null;
  const digits = m[3].replace(/,/g, ""), places = digits.includes(".") ? digits.split(".")[1].length : 0;
  const scale = SCALE[m[4]];
  return { currency: PREFIX[m[2]], millions: (m[1] ? -1 : 1) * Number(digits) * scale, tolerance: 0.5 * 10 ** -places * scale };
}
/** "$130.0B ± 3%", "€14.2B-€15.2B", "$65B" → its currency and [low, high] in millions; null for anything else. */
export function guidanceRange(value: string): { currency: DiveCurrency; low: number; high: number } | null {
  const band = /^(\S+)\s*±\s*(\d+(?:\.\d+)?)%$/.exec(value.trim());
  if (band) { const a = parseAmount(band[1]); const p = Number(band[2]) / 100; return a ? { currency: a.currency, low: a.millions * (1 - p), high: a.millions * (1 + p) } : null; }
  const range = /^(\S+?)\s*[-–]\s*(\S+)$/.exec(value.trim());
  if (range) { const a = parseAmount(range[1]), b = parseAmount(range[2]); return a && b && a.currency === b.currency ? { currency: a.currency, low: a.millions, high: b.millions } : null; }
  const one = parseAmount(value);
  return one ? { currency: one.currency, low: one.millions, high: one.millions } : null;
}
const close = (a: number, b: number, relative = 0.005) => Math.abs(a - b) <= Math.abs(b) * relative + 1e-9;

/** What a company page shows at the top, and whether its deep dive agrees with it: for the monitor's patrol (scripts/research/
 * earnings_patrol.py) through GET /api/research/company-earnings. Only what the page shows everyone (period, date, tiles) leaves the
 * server; the dive's own figures (PRO) are compared here and only the yes/no answers are returned. */
export type SectionReport = {
  ticker: string;
  section: { from: "dive" | "live"; period: string; releasedOn: string; sourceUrl: string | null; tiles: { label: string; value: string }[] };
  dive: { period: string; releasedOn: string; reviewedOn: string };
  hold: string | null;
  checks: {
    /** The dive covers the quarter the section shows. */
    diveCurrent: boolean;
    /** The dive's revenue against the section's revenue tile (same quarter only; null when not comparable). */
    diveRevenue: boolean | null;
    /** The dive's figures against the monitor's own reading of the same release (null: no reading of that release is stored). */
    flashRevenue: boolean | null; flashEps: boolean | null; flashGuidance: boolean | null;
  };
};
type DiveFacts = { ticker: string; period: string; releasedOn: string; reviewedOn: string; currency: DiveCurrency; sources: { url: string }[];
  tiles: WatchTile[]; labels: { eps: { en: string } };
  numbers: { revenue: { current: number }; adjustedEPS: number | null; guidance: { low: number; high: number } | null } };

/** The monitor's table flash of the dive's own release (published within two days of it), if it stored one. */
function flashOf(briefs: unknown, dive: DiveFacts): FlashBrief | null {
  if (!Array.isArray(briefs)) return null;
  const at = Date.parse(`${dive.releasedOn}T00:00:00Z`);
  return (briefs as FlashBrief[]).find(b => b && b.ticker === dive.ticker && b.kind === "earnings" && FLASH_ID.test(String(b.researchId ?? ""))
    && DETERMINISTIC.has(b.method) && typeof b.publishedAt === "string" && Array.isArray(b.facts)
    && Math.abs(Date.parse(`${releaseDay(b.publishedAt) ?? ""}T00:00:00Z`) - at) <= 2 * DAY) ?? null;
}
export function sectionReport(dive: DiveFacts, decision: LiveDecision, briefs: unknown): SectionReport {
  const live = decision.release;
  const tiles = (live ? live.tiles : dive.tiles).map(t => ({ label: t.label.en, value: t.value.en }));
  const shownRevenue = tileAmount(tiles[0]?.value ?? "");
  const diveRevenue = !live && shownRevenue && shownRevenue.currency === dive.currency
    ? Math.abs(shownRevenue.millions - dive.numbers.revenue.current) <= shownRevenue.tolerance + 1e-9 : null;
  const flash = flashOf(briefs, dive);
  const fact = (key: string) => flash?.facts?.find(f => f.key === key);
  const flashRevenueAmount = fact("revenue") ? parseAmount(fact("revenue")!.value) : null;
  const flashRevenue = flashRevenueAmount ? flashRevenueAmount.currency === dive.currency && close(dive.numbers.revenue.current, flashRevenueAmount.millions, 0.0005) : null;
  // The same basis only: an adjusted (non-GAAP) EPS in the file against the release's adjusted EPS, a reported one against the diluted EPS.
  const epsFact = fact(/^Adjusted\b/.test(dive.labels.eps.en) ? "adjusted-eps" : "eps");
  const eps = epsFact ? parsePerShare(epsFact.value) : null;
  const flashEps = dive.numbers.adjustedEPS === null || !eps || eps.currency !== dive.currency ? null : Math.abs(eps.value - dive.numbers.adjustedEPS) < 0.005;
  const guidanceFact = fact("guidance-revenue");
  const nextQuarter = guidanceFact && /next[- ]quarter/i.test(guidanceFact.en) ? guidanceRange(guidanceFact.value) : null;
  // Only in the file's currency: TSMC guides in US dollars and the file converts at the company's own rate (its basis says so).
  const flashGuidance = !nextQuarter || !dive.numbers.guidance || nextQuarter.currency !== dive.currency ? null
    : close(dive.numbers.guidance.low, nextQuarter.low) && close(dive.numbers.guidance.high, nextQuarter.high);
  return {
    ticker: dive.ticker,
    section: { from: live ? "live" : "dive", period: live?.period ?? dive.period, releasedOn: live?.releasedOn ?? dive.releasedOn,
      sourceUrl: live?.sourceUrl ?? dive.sources[0]?.url ?? null, tiles },
    dive: { period: dive.period, releasedOn: dive.releasedOn, reviewedOn: dive.reviewedOn },
    hold: decision.hold,
    checks: { diveCurrent: !live, diveRevenue, flashRevenue, flashEps, flashGuidance },
  };
}
