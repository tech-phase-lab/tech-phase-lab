import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { publicNewsPayload } from "../lib/research/general-news.ts";
const calendarUrl = new URL("../lib/research/calendar.ts", import.meta.url).href;
const source = (await readFile(new URL("../lib/research/pce-results.ts", import.meta.url), "utf8"))
  .replace('"./calendar"', JSON.stringify(calendarUrl));
const { mergeEconomicResults } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64"));
const update = {
  id: "9001", title: "U.S. August PCE: headline +0.4% MoM / +2.9% YoY; core +0.3% MoM / +2.7% YoY",
  translationJa: "米国8月PCE：総合 前月比+0.4%・前年比+2.9%／コア 前月比+0.3%・前年比+2.7%",
  url: "https://www.bea.gov/news/2026/personal-income-and-outlays-august-2026", publisher: "BEA", tickers: [],
  observedAt: "2026-09-30T13:00:00Z", publishedAt: "2026-09-30T12:30:00Z",
};

test("public BEA projection permits only official PCE paths and strips private fields", () => {
  const payload = publicNewsPayload({ ok: true, enabled: false, items: [], officialUpdates: [{ ...update, text: "private evidence", model: "private" }, update] });
  assert.equal(payload.officialUpdates.length, 1);
  assert.equal(payload.officialUpdates[0].text, undefined);
  assert.equal(payload.officialUpdates[0].publishedAt, "2026-09-30T12:30:00.000Z");
  for (const url of ["https://www.bea.gov/private", update.url + "?q=private", "https://www.bea.gov/news/2026/gdp", update.url.replace("www.bea.gov", "bea.gov.evil.example")]) {
    assert.throws(() => publicNewsPayload({ ok: true, enabled: false, items: [], officialUpdates: [{ ...update, url }] }));
  }
});

test("automatic exact-period PCE revisions replace the saved result once and preserve ADP", () => {
  const initial = mergeEconomicResults();
  const merged = mergeEconomicResults([update, update]);
  assert.equal(merged.length, initial.length);
  const pce = merged.find(item => item.id === "pce-2026-08");
  assert.equal(pce.result.ja, update.translationJa);
  assert.equal(pce.sourceName, "BEA");
  assert.deepEqual(merged.find(item => item.id === "adp-2026-09"), initial.find(item => item.id === "adp-2026-09"));
  for (const changes of [{ publisher: "Other" }, { publishedAt: undefined }, { translationJa: undefined }, { url: update.url.replace("august", "unknown") }]) {
    assert.deepEqual(mergeEconomicResults([{ ...update, ...changes }]), initial);
  }
  const next = mergeEconomicResults([{ ...update, url: update.url.replace("august", "september"), publishedAt: "2026-10-29T12:30:00Z" }]);
  assert.equal(next.length, initial.length + 1);
  // Newest first. A newer row of another kind (the Nov 3 midterms) may sit above it, so check the order rather than the first place.
  const position = id => next.findIndex(item => item.id === id);
  assert.ok(position("pce-2026-09") >= 0 && position("pce-2026-09") < position("fomc-2026-10"), "the new PCE result is above the older FOMC row");
  assert.deepEqual(next.map(item => Date.parse(item.releasedAt)), next.map(item => Date.parse(item.releasedAt)).toSorted((a, b) => b - a), "the list is newest first");
});

test('employment sources collapse into one localized release and retain the verified official result', () => {
  const brief = {id:'1176', researchId:'x-result-1176',kind:'economic',ticker:'ECON',period:'SEPTEMBER JOBS REPORT',
    titleJa:'非農業部門雇用者数 +29K／失業率 4.2%',titleEn:'Nonfarm payrolls +29K; unemployment rate 4.2%',
    facts:[{key:'nonfarm-payrolls',ja:'非農業部門雇用者数',en:'Nonfarm payrolls',value:'+29K'}],
    publisher:'Wall St Engine',url:'https://x.com/wallstengine/status/123',publishedAt:'2026-10-02T12:30:37Z',publicAt:'2026-10-02T12:49:15Z'};
  const merged = mergeEconomicResults([], [brief, {...brief,id:'1179',researchId:'x-result-1179',publisher:'Other'}]);
  const jobs = merged.filter(r => r.id.startsWith('jobs-') && r.releasedAt.startsWith('2026-10-02'));
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].sourceName,'BLS');
  assert.match(jobs[0].title.ja,/米国雇用統計/);
  assert.doesNotMatch(jobs[0].title.ja,/SEPTEMBER/);
  assert.match(jobs[0].detail.ja,/前月比/);
  const next = mergeEconomicResults([], [
    {...brief,period:'OCTOBER JOBS REPORT',publishedAt:'2026-11-06T13:30:37Z'},
    {...brief,id:'1180',researchId:'x-result-1180',period:'OCTOBER JOBS REPORT',publishedAt:'2026-11-06T13:31:00Z'},
  ]).filter(r=>r.id==='jobs-2026-10');
  assert.equal(next.length,1);
  assert.equal(next[0].title.ja,'米国雇用統計（10月）');
  assert.equal(next[0].title.en,'U.S. employment report (October 2026)');
});

