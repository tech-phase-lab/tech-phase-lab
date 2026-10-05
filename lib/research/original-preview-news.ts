import { configuredNoticeIdentity, type NoticeSourceClass } from "./configured-preview-notice.ts";
import providers from "./providers.json" with { type: "json" };
/** A deliberately small, separate wire type. Never a reviewed article or ticker input. */
export const ORIGINAL_PREVIEW_LIMIT = 30;
type PreviewIdentity = {
  id: string; sourceName: string; sourceUrl: string; acquiredAt: string; previewPublishedAt: string;
};
export type PreviewSummary = { titleJa: string; titleEn: string; bodyJa: string; bodyEn: string };
export type OriginalExcerptItem = PreviewIdentity & {
  status: "original-excerpt-unreviewed"; excerptOriginal: string;
  sourceTimePrecision: "timestamp" | "date" | "missing"; sourcePublishedAt: string | null; sourcePublishedOn: string | null;
  /** Bilingual one-line summary + detail, checked by the monitor against the full source. */
  summary?: PreviewSummary;
};

/** Public shape only; meaning and numbers are verified by the monitor before publication. */
function parsePreviewSummary(value: Record<string, unknown>): PreviewSummary | undefined {
  // Wire rows carry the marker and flat fields; already-parsed cards (the feed
  // is validated more than once on the way to the page) carry a nested object.
  const nested = value.summary && typeof value.summary === "object" && !Array.isArray(value.summary);
  if (value.summaryPolicy !== "preview-summary-v1" && !nested) return undefined;
  const row = nested ? value.summary as Record<string, unknown> : value;
  const japanese = /[\u3040-\u30ff\u4e00-\u9fff]/;
  const copy: Record<string, string> = {};
  for (const [key, max] of [["titleJa", 180], ["titleEn", 180], ["bodyJa", 1500], ["bodyEn", 1500]] as const) {
    const value = row[key];
    if (typeof value !== "string" || value.trim().length < 4 || Array.from(value).length > max
      || /[\x00-\x08\x0b-\x1f\x7f<>]|https?:\/\/|www\./i.test(value)) return undefined;
    copy[key] = value.trim();
  }
  if (!japanese.test(copy.titleJa) || !japanese.test(copy.bodyJa)) return undefined;
  return copy as PreviewSummary;
}
export type SecFilingNotice = PreviewIdentity & {
  status: "sec-filing-notice-unreviewed"; issuerName: string; issuerTicker: string;
  form: "8-K" | "6-K"; cik: string; accession: string;
  filingDate: string | null; acceptedAt: string | null;
  bodyAvailability: "unavailable" | "retained-unreviewed";
};
export type SourceMetadataNotice = PreviewIdentity & {
  status: "source-metadata-notice-unreviewed"; sourceClass: NoticeSourceClass;
  titleOriginal: string | null; sourcePublishedOn: string | null;
  bodyAvailability: "unavailable" | "retained-unreviewed";
};
export type OriginalPreviewItem = OriginalExcerptItem | SecFilingNotice | SourceMetadataNotice;

export type OriginalPreviewWindow = {
  recentWindowDays: 7; scanLimitPerLane: 200; displayLimit: 30; eligibleInScan: number;
  returned: number; omittedInScan: number; scanLimited: boolean;
};

export function parseOriginalPreviewWindow(value: unknown, returned: number): OriginalPreviewWindow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (row.recentWindowDays !== 7 || row.scanLimitPerLane !== 200 || row.displayLimit !== 30
    || typeof row.scanLimited !== "boolean" || returned > 30
    || !["eligibleInScan", "returned", "omittedInScan"].every(key => Number.isInteger(row[key]) && Number(row[key]) >= 0 && Number(row[key]) <= 1200)
    || Number(row.returned) > 30 || Number(row.eligibleInScan) < returned
    || Number(row.eligibleInScan) !== Number(row.returned) + Number(row.omittedInScan)) return undefined;
  return { recentWindowDays: 7, scanLimitPerLane: 200, displayLimit: 30,
    eligibleInScan: Number(row.eligibleInScan), returned, omittedInScan: Number(row.eligibleInScan) - returned, scanLimited: row.scanLimited };
}

export function originalPreviewUrlKey(value: string): string {
  const notice = configuredNoticeIdentity(value);
  if (notice) return notice.key;
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  const path = url.hostname.toLowerCase() === "x.com" ? url.pathname.toLowerCase() : url.pathname;
  return `${url.hostname.toLowerCase()}${path.replace(/\/$/, "")}`;
}

