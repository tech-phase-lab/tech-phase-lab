// The economic-results audit of Nov 28, 2026: every figure on the calendar checked against the official release.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { releaseView, releaseName, STATED_PREVIOUS, readValue } from "../lib/research/economic-release-view.ts";
import { fromObservations, readFredCsv, roundHalfAway, ISM_HISTORY } from "../lib/research/economic-history.ts";
import { calendarEvents, claimsReleases, dateOnlyEvents, indicatorReleases, economicResults } from "../lib/research/calendar.ts";

const calendarUrl = new URL("../lib/research/calendar.ts", import.meta.url).href;
const source = (await readFile(new URL("../lib/research/pce-results.ts", import.meta.url), "utf8")).replace('"./calendar"', JSON.stringify(calendarUrl));
const { mergeEconomicResults } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64"));

const now = Date.parse("2026-11-28T12:00:00Z");
const row = (id, releasedAt, ja, en, title = { ja: `${id}（10月）`, en: `${id} (October 2026)` }) => ({ id, releasedAt, title, result: { ja, en }, detail: { ja: "", en: "" }, sourceName: "x", sourceUrl: "https://example.com/" });

test("FRED's percent changes are rounded half away from zero, as the agencies print them, and a quarter is read from any of its months", () => {
  assert.equal(roundHalfAway(0.04999999999998117), 0.1, "100 → 100.05 is a 0.05% rise, printed 0.1 (toFixed gave 0.0)");
  assert.deepEqual([roundHalfAway(-0.25), roundHalfAway(0.24), roundHalfAway(-0.04), roundHalfAway(0)], [-0.3, 0.2, 0, 0]);
  assert.ok(!Object.is(roundHalfAway(-0.04), -0), "no negative zero");
  assert.deepEqual(fromObservations("cpi", readFredCsv("observation_date,CPIAUCSL\n2026-08-01,100\n2026-09-01,100.05")), [{ period: "2026-09", value: 0.1, decimals: 1 }]);
  assert.deepEqual(fromObservations("gdp", readFredCsv("observation_date,A191RL1Q225SBEA\n2026-03-01,1.0\n2026-07-01,4.3\n2026-12-01,2.0")).map(p => p.period), ["2026-Q1", "2026-Q3", "2026-Q4"]);
});

test("FRED's figures match the official releases for the last six months (checked Nov 28 against BLS, BEA, Census and ADP)", () => {
  // Index levels as FRED serves them on Nov 28, 2026; the expected changes are the agencies' own tables.
  const pce = fromObservations("pce", readFredCsv("observation_date,PCEPI\n2026-04-01,130.672\n2026-05-01,131.241\n2026-06-01,131.106\n2026-07-01,131.185\n2026-08-01,131.625\n2026-09-01,132.283\n2026-10-01,132.703"));
  assert.deepEqual(pce.slice(-2).map(p => p.value), [0.5, 0.3], "BEA October release: September 0.5, October 0.3");
  const cpi = fromObservations("cpi", readFredCsv("observation_date,CPIAUCSL\n2026-08-01,334.131\n2026-09-01,336.298\n2026-10-01,337.476"));
  assert.deepEqual(cpi.map(p => p.value), [0.6, 0.4], "BLS CPI table A: September 0.6, October 0.4");
  const ppi = fromObservations("ppi", readFredCsv("observation_date,PPIFIS\n2026-08-01,157.482\n2026-09-01,159.699\n2026-10-01,160.254"));
  assert.deepEqual(ppi.map(p => p.value), [1.4, 0.3], "BLS PPI table A: September 1.4 (revised), October 0.3");
  const retail = fromObservations("retail", readFredCsv("observation_date,RSAFS\n2026-08-01,740502\n2026-09-01,746637\n2026-10-01,748220"));
  assert.deepEqual(retail.map(p => p.value), [0.8, 0.2], "Census October: September 0.8 (unrevised), October 0.2");
  const jobs = fromObservations("jobs", readFredCsv("observation_date,PAYEMS\n2026-07-01,158882\n2026-08-01,159068\n2026-09-01,159128\n2026-10-01,159293"));
  assert.deepEqual(jobs.map(p => p.value), [186_000, 60_000, 165_000], "BLS October: August +186,000 and September +60,000 as revised, October +165,000");
  const adp = fromObservations("adp", readFredCsv("observation_date,ADPMNUSNERSA\n2026-08-01,132799000\n2026-09-01,132885000\n2026-10-01,132971000"));
  assert.deepEqual(adp.map(p => p.value), [86_000, 86_000], "ADP October: September revised to 86,000, October 86,000");
});

