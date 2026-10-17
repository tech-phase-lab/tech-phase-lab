/** PRO deep analysis (owner, Oct 11): written by a higher-tier model, every
 * figure checked against its source on the monitor before it is stored. */
export type DeepCopy = { ja: string; en: string };
export type DeepAnalysis = {
  id: string; kind: "earnings" | "indicator"; subject: string; sourceUrl: string; sourceTitle: string;
  publishedAt: string; headline: DeepCopy; points: DeepCopy[]; watch: DeepCopy | null;
};

function copy(value: unknown, max = 600): DeepCopy {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v.ja !== "string" || typeof v.en !== "string" || !v.ja.trim() || !v.en.trim()
    || v.ja.length > max || v.en.length > max || `${v.ja}${v.en}`.includes("\0")) throw Error("Invalid analysis copy");
  return { ja: v.ja, en: v.en };
}

export function parseDeepAnalyses(value: unknown): DeepAnalysis[] {
  const items = (value as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length > 30) throw Error("Invalid analyses");
  return items.flatMap(raw => {
    try {
      const r = raw as Record<string, unknown>;
      const url = new URL(String(r.sourceUrl));
      if (typeof r.id !== "string" || !/^[0-9a-f]{16}$/.test(r.id) || (r.kind !== "earnings" && r.kind !== "indicator")
        || typeof r.subject !== "string" || !r.subject || r.subject.length > 40 || url.protocol !== "https:"
        || typeof r.sourceTitle !== "string" || r.sourceTitle.length > 300
        || typeof r.publishedAt !== "string" || !Number.isFinite(Date.parse(r.publishedAt))
        || !Array.isArray(r.points) || r.points.length < 2 || r.points.length > 5) throw Error("Invalid analysis");
      return [{ id: r.id, kind: r.kind, subject: r.subject, sourceUrl: url.href, sourceTitle: r.sourceTitle,
        publishedAt: r.publishedAt, headline: copy(r.headline, 300), points: r.points.map(point => copy(point)),
        watch: r.watch == null ? null : copy(r.watch) }];
    } catch { return []; }
  });
}
