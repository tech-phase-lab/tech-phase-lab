/** One Japanese / English display name per ticker for トレジャーハント and クジラの足あと (owner, Nov 22: the lists showed SEC legal names such as
 * "HUBSPOT INC" in the Japanese column). Server only: the API routes put these names on the payload, so the browser never loads the maps.
 *
 * Japanese, first that applies:
 *   1. the Theme Ranking names (theme-stock-names.json), Latin spellings such as "TSMC" or "AMD" included, as the map writes them;
 *   2. the first spelling the stock search lists for the ticker (stock-search.ts);
 *   3. the Wikidata Japanese label the stock search matches by SEC issuer ID (japanese-company-names.json), when it is written in kana or kanji;
 *   4. otherwise the clean English name below. No katakana is made up for a company none of these lists.
 * English: the Theme Ranking name, else the universe's name (value-check-universe.json), always through cleanEnglishName. */
import themeNames from "./theme-stock-names.json" with { type: "json" };
import directory from "./japanese-company-names.json" with { type: "json" };
import universe from "./value-check-universe.json" with { type: "json" };
import { japaneseNamesOf } from "./stock-search.ts";
import type { ValueSnapshot } from "./value-check.ts";
import type { WhaleSnapshot } from "./whale-moves.ts";

type Pair = { ja: string; en: string };
const theme = themeNames as Record<string, Pair>;
const namesByCik = directory.namesByCik as Record<string, string[]>;
const companies = universe.companies as Record<string, { cik?: number | null; en?: string | null; ja?: string | null }>;

