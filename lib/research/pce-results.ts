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
  for (const r of briefs.filter(item => item.kind === 'economic')) {
    results.set(r.researchId, {id:r.researchId,title:{ja:r.period,en:r.period},sourceName:r.publisher,releasedAt:r.publishedAt,
      result:{ja:r.titleJa,en:r.titleEn},detail:{ja:'X投稿の結果速報です。公式資料との照合前です。',en:'X-sourced result flash, pending official-source confirmation.'},sourceUrl:r.url,verifiedOn:r.publicAt.slice(0,10)});
  }
  return [...results.values()].sort((a, b) => Date.parse(b.releasedAt) - Date.parse(a.releasedAt));
}
