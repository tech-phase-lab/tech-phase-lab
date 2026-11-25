import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const screen = read("../app/research/radar/screen.tsx") + read("../app/research/radar/chart.tsx");

test("the page carries the owner's wording", () => {
  for (const text of ["FINANCIAL RADAR", "財務レーダー", "稼ぐ力と守る力を、ジャンルの中で比べます",
    "↑ 守る力　借金に対する手元の現金", "稼ぐ力　売上のうち現金で残る割合 →", "低い", "高い", "売上が増加", "売上が減少", "点の大きさ＝売上の規模",
    "各銘柄の稼ぐ力・守る力の数字と", "体力ランキング、前の決算からの動きが見られます", "🔒 PRO",
    "↑ 守る力 ｜ 現金÷(借入+リース)", "稼ぐ力 ｜ 売上に対する営業キャッシュフロー →", "売上が前年より増加", "減少", "大きさ=売上規模", "白抜き=売上の比較なし", "点線=前の決算から", "フリーキャッシュフロー率", "稼ぐ力は営業キャッシュフローの売上に対する割合です。", "並び順:稼ぐ力と守る力の点数の平均。グラフの右上ほど上位です", "前受け金除く", "前受け金(顧客からの前払い)が大きい会社は、営業キャッシュフローが膨らんで見えます。", "1年間に受け取った前受け金が1年分の売上を超える会社は、その分を除いた営業キャッシュフローで稼ぐ力を計算し", "売上がまだないため順位なし",
    "体力ランキング", "最新の決算", "データが足りない銘柄 ・", "稼ぐ力", "守る力",
    "数字は米SECの開示資料から計算しています。範囲を超える値はグラフの端に表示します。売買をすすめるものではありません。"]) assert.ok(screen.includes(text), text);
  for (const text of ["盤石", "借入で攻める", "守りで耐える", "余力が小さい"]) assert.ok(read("../lib/research/radar.ts").includes(text), text);
  for (const tab of ["AIクラウド", "半導体", "メモリ", "通信", "光・フォトニクス", "ソフトウェア", "電力・設備", "サイバーセキュリティ"]) assert.ok(read("../lib/research/radar.ts").includes(tab), tab);
});

