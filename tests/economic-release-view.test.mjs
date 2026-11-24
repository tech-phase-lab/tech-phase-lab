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
