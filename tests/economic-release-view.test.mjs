import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { releaseView, readValue, cleanResult, factSentences } from "../lib/research/economic-release-view.ts";

const row = (id, releasedAt, ja, en, extra = {}) => ({ id, releasedAt, title: { ja: `${id}（10月）`, en: `${id} (October 2026)` }, result: { ja, en },
  detail: { ja: "小売・飲食サービス売上高の前月比を、米国勢調査局の公式発表から取得。市場予想との比較は含みません。", en: "Monthly change in retail and food services sales from the Census Bureau's release. No consensus comparison is included." },
  sourceName: "Census Bureau", sourceUrl: "https://www.census.gov/retail/sales.html", ...extra });
const retail10 = row("retail-2026-10", "2026-11-17T13:30:00+00:00", "前月比+0.2%（売上高 748.2十億ドル）", "+0.2% from the previous month ($748.2 billion)");
const retail9 = row("retail-2026-09", "2026-10-15T12:30:00+00:00", "前月比+0.8%（売上高 745.0十億ドル）", "+0.8% from the previous month ($745.0 billion)");
const now = Date.parse("2026-11-24T00:00:00Z");

test("a release shows its number, the previous release and the change, read from stored results only", () => {
  const view = releaseView(retail10, [retail10, retail9], [], [], now, "ja");
  assert.equal(view.name, "小売売上高（10月）", "the target month in the name's parentheses (owner, Nov 28)");
  assert.equal(view.display, "+0.2%");
  assert.equal(view.label, "前月比");
  assert.equal(view.previous.display, "+0.8%");
  assert.deepEqual(view.move, { direction: "down", size: "0.6pt", tone: "bad" }, "retail sales falling is the bad way");
  assert.deepEqual(view.facts, [], "the sourcing sentence is not a fact");
  assert.deepEqual(view.others, [{ label: "売上高", value: "7,482億ドル", note: null }]);
  assert.equal(view.forecast, null, "no forecast is shown without a stored expectation");
  assert.deepEqual(view.history, [], "two values are no chart (owner, Nov 28: four or more)");
  assert.deepEqual(view.link, { url: "https://www.census.gov/retail/sales.html", name: "米国勢調査局", official: true });
  const en = releaseView(retail10, [retail10, retail9], [], [], now, "en");
  assert.deepEqual([en.name, en.label, en.move.size], ["Retail sales (Oct)", "MoM", "0.6 pt"]);
  // The September release states August as revised (Census, adv2609.pdf: from +1.1% to +1.3%): 前回 even with no August row stored.
  assert.deepEqual(releaseView(retail9, [retail10, retail9], [], [], now, "ja").previous.display, "+1.3%", "the release's own revised August");
  const unknown = row("retail-2026-09", "2026-10-15T12:30:00+00:00", "前月比+0.7%", "+0.7% from the previous month");
  assert.equal(releaseView(unknown, [unknown], [], [], now, "ja").previous, null, "a stated revision is used only for the row that shows that release's own number");
  assert.deepEqual(releaseView(retail9, [retail10, retail9], [], [], now, "ja").history, [], "one release is no chart");
});

test("the forecast comes only from a stored expectation of the same release and joins the other figures", () => {
  const expected = { id: "expected-retail-2026-10", resultJa: "市場予想 前月比+0.4%（3社が同じ数字を報道）", resultEn: "Consensus: +0.4% from the previous month (the same figure from 3 outlets)" };
  const view = releaseView(retail10, [retail10, retail9], [expected], [], now, "ja");
  assert.equal(view.forecast.display, "+0.4%");
  assert.equal(view.forecast.vs, "below");
  assert.deepEqual(view.others.at(-1), { label: "予想", value: "+0.4%", note: null });
  assert.equal(releaseView(retail9, [retail10, retail9], [expected], [], now, "ja").forecast, null);
});