/** SEC accession identity is shared only for deduplication, never admission as reviewed news. */
export function secFilingUrlKey(value: string): string | null {
  try {
    const url = new URL(value);
    const match = /^\/Archives\/edgar\/data\/([1-9][0-9]{0,9})\/([0-9]{18})\/[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.exec(url.pathname);
    if (value.length > 512 || value !== url.href || url.protocol !== "https:" || url.host !== "www.sec.gov" || url.username || url.password || url.search || url.hash || !match) return null;
    const cik = match[1].padStart(10, "0");
    if (!providers.some(provider => provider.supplementalSources?.some(source => "cik" in source && source.format === "sec-json" && source.cik === cik))) return null;
    return `sec:${cik}:${match[2].slice(0, 10)}-${match[2].slice(10, 12)}-${match[2].slice(12)}`;
  } catch { return null; }
}

function validateOriginalCopy(excerptOriginal: string, sourceName: string): void {
  const sensitive = /(?:bearer\s+[A-Za-z0-9._~+/=-]{8,}|(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}|(?:api[_ -]?key|access[_ -]?token|password|client[_ -]?secret)\s*[:=])/i;
  if (sensitive.test(excerptOriginal) || sensitive.test(sourceName)
    || /^\s*(?:[\[{]|Traceback\b|(?:Exception|Error|HTTPError)\s*:|Unauthorized\b|Access denied\b)/i.test(excerptOriginal)
    || /(?:https?:\/\/|www\.)/i.test(excerptOriginal) || excerptOriginal.trim().split(/\s+/u).length > 20
    || (/[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\uff61-\uffdc\u{16fe0}-\u{16fff}\u{1aff0}-\u{1b16f}\u{1d360}-\u{1d37f}\u{1f200}-\u{1f2ff}\u{20000}-\u{3347f}]/u.test(excerptOriginal) && Array.from(excerptOriginal).length > 40)) throw Error("Invalid original excerpt");
}

/** Explicit reconstruction means no retained body, model arguments or raw metadata can pass. */
export function parseOriginalPreviewItems(value: unknown): OriginalPreviewItem[] {
  if (!Array.isArray(value) || value.length > ORIGINAL_PREVIEW_LIMIT) throw Error("Invalid original previews");
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("Invalid original preview");
    const row = raw as Record<string, unknown>;
    const field = (key: string, max: number) => {
      const text = row[key];
      if (typeof text !== "string" || !text.trim() || Array.from(text).length > max
        || /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(text)) throw Error("Invalid original preview field");
      return text;
    };
    const id = field("id", 41), sourceName = field("sourceName", 80), sourceUrl = field("sourceUrl", 4096);
    if (!/^original-preview-[a-f0-9]{24}$/.test(id) || !["original-excerpt-unreviewed", "sec-filing-notice-unreviewed", "source-metadata-notice-unreviewed"].includes(String(row.status))) throw Error("Invalid original preview status");
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port || (url.search && !(row.status === "source-metadata-notice-unreviewed" && configuredNoticeIdentity(sourceUrl))) || url.hash
      || !url.hostname.includes(".") || /^(?:\d+\.){3}\d+$/.test(url.hostname)
      || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) throw Error("Invalid original preview URL");
    const timestamp = (key: string) => {
      const text = field(key, 50);
      const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(text);
      if (!match || !Number.isFinite(Date.parse(text))
        || new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) !== match[1]) throw Error("Invalid original preview time");
      return text;
    };
    const acquiredAt = timestamp("acquiredAt"), previewPublishedAt = timestamp("previewPublishedAt");
    if (Date.parse(acquiredAt) > Date.parse(previewPublishedAt)) throw Error("Invalid original preview chronology");
    if (row.status === "sec-filing-notice-unreviewed") {
      const issuerName = field("issuerName", 80), issuerTicker = field("issuerTicker", 10);
      const cik = field("cik", 10), accession = field("accession", 20), form = field("form", 3);
      const provider = providers.find(provider => provider.ticker === issuerTicker && provider.name === issuerName);
      const config = provider?.supplementalSources?.find(source => "cik" in source && source.format === "sec-json" && source.cik === cik);
      if (sourceName !== "SEC EDGAR" || !/^\d{10}$/.test(cik) || !/^\d{10}-\d{2}-\d{6}$/.test(accession)
        || secFilingUrlKey(sourceUrl) !== `sec:${cik}:${accession}` || !config || !("forms" in config)
        || (form !== "8-K" && form !== "6-K") || !config.forms?.includes(form)
        || !["unavailable", "retained-unreviewed"].includes(String(row.bodyAvailability))) throw Error("Invalid SEC filing notice");
      const acceptedAt = row.acceptedAt === null ? null : timestamp("acceptedAt");
      const filingDate = row.filingDate === null ? null : field("filingDate", 10);
      if ((acceptedAt && (acceptedAt.endsWith("-00:00") || Date.parse(acceptedAt) > Date.parse(acquiredAt)))
        || (filingDate && (!/^\d{4}-\d{2}-\d{2}$/.test(filingDate) || !Number.isFinite(Date.parse(filingDate))
          || new Date(filingDate).toISOString().slice(0, 10) !== filingDate
          || filingDate > new Date(acquiredAt).toISOString().slice(0, 10)))) throw Error("Invalid SEC filing clock");
      return { id, status: "sec-filing-notice-unreviewed", sourceName, sourceUrl: url.href,
        issuerName, issuerTicker, form, cik, accession, filingDate, acceptedAt,
        bodyAvailability: row.bodyAvailability as SecFilingNotice["bodyAvailability"], acquiredAt, previewPublishedAt };
    }
    if (["www.sec.gov", "data.sec.gov"].includes(url.hostname)) throw Error("SEC requires filing notice status");
    if (row.status === "source-metadata-notice-unreviewed") {
      const ref = configuredNoticeIdentity(sourceUrl);
      if (!ref || row.sourceClass !== ref.sourceClass || sourceName !== ref.sourceName
        || !["unavailable", "retained-unreviewed"].includes(String(row.bodyAvailability))
        || (["exchange-disclosure", "official-document"].includes(ref.sourceClass) && row.bodyAvailability !== "retained-unreviewed")) throw Error("Invalid source metadata notice");
      const titleOriginal = row.titleOriginal === null ? null : field("titleOriginal", 100);
      if ((!titleOriginal && ["issuer-metadata", "exchange-disclosure"].includes(ref.sourceClass))
        || (ref.sourceClass === "official-document" && titleOriginal !== null)) throw Error("Invalid metadata title");
      if (titleOriginal) {
        validateOriginalCopy(titleOriginal, sourceName);
      }
      const sourcePublishedOn = row.sourcePublishedOn === null ? null : field("sourcePublishedOn", 10);
      if ((sourcePublishedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(sourcePublishedOn) || !Number.isFinite(Date.parse(sourcePublishedOn))
          || new Date(sourcePublishedOn).toISOString().slice(0, 10) !== sourcePublishedOn
          || sourcePublishedOn > new Date(acquiredAt).toISOString().slice(0, 10)))
        || (ref.sourcePublishedOn && sourcePublishedOn !== ref.sourcePublishedOn)
        || (ref.sourceClass === "official-document" && sourcePublishedOn !== null)) throw Error("Invalid metadata date");
      return { id, status: "source-metadata-notice-unreviewed", sourceName, sourceUrl, sourceClass: ref.sourceClass,
        titleOriginal, sourcePublishedOn, bodyAvailability: row.bodyAvailability as SourceMetadataNotice["bodyAvailability"], acquiredAt, previewPublishedAt };
    }
    // Keep this conservative block union identical to the publisher, including
    // halfwidth/compatibility forms, Hangul Jamo and supplementary ideographs.
    const excerptOriginal = field("excerptOriginal", 100);
    validateOriginalCopy(excerptOriginal, sourceName);
    let sourcePublishedAt: string | null = null, sourcePublishedOn: string | null = null;
    const precision = row.sourceTimePrecision;
    if (precision === "timestamp" && row.sourcePublishedOn === null) sourcePublishedAt = timestamp("sourcePublishedAt");
    else if (precision === "date" && row.sourcePublishedAt === null) {
      sourcePublishedOn = field("sourcePublishedOn", 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sourcePublishedOn) || !Number.isFinite(Date.parse(sourcePublishedOn))
        || new Date(sourcePublishedOn).toISOString().slice(0, 10) !== sourcePublishedOn) throw Error("Invalid original preview date");
    } else if (precision !== "missing" || row.sourcePublishedAt !== null || row.sourcePublishedOn !== null) throw Error("Invalid original date precision");
    const summary = parsePreviewSummary(row);
    return { id, status: "original-excerpt-unreviewed", sourceName, sourceUrl: url.href, excerptOriginal,
      sourceTimePrecision: precision, sourcePublishedAt, sourcePublishedOn, acquiredAt, previewPublishedAt,
      ...(summary ? { summary } : {}) };
  });
}
