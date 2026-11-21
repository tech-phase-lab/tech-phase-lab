import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const { cardBadge, formatNumber, barHeights, scheduleDate, groupNotes, arrangeDrafts, moveWidths, signedPercent } = await import("../lib/research/weekly-format.ts");
const { isOwnerAccount, OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID } = await import("../lib/membership/entitlements.ts");
const card = over => ({ label: "a", value: null, outlook: null, previous: null, unit: "", outlookUnit: "", range: "", delta: null, ...over });

test("the badge is percent for amounts and points for percentages, and absent when nothing compares", () => {
  assert.deepEqual(cardBadge(card({ value: 542.29, outlook: 615, unit: "億ドル" })), { text: "+13.4%", tone: "up", caption: "見通し" });
  assert.equal(cardBadge(card({ value: 12.5, outlook: 11.75, unit: "%" })).text, "−0.75pt");
  assert.equal(cardBadge(card({ value: 10, previous: 8, unit: "" })).caption, "前回比");
  assert.equal(cardBadge(card({ outlook: 5 })), null);
  assert.equal(cardBadge(card({ value: 0, outlook: 5 })), null);
  assert.equal(cardBadge(card({ value: 5, outlook: 5 })).tone, "flat");
});
test("numbers, bars and dates format without surprises", () => {
  assert.equal(formatNumber(1234567.5), "1,234,567.5");
  assert.equal(formatNumber(542.29), "542.29");
  assert.deepEqual(barHeights([542.29, 615]), [88, 100]);
  assert.deepEqual(barHeights([0, 0]), [0, 0]);
  assert.deepEqual(scheduleDate("2026-10-02"), { month: "OCT", day: "2", weekday: "金" });
});
test("the weekly route is PRO-only for reading, owner-only for drafts and actions, and never marks a person's edit as automatic", () => {
  const route = read("app/api/research/weekly-issues/route.ts");
  assert.match(route, /pro-required/); assert.match(route, /owner-required/);
  assert.match(route, /auto: false/);
  assert.match(route, /RESEARCH_EDITOR_TOKEN/);
  assert.match(read("proxy.ts"), /\/api\/research\/weekly-issues/);
});
test("the screen has the past-issues list, one closed source fold, and an off-by-default auto switch", () => {
  const screen = read("app/research/weekly/issues.tsx");
  for (const text of ["これまでの号", "さらに前の号を見る", "最新", "今週のひとこと", "確認なしで自動公開", "<details className={styles.sources}>"]) assert.ok(screen.includes(text), text);
  assert.equal((screen.match(/<details/g) ?? []).length, 4, "the sources, the owner's draft, its closed review memo fold and the closed old-drafts fold");
  assert.ok(!screen.includes("毎週木曜"));
});
test("the weekly-draft notice setting is the owner's alone", () => {
  assert.match(read("app/research/notification-page-view.tsx"), /p\.owner && <>/);
  assert.match(read("app/api/research/notifications/route.ts"), /weeklyDraft === true \&\& !member\.isAdmin/);
});

test("the owner can turn the weekly auto-draft on and try one now (Nov 4)", () => {
  const screen = read("app/research/weekly/issues.tsx");
  for (const text of ["毎週土曜に下書きを自動で作る", "今すぐ下書きを作る", "generateEnabled", "generateHour", "AIの設定がまだ終わっていません"]) assert.ok(screen.includes(text), text);
  assert.match(read("app/api/research/weekly-issues/route.ts"), /generate: "\/admin\/weekly\/generate"/);
  assert.ok(!/checked=\{generateEnabled \?\? true\}/.test(screen), "off unless the owner turns it on");
});

