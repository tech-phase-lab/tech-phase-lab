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
  assert.equal(view.display, "+0.2%");
  assert.equal(view.previous.display, "+0.8%");
  assert.equal(view.change, "前回から0.6ポイント低下");
  assert.deepEqual(view.facts, [], "the sourcing sentence is not a fact, and the sales figure is a line of the table");
  assert.deepEqual(view.table.map(r => [r.label, r.now, r.previous, r.change]), [["前月比", "+0.2%", "+0.8%", { direction: "down", text: "0.6pt" }], ["売上高", "7,482億ドル", "7,450億ドル", { direction: "up", text: "32億ドル" }]]);
  assert.equal(view.forecast, null, "no forecast is shown without a stored expectation");
  assert.deepEqual(view.history, [], "two releases are already 今回 and 前回");
  assert.deepEqual(view.link, { url: "https://www.census.gov/retail/sales.html", name: "米国勢調査局", official: true });
  const en = releaseView(retail10, [retail10, retail9], [], [], now, "en");
  assert.equal(en.change, "Down 0.6 pt from the previous release");
  assert.equal(releaseView(retail9, [retail10, retail9], [], [], now, "ja").previous, null, "the oldest release has no previous one");
});

test("the forecast comes only from a stored expectation of the same release and gives an above/below badge", () => {
  const expected = { id: "expected-retail-2026-10", resultJa: "市場予想 前月比+0.4%（3社が同じ数字を報道）", resultEn: "Consensus: +0.4% from the previous month (the same figure from 3 outlets)" };
  const view = releaseView(retail10, [retail10, retail9], [expected], [], now, "ja");
  assert.equal(view.forecast.display, "+0.4%");
  assert.equal(view.forecast.vs, "below");
  assert.equal(releaseView(retail9, [retail10, retail9], [expected], [], now, "ja").forecast, null);
});

test("the row never carries the outlet count, and the ADP row links one official page instead of six outlets", () => {
  const adp = row("adp-2026-10", "2026-11-04T13:15:12+00:00", "民間の雇用者数 +86,000人（20社が同じ数字を報道）", "Private employment +86,000 (the same figure from 20 outlets)",
    { sourceUrl: "https://news.google.com/rss/articles/x", detail: { ja: "ADP（公式発表）・investingLiveほかの見出しが、同じ数字を伝えました。ADPの発表と報道の見出しから読み取った数字です。", en: "Headlines from ADP and others gave the same figure. Read from ADP's release and news headlines; check ADP's official release." } });
  const adp9 = row("adp-2026-09", "2026-09-30T12:15:00+00:00", "民間雇用 +9万人", "Private employment +90,000");
  const schedule = [{ id: "adp-2026-12-02", at: "2026-12-02T08:15:00-05:00" }, { id: "adp-2026-11-04", at: "2026-11-04T08:15:00-05:00" }];
  const view = releaseView(adp, [adp, adp9], [], schedule, now, "ja");
  assert.equal(view.summary, "民間の雇用者数 +86,000人");
  assert.equal(view.display, "+86,000人");
  assert.equal(view.previous.display, "+90,000人");
  assert.equal(view.change, "前回より4,000人少ない");
  assert.deepEqual(view.facts, []);
  assert.equal(view.link.url, "https://adpemploymentreport.com/");
  assert.equal(view.next.at, "2026-12-02T08:15:00-05:00");
  assert.equal(releaseView(adp9, [adp, adp9], [], schedule, now, "ja").next, null, "only the latest release names the next date");
  assert.equal(readValue("adp-2026-09", { ja: "民間雇用 +9万人", en: "" }).value, 90000);
  assert.equal(cleanResult("Manufacturing PMI 55.5 (the same figure from 13 outlets)"), "Manufacturing PMI 55.5");
});

