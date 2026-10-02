import type { OfficialUpdate } from "./general-news";
import type { ResultBrief } from "./market-results";
import { normalizedEarningsPeriod } from "./deduplicate-events.ts";

type ResultSource = { id: string; url: string; publisher: string; publishedAt: string; observedAt: string };
type MergedResultUpdate = OfficialUpdate & { sources?: ResultSource[] };

export function resultNewsReleaseKey(result: ResultBrief): string {
  const period = result.kind === "earnings" ? normalizedEarningsPeriod(result.period)
    : result.period.trim().toUpperCase().replace(/\s+/g, " ");
  if (!period) return result.researchId;
  const revision = /\b(?:restated|restatement|revised|correction|corrected)\b|訂正|修正/.test(
    `${result.titleEn.toLowerCase()} ${result.titleJa}`) ? "revision" : "release";
  return JSON.stringify([result.kind, result.ticker, period, new Date(result.publishedAt).toISOString().slice(0, 10), revision]);
}

/** Merge only validated result-backed posts, never arbitrary same-ticker news. */
export function mergeResultNews(updates: OfficialUpdate[], briefs: ResultBrief[] = []): MergedResultUpdate[] {
  const groups = new Map<string, { update: OfficialUpdate; brief: ResultBrief }[]>();
  const unrelated: OfficialUpdate[] = [];
  for (const update of updates) {
    const brief = briefs.find(result => result.id === update.id && result.url === update.url);
    if (!brief) { unrelated.push(update); continue; }
    const key = resultNewsReleaseKey(brief);
    const group = groups.get(key) ?? [];
    // Repeated mappings of the same post must not create duplicate evidence.
    if (!group.some(item => item.brief.url === brief.url)) group.push({ update, brief });
    groups.set(key, group);
  }
  const merged: MergedResultUpdate[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => Date.parse(b.brief.publishedAt) - Date.parse(a.brief.publishedAt)
      || b.brief.researchId.localeCompare(a.brief.researchId));
    if (group.length === 1) { merged.push(group[0].update); continue; }
    const sources = group.map(({ brief }) => ({ id: brief.id, url: brief.url, publisher: brief.publisher,
      publishedAt: brief.publishedAt, observedAt: brief.observedAt }));
    const facts = new Map<string, { fact: ResultBrief["facts"][number]; publishers: Set<string> }>();
    const valuesByMetric = new Map<string, Set<string>>();
    for (const { brief } of group) for (const fact of brief.facts) {
      // The displayed basis/period labels matter: adjusted and GAAP EPS, actuals
      // and guidance must never become an invented combined consensus number.
      const metricKey = JSON.stringify([fact.key, fact.ja, fact.en]);
      const valueSet = valuesByMetric.get(metricKey) ?? new Set<string>();
      valueSet.add(fact.value); valuesByMetric.set(metricKey, valueSet);
      const key = JSON.stringify([metricKey, fact.value]);
      const entry = facts.get(key) ?? { fact, publishers: new Set<string>() };
      entry.publishers.add(brief.publisher); facts.set(key, entry);
    }
    const conflict = [...valuesByMetric.values()].some(values => values.size > 1);
    const primary = group[0], period = primary.brief.period, ticker = primary.brief.ticker;
    const titles = conflict ? primary.brief.kind === "earnings"
      ? { title: `${ticker} ${period} earnings: source figures differ`, translationJa: `${ticker} ${period}決算：情報源による数値の相違` }
      : { title: `${period}: source figures differ`, translationJa: "経済指標：情報源による数値の相違" }
      : {};
    const body = (lang: "ja" | "en") => [...facts.values()].map(({ fact, publishers }) => {
      const attribution = [...publishers].join(" / ");
      return lang === "ja" ? `${fact.ja}：${fact.value}（${attribution}）` : `${fact.en}: ${fact.value} (${attribution})`;
    }).join("\n");
    merged.push({ ...primary.update, ...titles, ...(conflict ? { shortTitleJa: undefined, shortTitleEn: undefined } : {}),
      bodyJa: body("ja"), bodyEn: body("en"), sources });
  }
  return [...merged, ...unrelated];
}