test("前回 is this release's own revised figure for the period before; FRED's only once it carries this release; else the stored row", () => {
  for (const [id, entry] of Object.entries(STATED_PREVIOUS)) {
    const verified = economicResults.find(item => item.id === id);
    if (verified) assert.equal(readValue(id, verified.result).value, entry.headline, `${id}: the entry is for the verified row's own number`);
  }
  // A December ADP row with no stated revision: FRED has December, so its November is November as revised by the December release.
  const dec = row("adp-2026-12", "2027-01-06T13:15:00Z", "民間の雇用者数 +50,000人", "Private employment +50,000");
  const nov = row("adp-2026-11", "2026-12-02T13:15:00Z", "民間の雇用者数 +90,000人", "Private employment +90,000");
  const fred = { adp: [{ period: "2026-11", value: 70_000, decimals: 0 }, { period: "2026-12", value: 50_000, decimals: 0 }] };
  assert.equal(releaseView(dec, [dec, nov], [], [], now, "ja", fred).previous.display, "+7万人");
  const fuller = { adp: [...["07", "08", "09", "10"].map(m => ({ period: `2026-${m}`, value: 10_000, decimals: 0 })), ...fred.adp] };
  assert.equal(releaseView(dec, [dec, nov], [], [], now, "ja", fuller).history.at(-2).display, "7", "the November bar shows the same figure as 前回");
  assert.equal(releaseView(dec, [dec, nov], [], [], now, "ja", { adp: fred.adp.slice(0, 1) }).previous.display, "+9万人", "FRED without December may not hold its revision yet");
  const jan = row("adp-2027-01", "2027-02-03T13:15:00Z", "民間の雇用者数 +40,000人", "Private employment +40,000");
  assert.equal(releaseView(dec, [jan, dec, nov], [], [], now, "ja", fred).previous.display, "+9万人", "an older row keeps the stored figure");
});

test("jobless claims: the bar for the week before shows the revised level, the same as 前回", () => {
  const claims = (week, at, ja, en) => ({ id: `claims-2026-11-${week}`, releasedAt: at, title: { ja: `米国新規失業保険申請件数（11月${week}日終了週）`, en: `U.S. initial jobless claims (week ending November ${week}, 2026)` }, result: { ja, en }, detail: { ja: "", en: "" }, sourceName: "DOL", sourceUrl: "https://www.dol.gov/ui/data.pdf" });
  const c21 = claims("21", "2026-11-25T13:30:00+00:00", "189,000件（前週改定値から13,000件減）", "189,000 (down 13,000 from the previous week's revised level)");
  const c14 = claims("14", "2026-11-19T13:30:00+00:00", "203,000件（前週改定値から1,000件増）", "203,000 (up 1,000 from the previous week's revised level)");
  const weeks = { claims: [["2026-10-17", 195000], ["2026-10-24", 195000], ["2026-10-31", 191000], ["2026-11-07", 202000]].map(([period, value]) => ({ period, value, decimals: 0 })) };
  const view = releaseView(c21, [c21, c14], [], [], now, "ja", weeks);
  assert.equal(view.previous.display, "20.2万件");
  assert.deepEqual(view.history.map(bar => bar.display).slice(-2), ["20.2", "18.9"], "DOL: the week of Nov 14 was revised from 203,000 to 202,000");
});

test("ISM's PMI has 前回 and bars from ISM's own releases (it is not on FRED)", () => {
  const ism = row("ism-2026-11", "2026-11-02T15:00:00Z", "製造業景況指数 55.5（50が拡大と縮小の境目）", "Manufacturing PMI 55.5 (50 separates expansion from contraction)", { ja: "ISM製造業景況指数（10月）", en: "ISM manufacturing (October 2026)" });
  const view = releaseView(ism, [ism], [], indicatorReleases, now, "ja");
  assert.deepEqual([view.previous.display, view.move.direction, view.move.size], ["54.5", "up", "1.0"]);
  assert.deepEqual(view.history.map(bar => [bar.label, bar.display]), [["5月", "54.0"], ["6月", "53.3"], ["7月", "55.6"], ["8月", "54.6"], ["9月", "54.5"], ["10月", "55.5"]]);
  assert.equal(view.next.at, "2026-12-01T10:00:00-05:00", "ISM's October report: the next report on December 1");
  assert.equal(ISM_HISTORY.find(point => point.period === "2026-10").value, 55.5);
});