test("a short history appears once three releases are stored, oldest first", () => {
  const retail8 = row("retail-2026-08", "2026-09-16T12:30:00+00:00", "前月比+0.5%", "+0.5% from the previous month");
  const view = releaseView(retail10, [retail10, retail8, retail9], [], [], now, "ja");
  assert.deepEqual(view.history.map(item => [item.display, item.current]), [["+0.5%", false], ["+0.8%", false], ["+0.2%", true]]);
});

test("facts keep dissents and revisions but drop where the number came from", () => {
  assert.deepEqual(factSentences("クック理事が反対。声明は「インフレ率は高止まり」と指摘。複数の報道（CNBC）で確認。連邦準備制度の声明原文との照合は未実施です。", "ja"),
    ["クック理事が反対。", "声明は「インフレ率は高止まり」と指摘。"]);
  assert.deepEqual(factSentences("Base pay rose 3.2% year over year. Checked against the official BLS release.", "en"), ["Base pay rose 3.2% year over year."]);
});

test("the withdraw button is the owner accounts' only and the opened row lists no outlets (owner, Nov 24)", () => {
  const panel = readFileSync(new URL("../app/research/calendar/economic-results-panel.tsx", import.meta.url), "utf8");
  const item = readFileSync(new URL("../app/research/calendar/economic-release-item.tsx", import.meta.url), "utf8");
  assert.match(panel, /const withdraw = auto && ownerAccount \?/);
  assert.doesNotMatch(panel, /useOwnerMode|auto\.sources\.map/);
  assert.match(item, /\{withdraw && <button type="button" className=\{calendarStyles\.withdraw\}/);
  assert.equal(item.match(/<a /g).length, 1, "one source link");
  assert.match(readFileSync(new URL("../lib/membership/server.ts", import.meta.url), "utf8"), /ownerAccount: isOwnerAccount\(userId\)/);
  assert.match(readFileSync(new URL("../app/api/research/event-results/route.ts", import.meta.url), "utf8"), /!member\.isAdmin \|\| !member\.ownerAccount/);
});

test("jobless claims open like the other indicators: this week, the previous week as revised, the change, the stated figures and what the number is", () => {
  const claims = (week, releasedAt, ja, en, detailJa = "季節調整済みの新規失業保険申請件数（速報値）を、米国労働省の週次発表から取得。市場予想との比較は含みません。",
    detailEn = "Seasonally adjusted advance initial claims from the Department of Labor's weekly release. No consensus comparison is included.") => ({
    id: `claims-2026-11-${week}`, releasedAt, title: { ja: `米国新規失業保険申請件数（11月${week}日終了週）`, en: `U.S. initial jobless claims (week ending November ${week}, 2026)` },
    result: { ja, en }, detail: { ja: detailJa, en: detailEn }, sourceName: "DOL", sourceUrl: "https://www.dol.gov/ui/data.pdf" });
  const c21 = claims("21", "2026-11-25T13:30:00+00:00", "189,000件（前週改定値から13,000件減）", "189,000 (down 13,000 from the previous week's revised level)",
    "4週平均：196,000件（前週比1,500件減）。継続受給者数：1,697,000人（11月14日終了週・前週比95,000人減）。季節調整済みの新規失業保険申請件数（速報値）を、米国労働省の週次発表から取得。市場予想との比較は含みません。",
    "4-week average: 196,000 (down 1,500 from the previous week). Continuing claims: 1,697,000 (week ending November 14, down 95,000 from the previous week). Seasonally adjusted advance initial claims from the Department of Labor's weekly release. No consensus comparison is included.");
  const c14 = claims("14", "2026-11-19T13:30:00+00:00", "203,000件（前週改定値から1,000件増）", "203,000 (up 1,000 from the previous week's revised level)");
  const view = releaseView(c21, [c21, c14], [], [], now, "ja");
  assert.equal(view.display, "189,000件");
  assert.deepEqual([view.previous.display, view.previous.revised], ["202,000件", true], "the previous week as revised, from the stated change, not the advance 203,000");
  assert.equal(view.change, "前週より13,000件減少");
  assert.deepEqual(view.facts, [], "no sourcing sentence; the 4-week average and continuing claims are lines of the table");
  assert.deepEqual(view.table.map(r => [r.label, r.now, r.previous, r.change?.direction, r.change?.text]), [
    ["件数", "189,000件", "202,000件", "down", "13,000件"],
    ["4週平均", "196,000件", "197,500件", "down", "1,500件"],
    ["継続受給者数", "1,697,000人", "1,792,000人", "down", "95,000人"],
  ], "the previous figures are worked out from the stated changes");
  assert.match(view.about, /失業保険を新たに申請した人の数/);
  assert.deepEqual(view.link, { url: "https://www.dol.gov/ui/data.pdf", name: "米労働省（DOL）", official: true });
  assert.equal(view.forecast, null, "no forecast is held for claims");
  assert.equal(view.expandable, true);
  const en = releaseView(c21, [c21, c14], [], [], now, "en");
  assert.deepEqual([en.display, en.previous.display, en.change], ["189,000", "202,000", "Down 13,000 from the previous week"]);
  assert.deepEqual(en.facts, []);
  assert.deepEqual(en.table.map(r => [r.label, r.now, r.previous, r.change?.text]), [["Claims", "189,000", "202,000", "13,000"], ["4-week average", "196,000", "197,500", "1,500"], ["Continuing claims", "1,697,000", "1,792,000", "95,000"]]);
  const older = releaseView(c14, [c21, c14], [], [], now, "ja");
  assert.deepEqual([older.display, older.previous.display, older.change, older.facts], ["203,000件", "202,000件", "前週より1,000件増加", []], "a result stored without the figures shows what it has");
  assert.deepEqual(older.table.map(r => r.key), ["headline"]);
  const same = claims("28", "2026-12-02T13:30:00+00:00", "189,000件（前週改定値から変わらず）", "189,000 (unchanged from the previous week's revised level)",
    "4週平均：196,000件（前週から変わらず）。継続受給者数：1,697,000人（11月21日終了週）。", "4-week average: 196,000 (unchanged from the previous week). Continuing claims: 1,697,000 (week ending November 21).");
  const sameView = releaseView(same, [same, c21], [], [], now, "ja");
  assert.equal(sameView.change, "前回と同じ");
  assert.deepEqual(sameView.table.map(r => [r.key, r.previous, r.change]), [
    ["headline", "189,000件", { direction: "same", text: "変わらず" }],
    ["average", "196,000件", { direction: "same", text: "変わらず" }],
    ["continuing", "1,697,000人", { direction: "same", text: "変わらず" }],
  ], "with no stated change, the previous release's own figure is the previous one");
});

test("a release with nothing to show but its link is not expandable", () => {
  const bare = { id: "election-2026", releasedAt: "2026-11-04T00:00:00Z", title: { ja: "選挙", en: "Election" }, result: { ja: "結果", en: "Result" },
    detail: { ja: "報道から取得。", en: "Read from outlets." }, sourceName: "X", sourceUrl: "https://example.com/a" };
  const view = releaseView(bare, [bare], [], [], now, "ja");
  assert.deepEqual([view.facts, view.about, view.expandable], [[], null, false]);
  assert.equal(releaseView(retail10, [retail10, retail9], [], [], now, "ja").expandable, true);
  const item = readFileSync(new URL("../app/research/calendar/economic-release-item.tsx", import.meta.url), "utf8");
  assert.match(item, /if \(!view\.expandable && !withdraw\) return <li><div className=\{calendarStyles\.plainRow\}>/, "no ＋ and no <details> for such a row");
});

test("the opened row's table: PCE reads 前月比・前年比・コア前月比・コア前年比 from the stored text, an unchanged figure says 変わらず (owner, Nov 27)", () => {
  const pce10 = row("pce-2026-10", "2026-11-25T15:00:00+00:00", "米国10月PCE：総合 前月比+0.3%・前年比+3.8%／コア 前月比+0.3%・前年比+3.3%", "U.S. October PCE: headline +0.3% MoM / +3.8% YoY; core +0.3% MoM / +3.3% YoY",
    { detail: { ja: "総合とコアの前月比・前年比をBEA公式発表から取得。市場予想との比較は含みません。", en: "Headline and core monthly and annual changes from the official BEA release. No consensus comparison." }, sourceUrl: "https://www.bea.gov/news/2026/personal-income-and-outlays-october-2026" });
  // The hand-written August row states the core figures in its detail.
  const pce8 = row("pce-2026-08", "2026-09-26T12:30:00+00:00", "総合：前月比+0.3%・前年比+3.4%", "Headline: +0.3% month over month; +3.4% year over year",
    { detail: { ja: "コア（食品・エネルギー除く）：前月比+0.2%・前年比+3.0%。BEA公式発表を確認して掲載。", en: "Core (excluding food and energy): +0.2% month over month; +3.0% year over year. Checked against the official BEA release." } });
  const view = releaseView(pce10, [pce10, pce8], [], [], now, "ja");
  assert.deepEqual(view.table.map(r => [r.label, r.now, r.previous, r.change?.direction, r.change?.text]), [
    ["前月比", "+0.3%", "+0.3%", "same", "変わらず"],
    ["前年比", "+3.8%", "+3.4%", "up", "0.4pt"],
    ["コア前月比", "+0.3%", "+0.2%", "up", "0.1pt"],
    ["コア前年比", "+3.3%", "+3.0%", "up", "0.3pt"],
  ]);
  assert.deepEqual(view.facts, [], "the core and yearly figures are not repeated as bullets under the table");
  assert.ok(view.table.every(r => r.forecast === null));
  const en = releaseView(pce10, [pce10, pce8], [], [], now, "en");
  assert.deepEqual(en.table.map(r => [r.label, r.now, r.previous, r.change?.text]), [["MoM", "+0.3%", "+0.3%", "Unchanged"], ["YoY", "+3.8%", "+3.4%", "0.4 pts"], ["Core MoM", "+0.3%", "+0.2%", "0.1 pts"], ["Core YoY", "+3.3%", "+3.0%", "0.3 pts"]]);
  assert.deepEqual(en.facts, []);
  assert.deepEqual(releaseView(pce8, [pce10, pce8], [], [], now, "ja").table.map(r => [r.label, r.now, r.previous]), [["前月比", "+0.3%", null], ["前年比", "+3.4%", null], ["コア前月比", "+0.2%", null], ["コア前年比", "+3.0%", null]]);
});

test("the table's 予想 is the stored expectation of the headline only; CPI, PPI and the jobs report read their own stated figures", () => {
  const expected = { id: "expected-retail-2026-10", resultJa: "市場予想 前月比+0.4%（3社が同じ数字を報道）", resultEn: "Consensus: +0.4% from the previous month (the same figure from 3 outlets)" };
  const retail = releaseView(retail10, [retail10, retail9], [expected], [], now, "ja");
  assert.deepEqual(retail.table.map(r => [r.key, r.forecast]), [["headline", "+0.4%"], ["sales", null]]);
  const ppi = row("ppi-2026-10", "2026-11-13T13:30:00+00:00", "米国10月PPI：総合 前月比+0.3%・前年比+2.7%／コア（食品・エネルギー・貿易サービス除く） 前月比+0.1%・前年比+2.6%", "U.S. October PPI: final demand +0.3% MoM / +2.7% YoY; core +0.1% MoM / +2.6% YoY");
  assert.deepEqual(releaseView(ppi, [ppi], [], [], now, "ja").table.map(r => [r.label, r.now]), [["前月比", "+0.3%"], ["前年比", "+2.7%"], ["コア前月比", "+0.1%"], ["コア前年比", "+2.6%"]]);
  const jobs = row("jobs-2026-10", "2026-11-06T13:30:00+00:00", "米国10月雇用統計：非農業部門雇用者数 +41,000人／失業率 4.3%／平均時給 前月比+0.2%（前年比+3.1%）", "U.S. October jobs report: nonfarm payrolls +41K / unemployment rate 4.3% / average hourly earnings +0.2% m/m (+3.1% y/y)");
  const jobs9 = row("jobs-2026-09", "2026-10-03T12:30:00+00:00", "非農業部門雇用者数 +29,000人／失業率 4.2%", "Nonfarm payrolls +29,000; unemployment rate 4.2%",
    { detail: { ja: "平均時給：前月比+0.1%・前年比+3.0%。雇用者数修正：7月 +21,000人→-10,000人。BLS公式本文と照合して掲載。", en: "Average hourly earnings: +0.1% MoM and +3.0% YoY. Payroll revisions: July +21,000 to -10,000. Checked against the official BLS release." } });
  assert.deepEqual(releaseView(jobs9, [jobs9], [], [], now, "en").table.slice(1).map(r => r.now), ["4.2%", "+0.1%", "+3.0%"], "read from the English detail");
  for (const lang of ["ja", "en"]) {
    const view = releaseView(jobs, [jobs, jobs9], [], [], now, lang);
    assert.deepEqual(view.table.slice(1).map(r => [r.key, r.now, r.previous]), [["unemployment", "4.3%", "4.2%"], ["wages-mom", "+0.2%", "+0.1%"], ["wages-yoy", "+3.1%", "+3.0%"]], lang);
    assert.deepEqual(view.facts, [], lang);
  }
  assert.deepEqual(releaseView(jobs9, [jobs, jobs9], [], [], now, "ja").facts, ["雇用者数修正：7月 +21,000人→-10,000人。"], "a revision is not a figure of the table and stays a line");
  const adp = row("adp-2026-10", "2026-11-04T13:15:12+00:00", "民間の雇用者数 +86,000人（20社が同じ数字を報道）", "Private employment +86,000 (the same figure from 20 outlets)");
  const adp9 = row("adp-2026-09", "2026-09-30T12:15:00+00:00", "民間雇用 +9万人", "Private employment +90,000");
  assert.deepEqual(releaseView(adp, [adp, adp9], [], [], now, "ja").table, [{ key: "headline", label: "民間雇用者数", now: "+86,000人", previous: "+90,000人", forecast: null, change: { direction: "down", text: "4,000人" } }]);
  const election = { id: "election-2026", releasedAt: "2026-11-04T00:00:00Z", title: { ja: "選挙", en: "Election" }, result: { ja: "結果", en: "Result" }, detail: { ja: "", en: "" }, sourceName: "X", sourceUrl: "https://example.com/a" };
  assert.deepEqual(releaseView(election, [election], [], [], now, "ja").table, [], "no table for a row without an indicator number");
});

test("the opened row is one table (no big boxes), an unchanged row is muted, and the heading's arrow is the table's (owner, Nov 27)", () => {
  const item = readFileSync(new URL("../app/research/calendar/economic-release-item.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/research/calendar/event-calendar.module.css", import.meta.url), "utf8");
  assert.doesNotMatch(item, /releaseFigures|releaseChange/);
  assert.match(item, /<table className=\{`\$\{calendarStyles\.resultTable\} \$\{calendarStyles\.releaseTable\}`\}>/);
  assert.match(item, /\{withForecast && <th scope="col">\{ja \? "予想" : "Forecast"\}<\/th>\}/, "the 予想 column only when a forecast is held");
  assert.match(item, /data-same=\{row\.change\?\.direction === "same" \|\| undefined\}/);
  assert.match(item, /arrows\[headline\?\.change\?\.direction \?\? "same"\]/);
  assert.match(css, /\.releaseTable tr\[data-same\] td,\.releaseTable \[data-tone="same"\]\{color:var\(--muted\);font-weight:400\}/);
  for (const kept of ["view.about", "次回発表", "出典：", "この結果を取り下げる"]) assert.ok(item.includes(kept), kept);
});
