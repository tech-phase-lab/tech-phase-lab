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
  secProfileUrl: string;
};

type SecDirectoryPayload = { fields?: unknown; data?: unknown };
type SecSubmissionPayload = {
  cik?: unknown;
  entityType?: unknown;
  sic?: unknown;
  sicDescription?: unknown;
  fiscalYearEnd?: unknown;
  stateOfIncorporation?: unknown;
  formerNames?: unknown;
};

const tickerPattern = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
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
    secProfileUrl: `https://www.sec.gov/edgar/browse/?CIK=${entry.cik}`,
  };
}

export function stockDirectoryIssues(entries: StockDirectoryEntry[]) {
  const issues: string[] = [];
  if (entries.length < 100) issues.push("directory-too-small");
  if (new Set(entries.map((entry) => `${entry.ticker}:${entry.cik}:${entry.exchange}`)).size !== entries.length) issues.push("duplicate-directory-entry");
  if (entries.some((entry) => !normalizeTicker(entry.ticker) || entry.cik <= 0 || !entry.name || !entry.exchange)) issues.push("invalid-directory-entry");
  return issues;
}
