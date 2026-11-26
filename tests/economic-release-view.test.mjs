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
  assert.deepEqual(view.facts, ["売上高 7,482億ドル"], "the sourcing sentence is not a fact");
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
  assert.deepEqual(view.facts, ["4週平均：196,000件（前週比1,500件減）。", "継続受給者数：1,697,000人（11月14日終了週・前週比95,000人減）。"], "no sourcing sentence, no repeat of the change");
  assert.match(view.about, /失業保険を新たに申請した人の数/);
  assert.deepEqual(view.link, { url: "https://www.dol.gov/ui/data.pdf", name: "米労働省（DOL）", official: true });
  assert.equal(view.forecast, null, "no forecast is held for claims");
  assert.equal(view.expandable, true);
  const en = releaseView(c21, [c21, c14], [], [], now, "en");
  assert.deepEqual([en.display, en.previous.display, en.change], ["189,000", "202,000", "Down 13,000 from the previous week"]);
  assert.deepEqual(en.facts, ["4-week average: 196,000 (down 1,500 from the previous week).", "Continuing claims: 1,697,000 (week ending November 14, down 95,000 from the previous week)."]);
  const older = releaseView(c14, [c21, c14], [], [], now, "ja");
  assert.deepEqual([older.display, older.previous.display, older.change, older.facts], ["203,000件", "202,000件", "前週より1,000件増加", []], "a result stored without the figures shows what it has");
  const same = claims("28", "2026-12-02T13:30:00+00:00", "189,000件（前週改定値から変わらず）", "189,000 (unchanged from the previous week's revised level)");
  assert.equal(releaseView(same, [same], [], [], now, "ja").change, "前回と同じ");
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
