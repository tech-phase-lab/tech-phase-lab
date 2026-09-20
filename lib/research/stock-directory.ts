import providers from "./providers.json" with { type: "json" };

export type StockDirectoryEntry = {
  cik: number;
  name: string;
  ticker: string;
  exchange: string;
  tracked: boolean;
};

export type StockProfile = StockDirectoryEntry & {
  entityType: string | null;
  sic: string | null;
  sicDescription: string | null;
  fiscalYearEnd: string | null;
  stateOfIncorporation: string | null;
  formerNames: { name: string; from: string | null; to: string | null }[];
  recentFilings: SecFiling[];
  latestAnnualFiling: SecFiling | null;
  secProfileUrl: string;
};

export type SecFiling = {
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  acceptedAt: string | null;
  items: string | null;
  description: string | null;
  documentUrl: string;
  filingIndexUrl: string;
};

export type BusinessSection = {
  ticker: string;
  cik: number;
  form: "10-K" | "20-F";
  filingDate: string;
  reportDate: string | null;
  accessionNumber: string;
  heading: string;
  excerpt: string;
  sectionCharacters: number;
  truncated: boolean;
  documentUrl: string;
  filingIndexUrl: string;
  retrievedAt: string;
  sourceSha256: string;
};

export type ExtractedBusinessSection = Pick<BusinessSection, "heading" | "excerpt" | "sectionCharacters" | "truncated">;

type SecDirectoryPayload = { fields?: unknown; data?: unknown };
type SecSubmissionPayload = {
  cik?: unknown;
  entityType?: unknown;
  sic?: unknown;
  sicDescription?: unknown;
  fiscalYearEnd?: unknown;
  stateOfIncorporation?: unknown;
  formerNames?: unknown;
  filings?: unknown;
};

const tickerPattern = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
const accessionPattern = /^\d{10}-\d{2}-\d{6}$/;
const documentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const acceptedAtPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/;
const materialForms = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A", "6-K", "6-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]);
const extractableAnnualForms = new Set(["10-K", "20-F"]);
const trackedTickers = new Set(providers.map((provider) => provider.ticker));

function safeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

export function normalizeTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  return tickerPattern.test(ticker) ? ticker : null;
}

export function parseSecDirectory(payload: unknown): StockDirectoryEntry[] {
  if (!payload || typeof payload !== "object") throw new Error("invalid-sec-directory");
  const directory = payload as SecDirectoryPayload;
  if (!Array.isArray(directory.fields) || !Array.isArray(directory.data)) throw new Error("invalid-sec-directory");
  const fields = directory.fields.map((field) => safeText(field, 32));
  const indexes = { cik: fields.indexOf("cik"), name: fields.indexOf("name"), ticker: fields.indexOf("ticker"), exchange: fields.indexOf("exchange") };
  if (Object.values(indexes).some((index) => index < 0)) throw new Error("invalid-sec-directory-fields");
  const entries: StockDirectoryEntry[] = [];
  const seen = new Set<string>();
  for (const row of directory.data) {
    if (!Array.isArray(row)) continue;
    const cik = Number(row[indexes.cik]);
    const name = safeText(row[indexes.name], 180);
    const ticker = normalizeTicker(String(row[indexes.ticker] ?? ""));
    const exchange = safeText(row[indexes.exchange], 40);
    if (!Number.isSafeInteger(cik) || cik <= 0 || !name || !ticker || !exchange) continue;
    const key = `${ticker}:${cik}:${exchange}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ cik, name, ticker, exchange, tracked: trackedTickers.has(ticker) });
  }
  if (entries.length < 100) throw new Error("incomplete-sec-directory");
  return entries;
}

function normalizedSearch(value: string) {
  return value.normalize("NFKC").toLocaleUpperCase("en-US").replace(/[^A-Z0-9.-]+/g, " ").trim();
}

export function searchDirectory(entries: StockDirectoryEntry[], query: string, limit = 24) {
  const q = normalizedSearch(query).slice(0, 80);
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  return entries
    .flatMap((entry) => {
      const ticker = normalizedSearch(entry.ticker);
      const name = normalizedSearch(entry.name);
      if (!terms.every((term) => ticker.includes(term) || name.includes(term))) return [];
      const score = ticker === q ? 0 : ticker.startsWith(q) ? 10 : name.startsWith(q) ? 20 : name.includes(q) ? 30 : ticker.includes(q) ? 40 : 50;
      return [{ entry, score }];
    })
    .toSorted((a, b) => a.score - b.score || Number(b.entry.tracked) - Number(a.entry.tracked) || a.entry.ticker.localeCompare(b.entry.ticker))
    .slice(0, Math.min(Math.max(1, limit), 40))
    .map(({ entry }) => entry);
}

export function parseSecProfile(entry: StockDirectoryEntry, payload: unknown): StockProfile {
  if (!payload || typeof payload !== "object") throw new Error("invalid-sec-profile");
  const submission = payload as SecSubmissionPayload;
  if (Number(submission.cik) !== entry.cik) throw new Error("sec-profile-cik-mismatch");
  const formerNames = Array.isArray(submission.formerNames) ? submission.formerNames.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    const name = safeText(candidate.name, 180);
    return name ? [{ name, from: safeText(candidate.from, 24), to: safeText(candidate.to, 24) }] : [];
  }).slice(0, 8) : [];
  return {
    ...entry,
    entityType: safeText(submission.entityType, 60),
    sic: safeText(submission.sic, 12),
    sicDescription: safeText(submission.sicDescription, 160),
    fiscalYearEnd: safeText(submission.fiscalYearEnd, 8),
    stateOfIncorporation: safeText(submission.stateOfIncorporation, 24),
    formerNames,
    recentFilings: parseRecentFilings(entry.cik, submission.filings),
    latestAnnualFiling: parseLatestAnnualFiling(entry.cik, submission.filings),
    secProfileUrl: `https://www.sec.gov/edgar/browse/?CIK=${entry.cik}`,
  };
}

