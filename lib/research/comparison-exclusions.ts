/** Listed tickers the Stock Comparison does not offer (owner, Nov 19: option A). They file no revenue or profit of their own to compare:
 *  blank-check companies (SPACs), funds and commodity trusts, and a company's preferreds, warrants, units and rights. They are left out of
 *  the comparison's search, a direct request for one is answered as an unknown company (as before for any ticker the comparison does not
 *  know), and the background job spends no statement credits on them. Only certain cases are excluded; an ordinary share never is:
 *  - preferred, warrant, unit, right: the SEC's ticker suffix (CTA-PB, AAC-WT, KCAC-UN, NMZ-RI), or a Nasdaq ticker ending in W, U or R
 *    that is another ticker of the same company plus one or two letters (AACIW, AACIU beside AACI; MOBBW beside MOB, HTZWW beside HTZ,
 *    ZKPU beside ZKP: Nov 20, MOBBW was still offered because its base has three letters);
 *  - SPAC, fund: the issuer is on the audit's list (comparison-exclusions.json: SIC 6770, or a fund with no revenue) under the same name. A
 *    SPAC that completes its merger takes the operating company's name and is offered again without a new list;
 *  - ETN (exchange-traded note, owner Nov 20): a ticker the SEC files under a bank that issues ETNs (comparison-exclusions.json "etn": UBS AG,
 *    Barclays Bank PLC, Credit Suisse AG, Deutsche Bank, Bank of Montreal, JPMorgan, Goldman Sachs, ...) other than that bank's own shares
 *    (DB, BMO, JPM, GS). An ETN pays out on an index (VXX, BDCZ, DGZ, FNGU); its filings are the bank's, which say nothing about the note.
 *    The banks' own shares and those of their parents (UBS, BCS: another CIK) are offered as before. */

import exclusionLists from "./comparison-exclusions.json" with { type: "json" };

/** etn: the ETN issuer's CIK, its name and its own share tickers (any other ticker under that CIK is a note). */
export type EtnIssuer = { name: string; shares: string[] };
export type ExclusionLists = { spac: Record<string, string>; fund: Record<string, string>; etn: Record<string, EtnIssuer> };
export type ExclusionKind = "spac" | "fund" | "etn" | "preferred" | "warrant" | "unit" | "right";
type Entry = { ticker: string; cik: number | string; name: string; exchange?: string };

const SUFFIX: [RegExp, ExclusionKind][] = [[/-P[A-Z]?$/, "preferred"], [/-(?:WTA?|WS|W)$/, "warrant"], [/-(?:UN|U)$/, "unit"], [/-(?:RI|R)$/, "right"]];
const FIFTH: Record<string, ExclusionKind> = { W: "warrant", U: "unit", R: "right" };
const sameName = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** The audit's list of SPACs, funds and ETN issuers (comparison-exclusions.json). */
export const COMPARISON_EXCLUSIONS: ExclusionLists = exclusionLists;

/** The tickers of each company, for the Nasdaq warrant, unit and right rule (built once per directory). */
export function tickersByCik(entries: Entry[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const e of entries) { const key = String(Number(e.cik)); const set = out.get(key) ?? new Set<string>(); set.add(e.ticker); out.set(key, set); }
  return out;
}

export function comparisonExclusion(entry: Entry, siblings: Map<string, Set<string>>, lists: ExclusionLists): ExclusionKind | null {
  const ticker = entry.ticker.toUpperCase(), cik = String(Number(entry.cik));
  for (const [pattern, kind] of SUFFIX) if (pattern.test(ticker)) return kind;
  const last = FIFTH[ticker.at(-1) ?? ""];
  if (/^[A-Z]{2,6}$/.test(ticker) && last && (entry.exchange === undefined || entry.exchange === "Nasdaq")
    && [1, 2].some(n => ticker.length - n >= 1 && siblings.get(cik)?.has(ticker.slice(0, -n)))) return last;
  if (lists.spac[cik] !== undefined && sameName(lists.spac[cik], entry.name)) return "spac";
  if (lists.fund[cik] !== undefined && sameName(lists.fund[cik], entry.name)) return "fund";
  // A CIK names one legal entity for good, so the issuer is matched on it alone (the SEC may rename it: Credit Suisse AG is now part of UBS).
  const issuer = lists.etn[cik];
  if (issuer !== undefined && !issuer.shares.includes(ticker)) return "etn";
  return null;
}

/** The directory without the tickers the comparison does not offer (its search). */
export function comparableEntries<T extends Entry>(entries: T[], lists: ExclusionLists): T[] {
  const siblings = tickersByCik(entries);
  return entries.filter(e => comparisonExclusion(e, siblings, lists) === null);
}
