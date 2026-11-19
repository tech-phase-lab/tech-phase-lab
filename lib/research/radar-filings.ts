import { CAPEX, CASH, OPERATING_CASH, REVENUE, type CompanyFacts, type LatestFiling, type RadarFacts } from "./radar-facts.ts";

/** What the SEC's "company facts" can miss, filled from the SEC's own filing archive (Nov 18, owner: "本当に見てる？" — Nebius had
 * reported its third quarter and the radar still showed its 2025 year):
 *
 *  1. A foreign filer (20-F / 40-F) files its quarters as a 6-K whose financial statements are an HTML exhibit without XBRL, so the
 *     company facts stop at the last annual report. The exhibit's balance sheet, statement of operations and cash flow statement are
 *     read here (dollars only), as facts of form "6-K".
 *  2. A 10-Q or 10-K the company facts have not taken in yet (Constellation's 10-Q of Nov 9 was still missing on Nov 18): the filing's
 *     own XBRL instance is read.
 *
 * Every step is pure apart from `fetchText`, so it is tested with small fixtures. A filing that cannot be read leaves the facts as they
 * were, and the radar then reports the company as behind (`filingLag`). */

export type Submissions = { filings?: { recent?: Record<string, unknown[]> } };
export type Filing = { form: string; accession: string; filed: string; period: string; primaryDocument: string; xbrl: boolean };
export type FetchText = (url: string, limit: number) => Promise<string>;
type Row = { start?: string; end: string; val: number; form: string; filed: string; accn: string };

const DAY = 86_400_000;
const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIODIC = /^(?:10-K|10-Q|20-F|40-F)(?:\/A)?$/;
const FOREIGN = /^(?:20-F|40-F)(?:\/A)?$/;

/** The filings of the SEC's submissions list, newest first. */
export function recentFilings(submissions: unknown): Filing[] {
  const recent = (submissions as Submissions | null)?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) return [];
  const at = (key: string, i: number) => (Array.isArray(recent[key]) ? recent[key][i] : undefined);
  const out: Filing[] = [];
  for (let i = 0; i < recent.form.length; i++) {
    const form = at("form", i), accession = at("accessionNumber", i), filed = at("filingDate", i);
    if (typeof form !== "string" || typeof accession !== "string" || typeof filed !== "string" || !DATE.test(filed)) continue;
    const period = at("reportDate", i);
    out.push({ form, accession, filed, period: typeof period === "string" && DATE.test(period) ? period : "", primaryDocument: String(at("primaryDocument", i) ?? ""), xbrl: at("isXBRL", i) === 1 });
  }
  return out;
}

/** The newest 10-Q, 10-K, 20-F or 40-F by the period it covers (an amendment of an older period never counts as newer). */
export function latestPeriodic(filings: Filing[]): Filing | null {
  let best: Filing | null = null;
  for (const f of filings) if (PERIODIC.test(f.form) && f.period && (!best || f.period > best.period || (f.period === best.period && f.filed > best.filed))) best = f;
  return best;
}

const taxonomyOf = (tag: string) => tag.includes(":") ? tag.split(":", 2) as [string, string] : ["us-gaap", tag] as const;
const usdRows = (data: CompanyFacts, tag: string): Row[] => {
  const [taxonomy, name] = taxonomyOf(tag);
  const rows = (data.facts?.[taxonomy]?.[name]?.units as Record<string, unknown> | undefined)?.USD;
  return Array.isArray(rows) ? rows as Row[] : [];
};
/** The newest balance date of the cash line. */
export function latestCashEnd(data: CompanyFacts): string | null {
  let best: string | null = null;
  for (const tag of CASH) for (const row of usdRows(data, tag)) if (!row.start && typeof row.end === "string" && (!best || row.end > best)) best = row.end;
  return best;
}
const hasFiling = (data: CompanyFacts, accession: string) => [...CASH, ...OPERATING_CASH].some(tag => usdRows(data, tag).some(row => row.accn === accession));

