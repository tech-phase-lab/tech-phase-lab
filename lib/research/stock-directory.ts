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
  extractionMethod: "form-item" | "cross-referenced-overview";
  excerpt: string;
  sectionCharacters: number;
  truncated: boolean;
  documentUrl: string;
  filingIndexUrl: string;
  retrievedAt: string;
  sourceSha256: string;
};

export type ExtractedBusinessSection = Pick<BusinessSection, "heading" | "extractionMethod" | "excerpt" | "sectionCharacters" | "truncated">;

export type RiskSection = {
  ticker: string;
  cik: number;
  form: "10-K" | "20-F";
  filingDate: string;
  reportDate: string | null;
  accessionNumber: string;
  heading: string;
  extractionMethod: "form-item" | "cross-referenced-risk-factors";
  overview: RiskOverview | null;
  excerpt: string;
  sectionCharacters: number;
  truncated: boolean;
  documentUrl: string;
  filingIndexUrl: string;
  retrievedAt: string;
  sourceSha256: string;
};

export type RiskOverview = {
  heading: string;
  extractionMethod: "issuer-risk-summary" | "issuer-risk-overview";
  groups: { heading: string | null; items: string[] }[];
  itemCount: number;
};

export type ExtractedRiskSection = Pick<RiskSection, "heading" | "extractionMethod" | "overview" | "excerpt" | "sectionCharacters" | "truncated">;

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
  return lines.filter((line, index) => index === 0 || line !== lines[index - 1]).join("\n").slice(0, 2_000_000);
}

function allMatches(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].map((match) => ({ index: match.index ?? -1, length: match[0].length })).filter((match) => match.index >= 0);
}

function bestSection(text: string, startPattern: RegExp, endPattern: RegExp, minimumCharacters = 800) {
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
    .filter((candidate) => candidate.length >= minimumCharacters)
    .toSorted((a, b) => b.length - a.length)[0]?.value ?? null;
}

function looksLikeFormCrossReference(value: string) {
  return /FORM\s+20-F\s+CAPTION[\s\S]{0,2000}LOCATION\s+IN\s+THIS\s+DOCUMENT/i.test(value);
}

function crossReferencedOverview(text: string) {
  const referenceCandidates = [
    ...(text.match(/\bITEM\s+4\s*[.:\-–—]?\s*INFORMATION\s+ON\s+THE\s+COMPANY\b[\s\S]{0,10000}?\bITEM\s+4A\b/gi) ?? []),
    ...(text.match(/APPENDIX\s*[–—-]\s*REFERENCE\s+TABLE\s+20-F[\s\S]{0,25000}/gi) ?? []),
  ];
  const reference = referenceCandidates.find((candidate) => looksLikeFormCrossReference(candidate) && /\bB[.:]?\s+BUSINESS\s+OVERVIEW\b/i.test(candidate) && /\bAT\s+A\s+GLANCE\b/i.test(candidate));
  if (!reference) return null;
  const starts = allMatches(text, /\bAT\s+A\s+GLANCE\s*[–—-]\s*(?:20\d{2}\s+)?OVERVIEW\b/gi);
  const candidates = starts.flatMap((start) => {
    const contentStart = start.index + start.length;
    if (/^\s*\(continued\)/i.test(text.slice(contentStart, contentStart + 32))) return [];
    const bounded = text.slice(contentStart, Math.min(text.length, contentStart + 20_000));
    const end = bounded.search(/\n(?:STRATEGIC\s+REPORT|CORPORATE\s+GOVERNANCE|FINANCIALS|SUSTAINABILITY\s+STATEMENTS)\n/i);
    if (end < 0) return [];
    const value = bounded.slice(0, end).trim();
    const letters = value.match(/[A-Za-z]/g)?.length ?? 0;
    const sentences = value.match(/[.!?](?:\s|\n|$)/g)?.length ?? 0;
    if (value.length < 600 || value.length > 15_000 || letters / value.length < 0.55 || sentences < 4 || looksLikeFormCrossReference(value)) return [];
    return [{ value, length: value.length }];
  });
  return candidates.toSorted((a, b) => b.length - a.length)[0]?.value ?? null;
}

export function extractBusinessSection(html: string, form: string, excerptLimit = 4_000): ExtractedBusinessSection | null {
  if (typeof html !== "string" || html.length < 500 || html.length > 30_000_000) return null;
  const text = filingHtmlToText(html);
  const itemSection = form === "10-K"
    ? bestSection(text, /\bITEM\s+1\s*[.:\-–—]?\s*BUSINESS\b/gi, /\bITEM\s+1A\s*[.:\-–—]?\s*RISK\s+FACTORS\b|\bITEM\s+1B\b/gi)
    : form === "20-F"
      ? bestSection(text, /\bITEM\s+4\s*[.:\-–—]?\s*INFORMATION\s+ON\s+THE\s+COMPANY\b/gi, /\bITEM\s+4A\b|\bITEM\s+5\s*[.:\-–—]/gi, 80)
      : null;
  const referencedOverview = form === "20-F" ? crossReferencedOverview(text) : null;
  const section = referencedOverview ?? (itemSection && itemSection.length >= 800 && !looksLikeFormCrossReference(itemSection) ? itemSection : null);
  if (!section) return null;
  const boundedLimit = Math.min(Math.max(excerptLimit, 800), 8_000);
  let excerpt = section.slice(0, boundedLimit);
  if (section.length > boundedLimit) excerpt = excerpt.replace(/\s+\S*$/, "").trimEnd();
  return {
    heading: referencedOverview ? "At a glance — official annual report overview" : form === "10-K" ? "Item 1. Business" : "Item 4. Information on the Company",
    extractionMethod: referencedOverview ? "cross-referenced-overview" : "form-item",
    excerpt,
    sectionCharacters: section.length,
    truncated: section.length > excerpt.length,
  };
}