test("次回: official dates through February 2027 for every indicator, claims every Thursday (DOL's only shift is Nov 25)", async () => {
  const days = claimsReleases.map(item => item.at.slice(0, 10));
  assert.equal(days[0], "2026-12-03");
  assert.equal(days.at(-1), "2027-02-25");
  assert.ok(days.includes("2026-12-24") && days.includes("2026-12-31"), "the Christmas and New Year holidays fall on Fridays");
  assert.ok(claimsReleases.every(item => new Date(item.at).getUTCDay() === 4 && item.at.endsWith("T08:30:00-05:00")));
  const scheduled = key => [...calendarEvents.filter(e => e.kind === "economic").map(e => ({ id: e.id, at: e.startsAt })), ...indicatorReleases]
    .filter(item => item.id.startsWith(`${key}-`)).map(item => item.at.slice(0, 10)).filter(day => day > "2026-11-28").toSorted();
  assert.deepEqual(scheduled("jobs"), ["2026-12-04", "2027-01-08", "2027-02-05"], "BLS 2026 and 2027 schedules");
  assert.deepEqual(scheduled("cpi"), ["2026-12-10", "2027-01-13", "2027-02-11"]);
  assert.deepEqual(scheduled("ppi"), ["2026-12-15", "2027-01-14", "2027-02-12"]);
  assert.deepEqual(scheduled("pce"), ["2026-12-23", "2027-01-28", "2027-02-25"], "BEA schedules");
  assert.deepEqual(scheduled("gdp"), ["2026-12-23", "2027-01-28", "2027-02-25"]);
  assert.deepEqual(scheduled("retail"), ["2026-12-16", "2027-01-15", "2027-02-17"], "Census schedule");
  assert.deepEqual(scheduled("adp"), ["2026-12-02", "2027-01-06", "2027-02-03"]);
  assert.deepEqual(scheduled("ism"), ["2026-12-01", "2027-01-04", "2027-02-01"]);
  assert.deepEqual(dateOnlyEvents.filter(e => e.id.startsWith("fomc-")).map(e => e.date), ["2026-12-09", "2027-01-27"], "the Fed's calendar");
  const retail = row("retail-2026-10", "2026-11-17T13:30:00+00:00", "前月比+0.2%（売上高 748.2十億ドル）", "+0.2% from the previous month ($748.2 billion)");
  assert.equal(releaseView(retail, [retail], [], indicatorReleases, now, "ja").next.at, "2026-12-16T08:30:00-05:00");
  const panel = await readFile(new URL("../app/research/calendar/economic-results-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /\.\.\.claimsReleases,[\s\S]*\.\.\.indicatorReleases,/, "the panel passes both to 次回");
});

test("the releases that left the news feed stay on the calendar, with the official figures", () => {
  const rows = mergeEconomicResults([], [], [{ id: "expected-jobs-2026-10", titleJa: "", titleEn: "", sourceName: "x", releasedAt: "2026-11-06T13:32:15Z", resultJa: "市場予想 非農業部門雇用者数 +65,000人（3社が同じ数字を報道）", resultEn: "Consensus: nonfarm payrolls +65,000 (the same figure from 3 outlets)", detailJa: "", detailEn: "", sourceUrl: "https://example.com/", verifiedOn: "2026-11-06" }]);
  const view = id => releaseView(rows.find(item => item.id === id), rows, [{ id: "expected-jobs-2026-10", resultJa: "市場予想 非農業部門雇用者数 +65,000人", resultEn: "Consensus: nonfarm payrolls +65,000" }], [], now, "ja");
  const jobs = view("jobs-2026-10");
  assert.deepEqual([jobs.display, jobs.previous.display, jobs.others.map(o => `${o.label} ${o.value}`)], ["+16.5万人", "+6万人", ["失業率 4.1%", "平均時給 前月比 +0.4%", "平均時給 前年比 +3.1%", "予想 +6.5万人"]]);
  const cpi = view("cpi-2026-10");
  assert.deepEqual([cpi.display, cpi.previous.display, cpi.others.map(o => o.label)], ["+0.4%", "+0.6%", ["コア前月比"]], "BLS published no 12-month change for October 2026");
  const ppi = view("ppi-2026-10");
  assert.deepEqual([ppi.display, ppi.previous.display, ppi.others.map(o => o.value)], ["+0.3%", "+1.4%", ["+6.5%", "+0.5%", "+4.9%"]], "September as revised from +1.3%");
  assert.deepEqual([view("pce-2026-09").display, view("pce-2026-09").previous.display], ["+0.5%", "+0.3%"]);
  const gdp = view("gdp-2026-q3-second");
  assert.deepEqual([gdp.name, gdp.display, gdp.previous.display], ["GDP（7〜9月期・改定）", "+4.3%", "+2.2%"]);
  assert.equal(releaseName({ id: "gdp-2026-q4-third", title: { ja: "米国GDP（10〜12月期・確報）", en: "U.S. GDP (Q4 2026, third estimate)" } }, "ja"), "GDP（10〜12月期・確報）", "the GDP reader's 確報 is kept in the name");
  const adp = view("adp-2026-10");
  assert.deepEqual([adp.previous.display, adp.move.direction], ["+8.6万人", "same"], "ADP: September revised from 90,000 to 86,000");
});