test("the weekly title stays on one line and the issue carries gold-brown frames, a rule after each heading and coloured outlooks (Nov 4)", () => {
  assert.match(read("app/research/weekly/issues.tsx"), /<ResearchToolShell desk compactTitle /);
  assert.match(read("app/research/research-tool-shell.tsx"), /compactTitle \? styles\.compactTitle/);
  assert.match(read("app/research/research-tools.module.css"), /\.desk h1\.compactTitle\{[^}]*white-space:nowrap/);
  const css = read("app/research/weekly/issues.module.css");
  for (const text of ["border:1px solid #4a3d20", ".part h3::after", ".val_up", ".val_down"]) assert.ok(css.includes(text), text);
  assert.ok(!/\.part\{[^}]*#2a3140/.test(css), "no blue-grey frame on a part");
});

test("the owner's review memo is grouped apart from the body, with a one-line count first (Nov 12)", () => {
  const memo = groupNotes([
    "【定型文】見出しは、AIの文が事実確認に通らなかったため、定型文にしています。〔changed-negation〕",
    "【要確認】「雇用統計は強め」は、数字が資料と合わないため載せていません。〔unsupported-number〕",
    "【取得なし】今週の決算が、集まっていません。",
    "【AI省略】AIが載せなかった話題: QCOM",
  ]);
  assert.deepEqual(memo.groups.map(g => g.kind), ["attention", "substituted", "missing", "omitted"]);
  assert.equal(memo.summary, "要対応 2件(確認メモ 計4件)");
  assert.deepEqual(memo.substituted, { headline: true, lead: false });
  assert.equal(memo.groups[1].lines[0].code, "changed-negation");
  assert.ok(!memo.groups[1].lines[0].text.includes("changed-negation"), "the code is kept apart from the sentence");
  assert.equal(groupNotes([]).summary, "確認メモはありません。");
  assert.equal(groupNotes(["【取得なし】x"]).summary, "確認メモ 1件(要対応はありません)");
  // Drafts saved before the tags still sort sensibly.
  const old = groupNotes(["見出しはAIの文が確認に通らなかったため、定型文にしています（changed-negation）", "ここは取れませんでした: numbers", "数字が食い違った: 雇用統計は強め", "QCOMの決算数値は、論点を絞るため掲載を見送りました。"]);
  assert.deepEqual(old.counts, { attention: 1, substituted: 1, missing: 1, omitted: 1, verified: 0 });
  assert.equal(old.groups[1].lines[0].code, "changed-negation");
});
test("the computed market figures are listed in the memo with their source and are not counted as to-do (Nov 21)", () => {
  const memo = groupNotes(["【検証】QQQ 週間-10.5% = 2026-11-20終値 608.45 ÷ 2026-11-13終値 679.89 − 1。出典: Twelve Data の日足終値", "【取得なし】x"]);
  assert.deepEqual(memo.groups.map(g => g.kind), ["missing", "verified"]);
  assert.equal(memo.groups[1].title, "検証用の数字(出典と計算)");
  assert.equal(memo.summary, "確認メモ 2件(要対応はありません)");
});
test("the draft shows the memo apart from the issue and the issue groups its parts by section (Nov 12)", () => {
  const screen = read("app/research/weekly/issues.tsx");
  for (const text of ["groupNotes(value.notes)", "確認メモ(", "読者には見えません", "要対応", "SECTION_TITLES", "定型文: "]) assert.ok(screen.includes(text), text);
  const view = screen.slice(screen.indexOf("export function IssueView"), screen.indexOf("const send"));
  assert.ok(!view.includes("notes"), "the reader's view never touches the owner's notes");
  assert.ok(screen.indexOf("<IssueView issue={value} />") < screen.indexOf("styles.memo}"), "the memo comes after the issue");
});

test("the issue draws its diagrams from checked data: takeaway icon cards, result/forecast/previous bars, a day strip (Nov 13)", () => {
  const screen = read("app/research/weekly/issues.tsx"), css = read("app/research/weekly/issues.module.css");
  for (const text of ["function Takeaways", "function Compare", "styles.strip", "KindIcon", "part.compare", "part.items"]) assert.ok(screen.includes(text), text);
  for (const text of [".takeaways", ".compare", ".cmpMain", ".strip"]) assert.ok(css.includes(text), text);
  assert.ok(!/https?:\/\/[^"']*(tradingview|chart)/i.test(screen), "no external chart service");
  assert.ok(screen.includes("items.map(item => item.text).join") || screen.includes("part.items.map(item => item.text)"), "edited takeaway text falls back to plain lines");
});

test("the owner's drafts: the newest per date stays a card, older or superseded ones fold away (Nov 15)", () => {
  const d = (id, date, createdAt) => ({ id, date, createdAt });
  const drafts = [d("a", "2026-11-14", "2026-11-14T01:00:00.000Z"), d("b", "2026-11-14", "2026-11-14T03:00:00.000Z"), d("c", "2026-11-14", "2026-11-14T02:00:00.000Z"),
    d("e", "2026-11-21", "2026-11-21T00:00:00.000Z"), d("f", "2026-11-07", "2026-11-07T00:00:00.000Z"), d("g", "2026-10-31", "2026-10-31T00:00:00.000Z")];
  const { current, older } = arrangeDrafts(drafts, "2026-11-07");
  assert.deepEqual(current.map(x => x.id), ["e", "b"], "one card per date, newest date first, the latest-made draft of that date");
  assert.deepEqual(older.map(x => x.id), ["c", "a", "f", "g"], "superseded drafts and drafts on or before the latest published issue are folded");
  assert.deepEqual(arrangeDrafts(drafts, null).current.map(x => x.id), ["e", "b", "f", "g"]);
  assert.deepEqual(arrangeDrafts([], null), { current: [], older: [] });
});

test("the owner reads the issue on top and manages drafts below; readers see no draft (Nov 15)", () => {
  const screen = read("app/research/weekly/issues.tsx");
  for (const text of ["過去の下書き（{older.length}件）", "確認待ちの下書き", "毎週土曜に下書きを自動で作る", "arrangeDrafts(drafts, latestPublished)", "上で読者の見え方を確認", "読者にはまだ見えません", "削除"]) assert.ok(screen.includes(text), text);
  const panel = screen.slice(screen.indexOf("function OwnerPanel"), screen.indexOf("export default function WeeklyIssues"));
  assert.ok(panel.indexOf("確認待ちの下書き") < panel.indexOf("過去の下書き") && panel.indexOf("過去の下書き") < panel.indexOf("毎週土曜に下書きを自動で作る"), "cards, then the fold, then the settings");
  assert.match(panel, /<details className=\{styles\.oldDrafts\}>/, "the old drafts fold is closed by default");
  assert.match(screen, /window\.confirm\(`\$\{shortDate\(draft\.date\)\}の古い下書き/, "deleting an old draft asks first");
  const page = screen.slice(screen.indexOf("export default function WeeklyIssues"));
  assert.ok(page.indexOf("<IssueView issue={reviewing}") < page.indexOf("<OwnerPanel"), "the issue comes before the management area");
  assert.match(page, /const reviewing = ownerMode && owner \?/, "a draft is shown on top only in the owner's view");
  assert.match(page, /\{ownerMode && owner && <OwnerPanel/);
  const css = read("app/research/weekly/issues.module.css");
  for (const rule of [".oldDrafts li{display:flex;flex-wrap:wrap", ".previewBar{display:flex;flex-wrap:wrap", "min-width:0"]) assert.ok(css.includes(rule), rule);
});

test("both owner accounts keep full access to the weekly issue and its drafts (Nov 15)", () => {
  assert.ok(isOwnerAccount(OWNER_ACCOUNT_ID) && isOwnerAccount(PRODUCTION_OWNER_ACCOUNT_ID));
  assert.ok(!isOwnerAccount("user_someone_else"));
  const route = read("app/api/research/weekly-issues/route.ts");
  assert.match(route, /member\.plan !== "pro" && !member\.isAdmin/, "the owner reads every issue whatever the plan");
  assert.match(route, /if \(!member\.isAdmin\) return reply\(403, \{ ok: false, error: "owner-required" \}\)/, "drafts are the owner's alone");
  const server = read("lib/membership/server.ts");
  assert.match(server, /isOwnerAccount\(userId\) && isAdmin/, "owner mode comes from the owner account ids");
  assert.match(server, /ownerMode \? "pro"/, "an owner account in owner mode reads as PRO");
});

test("making another draft by hand asks first and says it costs money; nothing else asks the AI again (Nov 15)", () => {
  const screen = read("app/research/weekly/issues.tsx");
  const make = screen.slice(screen.indexOf("const makeNow"), screen.indexOf("const toggle = async"));
  assert.match(make, /window\.confirm\("[^"]*料金[^"]*"\)\) return;\s*setBusy\(true\)/, "the cost confirm comes before the request");
  assert.equal((screen.match(/send\("generate"/g) ?? []).length, 1, "only the owner's button asks for a new draft");
});

test("prices keep two decimals and the week's moves are drawn around zero (owner, Nov 21)", () => {
  assert.equal(formatNumber(79.3, 2), "79.30");
  assert.equal(formatNumber(58951.5, 2), "58,951.50");
  assert.equal(formatNumber(79.3), "79.3", "cards without digits are unchanged");
  assert.deepEqual(moveWidths([-10.5, -21, 4.2, 0]), [50, 100, 20, 0]);
  assert.equal(signedPercent(-10.5), "−10.5%");
  assert.equal(signedPercent(3), "+3.0%");
  const screen = read("app/research/weekly/issues.tsx");
  for (const text of ['part.type === "moves"', "<svg", "formatNumber(card.value, card.digits)", "aria-label"]) assert.ok(screen.includes(text), text);
});
