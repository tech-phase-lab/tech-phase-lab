import { economicResults } from "./calendar";
import type { ResultBrief } from "./market-results";
import type { EventResult, OfficialUpdate } from "./general-news";

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function mergeEconomicResults(updates: OfficialUpdate[] = [], briefs: ResultBrief[] = [], events: EventResult[] = []) {
  const results = new Map(economicResults.map(event => [event.id, event]));
  // Big events read automatically from at least two outlets; they replace a hand-written row of the same id.
  // An "expected-…" event is the market expectation read from headlines; it joins the official row below and is never a row of its own.
  for (const event of events.filter(event => !event.id.startsWith("expected-"))) results.set(event.id, { id: event.id, title: { ja: event.titleJa, en: event.titleEn }, sourceName: event.sourceName, releasedAt: event.releasedAt,
    result: { ja: event.resultJa, en: event.resultEn }, detail: { ja: event.detailJa, en: event.detailEn }, sourceUrl: event.sourceUrl, verifiedOn: event.verifiedOn });
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
  // The CPI and PPI releases read straight from bls.gov (Oct 14/15): the official result takes the same place as BEA's PCE.
  const blsIndicators = [
    { key: "jobs", file: "empsit", label: "jobs report", title: { ja: (month: number) => `米国雇用統計（${month}月）`, en: (period: string) => `U.S. employment report (${period})` },
      detail: { ja: "非農業部門雇用者数の増減・失業率・平均時給(前月比と前年比。取得できた場合)をBLS公式発表から取得。市場予想との比較は含みません。", en: "Change in total nonfarm payroll employment, the unemployment rate, and average hourly earnings (monthly and yearly change, when stated) from the official BLS release. No consensus comparison." } },
    { key: "cpi", file: "cpi", label: "CPI", title: { ja: (month: number) => `米国CPI（消費者物価指数）（${month}月）`, en: (period: string) => `U.S. Consumer Price Index (${period})` },
      detail: { ja: "総合とコアの前月比・前年比をBLS公式発表から取得。市場予想との比較は含みません。", en: "Headline and core monthly and annual changes from the official BLS release. No consensus comparison." } },
    { key: "ppi", file: "ppi", label: "PPI", title: { ja: (month: number) => `米国PPI（生産者物価指数）（${month}月）`, en: (period: string) => `U.S. Producer Price Index (${period})` },
      detail: { ja: "最終需要の前月比・前年比と、食品・エネルギー・貿易サービスを除くコアの変化をBLS公式発表から取得。市場予想との比較は含みません。", en: "Final demand and core (less foods, energy and trade services) monthly and annual changes from the official BLS release. No consensus comparison." } },
  ];
  for (const indicator of blsIndicators) for (const item of updates) {
    const url = new URL(item.url);
    const match = new RegExp(`^\\/news\\.release\\/archives\\/${indicator.file}_(\\d{2})(\\d{2})(20\\d{2})\\.htm$`).exec(url.pathname);
    const named = new RegExp(`^U\\.S\\. ([A-Z][a-z]+) ${indicator.label}:`).exec(item.title);
    if (url.origin !== "https://www.bls.gov" || url.search || url.hash || !match || !named || item.publisher !== "BLS" || !item.publishedAt || !item.translationJa) continue;
    const month = months.indexOf(named[1].toLowerCase()) + 1;
    if (!month) continue;
    const releaseMonth = Number(match[1]), releaseYear = Number(match[3]);
    const year = releaseYear - (month > releaseMonth ? 1 : 0);
    const period = `${year}-${String(month).padStart(2, "0")}`;
    const id = `${indicator.key}-${period}`;
    results.set(id, {
      id, title: { ja: indicator.title.ja(month), en: indicator.title.en(period) },
      sourceName: "BLS", releasedAt: item.publishedAt,
      result: { ja: item.translationJa, en: item.title },
      detail: indicator.detail,
      sourceUrl: item.url, verifiedOn: item.observedAt.slice(0, 10),
    });
  }
  // Owner, Nov 6: the market expectation (from at least two outlets' headlines) is added to the official result of the same report.
  for (const expected of events.filter(event => event.id.startsWith("expected-"))) {
    const row = results.get(expected.id.slice("expected-".length));
    if (!row || row.result.ja.includes("市場予想")) continue;
    results.set(row.id, { ...row,
      result: { ja: `${row.result.ja}／${expected.resultJa.replace(/（\d+社が同じ数字を報道）$/, "").replace(/^市場予想 非農業部門雇用者数 /, "市場予想 ")}`, en: `${row.result.en} / ${expected.resultEn.replace(/ \(the same figure from \d+ outlets\)$/, "").replace(/^Consensus: nonfarm payrolls /, "consensus ")}` },
      detail: { ja: row.detail.ja.replace("市場予想との比較は含みません。", "市場予想は、2社以上の報道の見出しが同じ数字を伝えたものです(公式の数字ではありません)。"), en: row.detail.en.replace("No consensus comparison is included.", "The consensus is the figure at least two outlets gave in their headlines (not an official figure).").replace("No consensus comparison.", "The consensus is the figure at least two outlets gave in their headlines (not an official figure).") } });
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
    const inflation = /^(?:[A-Z]+ )?U\.S\. (CPI|PPI|PCE)(?:\/|$)/.exec(r.period);
    if (inflation && !employment) {
      // Oct 11: one calendar row per U.S. inflation release, named in Japanese.
      const name = inflation[1];
      const release = new Date(r.publishedAt);
      const year = release.getUTCFullYear() - (month > release.getUTCMonth() ? 1 : 0);
      id = month < 0 ? `${name.toLowerCase()}-release-${date}` : `${name.toLowerCase()}-${year}-${String(month + 1).padStart(2, "0")}`;
      title = month < 0
        ? { ja: `米国${name}`, en: `U.S. ${name}` }
        : { ja: `米国${name}（${month + 1}月）`, en: `U.S. ${name} (${months[month][0].toUpperCase() + months[month].slice(1)} ${year})` };
    }
    if (officialIds.has(id)) continue;
    // A post that names no month ("U.S. PCE") is the same release as the verified row of that day.
    if (inflation && !employment && month < 0 && [...results.values()].some(row => row.id.startsWith(`${inflation[1].toLowerCase()}-`) && row.releasedAt.slice(0, 10) === date)) continue;
    results.set(id, {id,title,sourceName:r.publisher,releasedAt:r.publishedAt,
      result:{ja:r.titleJa,en:r.titleEn},
      detail:{ja:r.facts.map(f => `${f.ja}：${f.value}`).join("\n"),en:r.facts.map(f => `${f.en}: ${f.value}`).join("\n")},
      sourceUrl:r.url,verifiedOn:r.publicAt.slice(0,10)});
  }
  return [...results.values()].sort((a, b) => Date.parse(b.releasedAt) - Date.parse(a.releasedAt));
}