test("FREE sees a chart by rank and three blurred sample cards under 「🔒 PRO」; trails and taps are PRO-only (owner, Nov 25)", () => {
  const screen = read("../app/research/radar/screen.tsx"), chart = read("../app/research/radar/chart.tsx"), css = read("../app/research/radar/radar.module.css");
  assert.match(screen, /<RankChart dots=\{radar\.dots\} lang=\{lang\} \/>/);
  assert.match(screen, /<RadarChart dots=\{pro\.dots\} selected=\{selected\} onSelect=\{setSelected\} lang=\{lang\} \/>/);
  const rankChart = chart.slice(chart.indexOf("export function RankChart"));
  assert.ok(!/onClick|onSelect|ocfMargin|cover/.test(rankChart), "the FREE chart has no figures and nothing to tap");
  assert.match(screen, /<LockedRanking asOf=\{radar\.asOf\} lang=\{lang\} \/>/);
  assert.ok(!screen.includes("styles.locked}"), "no flat black box");
  assert.match(screen, /<div className=\{styles\.ghosts\} aria-hidden="true" inert>\{LOCKED_SAMPLE\.map/);
  assert.match(css, /\.ghosts \{[^}]*filter: blur\(7px\)/);
  const locked = screen.slice(screen.indexOf("function LockedRanking"), screen.indexOf("/** 体力ランキング"));
  assert.ok(!/gold|#e7c77e|#c9a24f|#d8b36a/i.test(locked + css.slice(css.indexOf(".lockedRest"), css.indexOf(".lockCta p"))), "no gold on FREE");
  assert.match(screen, /\{pro \? <section className=\{styles\.card\}>/);
  assert.match(screen, /<li><b aria-hidden="true">┈<\/b>\{t\("点線=前の決算から", "Dotted = since the previous report"\)\}<\/li>/);
  assert.match(chart, /!isPro\(dot\) \|\| !dot\.previous/);
});

test("the notes and the disclaimer open from the 「i」 beside the heading, for FREE and PRO alike (owner, Nov 25)", () => {
  const screen = read("../app/research/radar/screen.tsx");
  assert.ok(!screen.includes("styles.foot"));
  assert.match(screen, /className=\{styles\.info\} aria-expanded=\{about\}/);
  assert.match(screen, /useState\(false\);\n  const requested/);
  const about = screen.slice(screen.indexOf("{about && "), screen.indexOf("</div>}", screen.indexOf("{about && ")));
  for (const text of ["数字は米SECの開示資料から計算しています。", "売買をすすめるものではありません。", "前受け金(顧客からの前払い)が大きい会社は", "稼ぐ力は営業キャッシュフローの売上に対する割合です。"]) assert.ok(about.includes(text), text);
});

test("PRO ranking: 「前受け金除く」 sits under 「稼ぐ力」 and the number column has a fixed width (owner, Nov 25: IREN overflowed)", () => {
  const screen = read("../app/research/radar/screen.tsx"), css = read("../app/research/radar/radar.module.css");
  assert.match(screen, /<span>\{ja \? "稼ぐ力" : "Cash generation"\}\{dot\.prepaid && <small className=\{styles\.review\}>/);
  assert.ok(!/<strong>\{dot\.prepaid/.test(screen));
  assert.match(css, /\.bar \{ display: grid; grid-template-columns: 66px minmax\(0, 1fr\) 76px;/);
});

test("the server decides PRO and a FREE caller is sent the dots only", () => {
  const route = read("../app/api/research/radar/route.ts");
  assert.match(route, /comparisonAccess\(member\) === 200 \? "pro" : "free"/);
  assert.match(route, /buildRadar\(genre\.id, entries, finalTier\)/);
  assert.ok(!/health/.test(route));
});

test("the menu lists 財務レーダー under Research after 資本マップ for everyone, never in the PRO tiles (owner, Nov 22 v2)", () => {
  const header = read("../app/research/site-header.tsx");
  const research = header.slice(header.indexOf('heading(ja ? "リサーチ"'));
  const map = research.indexOf('"/research/capital-map"'), radar = research.indexOf('"/research/radar"'), targets = research.indexOf('"/research/price-targets"');
  assert.ok(map > 0 && radar > map && radar < targets);
  assert.equal(header.split('"/research/radar"').length - 1, 1);
  const proTiles = header.slice(header.indexOf("tile("), header.indexOf('heading(ja ? "リサーチ"'));
  assert.ok(!proTiles.includes("radar"));
  const sidebar = read("../app/research/home-sidebar.tsx");
  assert.ok(sidebar.indexOf('"/research/radar"') > sidebar.indexOf('"/research/capital-map"'));
  const start = sidebar.indexOf("...(member ? [\n"), sidebarPro = sidebar.slice(start, sidebar.indexOf("] : [])", start));
  assert.ok(sidebarPro.includes("themes") && !sidebarPro.includes("radar"));
});

test("the old health map address leads to the radar", () => {
  assert.match(read("../app/research/health/page.tsx"), /redirect\("\/research\/radar"\)/);
});

test("the free-cash-flow ratio is only in the tapped detail; the axis, bars and ranking use operating cash flow", () => {
  const chart = read("../app/research/radar/chart.tsx"), screen = read("../app/research/radar/screen.tsx");
  assert.equal((chart.match(/fcfMargin/g) ?? []).length, 1); // the detail line only
  assert.ok(!screen.includes("fcfMargin"));
  assert.ok(screen.includes("xPosition(dot.ocfMargin)"));
  assert.match(chart, /TRAIL_MIN = 6/);
  assert.match(chart, /Math\.hypot\(x2 - x1, y2 - y1\) < TRAIL_MIN\) return null/);
});

test("the page opens with the first genre's dots already in it, and the screen needs no loading message", () => {
  const page = read("../app/research/radar/page.tsx"), screen = read("../app/research/radar/screen.tsx");
  assert.match(page, /buildRadar\(first, entries, "free"\)/);          // public dots only; the plan is settled by the API afterwards
  assert.match(page, /setTimeout\(\(\) => resolve\(null\), 2500\)/);   // never held up for long
  assert.match(page, /after\(\(\) => afterRadar\(first\)\)/);
  assert.ok(!/getMembership/.test(page));
  assert.ok(!screen.includes("読み込み中"));
  assert.match(screen, /for \(const item of radarGenres\) await request\(item\.id\)/); // other tabs fetched quietly, one at a time
  assert.match(screen, /!confirmed \? <section className=\{styles\.rankWait\} aria-hidden="true" \/>/); // no lock flashed at a PRO visitor
  const route = read("../app/api/research/radar/route.ts");
  assert.match(route, /await loadGenreEntries\(genre\.id\)/);
  assert.match(route, /after\(\(\) => afterRadar\(genre\.id\)\)/);
});

test("the English view has no Japanese left in the radar page (owner, Nov 6)", () => {
  for (const text of ["Financial Radar", "Cash generation", "Financial resilience", "Financial strength ranking", "Financial cushion — cash vs. debt", "Cash earning power — cash kept from sales", "Compare earning power and financial cushion within each genre.", "See each stock's numbers, the strength ranking, and changes since the last report.", "Excl. prepayments", "Not ranked: no revenue yet", "Revenue up from a year earlier"]) assert.ok(screen.includes(text), text);
  const chart = read("../app/research/radar/chart.tsx");
  assert.match(chart, /ja \? "横軸が稼ぐ力、縦軸が守る力の散布図" : "Scatter plot/);
  assert.match(read("../lib/research/radar.ts"), /zoneNameEn/);
});

test("the browser tab title is English in the English view", async () => {
  const { englishTitle } = await import("../lib/research/english-titles.ts");
  assert.equal(englishTitle("/research/radar"), "Financial Radar | Tech Phase Research");
  assert.equal(englishTitle("/research/pro-experience/watch-22"), "PRO feature tour | Tech Phase Research");
  assert.equal(englishTitle("/research/unknown"), "Tech Phase Research");
  assert.equal(englishTitle("/terms"), "Terms of Service | Tech Phase");
});

test("no separate 要確認 block: only a company without revenue is unranked, in one plain line (owner, Nov 24)", () => {
  assert.ok(!screen.includes("要確認"));
  assert.ok(!screen.includes("順位外"));
  assert.ok(!screen.includes("reviewHead"));
  assert.match(screen, /const unranked = pro\.dots\.filter\(dot => dot\.rank === null\);/);
  assert.match(screen, /unranked\.map\(dot => <p key=\{dot\.ticker\} className=\{styles\.unranked\}>/);
});

test("the owner's accounts always get the full PRO radar (figures, ranking, trails, taps), even on a FREE plan", async () => {
  const { comparisonAccess } = await import("../lib/research/comparison.ts");
  const { OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID } = await import("../lib/membership/entitlements.ts");
  for (const id of [OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID]) assert.equal(comparisonAccess({ status: "signed-in", plan: "free", userId: id, ownerAccount: true }), 200);
  assert.equal(comparisonAccess({ status: "signed-in", plan: "free", userId: "user_someone_else", ownerAccount: false }), 403);
  assert.match(read("../app/api/research/radar/route.ts"), /comparisonAccess\(member\) === 200 \? "pro" : "free"/);
});