test("U.S. CPI flashes become one Japanese-named calendar row per release", () => {
  const brief = { id: "1", researchId: "x-result-1", kind: "economic", ticker: "ECON", period: "SEPTEMBER U.S. CPI",
    titleJa: "米国CPI（9月）：前年比 2.9%", titleEn: "U.S. September CPI: YoY 2.9%",
    facts: [{ key: "cpi-yoy", ja: "CPI（前年比）", en: "CPI (YoY)", value: "2.9%" }],
    url: "https://x.com/wallstengine/status/1", publisher: "Wall St Engine",
    publishedAt: "2026-10-14T12:30:05Z", observedAt: "2026-10-14T12:30:20Z", publicAt: "2026-10-14T12:30:21Z" };
  const merged = mergeEconomicResults([], [brief, { ...brief, id: "2", researchId: "x-result-2", publishedAt: "2026-10-14T12:31:00Z" }]);
  const rows = merged.filter(item => item.id === "cpi-2026-09");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title.ja, "米国CPI（9月）");
  assert.equal(rows[0].result.ja, brief.titleJa);
});

const cpi = {
  id: "9101", title: "U.S. September CPI: headline +0.6% MoM / +3.7% YoY; core +0.3% MoM / +2.6% YoY",
  translationJa: "米国9月CPI：総合 前月比+0.6%・前年比+3.7%／コア 前月比+0.3%・前年比+2.6%",
  url: "https://www.bls.gov/news.release/archives/cpi_10142026.htm", publisher: "BLS", tickers: [],
  observedAt: "2026-10-14T12:30:07Z", publishedAt: "2026-10-14T08:30:00-04:00",
};

test("the CPI release read from bls.gov is accepted only at its dated archive path and joins the calendar results", () => {
  const payload = publicNewsPayload({ ok: true, enabled: false, items: [], officialUpdates: [{ ...cpi, text: "private evidence" }] });
  assert.equal(payload.officialUpdates.length, 1);
  assert.equal(payload.officialUpdates[0].text, undefined);
  for (const url of ["https://www.bls.gov/private", cpi.url + "?q=1", "https://www.bls.gov/news.release/cpi.nr0.htm", cpi.url.replace("www.bls.gov", "bls.gov.evil.example")]) {
    assert.throws(() => publicNewsPayload({ ok: true, enabled: false, items: [], officialUpdates: [{ ...cpi, url }] }));
  }
  const row = mergeEconomicResults([cpi]).find(event => event.id === "cpi-2026-09");
  assert.ok(row);
  assert.equal(row.sourceName, "BLS");
  assert.equal(row.releasedAt, "2026-10-14T08:30:00-04:00");
  assert.equal(row.result.ja, cpi.translationJa);
  // A flash for the same release does not add a second row.
  const flash = { id: "f1", kind: "economic", ticker: "ECON", period: "U.S. SEPTEMBER CPI", titleJa: "x", titleEn: "x", facts: [], publishedAt: "2026-10-14T12:31:00Z", observedAt: "2026-10-14T12:31:05Z", publicAt: "2026-10-14T12:31:06Z", url: "https://x.com/wallstengine/status/1", publisher: "Wall St Engine" };
  assert.equal(mergeEconomicResults([cpi], [flash]).filter(event => event.id.startsWith("cpi-")).length, 1);
});

test("a CPI result for a December release names the previous year's January data correctly", () => {
  const january = { ...cpi, title: cpi.title.replace("September", "December"), url: "https://www.bls.gov/news.release/archives/cpi_01142027.htm", publishedAt: "2027-01-14T08:30:00-05:00" };
  assert.ok(mergeEconomicResults([january]).some(event => event.id === "cpi-2026-12"));
});

const ppi = {
  id: "9102", title: "U.S. September PPI: final demand +1.3% MoM / +6.3% YoY; core +0.5% MoM / +5.0% YoY",
  translationJa: "米国9月PPI：総合 前月比+1.3%・前年比+6.3%／コア 前月比+0.5%・前年比+5.0%",
  url: "https://www.bls.gov/news.release/archives/ppi_10152026.htm", publisher: "BLS", tickers: [],
  observedAt: "2026-10-15T12:30:07Z", publishedAt: "2026-10-15T08:30:00-04:00",
};