function safeDate(value: unknown) {
  const text = safeText(value, 10);
  return text && isoDatePattern.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) ? text : null;
}

function safeAcceptedAt(value: unknown) {
  const text = safeText(value, 32);
  return text && acceptedAtPattern.test(text) && !Number.isNaN(Date.parse(text.endsWith("Z") ? text : `${text}Z`)) ? text : null;
}

function recentColumn(recent: Record<string, unknown>, key: string) {
  return Array.isArray(recent[key]) ? recent[key] : [];
}

function filingAt(cik: number, recent: Record<string, unknown>, index: number, allowedForms: Set<string>) {
  const accessionNumber = safeText(recentColumn(recent, "accessionNumber")[index], 20);
  const form = safeText(recentColumn(recent, "form")[index], 16)?.toUpperCase() ?? null;
  const filingDate = safeDate(recentColumn(recent, "filingDate")[index]);
  const primaryDocument = safeText(recentColumn(recent, "primaryDocument")[index], 200);
  if (!accessionNumber || !accessionPattern.test(accessionNumber) || !form || !allowedForms.has(form) || !filingDate || !primaryDocument || !documentPattern.test(primaryDocument)) return null;
  const archiveRoot = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNumber.replaceAll("-", "")}`;
  return {
    accessionNumber,
    form,
    filingDate,
    reportDate: safeDate(recentColumn(recent, "reportDate")[index]),
    acceptedAt: safeAcceptedAt(recentColumn(recent, "acceptanceDateTime")[index]),
    items: safeText(recentColumn(recent, "items")[index], 160),
    description: safeText(recentColumn(recent, "primaryDocDescription")[index], 200),
    documentUrl: `${archiveRoot}/${primaryDocument}`,
    filingIndexUrl: `${archiveRoot}/${accessionNumber}-index.html`,
  } satisfies SecFiling;
}

export function parseRecentFilings(cik: number, filings: unknown, limit = 8): SecFiling[] {
  if (!filings || typeof filings !== "object") return [];
  const recentValue = (filings as Record<string, unknown>).recent;
  if (!recentValue || typeof recentValue !== "object") return [];
  const recent = recentValue as Record<string, unknown>;
  const accessions = recentColumn(recent, "accessionNumber");
  const results: SecFiling[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < accessions.length && results.length < Math.min(Math.max(limit, 1), 12); index += 1) {
    const filing = filingAt(cik, recent, index, materialForms);
    if (!filing || seen.has(filing.accessionNumber)) continue;
    seen.add(filing.accessionNumber);
    results.push(filing);
  }
  return results;
}

export function parseLatestAnnualFiling(cik: number, filings: unknown): SecFiling | null {
  if (!filings || typeof filings !== "object") return null;
  const recentValue = (filings as Record<string, unknown>).recent;
  if (!recentValue || typeof recentValue !== "object") return null;
  const recent = recentValue as Record<string, unknown>;
  const accessions = recentColumn(recent, "accessionNumber");
  for (let index = 0; index < accessions.length; index += 1) {
    const filing = filingAt(cik, recent, index, extractableAnnualForms);
    if (filing) return filing;
  }
  return null;
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"', ndash: "–", mdash: "—" };
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (entity, key: string) => {
    const normalized = key.toLowerCase();
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    }
    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    }
    return named[normalized] ?? entity;
  });
}

function filingHtmlToText(html: string) {
  const withoutHiddenContent = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(address|article|aside|blockquote|caption|dd|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const lines = decodeHtmlEntities(withoutHiddenContent)
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return lines.filter((line, index) => index === 0 || line !== lines[index - 1]).join("\n").slice(0, 1_000_000);
}

function allMatches(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].map((match) => ({ index: match.index ?? -1, length: match[0].length })).filter((match) => match.index >= 0);
}

function bestSection(text: string, startPattern: RegExp, endPattern: RegExp) {
  const starts = allMatches(text, startPattern);
  const ends = allMatches(text, endPattern);
  return starts
    .map((start) => {
      const contentStart = start.index + start.length;
      const end = ends.find((candidate) => candidate.index > contentStart);
      const contentEnd = end?.index ?? Math.min(text.length, contentStart + 300_000);
      const value = text.slice(contentStart, contentEnd).replace(/^\s+|\s+$/g, "");
      return { value, length: value.length };
    })
    .filter((candidate) => candidate.length >= 800)
    .toSorted((a, b) => b.length - a.length)[0]?.value ?? null;
}

export function extractBusinessSection(html: string, form: string, excerptLimit = 4_000): ExtractedBusinessSection | null {
  if (typeof html !== "string" || html.length < 500 || html.length > 12_000_000) return null;
  const text = filingHtmlToText(html);
  const section = form === "10-K"
    ? bestSection(text, /\bITEM\s+1\s*[.:\-–—]?\s*BUSINESS\b/gi, /\bITEM\s+1A\s*[.:\-–—]?\s*RISK\s+FACTORS\b|\bITEM\s+1B\b/gi)
    : form === "20-F"
      ? bestSection(text, /\bITEM\s+4\s*[.:\-–—]?\s*INFORMATION\s+ON\s+THE\s+COMPANY\b/gi, /\bITEM\s+4A\b|\bITEM\s+5\s*[.:\-–—]/gi)
      : null;
  if (!section) return null;
  const boundedLimit = Math.min(Math.max(excerptLimit, 800), 8_000);
  let excerpt = section.slice(0, boundedLimit);
  if (section.length > boundedLimit) excerpt = excerpt.replace(/\s+\S*$/, "").trimEnd();
  return {
    heading: form === "10-K" ? "Item 1. Business" : "Item 4. Information on the Company",
    excerpt,
    sectionCharacters: section.length,
    truncated: section.length > excerpt.length,
  };
}

export function stockDirectoryIssues(entries: StockDirectoryEntry[]) {
  const issues: string[] = [];
  if (entries.length < 100) issues.push("directory-too-small");
  if (new Set(entries.map((entry) => `${entry.ticker}:${entry.cik}:${entry.exchange}`)).size !== entries.length) issues.push("duplicate-directory-entry");
  if (entries.some((entry) => !normalizeTicker(entry.ticker) || entry.cik <= 0 || !entry.name || !entry.exchange)) issues.push("invalid-directory-entry");
  return issues;
}