/** Adds `extra` to `base` (new objects; neither input is changed). */
export function mergeFacts(base: CompanyFacts, extra: CompanyFacts): CompanyFacts {
  const facts: NonNullable<CompanyFacts["facts"]> = { ...(base.facts ?? {}) };
  for (const [taxonomy, tags] of Object.entries(extra.facts ?? {})) {
    const merged = { ...(facts[taxonomy] ?? {}) };
    for (const [tag, body] of Object.entries(tags)) {
      const units = { ...(merged[tag]?.units ?? {}) };
      for (const [unit, rows] of Object.entries(body.units ?? {})) units[unit] = [...(Array.isArray(units[unit]) ? units[unit] as Row[] : []), ...(rows as Row[])];
      merged[tag] = { ...(merged[tag] ?? {}), units };
    }
    facts[taxonomy] = merged;
  }
  return { ...base, facts };
}

function collect(rows: { tag: string; row: Row }[]): CompanyFacts {
  const facts: NonNullable<CompanyFacts["facts"]> = {};
  const seen = new Set<string>();
  for (const { tag, row } of rows) {
    const [taxonomy, name] = taxonomyOf(tag);
    const key = `${taxonomy}:${name}:${row.start ?? ""}:${row.end}`;
    if (seen.has(key)) continue; // the first statement that shows a line wins (the face of the statements comes before the notes)
    seen.add(key);
    const bucket = (facts[taxonomy] ??= {});
    ((bucket[name] ??= { units: { USD: [] } }).units!.USD as Row[]).push(row);
  }
  return { facts };
}

// ---------- an XBRL instance (a 10-Q the company facts do not hold yet) ----------

/** The company's own (no dimension) dollar facts of us-gaap and ifrs-full from an XBRL instance document. */
export function parseXbrlInstance(xml: string, form: string, filed: string, accession: string): CompanyFacts {
  const contexts = new Map<string, { start?: string; end: string }>();
  for (const m of xml.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g)) {
    const body = m[2];
    if (/<(?:xbrli:)?(?:segment|scenario)\b/.test(body)) continue; // a part of the company (a subsidiary, a segment), not the whole
    const instant = /<(?:xbrli:)?instant>\s*(\d{4}-\d{2}-\d{2})\s*</.exec(body)?.[1];
    const start = /<(?:xbrli:)?startDate>\s*(\d{4}-\d{2}-\d{2})\s*</.exec(body)?.[1];
    const end = /<(?:xbrli:)?endDate>\s*(\d{4}-\d{2}-\d{2})\s*</.exec(body)?.[1];
    if (instant) contexts.set(m[1], { end: instant });
    else if (start && end) contexts.set(m[1], { start, end });
  }
  const dollars = new Set<string>();
  for (const m of xml.matchAll(/<(?:xbrli:)?unit\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?unit>/g)) {
    if (/iso4217:USD\s*</.test(m[2]) && !/divide/.test(m[2])) dollars.add(m[1]);
  }
  const rows: { tag: string; row: Row }[] = [];
  for (const m of xml.matchAll(/<(us-gaap|ifrs-full):([A-Za-z0-9_]+)\b([^>]*?)>([^<]*)<\/\1:\2>/g)) {
    const attrs = m[3];
    const context = contexts.get(/\bcontextRef="([^"]+)"/.exec(attrs)?.[1] ?? "");
    const unit = /\bunitRef="([^"]+)"/.exec(attrs)?.[1];
    const val = Number(m[4].trim());
    if (!context || !unit || !dollars.has(unit) || !m[4].trim() || !Number.isFinite(val)) continue;
    rows.push({ tag: m[1] === "us-gaap" ? m[2] : `${m[1]}:${m[2]}`, row: { ...context, val, form, filed, accn: accession } });
  }
  return collect(rows);
}