function boundedExcerpt(section: string, excerptLimit: number) {
  const boundedLimit = Math.min(Math.max(excerptLimit, 800), 8_000);
  let excerpt = section.slice(0, boundedLimit);
  if (section.length > boundedLimit) excerpt = excerpt.replace(/\s+\S*$/, "").trimEnd();
  return { excerpt, sectionCharacters: section.length, truncated: section.length > excerpt.length };
}

function looksLikeNarrativeSection(value: string) {
  const letters = value.match(/[A-Za-z]/g)?.length ?? 0;
  const sentences = value.match(/[.!?](?:\s|\n|$)/g)?.length ?? 0;
  return value.length >= 800 && letters / value.length >= 0.48 && sentences >= 5 && !looksLikeFormCrossReference(value);
}

function crossReferencedRiskFactors(text: string) {
  const referenceCandidates = [
    ...(text.match(/\bITEM\s+3\s*[.:\-–—]?\s*KEY\s+INFORMATION\b[\s\S]{0,15000}?\bITEM\s+4\b/gi) ?? []),
    ...(text.match(/APPENDIX\s*[–—-]\s*REFERENCE\s+TABLE\s+20-F[\s\S]{0,40000}/gi) ?? []),
  ];
  const reference = referenceCandidates.find((candidate) => looksLikeFormCrossReference(candidate)
    && /\bD[.:]?\s+RISK\s+FACTORS\b/i.test(candidate)
    && /\bRISK\s*[–—-]\s*RISK\s+FACTORS\b/i.test(candidate));
  if (!reference) return null;
  const starts = allMatches(text, /^\s*RISK\s+FACTORS\s*$/gim);
  const continuations = allMatches(text, /^\s*RISK\s+FACTORS\s*\(continued\)\s*$/gim);
  const firstContinuation = continuations[0];
  if (firstContinuation) {
    const start = starts.filter((candidate) => candidate.index < firstContinuation.index).at(-1);
    if (start) {
      const boundedContinuations = continuations.filter((candidate) => candidate.index > start.index && candidate.index < start.index + 120_000);
      const lastContinuation = boundedContinuations.at(-1) ?? firstContinuation;
      const ends = allMatches(text, /^\s*INFORMATION\s+SECURITY\s*$/gim);
      const end = ends.find((candidate) => candidate.index > lastContinuation.index);
      if (end) {
        const value = text.slice(start.index + start.length, end.index).trim();
        const materialityLanguage = value.match(/\b(?:could|may)\b/gi)?.length ?? 0;
        if (value.length >= 3_000 && value.length <= 100_000 && materialityLanguage >= 5 && looksLikeNarrativeSection(value)) return value;
      }
    }
  }
  const candidates = starts.flatMap((start) => {
    const contentStart = start.index + start.length;
    if (/^\s*\(continued\)/i.test(text.slice(contentStart, contentStart + 32))) return [];
    const bounded = text.slice(contentStart, Math.min(text.length, contentStart + 120_000));
    const end = bounded.search(/\n(?:INFORMATION\s+SECURITY|CORPORATE\s+GOVERNANCE)\n/i);
    if (end < 0) return [];
    const value = bounded.slice(0, end).trim();
    const materialityLanguage = value.match(/\b(?:could|may)\b/gi)?.length ?? 0;
    if (value.length < 3_000 || value.length > 100_000 || materialityLanguage < 5 || !looksLikeNarrativeSection(value)) return [];
    return [{ value, length: value.length }];
  });
  return candidates.toSorted((a, b) => b.length - a.length)[0]?.value ?? null;
}

function riskOverviewLine(value: string, maxLength = 500) {
  const normalized = value.replace(/^\s*[•·▪◦]\s*/, "").replace(/\s+/g, " ").trim();
  if (normalized.length < 24 || normalized.length > maxLength) return null;
  if (/^(?:table of contents|strategic report|corporate governance|sustainability|financials)$/i.test(normalized)) return null;
  if (/^\d{1,3}$/.test(normalized)) return null;
  return normalized;
}

