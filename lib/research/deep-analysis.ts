/** PRO deep analysis (owner, Oct 11): written by a higher-tier model, every
 * figure checked against its source on the monitor before it is stored.
 * Since Nov 18 it reads like a research note: the headline is the question the release raises, then what changed, sections with headings,
 * conditional scenarios, what the release does not tell (わからないこと) and what to check next (次に見ること). Analyses stored earlier carry
 * only points and a watch line; both shapes are accepted. */
import { parseMarketReaction, type MarketReaction } from "./market-reaction.ts";

export type DeepCopy = { ja: string; en: string };
export type DeepSection = DeepCopy & { heading: DeepCopy | null };
export type DeepScenario = DeepCopy & { case: "base" | "upside" | "reassessment" };
export type DeepAnalysis = {
  id: string; kind: "earnings" | "indicator"; subject: string; sourceUrl: string; sourceTitle: string;
  publishedAt: string; releasedAt: string | null; headline: DeepCopy; summary: DeepCopy | null; sections: DeepSection[];
  scenarios: DeepScenario[]; unknowns: DeepCopy[]; next: DeepCopy[];
  points: DeepCopy[]; watch: DeepCopy | null;
  /** 「翌日の市場の反応」, added by the web server from daily prices (never by the monitor or a model). */
  reaction?: MarketReaction | null;
};

function copy(value: unknown, max = 600): DeepCopy {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v.ja !== "string" || typeof v.en !== "string" || !v.ja.trim() || !v.en.trim()
    || v.ja.length > max || v.en.length > max || `${v.ja}${v.en}`.includes("\0")) throw Error("Invalid analysis copy");
  return { ja: v.ja, en: v.en };
}
const list = (value: unknown, max: number): unknown[] => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw Error("Invalid analysis list");
  return value;
};
const CASES = ["base", "upside", "reassessment"] as const;

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
        || typeof r.publishedAt !== "string" || !Number.isFinite(Date.parse(r.publishedAt))) throw Error("Invalid analysis");
      const points = list(r.points, 5).map(point => copy(point));
      // A research note's sections; an earlier analysis shows its points as sections without headings.
      const sections: DeepSection[] = r.sections == null ? points.map(point => ({ ...point, heading: null }))
        : list(r.sections, 5).map(raw => {
          const s = raw as Record<string, unknown>;
          return { ...copy(s), heading: s?.heading == null ? null : copy(s.heading, 80) };
        });
      if (!sections.length) throw Error("Invalid analysis");
      const scenarios = list(r.scenarios, 3).map(raw => {
        const s = raw as Record<string, unknown>;
        if (!CASES.includes(s?.case as DeepScenario["case"])) throw Error("Invalid scenario");
        return { ...copy(s), case: s.case as DeepScenario["case"] };
      });
      const next = list(r.next, 4).map(item => copy(item));
      const watch = r.watch == null ? null : copy(r.watch);
      const releasedAt = typeof r.releasedAt === "string" && Number.isFinite(Date.parse(r.releasedAt)) ? r.releasedAt : null;
      return [{ id: r.id, kind: r.kind, subject: r.subject, sourceUrl: url.href, sourceTitle: r.sourceTitle,
        publishedAt: r.publishedAt, releasedAt, headline: copy(r.headline, 300), summary: r.summary == null ? null : copy(r.summary),
        sections, scenarios, unknowns: list(r.unknowns, 3).map(item => copy(item, 300)),
        next: next.length ? next : watch ? [watch] : [], points: points.length ? points : sections.map(({ ja, en }) => ({ ja, en })), watch,
        ...(r.reaction !== undefined ? { reaction: parseMarketReaction(r.reaction) } : {}) }];
    } catch { return []; }
  });
}