// ---------- a 6-K exhibit's financial statements (HTML tables) ----------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})\\b`, "gi");
function decode(text: string): string {
  return text.replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;|&quot;/g, "\"")
    .replace(/[​ \s]+/g, " ").trim();
}
/** A table cell's number: "1,234.5", "(432.4)", "$ 24.5", "—" (nil). Null for anything else. */
function cellNumber(text: string): number | null {
  const t = text.replace(/\$/g, "").replace(/\s+/g, "");
  if (/^[—–-]+$/.test(t)) return 0;
  const m = /^(\()?(-)?(\d{1,3}(?:,\d{3})*|\d+)(\.\d+)?(\))?$/.exec(t);
  if (!m) return null;
  const value = Number(`${m[3].replace(/,/g, "")}${m[4] ?? ""}`);
  return m[1] || m[2] ? -value : value;
}
const isYear = (text: string) => /^(?:19|20)\d{2}$/.test(text.replace(/\s+/g, ""));

type Column = { start?: string; end: string };
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
/** A period of `months` ending on `end`: a month end starts on the first of a month, a 52/53-week date one day after the same date `months` earlier. */
function startOf(end: string, months: number): string {
  const [y, m, d] = end.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).getUTCDate() === d;
  return monthEnd ? iso(y, m - months, 1) : iso(y, m - 1 - months, d + 1);
}
/** The columns a statement's header names: instants ("As of December 31, | September 30, | 2025 | 2026") or periods ("Three months ended
 * September 30, | Nine months ended September 30, | 2025 2026 2025 2026"). Null when the header cannot be read with certainty. */