test("the row never carries the outlet count, counts are written in 万, and the ADP row links one official page", () => {
  const adp = row("adp-2026-10", "2026-11-04T13:15:12+00:00", "民間の雇用者数 +86,000人（20社が同じ数字を報道）", "Private employment +86,000 (the same figure from 20 outlets)",
    { sourceUrl: "https://news.google.com/rss/articles/x", detail: { ja: "ADP（公式発表）・investingLiveほかの見出しが、同じ数字を伝えました。ADPの発表と報道の見出しから読み取った数字です。", en: "Headlines from ADP and others gave the same figure. Read from ADP's release and news headlines; check ADP's official release." } });
  const adp9 = row("adp-2026-09", "2026-09-30T12:15:00+00:00", "民間雇用 +9万人", "Private employment +90,000");
  const schedule = [{ id: "adp-2026-12-02", at: "2026-12-02T08:15:00-05:00" }, { id: "adp-2026-11-04", at: "2026-11-04T08:15:00-05:00" }];
  const view = releaseView(adp, [adp, adp9], [], schedule, now, "ja");
  assert.equal(view.summary, "民間の雇用者数 +86,000人");
  assert.equal(view.display, "+8.6万人", "owner, Nov 28: 86,000人 → 8.6万人");
  // ADP's October release revised September from 90,000 to 86,000: 前回 is that, not the stored first figure (+9万人).
  assert.equal(view.previous.display, "+8.6万人");
  assert.deepEqual(view.move, { direction: "same", size: null, tone: "neutral" });
  assert.deepEqual([view.facts, view.others], [[], []]);
  assert.equal(view.link.url, "https://adpemploymentreport.com/");
  assert.equal(view.next.at, "2026-12-02T08:15:00-05:00");
  assert.equal(releaseView(adp9, [adp, adp9], [], schedule, now, "ja").next, null, "only the latest release names the next date");
  assert.equal(releaseView(adp, [adp, adp9], [], schedule, now, "en").display, "+86K");
  assert.equal(readValue("adp-2026-09", { ja: "民間雇用 +9万人", en: "" }).value, 90000);
  assert.equal(cleanResult("Manufacturing PMI 55.5 (the same figure from 13 outlets)"), "Manufacturing PMI 55.5");
});

test("the bars: up to six stored releases, oldest first, this one last", () => {
  const months = ["03", "04", "05", "06", "07", "08"].map((m, i) => row(`retail-2026-${m}`, `2026-${String(i + 4).padStart(2, "0")}-15T12:30:00+00:00`, `前月比+0.${i}%`, `+0.${i}% from the previous month`,
    { title: { ja: `米国小売売上高（${Number(m)}月・速報）`, en: `U.S. retail sales (${["March", "April", "May", "June", "July", "August"][i]} 2026, advance)` } }));
  const r9 = { ...retail9, title: { ja: "米国小売売上高（9月・速報）", en: "U.S. retail sales (September 2026, advance)" } };
  const r10 = { ...retail10, title: { ja: "米国小売売上高（10月・速報）", en: "U.S. retail sales (October 2026, advance)" } };
  const view = releaseView(r10, [r10, r9, ...months], [], [], now, "ja");
  assert.deepEqual(view.history.map(item => [item.label, item.display, item.current]), [["5月", "0.2%", false], ["6月", "0.3%", false], ["7月", "0.4%", false], ["8月", "0.5%", false], ["9月", "0.8%", false], ["10月", "0.2%", true]]);
  assert.deepEqual(releaseView(r10, [r10, r9, ...months], [], [], now, "en").history.map(item => item.label), ["May", "Jun", "Jul", "Aug", "Sep", "Oct"]);
});

test("facts keep dissents and revisions but drop where the number came from", () => {
  assert.deepEqual(factSentences("クック理事が反対。声明は「インフレ率は高止まり」と指摘。複数の報道（CNBC）で確認。連邦準備制度の声明原文との照合は未実施です。", "ja"),
    ["クック理事が反対。", "声明は「インフレ率は高止まり」と指摘。"]);
  assert.deepEqual(factSentences("Base pay rose 3.2% year over year. Checked against the official BLS release.", "en"), ["Base pay rose 3.2% year over year."]);
});

