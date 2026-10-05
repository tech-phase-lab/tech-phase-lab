/** A deliberately small, separate wire type. Never a reviewed article or ticker input. */
export const ORIGINAL_PREVIEW_LIMIT = 30;
export type OriginalPreviewItem = {
  id: string; status: "original-excerpt-unreviewed"; sourceName: string; sourceUrl: string; excerptOriginal: string;
  sourceTimePrecision: "timestamp" | "date" | "missing"; sourcePublishedAt: string | null; sourcePublishedOn: string | null;
  acquiredAt: string; previewPublishedAt: string;
};

export type OriginalPreviewWindow = {
  recentWindowDays: 7; scanLimitPerLane: 200; displayLimit: 30; eligibleInScan: number;
  returned: number; omittedInScan: number; scanLimited: boolean;
};

export function parseOriginalPreviewWindow(value: unknown, returned: number): OriginalPreviewWindow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (row.recentWindowDays !== 7 || row.scanLimitPerLane !== 200 || row.displayLimit !== 30
    || typeof row.scanLimited !== "boolean" || returned > 30
    || !["eligibleInScan", "returned", "omittedInScan"].every(key => Number.isInteger(row[key]) && Number(row[key]) >= 0 && Number(row[key]) <= 600)
    || Number(row.returned) > 30 || Number(row.eligibleInScan) < returned
    || Number(row.eligibleInScan) !== Number(row.returned) + Number(row.omittedInScan)) return undefined;
  return { recentWindowDays: 7, scanLimitPerLane: 200, displayLimit: 30,
    eligibleInScan: Number(row.eligibleInScan), returned, omittedInScan: Number(row.eligibleInScan) - returned, scanLimited: row.scanLimited };
}

export function originalPreviewUrlKey(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  const path = url.hostname.toLowerCase() === "x.com" ? url.pathname.toLowerCase() : url.pathname;
  return `${url.hostname.toLowerCase()}${path.replace(/\/$/, "")}`;
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
    if (!/^original-preview-[a-f0-9]{24}$/.test(id) || row.status !== "original-excerpt-unreviewed") throw Error("Invalid original preview status");
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash
      || !url.hostname.includes(".") || /^(?:\d+\.){3}\d+$/.test(url.hostname)
      || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) throw Error("Invalid original preview URL");
    // Keep this conservative block union identical to the publisher, including
    // halfwidth/compatibility forms, Hangul Jamo and supplementary ideographs.
    const excerptOriginal = field("excerptOriginal", 100);
    const sensitive = /(?:bearer\s+[A-Za-z0-9._~+/=-]{8,}|(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}|(?:api[_ -]?key|access[_ -]?token|password|client[_ -]?secret)\s*[:=])/i;
    if (sensitive.test(excerptOriginal) || sensitive.test(sourceName)
      || /^\s*(?:[\[{]|Traceback\b|(?:Exception|Error|HTTPError)\s*:|Unauthorized\b|Access denied\b)/i.test(excerptOriginal)
      || /(?:https?:\/\/|www\.)/i.test(excerptOriginal) || excerptOriginal.trim().split(/\s+/u).length > 20
      || (/[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\uff61-\uffdc\u{16fe0}-\u{16fff}\u{1aff0}-\u{1b16f}\u{1d360}-\u{1d37f}\u{1f200}-\u{1f2ff}\u{20000}-\u{3347f}]/u.test(excerptOriginal) && Array.from(excerptOriginal).length > 40)) throw Error("Invalid original excerpt");
    const timestamp = (key: string) => {
      const text = field(key, 50);
      const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(text);
      if (!match || !Number.isFinite(Date.parse(text))
        || new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) !== match[1]) throw Error("Invalid original preview time");
      return text;
    };
    const acquiredAt = timestamp("acquiredAt"), previewPublishedAt = timestamp("previewPublishedAt");
    if (Date.parse(acquiredAt) > Date.parse(previewPublishedAt)) throw Error("Invalid original preview chronology");
    let sourcePublishedAt: string | null = null, sourcePublishedOn: string | null = null;
    const precision = row.sourceTimePrecision;
    if (precision === "timestamp" && row.sourcePublishedOn === null) sourcePublishedAt = timestamp("sourcePublishedAt");
    else if (precision === "date" && row.sourcePublishedAt === null) {
      sourcePublishedOn = field("sourcePublishedOn", 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sourcePublishedOn) || !Number.isFinite(Date.parse(sourcePublishedOn))
        || new Date(sourcePublishedOn).toISOString().slice(0, 10) !== sourcePublishedOn) throw Error("Invalid original preview date");
    } else if (precision !== "missing" || row.sourcePublishedAt !== null || row.sourcePublishedOn !== null) throw Error("Invalid original date precision");
    return { id, status: "original-excerpt-unreviewed", sourceName, sourceUrl: url.href, excerptOriginal,
      sourceTimePrecision: precision, sourcePublishedAt, sourcePublishedOn, acquiredAt, previewPublishedAt };
  });
}