function columnsOf(header: string[], years: number[]): { kind: "instant" | "duration"; columns: Column[] } | null {
  const text = header.join(" ").toLowerCase();
  const groups = [...text.matchAll(/\b(three|six|nine|twelve|3|6|9|12)[\s-]+months?\s+ended\b|\b(?:fiscal\s+)?year\s+ended\b/g)]
    .map(m => ({ three: 3, six: 6, nine: 9, twelve: 12 } as Record<string, number>)[m[1] ?? "twelve"] ?? Number(m[1]));
  const days = [...text.matchAll(MONTH)].map(m => ({ month: MONTHS.indexOf(m[1].toLowerCase()) + 1, day: Number(m[2]) }));
  const full = [...text.matchAll(new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2}),?\\s+((?:19|20)\\d{2})\\b`, "gi"))];
  let dates: string[];
  if (!years.length && full.length) dates = full.map(m => iso(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()), Number(m[2])));
  else if (years.length && days.length === years.length) dates = years.map((y, i) => iso(y, days[i].month - 1, days[i].day));
  else if (years.length && days.length && years.length % days.length === 0) {
    const per = years.length / days.length;
    dates = years.map((y, i) => iso(y, days[Math.floor(i / per)].month - 1, days[Math.floor(i / per)].day));
  } else return null;
  if (dates.some(d => !DATE.test(d))) return null;
  if (!groups.length) return /months?\s+ended|year\s+ended/.test(text) ? null : { kind: "instant", columns: dates.map(end => ({ end })) };
  if (dates.length % groups.length) return null;
  const per = dates.length / groups.length;
  return { kind: "duration", columns: dates.map((end, i) => ({ start: startOf(end, groups[Math.floor(i / per)]), end })) };
}

type Line = { tag: string; kind: "instant" | "duration"; abs?: boolean };
const label = (text: string) => text.toLowerCase().replace(/\(\d\)|\*/g, "").replace(/[’']/g, "'").replace(/\s*[:–—-]\s*$/, "").replace(/\s+/g, " ").trim();
/** The first tag of `candidates` the company already uses (so the quarter joins its annual line), else the first. */
const preferred = (base: CompanyFacts, candidates: string[]) => candidates.find(tag => usdRows(base, tag).length) ?? candidates[0];
function lineOf(text: string, base: CompanyFacts): Line | null {
  const l = label(text);
  if (/^(?:total )?(?:net )?revenues?(?:, net)?$/.test(l)) return { tag: preferred(base, REVENUE), kind: "duration" };
  if (/^net cash\b.*\boperating activities$/.test(l) && !/continuing|discontinued/.test(l)) return { tag: preferred(base, OPERATING_CASH), kind: "duration" };
  if (/^(?:purchases?|acquisitions?|payments? for (?:the )?(?:purchases?|acquisitions?)|capital expenditures?)(?: of)? property(?:,)? (?:plant,? )?(?:and )?equipment/.test(l) || /^capital expenditures?$/.test(l)) return { tag: preferred(base, CAPEX), kind: "duration", abs: true };
  if (/^cash and cash equivalents$/.test(l)) return { tag: preferred(base, ["CashAndCashEquivalentsAtCarryingValue", "ifrs-full:CashAndCashEquivalents"]), kind: "instant" };
  if (/^(?:short-term investments|short-term marketable securities|marketable securities, current)$/.test(l)) return { tag: "ShortTermInvestments", kind: "instant" };
  if (/^(?:debt, current|current debt|short-term debt|short-term borrowings|current portion of (?:long-term )?debt(?:, net)?)$/.test(l)) return { tag: "LongTermDebtCurrent", kind: "instant" };
  if (/^(?:debt, non-?current|non-?current debt|long-term debt(?:, net)?(?:, non-?current| of current portion|, less current portion|, net of current portion)?)$/.test(l)) return { tag: "LongTermDebtNoncurrent", kind: "instant" };
  if (/^operating lease liabilit(?:y|ies), current$/.test(l)) return { tag: "OperatingLeaseLiabilityCurrent", kind: "instant" };
  if (/^operating lease liabilit(?:y|ies), non-?current$/.test(l)) return { tag: "OperatingLeaseLiabilityNoncurrent", kind: "instant" };
  if (/^total operating lease liabilit(?:y|ies)$/.test(l)) return { tag: "OperatingLeaseLiability", kind: "instant" };
  if (/^finance lease liabilit(?:y|ies), current$/.test(l)) return { tag: "FinanceLeaseLiabilityCurrent", kind: "instant" };
  if (/^finance lease liabilit(?:y|ies), non-?current$/.test(l)) return { tag: "FinanceLeaseLiabilityNoncurrent", kind: "instant" };
  return null;
}
/** Millions or thousands of dollars, from the line above a statement; null for another currency or no stated scale. */
function scaleOf(text: string): number | null {
  const all = [...text.matchAll(/\bin (millions|thousands)(?: of ([^)(,;]{0,40}))?/gi)];
  const m = all.at(-1);
  if (!m) return null;
  const currency = (m[2] ?? "").toLowerCase();
  if (currency && !/u\.?s\.? dollars|us\$|^\s*\$|^\s*dollars|united states dollars/.test(currency)) return null;
  return m[1].toLowerCase() === "millions" ? 1e6 : 1e3;
}

/** The statements of a 6-K exhibit as facts of form "6-K" (dollars only). */
export function parseStatementTables(html: string, filed: string, accession: string, base: CompanyFacts): CompanyFacts {
  const rows: { tag: string; row: Row }[] = [];
  for (const table of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const before = decode(html.slice(Math.max(0, table.index - 4000), table.index));
    const scale = scaleOf(`${before} ${decode(table[0]).slice(0, 600)}`);
    if (!scale) continue;
    const header: string[] = [], years: number[] = [];
    let columns: ReturnType<typeof columnsOf> | undefined;
    for (const tr of table[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
      const cells = [...tr[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => decode(c[1])).filter(c => c && c !== "$" && c !== "%");
      // a closing bracket in its own cell belongs to the number before it
      const merged: string[] = [];
      for (const c of cells) if (c === ")" && merged.length) merged[merged.length - 1] += ")"; else merged.push(c);
      const numbers = merged.map(cellNumber);
      const name = merged.find((c, i) => numbers[i] === null && /[a-z]/i.test(c)) ?? "";
      if (columns === undefined) {
        // header rows: words and years only
        const values = merged.filter((c, i) => numbers[i] !== null);
        if (values.length && values.every(isYear)) { years.push(...values.map(v => Number(v.replace(/\s+/g, "")))); header.push(merged.filter(c => !isYear(c)).join(" ")); continue; }
        if (!values.length || !name) { header.push(merged.join(" ")); continue; }
        columns = columnsOf(header, years);
        if (!columns) break;
      }
      if (!columns || !name) continue;
      const line = lineOf(name, base);
      if (!line || line.kind !== columns.kind) continue;
      const values = numbers.filter((n): n is number => n !== null);
      if (values.length < columns.columns.length) continue;
      const own = values.slice(-columns.columns.length); // a "Notes" column comes before the figures
      own.forEach((value, i) => {
        const val = Math.round((line.abs ? Math.abs(value) : value) * scale);
        rows.push({ tag: line.tag, row: { ...columns!.columns[i], val, form: "6-K", filed, accn: accession } });
      });
    }
  }
  return collect(rows);
}

/** The balance date a 6-K's statements cover: the newest date with both the cash line and the operating cash flow. */
export function statementsEnd(extra: CompanyFacts): string | null {
  let best: string | null = null;
  const flows = new Set(OPERATING_CASH.flatMap(tag => usdRows(extra, tag).filter(r => r.start).map(r => r.end)));
  for (const tag of CASH) for (const row of usdRows(extra, tag)) if (!row.start && flows.has(row.end) && (!best || row.end > best)) best = row.end;
  return best;
}

// ---------- putting it together ----------

const archive = (cik: string, accession: string) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}`;
type IndexItem = { name: string; size: number };
async function indexOf(cik: string, accession: string, fetchText: FetchText): Promise<IndexItem[]> {
  const body = JSON.parse(await fetchText(`${archive(cik, accession)}/index.json`, 2_000_000)) as { directory?: { item?: { name?: unknown; size?: unknown }[] } };
  return (body.directory?.item ?? []).filter(i => typeof i.name === "string").map(i => ({ name: i.name as string, size: Number(i.size) || 0 }));
}

/** A foreign filer's newest quarter after `known`, from the statements in its 6-K exhibits (newest 6-K first, at most four).
 * `sawStatements` is true when an exhibit held statements that could not be read. */
async function readSixK(cik: string, filings: Filing[], known: string, base: CompanyFacts, fetchText: FetchText):
  Promise<{ extra: CompanyFacts; filing: LatestFiling } | { sawStatements: boolean }> {
  const candidates = filings.filter(f => /^6-K(?:\/A)?$/.test(f.form) && day(f.filed) - day(known) >= 20).slice(0, 4);
  let sawStatements = false;
  for (const sixK of candidates) {
    if (sixK.xbrl && hasFiling(base, sixK.accession)) break; // the company facts already hold it
    let items: IndexItem[];
    try { items = await indexOf(cik, sixK.accession, fetchText); } catch { continue; }
    const exhibits = items.filter(i => /\.html?$/i.test(i.name) && i.name !== sixK.primaryDocument && i.size >= 20_000 && i.size <= 8_000_000 && /ex|99/i.test(i.name))
      .sort((a, b) => b.size - a.size).slice(0, 2);
    for (const exhibit of exhibits) {
      let html: string;
      try { html = await fetchText(`${archive(cik, sixK.accession)}/${exhibit.name}`, 10_000_000); } catch { continue; }
      if (!/balance\s+sheets?/i.test(html) || !/cash\s+flows?/i.test(html)) continue;
      const extra = parseStatementTables(html, sixK.filed, sixK.accession, base);
      const end = statementsEnd(extra);
      if (end && end > known) return { extra, filing: { form: "6-K", period: end, filed: sixK.filed } };
      sawStatements = true;
    }
  }
  return { sawStatements };
}

export type Supplemented = { facts: CompanyFacts; filing: LatestFiling | null; unread: string | null };
/** Company facts plus what the archive holds beyond them; `filing` is the newest periodic report (or read 6-K), `unread` a code when a
 * newer filing exists that could not be read. Never throws for a filing that cannot be read. */
export async function supplementFacts(cik: string, base: CompanyFacts, submissions: unknown, fetchText: FetchText): Promise<Supplemented> {
  const filings = recentFilings(submissions);
  const periodic = latestPeriodic(filings);
  let facts = base, unread: string | null = null;
  let filing: LatestFiling | null = periodic ? { form: periodic.form, period: periodic.period, filed: periodic.filed } : null;
  if (!periodic) return { facts, filing, unread };
  // 1. an XBRL report the company facts do not hold yet
  if (periodic.xbrl && !hasFiling(facts, periodic.accession) && (latestCashEnd(facts) ?? "") < periodic.period) {
    try {
      const items = await indexOf(cik, periodic.accession, fetchText);
      const instance = items.find(i => /_htm\.xml$/i.test(i.name)) ?? items.find(i => /\.xml$/i.test(i.name) && !/_(?:cal|def|lab|pre)\.xml$|FilingSummary/i.test(i.name));
      const extra = instance ? parseXbrlInstance(await fetchText(`${archive(cik, periodic.accession)}/${instance.name}`, 40_000_000), periodic.form, periodic.filed, periodic.accession) : null;
      if (extra && latestCashEnd(extra) === periodic.period) facts = mergeFacts(facts, extra); else unread = "xbrl-unread";
    } catch { unread = "xbrl-unread"; }
  }
  // 2. a foreign filer's quarter, filed as a 6-K after its annual report
  if (FOREIGN.test(periodic.form)) {
    const read = await readSixK(cik, filings, latestCashEnd(facts) ?? periodic.period, facts, fetchText);
    if ("extra" in read) { facts = mergeFacts(facts, read.extra); filing = read.filing; }
    else if (read.sawStatements) unread = "6k-unread";
  }
  return { facts, filing, unread };
}

/** The newest period the company has filed, from the submissions list alone (a foreign filer's 6-K statements are read for their date),
 * for the freshness check: no company facts are downloaded. */
export async function filedPeriod(cik: string, submissions: unknown, fetchText: FetchText): Promise<LatestFiling | null> {
  const filings = recentFilings(submissions);
  const periodic = latestPeriodic(filings);
  if (!periodic) return null;
  const filing = { form: periodic.form, period: periodic.period, filed: periodic.filed };
  if (!FOREIGN.test(periodic.form)) return filing;
  const read = await readSixK(cik, filings, periodic.period, { facts: {} }, fetchText);
  return "extra" in read ? read.filing : filing;
}

/** Days a gap of this many days between the radar's period and the filed period means a missed quarter (52/53-week quarters move a few days). */
const SAME_PERIOD_DAYS = 20;
/** Two days after filing a result must be on the radar (owner, Nov 18). */
export const LAG_GRACE_DAYS = 2;
/** Why a company's radar period is behind what it filed, or null when it is current. `period` is what the radar shows (stored or calculated). */
export function filingLag(period: string | null, facts: Pick<RadarFacts, "filing" | "unread">, now = Date.now()): string | null {
  const filing = facts.filing;
  if (facts.unread) return facts.unread;
  if (!filing || !DATE.test(filing.period) || !DATE.test(filing.filed)) return null;
  if (now / DAY - day(filing.filed) <= LAG_GRACE_DAYS) return null;
  if (!period) return "missing";
  return day(filing.period) - day(period) > SAME_PERIOD_DAYS ? "behind" : null;
}

export type FreshnessEntry = { ticker: string; stored: string | null; filing: LatestFiling | null; unreadable?: boolean };
export type StaleItem = { ticker: string; code: string; stored: string | null; filed: string | null; form: string | null; filedOn: string | null };
/** The companies whose radar period lags what they filed by more than two days (tickers, codes and public filing dates only). */
export function staleItems(entries: FreshnessEntry[], now = Date.now()): StaleItem[] {
  const out: StaleItem[] = [];
  for (const { ticker, stored, filing, unreadable } of entries) {
    const code = unreadable ? "sec-unreadable" : filingLag(stored, { filing }, now);
    if (code) out.push({ ticker, code, stored, filed: filing?.period ?? null, form: filing?.form ?? null, filedOn: filing?.filed ?? null });
  }
  return out;
}