test("the PPI release read from bls.gov is accepted only at its dated archive path and joins the calendar results", () => {
  const payload = publicNewsPayload({ ok: true, enabled: false, items: [], officialUpdates: [{ ...ppi, text: "private evidence" }] });
  assert.equal(payload.officialUpdates.length, 1);
  assert.equal(payload.officialUpdates[0].text, undefined);
  for (const url of ["https://www.bls.gov/news.release/ppi.nr0.htm", ppi.url + "?q=1", ppi.url.replace("www.bls.gov", "bls.gov.evil.example")]) {
    assert.throws(() => publicNewsPayload({ ok: true, enabled: false, items: [], officialUpdates: [{ ...ppi, url }] }));
  }
  const row = mergeEconomicResults([ppi]).find(event => event.id === "ppi-2026-09");
  assert.ok(row);
  assert.equal(row.title.ja, "米国PPI（生産者物価指数）（9月）");
  assert.equal(row.sourceName, "BLS");
  assert.equal(row.releasedAt, "2026-10-15T08:30:00-04:00");
  assert.equal(row.result.ja, ppi.translationJa);
});

const jobs = {
  id: "9103", title: "U.S. September jobs report: nonfarm payrolls +29K / unemployment rate 4.2%",
  translationJa: "米国9月雇用統計：非農業部門雇用者数 +29,000人／失業率 4.2%",
  url: "https://www.bls.gov/news.release/archives/empsit_10022026.htm", publisher: "BLS", tickers: [],
  observedAt: "2026-10-02T12:30:07Z", publishedAt: "2026-10-02T08:30:00-04:00",
};

test("the jobs report read from bls.gov is accepted only at its dated archive path and joins the calendar results", () => {
  const payload = publicNewsPayload({ ok: true, enabled: false, items: [], officialUpdates: [{ ...jobs, text: "private evidence" }] });
  assert.equal(payload.officialUpdates.length, 1);
  for (const url of ["https://www.bls.gov/news.release/empsit.nr0.htm", jobs.url + "?q=1", jobs.url.replace("www.bls.gov", "bls.gov.evil.example")]) {
    assert.throws(() => publicNewsPayload({ ok: true, enabled: false, items: [], officialUpdates: [{ ...jobs, url }] }));
  }
  const row = mergeEconomicResults([jobs]).find(event => event.id === "jobs-2026-09");
  assert.ok(row);
  assert.equal(row.title.ja, "米国雇用統計（9月）");
  assert.equal(row.sourceName, "BLS");
  assert.equal(row.result.ja, jobs.translationJa);
});

