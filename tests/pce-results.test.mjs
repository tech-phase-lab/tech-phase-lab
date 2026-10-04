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
  assert.equal(next[0].id, "pce-2026-09");
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