function deduplicateRiskItems(items: string[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tenKRiskOverview(section: string): RiskOverview | null {
  const start = section.search(/^\s*RISK\s+FACTORS\s+SUMMARY\s*$/im);
  if (start < 0) return null;
  const afterHeading = section.slice(start).replace(/^\s*RISK\s+FACTORS\s+SUMMARY\s*$/im, "");
  const end = afterHeading.search(/^\s*RISK\s+FACTORS\s*$/im);
  if (end < 0 || end > 30_000) return null;
  const lines = afterHeading.slice(0, end).split("\n").map((line) => line.trim()).filter(Boolean);
  const groups: { heading: string | null; items: string[] }[] = [];
  let group: { heading: string | null; items: string[] } | null = null;
  let currentItem: string | null = null;
  const finishItem = () => {
    if (!group || !currentItem) return;
    const item = riskOverviewLine(currentItem);
    if (item) group.items.push(item);
    currentItem = null;
  };
  const finishGroup = () => {
    finishItem();
    if (group?.items.length) groups.push({ ...group, items: deduplicateRiskItems(group.items) });
  };
  for (const line of lines) {
    if (/^RISKS?\s+RELATED\s+TO\b/i.test(line)) {
      finishGroup();
      group = { heading: riskOverviewLine(line, 180), items: [] };
      continue;
    }
    if (/^\s*[•·▪◦]\s*/.test(line)) {
      finishItem();
      group ??= { heading: null, items: [] };
      currentItem = line;
      continue;
    }
    if (currentItem && !/^(?:table of contents|\d{1,3})$/i.test(line)) currentItem += ` ${line}`;
  }
  finishGroup();
  const itemCount = groups.reduce((count, candidate) => count + candidate.items.length, 0);
  if (itemCount < 3 || itemCount > 40) return null;
  return { heading: "Risk Factors Summary", extractionMethod: "issuer-risk-summary", groups, itemCount };
}

function twentyFRiskOverview(text: string): RiskOverview | null {
  const starts = allMatches(text, /^\s*OVERVIEW\s+OF\s+RISK\s+FACTORS\s*$/gim);
  const candidates = starts.flatMap((start) => {
    const bounded = text.slice(start.index + start.length, Math.min(text.length, start.index + start.length + 40_000));
    const end = bounded.search(/^\s*(?:STRATEGIC\s+REPORT|RISK\s+FACTORS)\s*$/im);
    if (end < 0) return [];
    const items = deduplicateRiskItems(bounded.slice(0, end).split("\n").flatMap((line) => {
      const item = riskOverviewLine(line, 320);
      if (!item || /^(?:risk|type|factor|risk type|risk factor)$/i.test(item)) return [];
      return [item];
    }));
    const signaled = items.filter((item) => /\b(?:risk|could|may|depend|failure|uncertain|competition|cyclical|adversely|protect|unable|challenge|exposed|subject|restriction|not\s+declare)\b/i.test(item)).length;
    if (items.length < 3 || items.length > 40 || signaled / items.length < 0.7) return [];
    return [{ items, signaled }];
  });
  const overview = candidates.toSorted((a, b) => b.signaled - a.signaled || b.items.length - a.items.length)[0];
  if (!overview) return null;
  return {
    heading: "Overview of risk factors",
    extractionMethod: "issuer-risk-overview",
    groups: [{ heading: null, items: overview.items }],
    itemCount: overview.items.length,
  };
}

export function extractRiskSection(html: string, form: string, excerptLimit = 4_000): ExtractedRiskSection | null {
  if (typeof html !== "string" || html.length < 500 || html.length > 30_000_000) return null;
  const text = filingHtmlToText(html);
  const itemSection = form === "10-K"
    ? bestSection(
        text,
        /^\s*ITEM\s+1A\s*[.:\-–—]?\s*RISK\s+FACTORS\s*$/gim,
        /^\s*ITEM\s+(?:1B|1C|2)\b[^\n]*$/gim,
      )
    : form === "20-F"
      ? bestSection(
          text,
          /^\s*(?:ITEM\s+3\s*[.:\-–—]?\s*)?D\s*[.:\-–—]\s*RISK\s+FACTORS\s*$/gim,
          /^\s*ITEM\s+4\b[^\n]*$/gim,
        )
      : null;
  const referencedRisks = form === "20-F" ? crossReferencedRiskFactors(text) : null;
  const section = referencedRisks ?? itemSection;
  if (!section || !looksLikeNarrativeSection(section)) return null;
  const overview = form === "10-K" ? tenKRiskOverview(section) : twentyFRiskOverview(text);
  return {
    heading: referencedRisks ? "Risk factors — official annual report section" : form === "10-K" ? "Item 1A. Risk Factors" : "Item 3.D. Risk Factors",
    extractionMethod: referencedRisks ? "cross-referenced-risk-factors" : "form-item",
    overview,
    ...boundedExcerpt(section, excerptLimit),
  };
}

export function stockDirectoryIssues(entries: StockDirectoryEntry[]) {
  const issues: string[] = [];
  if (entries.length < 100) issues.push("directory-too-small");
  if (new Set(entries.map((entry) => `${entry.ticker}:${entry.cik}:${entry.exchange}`)).size !== entries.length) issues.push("duplicate-directory-entry");
  if (entries.some((entry) => !normalizeTicker(entry.ticker) || entry.cik <= 0 || !entry.name || !entry.exchange)) issues.push("invalid-directory-entry");
  return issues;
}