test("a month-less PCE flash on the day of the verified BEA release adds no second row", () => {
  const bea = { ...update, title: "U.S. September PCE: headline +0.5% MoM / +3.6% YoY; core +0.3% MoM / +3.1% YoY",
    translationJa: "米国9月PCE：総合 前月比+0.5%・前年比+3.6%／コア 前月比+0.3%・前年比+3.1%",
    url: "https://www.bea.gov/news/2026/personal-income-and-outlays-september-2026", observedAt: "2026-10-29T12:30:10Z", publishedAt: "2026-10-29T12:30:00Z" };
  const brief = { id: "5", researchId: "x-result-5", kind: "economic", ticker: "ECON", period: "U.S. PCE",
    titleJa: "米国PCE：コア前年比 3.1%", titleEn: "U.S. PCE: core YoY 3.1%",
    facts: [{ key: "pce-core-yoy", ja: "コア前年比", en: "Core YoY", value: "3.1%" }],
    url: "https://x.com/wallstengine/status/5", publisher: "Wall St Engine",
    publishedAt: "2026-10-29T12:31:00Z", observedAt: "2026-10-29T12:31:10Z", publicAt: "2026-10-29T12:31:11Z" };
  const rows = mergeEconomicResults([bea], [brief]).filter(item => item.releasedAt.startsWith("2026-10-29"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title.ja, "米国PCE物価指数（9月）");
  assert.equal(mergeEconomicResults([], [brief]).filter(item => item.releasedAt.startsWith("2026-10-29")).length, 1);
});

test("the market expectation read from headlines joins the official jobs row and never becomes a row of its own (owner, Nov 6)", () => {
  const jobsUpdate = {
    id: "9100", title: "U.S. October jobs report: nonfarm payrolls +165K / unemployment rate 4.1% / average hourly earnings +0.3% m/m (+3.8% y/y)",
    translationJa: "米国10月雇用統計：非農業部門雇用者数 +165,000人／失業率 4.1%／平均時給 前月比+0.3%（前年比+3.8%）",
    url: "https://www.bls.gov/news.release/archives/empsit_11062026.htm", publisher: "BLS", tickers: [],
    observedAt: "2026-11-06T13:31:00Z", publishedAt: "2026-11-06T13:30:00Z",
  };
  const expected = { id: "expected-jobs-2026-10", titleJa: "米国雇用統計の市場予想（10月）", titleEn: "U.S. jobs report consensus (October)", sourceName: "investingLive・Forex Factory(報道)",
    releasedAt: "2026-11-06T13:31:00Z", resultJa: "市場予想 非農業部門雇用者数 +150,000人（2社が同じ数字を報道）", resultEn: "Consensus: nonfarm payrolls +150,000 (the same figure from 2 outlets)",
    detailJa: "x", detailEn: "x", sourceUrl: "https://example.com/a", verifiedOn: "2026-11-06", sources: [{ publisher: "a", title: "t", url: "https://example.com/a" }, { publisher: "b", title: "t", url: "https://example.com/b" }] };
  const merged = mergeEconomicResults([jobsUpdate], [], [expected]);
  assert.equal(merged.some(row => row.id === "expected-jobs-2026-10"), false);
  const row = merged.find(item => item.id === "jobs-2026-10");
  assert.match(row.result.ja, /非農業部門雇用者数 \+165,000人.*平均時給 前月比\+0\.3%（前年比\+3\.8%）／市場予想 \+150,000人$/);
  assert.match(row.result.en, /consensus \+150,000$/);
  assert.match(row.detail.ja, /2社以上の報道の見出しが同じ数字を伝えたもの/);
  assert.doesNotMatch(row.detail.ja, /市場予想との比較は含みません/);
  // Without an expectation the row is unchanged.
  assert.doesNotMatch(mergeEconomicResults([jobsUpdate], [], []).find(item => item.id === "jobs-2026-10").result.ja, /市場予想/);
});

test("one row per indicator and release day: the Oct 28 FOMC read from the Fed statement does not add a second row (owner, Nov 19)", () => {
  // The shape indicator_results.fomc_payload saves (its id carries the meeting date, the hand-written row's only the month).
  const fomc = (meeting, month) => ({ id: `fomc-${meeting}`, titleJa: `FOMC 政策金利（${month}月会合）`, titleEn: "FOMC rate decision", sourceName: "FRB",
    releasedAt: `${meeting}T18:00:00Z`, resultJa: "政策金利を据え置き（3.75〜4.00%）", resultEn: "Policy rate held: target range 3.75% to 4.00%",
    detailJa: "FRBの声明文から、フェデラルファンド金利の誘導目標レンジを取得。市場予想との比較は含みません。", detailEn: "x",
    sourceUrl: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm", verifiedOn: meeting });
  const merged = mergeEconomicResults([], [], [fomc("2026-10-28", 10)]);
  const october = merged.filter(row => row.id.startsWith("fomc-") && row.releasedAt.startsWith("2026-10-28"));
  assert.equal(october.length, 1);
  // The more detailed hand-written row stays: target range and the 10-2 vote.
  assert.equal(october[0].title.ja, "FOMC 政策金利の発表（10月会合）");
  assert.equal(october[0].result.ja, "政策金利（誘導目標レンジ3.75〜4.00%）を据え置き。採決は10対2");
  assert.equal(merged.length, mergeEconomicResults().length);
  // Another meeting is its own row.
  const december = mergeEconomicResults([], [], [fomc("2026-12-09", 12)]);
  assert.equal(december.filter(row => row.id.startsWith("fomc-")).length, 2);
  assert.ok(december.some(row => row.id === "fomc-2026-12-09"));
});

test("the same report under two ids on one day collapses for every indicator; other days and other indicators stay", () => {
  const event = (id, releasedAt, resultJa) => ({ id, titleJa: id, titleEn: id, sourceName: "x", releasedAt, resultJa, resultEn: resultJa, detailJa: "", detailEn: "", sourceUrl: "https://example.com/", verifiedOn: releasedAt.slice(0, 10) });
  const rows = mergeEconomicResults([], [], [
    event("retail-2026-10", "2026-11-17T13:30:00Z", "前月比+0.4%（売上高 750.0十億ドル）"), event("retail-release-2026-11-17", "2026-11-17T13:35:00Z", "前月比+0.4%"),
    event("gdp-2026-q3-advance", "2026-10-29T12:30:00Z", "年率+2.1%"), event("retail-2026-11", "2026-12-15T13:30:00Z", "前月比+0.2%"),
  ]);
  assert.deepEqual(rows.filter(row => row.id.startsWith("retail")).map(row => row.id).sort(), ["retail-2026-10", "retail-2026-11"]);
  assert.ok(rows.some(row => row.id === "gdp-2026-q3-advance"));
  const apart = mergeEconomicResults([], [], [event("adp-2026-12", "2026-12-02T13:15:00Z", "a"), event("adp-2027-01", "2027-01-06T13:15:00Z", "b")]);
  assert.equal(apart.filter(row => /^adp-202(6-12|7-01)$/.test(row.id)).length, 2);
});