test("the withdraw button is the owner accounts' only, right of the one source link, and the opened row lists no outlets", () => {
  const panel = readFileSync(new URL("../app/research/calendar/economic-results-panel.tsx", import.meta.url), "utf8");
  const item = readFileSync(new URL("../app/research/calendar/economic-release-item.tsx", import.meta.url), "utf8");
  assert.match(panel, /const withdraw = auto && ownerAccount \?/);
  assert.doesNotMatch(panel, /useOwnerMode|auto\.sources\.map/);
  assert.match(item, /<span className=\{calendarStyles\.releaseSource\}>\s*\{view\.link && <a [^>]+>\{ja \? "出典：" : "Source: "\}\{view\.link\.name\}<\/a>\}\s*\{withdraw && <button type="button" className=\{calendarStyles\.withdraw\}/);
  assert.equal(item.match(/<a /g).length, 1, "one source link");
  assert.doesNotMatch(item, /↗/, "no slanted arrow after the source (owner, Nov 28)");
  assert.match(readFileSync(new URL("../lib/membership/server.ts", import.meta.url), "utf8"), /ownerAccount: isOwnerAccount\(userId\)/);
  assert.match(readFileSync(new URL("../app/api/research/event-results/route.ts", import.meta.url), "utf8"), /!member\.isAdmin \|\| !member\.ownerAccount/);
});

const claims = (week, releasedAt, ja, en, detailJa = "季節調整済みの新規失業保険申請件数（速報値）を、米国労働省の週次発表から取得。市場予想との比較は含みません。",
  detailEn = "Seasonally adjusted advance initial claims from the Department of Labor's weekly release. No consensus comparison is included.") => ({
  id: `claims-2026-11-${week}`, releasedAt, title: { ja: `米国新規失業保険申請件数（11月${week}日終了週）`, en: `U.S. initial jobless claims (week ending November ${week}, 2026)` },
  result: { ja, en }, detail: { ja: detailJa, en: detailEn }, sourceName: "DOL", sourceUrl: "https://www.dol.gov/ui/data.pdf" });

test("jobless claims (owner, Nov 28 mock 03): 18.9万件, ↓ 1.3万件 green, 前回 20.2万件 as revised, continuing claims in one line, no week, no 4-week average", () => {
  const c21 = claims("21", "2026-11-25T13:30:00+00:00", "189,000件（前週改定値から13,000件減）", "189,000 (down 13,000 from the previous week's revised level)",
    "4週平均：196,000件（前週比1,500件減）。継続受給者数：1,697,000人（11月14日終了週・前週比95,000人減）。季節調整済みの新規失業保険申請件数（速報値）を、米国労働省の週次発表から取得。市場予想との比較は含みません。",
    "4-week average: 196,000 (down 1,500 from the previous week). Continuing claims: 1,697,000 (week ending November 14, down 95,000 from the previous week). Seasonally adjusted advance initial claims from the Department of Labor's weekly release. No consensus comparison is included.");
  const c14 = claims("14", "2026-11-19T13:30:00+00:00", "203,000件（前週改定値から1,000件増）", "203,000 (up 1,000 from the previous week's revised level)");
  const view = releaseView(c21, [c21, c14], [], [], now, "ja");
  assert.equal(view.name, "新規失業保険申請", "the week is not written (owner, Nov 28)");
  assert.equal(view.display, "18.9万件");
  assert.equal(view.label, null);
  assert.deepEqual([view.previous.display, view.previous.revised], ["20.2万件", true], "the previous week as revised, from the stated change, not the advance 203,000");
  assert.deepEqual(view.move, { direction: "down", size: "1.3万件", tone: "good" }, "fewer claims is the good way");
  assert.deepEqual(view.others, [{ label: "継続受給者", value: "169.7万人", note: "（−9.5万）" }], "no 4-week average");
  assert.deepEqual(view.facts, []);
  assert.deepEqual(view.history, [], "two stored weeks and no FRED copy: no chart");
  assert.equal(releaseView(c21, [c21, c14], [], [{ id: "claims-release-2026-12-03", at: "2026-12-03T08:30:00-05:00" }], now, "ja").next.at, "2026-12-03T08:30:00-05:00", "a weekly indicator names its next date too");
  assert.equal(view.about, "失業保険を新しく申請した人の数。増えると雇用が冷えてきたサインです。");
  assert.deepEqual(view.link, { url: "https://www.dol.gov/ui/data.pdf", name: "米労働省", official: true });
  assert.equal(view.forecast, null, "no forecast is held for claims");
  assert.equal(view.expandable, true);
  const en = releaseView(c21, [c21, c14], [], [], now, "en");
  assert.deepEqual([en.name, en.display, en.previous.display, en.move.size, en.others], ["Initial jobless claims", "189K", "202K", "13K", [{ label: "Continuing claims", value: "1.7M", note: " (−95K)" }]]);
  const older = releaseView(c14, [c21, c14], [], [], now, "ja");
  assert.deepEqual([older.display, older.previous.display, older.move], ["20.3万件", "20.2万件", { direction: "up", size: "1,000件", tone: "bad" }], "a result stored without the figures shows what it has");
  assert.deepEqual(older.others, []);
  const same = claims("28", "2026-12-02T13:30:00+00:00", "189,000件（前週改定値から変わらず）", "189,000 (unchanged from the previous week's revised level)",
    "4週平均：196,000件（前週から変わらず）。継続受給者数：1,697,000人（11月21日終了週）。", "4-week average: 196,000 (unchanged from the previous week). Continuing claims: 1,697,000 (week ending November 21).");
  const sameView = releaseView(same, [same, c21], [], [], now, "ja");
  assert.deepEqual(sameView.move, { direction: "same", size: null, tone: "neutral" });
  assert.deepEqual(sameView.others, [{ label: "継続受給者", value: "169.7万人", note: "（変わらず）" }], "with no stated change, the previous release's own figure is the previous one");
});

test("a release with nothing to show but its link is not expandable; an event keeps its result as one line", () => {
  const bare = { id: "election-2026", releasedAt: "2026-11-04T00:00:00Z", title: { ja: "選挙", en: "Election" }, result: { ja: "結果", en: "Result" },
    detail: { ja: "報道から取得。", en: "Read from outlets." }, sourceName: "X", sourceUrl: "https://example.com/a" };
  const view = releaseView(bare, [bare], [], [], now, "ja");
  assert.deepEqual([view.known, view.name, view.summary, view.facts, view.about, view.expandable], [false, "選挙", "結果", [], null, false]);
  assert.equal(releaseView(retail10, [retail10, retail9], [], [], now, "ja").expandable, true);
  const item = readFileSync(new URL("../app/research/calendar/economic-release-item.tsx", import.meta.url), "utf8");
  assert.match(item, /if \(!view\.expandable && !withdraw\) return <li><div className=\{calendarStyles\.plainRow\}>/, "no ＋ and no <details> for such a row");
  assert.match(item, /\{!view\.known && <span className=\{calendarStyles\.eventTag\}>\{ja \? "イベント" : "Event"\}<\/span>\}/, "a framed イベント tag");
});

test("PCE (Oct): 前回 is September as BEA's October release revised it, +0.5%, not +0.3% (owner, Nov 28 audit)", () => {
  const pce10 = row("pce-2026-10", "2026-11-25T13:30:00+00:00", "米国10月PCE：総合 前月比+0.3%・前年比+3.8%／コア 前月比+0.3%・前年比+3.3%", "U.S. October PCE: headline +0.3% MoM / +3.8% YoY; core +0.3% MoM / +3.3% YoY",
    { title: { ja: "米国PCE物価指数（10月）", en: "U.S. PCE price index (2026-10)" } });
  const pce9 = row("pce-2026-09", "2026-10-29T12:30:00+00:00", "総合：前月比+0.4%", "Headline: +0.4% month over month", { title: { ja: "米国PCE物価指数（9月）", en: "U.S. PCE price index (2026-09)" } });
  // BEA's October table: "PCE price index 0.5 0.3" (September, October). It wins over FRED's figure and over a stored September row.
  for (const backfill of [{}, { pce: [{ period: "2026-09", value: 0.4, decimals: 1 }, { period: "2026-10", value: 0.3, decimals: 1 }] }]) {
    const view = releaseView(pce10, [pce10, pce9], [], [], now, "ja", backfill);
    assert.deepEqual([view.previous.display, view.previous.revised, view.move], ["+0.5%", true, { direction: "down", size: "0.2pt", tone: "good" }]);
  }
  const bars = releaseView(pce10, [pce10], [], [], now, "ja", { pce: ["05", "06", "07", "08", "09"].map(m => ({ period: `2026-${m}`, value: 0.1, decimals: 1 })) }).history;
  assert.equal(bars.find(bar => bar.label === "9月").display, "0.5%", "the September bar shows the same revised figure as 前回");
});

test("PCE (owner, Nov 28 mock 03): +0.3% 前月比 → 前回と同じ, 前年比・コア前月比・コア前年比 in one line", () => {
  const pce10 = row("pce-2026-10", "2026-11-25T15:00:00+00:00", "米国10月PCE：総合 前月比+0.3%・前年比+3.8%／コア 前月比+0.3%・前年比+3.3%", "U.S. October PCE: headline +0.3% MoM / +3.8% YoY; core +0.3% MoM / +3.3% YoY",
    { title: { ja: "米国PCE物価指数（10月）", en: "U.S. PCE price index (2026-10)" }, detail: { ja: "総合とコアの前月比・前年比をBEA公式発表から取得。市場予想との比較は含みません。", en: "Headline and core monthly and annual changes from the official BEA release. No consensus comparison." }, sourceUrl: "https://www.bea.gov/news/2026/personal-income-and-outlays-october-2026" });
  const pce8 = row("pce-2026-08", "2026-09-26T12:30:00+00:00", "総合：前月比+0.3%・前年比+3.4%", "Headline: +0.3% month over month; +3.4% year over year",
    { title: { ja: "米国PCE物価指数（8月）", en: "U.S. PCE price index (August)" }, detail: { ja: "コア（食品・エネルギー除く）：前月比+0.2%・前年比+3.0%。BEA公式発表を確認して掲載。", en: "Core (excluding food and energy): +0.2% month over month; +3.0% year over year. Checked against the official BEA release." } });
  // A November row (no stated revision kept for it) takes October from FRED and never skips back to an older month.
  const nov = row("pce-2026-11", "2026-12-23T13:30:00+00:00", "米国11月PCE：総合 前月比+0.3%・前年比+3.8%／コア 前月比+0.3%・前年比+3.3%", "U.S. November PCE: headline +0.3% MoM / +3.8% YoY; core +0.3% MoM / +3.3% YoY",
    { title: { ja: "米国PCE物価指数（11月）", en: "U.S. PCE price index (2026-11)" } });
  const view = releaseView(pce10, [pce10, pce8], [], [], now, "ja", { pce: [{ period: "2026-09", value: 0.3, decimals: 1 }] });
  assert.deepEqual([view.name, view.display, view.label], ["PCE物価指数（10月）", "+0.3%", "前月比"]);
  const same = releaseView(nov, [nov, pce8], [], [], now, "ja", { pce: [{ period: "2026-10", value: 0.3, decimals: 1 }] });
  assert.deepEqual(same.move, { direction: "same", size: null, tone: "neutral" });
  assert.equal(releaseView(nov, [nov, pce8], [], [], now, "ja").previous, null, "前回 is October: August is never shown as the previous month");
  assert.deepEqual(view.others.map(o => `${o.label} ${o.value}`), ["前年比 +3.8%", "コア前月比 +0.3%", "コア前年比 +3.3%"]);
  assert.deepEqual(view.history, [], "three values are no chart");
  assert.equal(view.about, "FRBが物価目標（2%）を見るときに一番重視するインフレの数字です。");
  assert.deepEqual(view.link, { url: "https://www.bea.gov/news/2026/personal-income-and-outlays-october-2026", name: "米経済分析局", official: true });
  const en = releaseView(pce10, [pce10, pce8], [], [], now, "en", { pce: [{ period: "2026-09", value: 0.3, decimals: 1 }] });
  assert.deepEqual([en.name, en.others.map(o => `${o.label} ${o.value}`)], ["PCE prices (Oct)", ["YoY +3.8%", "Core MoM +0.3%", "Core YoY +3.3%"]]);
  const pce11 = row("pce-2026-11", "2026-12-23T13:30:00+00:00", "米国11月PCE：総合 前月比+0.4%・前年比+3.9%", "U.S. November PCE: headline +0.4% MoM / +3.9% YoY", { title: { ja: "米国PCE物価指数（11月）", en: "U.S. PCE price index (2026-11)" } });
  assert.deepEqual(releaseView(pce11, [pce11, pce10], [], [], now, "ja").move, { direction: "up", size: "0.1pt", tone: "bad" }, "prices rising is the bad way");
});

test("CPI, PPI and the jobs report read their own stated figures into the one line", () => {
  const ppi = row("ppi-2026-10", "2026-11-13T13:30:00+00:00", "米国10月PPI：総合 前月比+0.3%・前年比+2.7%／コア（食品・エネルギー・貿易サービス除く） 前月比+0.1%・前年比+2.6%", "U.S. October PPI: final demand +0.3% MoM / +2.7% YoY; core +0.1% MoM / +2.6% YoY");
  assert.deepEqual(releaseView(ppi, [ppi], [], [], now, "ja").others.map(o => `${o.label} ${o.value}`), ["前年比 +2.7%", "コア前月比 +0.1%", "コア前年比 +2.6%"]);
  const jobs = row("jobs-2026-10", "2026-11-06T13:30:00+00:00", "米国10月雇用統計：非農業部門雇用者数 +41,000人／失業率 4.3%／平均時給 前月比+0.2%（前年比+3.1%）", "U.S. October jobs report: nonfarm payrolls +41K / unemployment rate 4.3% / average hourly earnings +0.2% m/m (+3.1% y/y)");
  const jobs9 = row("jobs-2026-09", "2026-10-03T12:30:00+00:00", "非農業部門雇用者数 +29,000人／失業率 4.2%", "Nonfarm payrolls +29,000; unemployment rate 4.2%",
    { detail: { ja: "平均時給：前月比+0.1%・前年比+3.0%。雇用者数修正：7月 +21,000人→-10,000人。BLS公式本文と照合して掲載。", en: "Average hourly earnings: +0.1% MoM and +3.0% YoY. Payroll revisions: July +21,000 to -10,000. Checked against the official BLS release." } });
  assert.deepEqual(releaseView(jobs9, [jobs9], [], [], now, "en").others.map(o => o.value), ["4.2%", "+0.1%", "+3.0%"], "read from the English detail");
  for (const lang of ["ja", "en"]) assert.deepEqual(releaseView(jobs, [jobs, jobs9], [], [], now, lang).others.map(o => o.value), ["4.3%", "+0.2%", "+3.1%"], lang);
  const view = releaseView(jobs, [jobs, jobs9], [], [], now, "ja");
  assert.deepEqual([view.display, view.move], ["+4.1万人", { direction: "up", size: "1.2万人", tone: "good" }], "more jobs is the good way");
  const election = { id: "election-2026", releasedAt: "2026-11-04T00:00:00Z", title: { ja: "選挙", en: "Election" }, result: { ja: "結果", en: "Result" }, detail: { ja: "", en: "" }, sourceName: "X", sourceUrl: "https://example.com/a" };
  assert.deepEqual(releaseView(election, [election], [], [], now, "ja").others, [], "no figures for a row without an indicator number");
});

test("one shape for every indicator (owner, Nov 28): big number, bars, one line of figures, one sentence, 次回 and 出典; no boxes, no table", () => {
  const item = readFileSync(new URL("../app/research/calendar/economic-release-item.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/research/calendar/event-calendar.module.css", import.meta.url), "utf8");
  assert.doesNotMatch(item, /releaseFigures|releaseChange|releaseTable|<table|releaseBadge/);
  for (const kept of ["releaseHead", "releaseBars", "releaseOthers", "view.about", '"次回"', '"出典："', "この結果を取り下げる", "前回と同じ"]) assert.ok(item.includes(kept), kept);
  assert.match(item, /high === low \? 40 : Math\.round\(10 \+ \(item\.value - low\) \/ \(high - low\) \* 50\)/, "bar heights from the six's own minimum to maximum, not from 0");
  assert.match(css, /\.releaseHead strong\{[^}]*font-size:28px/);
  assert.match(css, /\.releaseBars li\[data-current\] i\{background:var\(--mint\)\}/);
  assert.match(css, /\.release\[open\]>summary \.releaseRight\{display:none\}/);
  assert.doesNotMatch(css, /gold|#d4af37|#c9a227/i, "FREE screens use no gold");
  const about = ["claims", "pce", "cpi", "ppi", "retail", "adp", "jobs", "gdp", "fomc", "ism"].map(key => releaseView(row(`${key}-2026-10`, "2026-11-01T12:00:00Z", "x", "x"), [], [], [], now, "ja").about);
  for (const sentence of about) assert.ok(sentence.length >= 28 && sentence.length <= 42, sentence);
});

test("FRED fills the five periods before the stored result; stored results win; a missing period stays empty (owner, Nov 28)", async () => {
  const { fromObservations, readFredCsv, parseBackfill } = await import("../lib/research/economic-history.ts");
  // PCEPI as FRED serves it (index levels): the month-over-month change is computed, one decimal
  const pcepi = readFredCsv("observation_date,PCEPI\n2026-04-01,130.0\n2026-05-01,130.52\n2026-06-01,130.39\n2026-07-01,131.185\n2026-08-01,131.625\n2026-09-01,132.283\n2026-10-01,132.703\n2026-11-01,.");
  const points = fromObservations("pce", pcepi);
  assert.deepEqual(points.map(p => [p.period, p.value]), [["2026-05", 0.4], ["2026-06", -0.1], ["2026-07", 0.6], ["2026-08", 0.3], ["2026-09", 0.5], ["2026-10", 0.3]]);
  assert.deepEqual(fromObservations("adp", readFredCsv("observation_date,ADPMNUSNERSA\n2026-09-01,132885000\n2026-10-01,132971000")), [{ period: "2026-10", value: 86000, decimals: 0 }]);
  assert.deepEqual(fromObservations("claims", readFredCsv("observation_date,ICSA\n2026-11-14,202000"))[0], { period: "2026-11-14", value: 202000, decimals: 0 });
  assert.deepEqual(fromObservations("ism", pcepi), [], "ISM has no FRED series");
  const pce10 = row("pce-2026-10", "2026-11-25T13:30:00+00:00", "米国10月PCE：総合 前月比+0.3%・前年比+3.8%", "U.S. October PCE: headline +0.3% MoM / +3.8% YoY", { title: { ja: "米国PCE物価指数（10月）", en: "U.S. PCE price index (2026-10)" } });
  const pce8 = row("pce-2026-08", "2026-09-30T12:30:00+00:00", "総合：前月比+0.2%・前年比+3.4%", "Headline: +0.2% month over month", { title: { ja: "米国PCE物価指数（8月）", en: "U.S. PCE price index (August)" } });
  const backfill = parseBackfill({ pce: points.filter(p => p.period !== "2026-06"), junk: [1] });
  const view = releaseView(pce10, [pce10, pce8], [], [], now, "ja", backfill);
  assert.deepEqual(view.history.map(bar => [bar.label, bar.display, bar.source]), [["5月", "0.4%", "fred"], ["6月", null, null], ["7月", "0.6%", "fred"], ["8月", "0.2%", "stored"], ["9月", "0.5%", "stored"], ["10月", "0.3%", "stored"]],
    "six consecutive months: the stored August (0.2) over FRED's 0.3, an empty June that keeps its label, September as the October release revised it, this month the site's own");
  assert.deepEqual([view.previous.display, view.move], ["+0.5%", { direction: "down", size: "0.2pt", tone: "good" }], "前回 is September as revised in the October release");
  assert.deepEqual(releaseView(pce10, [pce10], [], [], now, "ja", { pce: [{ period: "2026-09", value: 0.5, decimals: 1 }, { period: "2026-08", value: 0.3, decimals: 1 }] }).history, [], "three values: no chart");
  const claims = (week, at, ja, en) => ({ id: `claims-2026-11-${week}`, releasedAt: at, title: { ja: `米国新規失業保険申請件数（11月${week}日終了週）`, en: `U.S. initial jobless claims (week ending November ${week}, 2026)` }, result: { ja, en }, detail: { ja: "", en: "" }, sourceName: "DOL", sourceUrl: "https://www.dol.gov/ui/data.pdf" });
  const c21 = claims("21", "2026-11-25T13:30:00+00:00", "189,000件（前週改定値から13,000件減）", "189,000 (down 13,000 from the previous week's revised level)");
  const weeks = { claims: [["2026-10-17", 195000], ["2026-10-24", 195000], ["2026-10-31", 191000], ["2026-11-07", 202000], ["2026-11-14", 202000]].map(([period, value]) => ({ period, value, decimals: 0 })) };
  const bars = releaseView(c21, [c21], [], [], now, "ja", weeks).history;
  assert.deepEqual(bars.map(bar => [bar.releasedAt.slice(0, 10), bar.display]), [["2026-10-22", "19.5"], ["2026-10-29", "19.5"], ["2026-11-05", "19.1"], ["2026-11-12", "20.2"], ["2026-11-19", "20.2"], ["2026-11-25", "18.9"]],
    "six consecutive weeks, each named by its release Thursday; this week the site's own");
  const item = readFileSync(new URL("../app/research/calendar/economic-release-item.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/research/calendar/event-calendar.module.css", import.meta.url), "utf8");
  assert.match(item, /data-empty=\{item\.value === null \|\| undefined\}/);
  assert.match(css, /\.releaseBars li\{flex:0 0 calc\(\(100% - 30px\) \/ 6\)/, "the width of six bars whatever the count");
  const server = readFileSync(new URL("../lib/research/economic-history-server.ts", import.meta.url), "utf8");
  assert.match(server, /import "server-only";/);
  assert.match(server, /fredgraph\.csv\?id=\$\{spec\.id\}&cosd=\$\{start\}`, \{\s*next: \{ revalidate: 21600 \}/, "keyless, six-hour cache, like macro.ts");
});
