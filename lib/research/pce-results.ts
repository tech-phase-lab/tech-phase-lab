import { economicResults } from "./calendar";
import type { ResultBrief } from "./market-results";
import type { OfficialUpdate } from "./general-news";

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function mergeEconomicResults(updates: OfficialUpdate[] = [], briefs: ResultBrief[] = []) {
  const results = new Map(economicResults.map(event => [event.id, event]));
  for (const item of updates) {
    const url = new URL(item.url);
    const match = /^\/news\/20\d{2}\/personal-income-and-outlays-([a-z]+)-(20\d{2})$/.exec(url.pathname);
    if (url.origin !== "https://www.bea.gov" || url.search || url.hash || !match || item.publisher !== "BEA" || !item.publishedAt || !item.translationJa) continue;
    const month = months.indexOf(match[1]) + 1;
    if (!month) continue;
    const period = `${match[2]}-${String(month).padStart(2, "0")}`;
    const id = `pce-${period}`;
    results.set(id, {
      id, title: { ja: `米国PCE物価指数（${month}月）`, en: `U.S. PCE price index (${period})` },
      sourceName: "BEA", releasedAt: item.publishedAt,
      result: { ja: item.translationJa, en: item.title },
      detail: { ja: "総合とコアの前月比・前年比をBEA公式発表から取得。市場予想との比較は含みません。", en: "Headline and core monthly and annual changes from the official BEA release. No consensus comparison." },
      sourceUrl: item.url, verifiedOn: item.observedAt.slice(0, 10),
    });
  }
  // One release per indicator/period. Verified official results take precedence;
  // incoming social posts must not add a second English-titled calendar row.
  const officialIds = new Set(results.keys());
  const economic = briefs.filter(item => item.kind === "economic")
    .toSorted((a, b) => a.facts.length - b.facts.length || Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  for (const r of economic) {
    const employment = /jobs report|employment results|non[- ]?farm payrolls|^NFP$|unemployment rate|hourly earnings/i.test(r.period);
    const date = r.publishedAt.slice(0, 10);
    const month = months.findIndex(month => new RegExp(`\\b${month}\\b`, "i").test(r.period));
    let id = `economic-${r.period.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${date}`;
    let title = { ja: r.titleJa, en: r.titleEn };
    if (employment) {
      const existing = economicResults.find(event => event.id.startsWith("jobs-") && event.releasedAt.slice(0, 10) === date);
      const release = new Date(r.publishedAt);
      const year = release.getUTCFullYear() - (month > release.getUTCMonth() ? 1 : 0);
      const explicitId = month < 0 ? null : `jobs-${year}-${String(month + 1).padStart(2, "0")}`;
      id = explicitId ?? existing?.id ?? `jobs-release-${date}`;
      title = month < 0
        ? { ja: "米国雇用統計", en: "U.S. employment report" }
        : { ja: `米国雇用統計（${month + 1}月）`, en: `U.S. employment report (${months[month][0].toUpperCase() + months[month].slice(1)} ${year})` };
    }
    if (officialIds.has(id)) continue;
    results.set(id, {id,title,sourceName:r.publisher,releasedAt:r.publishedAt,
      result:{ja:r.titleJa,en:r.titleEn},
      detail:{ja:r.facts.map(f => `${f.ja}：${f.value}`).join("\n"),en:r.facts.map(f => `${f.en}: ${f.value}`).join("\n")},
      sourceUrl:r.url,verifiedOn:r.publicAt.slice(0,10)});
  }
  return [...results.values()].sort((a, b) => Date.parse(b.releasedAt) - Date.parse(a.releasedAt));
}