const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const PARENTHESIS = /[(（]/;
/** Theme Ranking names that describe one business inside a company for a relationship map (e.g. ABT as "Abbott Diabetes Care", PSA as the
 * card grader), which are wrong as a whole-company name. The map stays as it is; these tickers take their company name here instead. */
const COMPANY_NAME: Record<string, string> = {
  ABT: "Abbott Laboratories", AEP: "American Electric Power", PSA: "Public Storage", UNH: "UnitedHealth Group",
  OXY: "Occidental Petroleum", CFG: "Citizens Financial Group",
};
/** Wikidata Japanese labels that name a former company or one unit (e.g. TT as インガソール・ランド, AFL as the Japanese insurer): English instead. */
const STALE_LABEL = new Set(["AFL", "CBRE", "COO", "COR", "ES", "GL", "HWM", "IVZ", "J", "KDP", "LH", "P", "PTC", "RVTY", "TT", "VMRK"]);
/** Share classes take the name of the class the lists below know. */
const SAME_COMPANY: Record<string, string> = { GOOG: "GOOGL" };
/** The company's own spelling where the SEC record is all capitals (the generic rule below cannot know "HubSpot" from "Hubspot"). */
const SPELLING: Record<string, string> = {
  HUBS: "HubSpot", GFS: "GlobalFoundries", SITM: "SiTime", DOCU: "DocuSign", SYNA: "Synaptics", AMKR: "Amkor Technology",
  ENTG: "Entegris", ONTO: "Onto Innovation", LSCC: "Lattice Semiconductor", RMBS: "Rambus", POWI: "Power Integrations",
  ALGM: "Allegro MicroSystems", ACLS: "Axcelis Technologies", FORM: "FormFactor", AEHR: "Aehr Test Systems", COHU: "Cohu",
  SMTC: "Semtech", CRUS: "Cirrus Logic", DIOD: "Diodes", AMBA: "Ambarella", CALX: "Calix", MTSI: "MACOM", GTLB: "GitLab",
  // Where the legal word is the name people use.
  NWSA: "News Corp", NWS: "News Corp", COO: "Cooper Companies",
};

const LEGAL = String.raw`(?:Inc|Incorporated|Corp|Corporation|Ltd|Limited|plc|PLC|N\.V|S\.A|L\.P|LLC|AG|SE)\.?`;
const LEGAL_END = new RegExp(String.raw`,?\s+${LEGAL}$`, "i");
const AND_COMPANY_END = /\s+(?:&|and)\s+(?:Company|Co\.?)$/i;
const HOLDINGS_LEGAL_END = new RegExp(String.raw`\s+Holdings?,?\s+${LEGAL}$`, "i");

/** "HUBSPOT INC" → "Hubspot", "Insulet Corporation" → "Insulet", "Walt Disney Company (The)" → "Walt Disney", "Trade Desk, Inc." → "Trade Desk".
 * "Booking Holdings" and "CME Group" keep their last word (they are the name people use); "… Holdings, Inc." loses both. */
export function cleanEnglishName(raw: string): string {
  let name = raw.normalize("NFKC").replace(/\s+/g, " ").trim()
    .replace(/\s*\/[A-Z]{2,4}\/?$/, "") // SEC state tags such as "DIODES INC /DEL/"
    .replace(/\s*\((?:Class|Series) [A-Z]\)$/i, "");
  let the = false;
  if (/\s*\(The\)$/i.test(name)) { name = name.replace(/\s*\(The\)$/i, ""); the = true; }
  if (/^The\s+/i.test(name)) { name = name.replace(/^The\s+/i, ""); the = true; }
  const shouting = /[A-Z]/.test(name) && !/[a-z]/.test(name);
  const legal = LEGAL_END.test(name) || HOLDINGS_LEGAL_END.test(name);
  for (let previous = ""; previous !== name;) {
    previous = name;
    name = name.replace(HOLDINGS_LEGAL_END, "").replace(LEGAL_END, "").replace(AND_COMPANY_END, "").replace(/,$/, "").trim();
    // "(The)" marks the S&P list's "Hershey Company (The)": the company word goes with it.
    if (the) name = name.replace(/\s+(?:Company|Companies)$/i, "");
  }
  // An SEC record in capitals ("AEHR TEST SYSTEMS", "COHU INC"); a lone acronym such as "IBM" or "IQVIA" stays as it is.
  // Words of three letters or fewer ("USA", "AMD") stay in capitals.
  if (shouting && (legal || name.includes(" "))) name = name.replace(/[A-Z][A-Z']{3,}/g, word => word[0] + word.slice(1).toLowerCase());
  return name || raw.trim();
}

const usableTheme = (ticker: string): Pair | null => {
  const entry = theme[ticker];
  return entry && !(ticker in COMPANY_NAME) && !PARENTHESIS.test(entry.ja) && !PARENTHESIS.test(entry.en) ? entry : null;
};

/** The names a row shows; `fallbackEn` is what the monitor sent, used for a ticker outside the universe file. */
export function companyDisplayName(ticker: string, fallbackEn?: string): Pair {
  const known = companies[ticker];
  const mapped = usableTheme(ticker);
  const en = SPELLING[ticker] ?? cleanEnglishName(COMPANY_NAME[ticker] ?? mapped?.en ?? known?.en ?? fallbackEn ?? ticker);
  if (mapped) return { ja: mapped.ja.replace(/(?<=[A-Za-z0-9])社$/, ""), en };
  // The universe file's own Japanese name was copied from these same lists; it is read only where no Theme Ranking name was behind it.
  const fresh = !STALE_LABEL.has(ticker) && !(ticker in theme);
  const cik = known?.cik && !STALE_LABEL.has(ticker) ? String(known.cik) : "";
  const candidates = [japaneseNamesOf(SAME_COMPANY[ticker] ?? ticker)[0], fresh ? known?.ja : null, ...(cik ? namesByCik[cik] ?? [] : [])]
    .map(value => value?.replace(/\s*[(（][^()（）]*(?:企業|会社)[)）]$/, "")); // Wikipedia's "ネットフリックス (企業)"
  const ja = candidates.find((value): value is string => !!value && JAPANESE.test(value) && !PARENTHESIS.test(value));
  // A label such as "ペンテアInc." keeps the Japanese and loses the Latin suffix.
  return { ja: ja ? ja.replace(new RegExp(String.raw`,?\s*${LEGAL}$`), "").trim() : en, en };
}

/** Replaces ja / en on every row of a list of rows that carry a ticker; nothing else changes (scores, order, counts stay as sent). */
export const withDisplayNames = <T extends { ticker: string; ja: string; en: string }>(rows: T[]): T[] =>
  rows.map(row => ({ ...row, ...companyDisplayName(row.ticker, row.en) }));

/** トレジャーハント's payload with these names on every ranked row. */
export const valueSnapshotWithNames = (snapshot: ValueSnapshot): ValueSnapshot => ({
  ...snapshot,
  universes: { tech: { ...snapshot.universes.tech, items: withDisplayNames(snapshot.universes.tech.items) },
    all: { ...snapshot.universes.all, items: withDisplayNames(snapshot.universes.all.items) } },
});

/** クジラの足あと's payload with these names on the rows of all four tabs. */
export const whaleSnapshotWithNames = (snapshot: WhaleSnapshot): WhaleSnapshot => ({
  ...snapshot,
  institutional: withDisplayNames(snapshot.institutional), short: withDisplayNames(snapshot.short),
  insiders: withDisplayNames(snapshot.insiders), buybacks: withDisplayNames(snapshot.buybacks),
});
