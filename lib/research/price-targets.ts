export type PriceTargetSource = {
  id: number; source: string; url: string; publishedAt: string; observedAt: string;
};

export type PriceTarget = PriceTargetSource & {
  ticker: string; firm: string; previous: number; latest: number;
  sources?: PriceTargetSource[];
};

const accounts = new Map([
  ["tipranks", "TipRanks"], ["wallstengine", "wallstengine"], ["fabymetal4", "FABYMETAL4"],
]);

function sourceRecord(value: unknown): PriceTargetSource {
  if (!value || typeof value !== "object") throw new Error("Invalid target source");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "number" || !Number.isSafeInteger(row.id) || row.id <= 0
      || typeof row.source !== "string" || !row.source.trim() || row.source.length > 100
      || /[\0\r\n]/.test(row.source) || typeof row.url !== "string" || row.url.length > 250) {
    throw new Error("Invalid target source");
  }
  const url = new URL(row.url);
  const account = /^\/([^/]+)\/status\/\d+$/.exec(url.pathname)?.[1].toLowerCase();
  if (url.protocol !== "https:" || url.hostname !== "x.com" || url.username || url.password
      || url.port || url.search || url.hash || !account || !accounts.has(account)) {
    throw new Error("Unapproved target source");
  }
  for (const key of ["publishedAt", "observedAt"] as const) {
    if (typeof row[key] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(row[key])
        || !Number.isFinite(Date.parse(row[key]))) throw new Error("Invalid target date");
  }
  if (Date.parse(row.observedAt as string) < Date.parse(row.publishedAt as string)) throw new Error("Invalid target chronology");
  return { id: row.id, source: row.source, url: url.href,
    publishedAt: row.publishedAt as string, observedAt: row.observedAt as string };
}

/** Revalidate public structured fields only; never pass through source bodies. */
export function publicPriceTargets(value: unknown): { ok: true; items: PriceTarget[] } {
  if (!value || typeof value !== "object") throw new Error("Invalid target feed");
  if (new TextEncoder().encode(JSON.stringify(value)).length > 100_000) throw new Error("Oversized target feed");
  const payload = value as Record<string, unknown>;
  if (payload.ok !== true || !Array.isArray(payload.items) || payload.items.length > 30) throw new Error("Invalid target feed");
  const items: PriceTarget[] = [];
  for (const value of payload.items) {
    try {
      const primary = sourceRecord(value);
      const row = value as Record<string, unknown>;
      if (typeof row.ticker !== "string" || !/^[A-Z]{1,5}(?:[.-][A-Z])?$/.test(row.ticker)
          || typeof row.firm !== "string" || !row.firm.trim() || row.firm.length > 100 || /[\0\r\n]/.test(row.firm)
          || typeof row.previous !== "number" || !Number.isFinite(row.previous) || row.previous <= 0 || row.previous > 100_000
          || typeof row.latest !== "number" || !Number.isFinite(row.latest) || row.latest <= 0 || row.latest > 100_000
          || row.previous === row.latest) throw new Error("Invalid target action");
      const item: PriceTarget = { ...primary, ticker: row.ticker, firm: row.firm, previous: row.previous, latest: row.latest };
      if (row.sources !== undefined) {
        if (!Array.isArray(row.sources)) throw new Error("Invalid target sources");
        const sources = new Map([[primary.url.toLowerCase(), primary]]);
        for (const raw of row.sources) {
          try {
            const source = sourceRecord(raw);
            const key = source.url.toLowerCase();
            if (!sources.has(key)) sources.set(key, source);
          } catch { /* An invalid secondary source cannot remove a valid action. */ }
        }
        item.sources = [...sources.values()];
      }
      items.push(item);
    } catch { /* Isolate malformed rows from unrelated verified targets. */ }
  }
  return { ok: true, items };
}

export function priceTargetSources(item: PriceTarget): PriceTargetSource[] {
  return item.sources?.length ? item.sources : [item];
}

export function priceTargetSourceName(source: PriceTargetSource): string {
  const account = new URL(source.url).pathname.split("/")[1].toLowerCase();
  return accounts.get(account) ?? source.source.replace(/^X\s*[·・]\s*/, "");
}
