import type { Language } from "./data";

export type AnalystAction = "initiation" | "upgrade" | "downgrade" | "top-pick" | "conviction-list" | "tactical-list";
export type AnalystUpdate = {
  id: string; ticker: string; firm: string; action: AnalystAction;
  titleJa: string; titleEn: string; bodyJa?: string; bodyEn?: string;
  publishedAt: string; observedAt: string;
};

const actions = new Set<AnalystAction>(["initiation", "upgrade", "downgrade", "top-pick", "conviction-list", "tactical-list"]);

/** Reconstruct public reporting only. Source posts and provenance stay internal. */
export function parseAnalystUpdates(value: unknown): AnalystUpdate[] {
  if (!Array.isArray(value) || value.length > 30) throw Error("Invalid analyst updates");
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("Invalid analyst update");
    const row = raw as Record<string, unknown>;
    const field = (key: string, max: number, multiline = false) => {
      const text = row[key];
      if (typeof text !== "string" || !text.trim() || Array.from(text).length > max
        || Array.from(text).some(char => {
          const code = char.charCodeAt(0);
          return code === 127 || (code < 32 && !(multiline && (code === 9 || code === 10)));
        })) throw Error("Invalid analyst field");
      return text;
    };
    const copy = (key: string, max: number, multiline = false) => {
      const text = field(key, max, multiline);
      if (/(?:https?:\/\/|www\.|(?:x|twitter)\.com\/|@[A-Za-z0-9_]|\b(?:TipRanks|TheFlyNews|The Fly|WallStEngine|Wall St Engine|FabyMetal4|Barchart|TrendSpider)\b)/i.test(text)) throw Error("Invalid analyst public copy");
      return text;
    };
    const id = field("id", 24), ticker = field("ticker", 7), firm = copy("firm", 80);
    const action = field("action", 20) as AnalystAction;
    if (!/^\d+$/.test(id) || !/^[A-Z]{1,5}(?:[.-][A-Z])?$/.test(ticker) || !actions.has(action)) throw Error("Invalid analyst action");
    const date = (key: string) => {
      const text = field(key, 50);
      const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(text);
      if (!match || !Number.isFinite(Date.parse(text))
        || new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) !== match[1]) throw Error("Invalid analyst date");
      return text;
    };
    const publishedAt = date("publishedAt"), observedAt = date("observedAt");
    if (Date.parse(publishedAt) > Date.parse(observedAt)) throw Error("Invalid analyst chronology");
    const body: Pick<AnalystUpdate, "bodyJa" | "bodyEn"> = {};
    if (row.bodyJa !== undefined || row.bodyEn !== undefined) {
      body.bodyJa = copy("bodyJa", 1200, true);
      body.bodyEn = copy("bodyEn", 1200, true);
    }
    return { id, ticker, firm, action, titleJa: copy("titleJa", 180), titleEn: copy("titleEn", 180),
      ...body, publishedAt, observedAt };
  });
}

export function analystNewsDisplay(item: AnalystUpdate, lang: Language) {
  const ja = lang === "ja";
  return { label: `${ja ? "アナリスト動向" : "Analyst news"} · ${item.ticker}`,
    title: ja ? item.titleJa : item.titleEn, body: ja ? item.bodyJa : item.bodyEn };
}
