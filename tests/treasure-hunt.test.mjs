// Owner's sheet of Nov 22: 割安判別ツール / Value Check becomes トレジャーハント / Treasure Hunt, the English name of クジラの足あと becomes
// Whale Tracks, the PRO introduction card gains both rows (and a short English table), and the PRO feature tour gets a hands-on sample of each.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { JSDOM } from "jsdom";
import ts from "typescript";
import config from "../next.config.ts";
import { englishTitle } from "../lib/research/english-titles.ts";
import * as valueLib from "../lib/research/value-check.ts";
import * as whaleLib from "../lib/research/whale-moves.ts";
import * as samplesLib from "../lib/research/pro-experience-samples.ts";
import { TREASURE_NOTE, treasureHuntSample } from "../lib/research/pro-experience-sample-treasure.ts";
import { WHALE_NOTE, whaleTracksSample } from "../lib/research/pro-experience-sample-whales.ts";
import { proFeatures } from "../lib/research/pro-experience.ts";
import { PRO_ONLY_FEATURES } from "../lib/research/pro-features.ts";
import { OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID } from "../lib/membership/entitlements.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("names: トレジャーハント / Treasure Hunt and Whale Tracks everywhere a reader sees them; the old address opens the new page", async () => {
  const header = read("../app/research/site-header.tsx"), sidebar = read("../app/research/home-sidebar.tsx");
  const treasure = read("../app/research/treasure-hunt/screen.tsx"), whales = read("../app/research/whales/screen.tsx");
  assert.match(treasure, /TREASURE HUNT</);
  assert.match(treasure, /export const TREASURE_HUNT = \{ ja: "トレジャーハント", en: "Treasure Hunt" \}/);
  assert.match(whales, /WHALE TRACKS</);
  assert.match(whales, /export const WHALE_TRACKS = \{ ja: "クジラの足あと", en: "Whale Tracks" \}/);
  assert.match(read("../app/research/treasure-hunt/page.tsx"), /title: "トレジャーハント \| Tech Phase PRO"/);
  assert.equal(englishTitle("/research/treasure-hunt"), "Treasure Hunt | Tech Phase Research");
  assert.equal(englishTitle("/research/whales"), "Whale Tracks | Tech Phase Research");
  // No line under the heading (the same as クジラの足あと): the card goes from the heading straight to the switch.
  assert.match(treasure, /<h1 id="treasure-hunt-title">[^\n]*<\/h1>\n\s*<\/div>/);
  for (const source of [header, sidebar, treasure, whales, read("../lib/research/english-titles.ts"), read("../app/research/plan-cards.tsx"), read("../lib/research/pro-experience.json")])
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""), /割安判別ツール|Value Check|VALUE CHECK|Whale Moves|WHALE MOVES/); // comments may keep the history
  const redirects = await config.redirects();
  assert.ok(redirects.some(r => r.source === "/research/value-check" && r.destination === "/research/treasure-hunt" && r.permanent === false));
});

test("names: production keeps its internal names (switches, API, monitor route, Python module)", () => {
  assert.match(read("../app/research/treasure-hunt/screen.tsx"), /fetch\("\/api\/research\/value-check"/);
  assert.match(read("../lib/research/value-check-server.ts"), /readMonitor\("\/value-check", 1_500_000/);
  assert.match(read("../lib/research/value-check.ts"), /NEXT_PUBLIC_VALUE_CHECK_ENABLED: process\.env\.NEXT_PUBLIC_VALUE_CHECK_ENABLED/);
  assert.match(read("../lib/research/whale-moves.ts"), /NEXT_PUBLIC_WHALE_MOVES_ENABLED: process\.env\.NEXT_PUBLIC_WHALE_MOVES_ENABLED/);
  const service = read("../scripts/research/service.py");
  assert.match(service, /VALUE_CHECK_ENABLED/);
  assert.match(service, /if path == "\/value-check":/);
  assert.ok(read("../scripts/research/value_check.py").length > 1000);
  // The owner's accounts always see both, even with the switches off (AGENTS.md, operator access).
  for (const owner of [{ ownerAccount: true }, { ownerMode: true }]) {
    assert.equal(valueLib.valueCheckAccess({ status: "signed-in", plan: "free", ...owner }, false), 200);
    assert.equal(whaleLib.whaleMovesAccess({ status: "signed-in", plan: "free", ...owner }, false), 200);
  }
  assert.ok(OWNER_ACCOUNT_ID && PRODUCTION_OWNER_ACCOUNT_ID);
});

test("PRO card: two new rows under テーマランキング, the owner's English table, every row one line, the new spacing", () => {
  const cards = read("../app/research/plan-cards.tsx");
  const rows = [...cards.slice(cards.indexOf("const pro: Group[]"), cards.indexOf("return { free, pro };")).matchAll(/\[t\("([^"]+)", "([^"]+)"\), t\("([^"]+)", "([^"]+)"\)\]/g)].map(m => m.slice(1));
  assert.deepEqual(rows.map(r => r[0]), ["決算リサーチ", "連関マップ", "テーマランキング", "トレジャーハント", "クジラの足あと", "銘柄比較 PRO", "財務レーダー",
    "ハイテク速報", "スマホ通知", "監視22銘柄", "米国株の資産管理", "週刊 Tech Phase PRO", "リゼルのひとりごと", "リゼルに聞く"]);
  const english = Object.fromEntries(rows.map(r => [r[0], [r[1], r[3]]]));
  assert.deepEqual(english, {
    "決算リサーチ": ["Earnings Research", "What's next"], "連関マップ": ["Company Map", "Partners & rivals"], "テーマランキング": ["Theme Rankings", "See what's leading"],
    "銘柄比較 PRO": ["Compare PRO", "2–3 stocks side by side"], "財務レーダー": ["Financial Radar", "Health & profitability"], "トレジャーハント": ["Treasure Hunt", "Daily value finds"],
    "クジラの足あと": ["Whale Tracks", "Funds, shorts & buybacks"], "ハイテク速報": ["Tech Alerts", "Every update, live"], "スマホ通知": ["Push Alerts", "Prices, earnings, data & news"],
    "監視22銘柄": ["22-Stock Watchlist", "Track key changes"], "米国株の資産管理": ["US Portfolio", "Import from a screenshot"], "週刊 Tech Phase PRO": ["PRO Weekly", "Recap & outlook"],
    "リゼルのひとりごと": ["RIZEL's Notes", "Read or listen"], "リゼルに聞く": ["Ask RIZEL", "Member Q&A"],
  });
  assert.deepEqual(rows.find(r => r[0] === "トレジャーハント")[2], "割安銘柄を毎日掘り起こす");
  assert.deepEqual(rows.find(r => r[0] === "クジラの足あと")[2], "機関・空売り・自社株買いの裏側");
  assert.doesNotMatch(cards, /追加/);
  const css = read("../app/research/plan-cards.module.css");
  assert.match(css, /\.includes \{ margin:32px 0 0;/);
  assert.match(css, /\.proCard \.includes \+ \.group \{ margin-top:14px; \}/);
  assert.match(css, /\.proCard \.group ul\[data-ja="false"\] li \{ white-space:nowrap;/);
  assert.doesNotMatch(css, /text-overflow:ellipsis/);
});

test("lost when PRO ends: トレジャーハント and クジラの足あと under テーマランキング, as on the PRO card", () => {
  const names = PRO_ONLY_FEATURES.map(feature => feature.ja);
  const at = names.indexOf("テーマランキング");
  assert.deepEqual(names.slice(at, at + 3), ["テーマランキング", "トレジャーハント", "クジラの足あと"]);
  assert.deepEqual(PRO_ONLY_FEATURES.slice(at + 1, at + 3), [
    { ja: "トレジャーハント", descriptionJa: "割安銘柄を毎日掘り起こす", en: "Treasure Hunt", descriptionEn: "Daily value finds" },
    { ja: "クジラの足あと", descriptionJa: "機関・空売り・自社株買いの裏側", en: "Whale Tracks", descriptionEn: "Funds, shorts & buybacks" },
  ]);
});

test("FREE card in English: the owner's short table (Nov 22); the Japanese card is unchanged", () => {
  const cards = read("../app/research/plan-cards.tsx");
  const block = cards.slice(cards.indexOf("const free: Group[]"), cards.indexOf("const pro: Group[]"));
  const rows = [...block.matchAll(/\[t\("([^"]+)", "([^"]+)"\)(?:, t\("([^"]+)", "([^"]+)"\))?\]/g)].map(m => [m[1], m[2], m[4]]);
  assert.deepEqual(rows.map(r => r.slice(1).filter(Boolean).join(" ｜ ")), [
    "Earnings & economic updates", "Top US market stories", "Tech Alerts ｜ 5 headlines · 30m lag", "Curated News ｜ Company updates",
    "US stock search", "Prices & charts", "Earnings & economic calendar", "Indices, bonds & currencies", "Capital Map ｜ See who owns what",
    "Your watchlist", "Research Notes ｜ Memos & PDFs", "Stock Notebook ｜ Watchlist moves",
  ]);
  assert.deepEqual(rows.map(r => r[0]), ["決算と経済指標の速報", "米国市場の注目トピック", "ハイテク速報", "厳選ニュース", "米国株の銘柄検索", "株価とチャートの確認",
    "決算・経済指標カレンダー", "指数・債券・為替のマーケット情報", "資本マップ", "ウォッチリストの銘柄登録", "リサーチノート", "銘柄手帳"]);
  assert.match(block, /t\("ハイテク速報", "Tech Alerts"\), t\("30分遅れ・5件", "5 headlines · 30m lag"\)/);
  assert.match(block, /title: t\("ニュース", "News"\)[\s\S]*title: t\("調べる", "Explore"\)[\s\S]*title: t\("自分用", "For you"\)/);
  assert.match(cards, /t\("米国株を調べる、深く知る。", "Explore US stocks in depth\."\)/);
});

test("samples: the owner's mockups (Nov 22), on a made-up 2035 timeline", () => {
  assert.deepEqual(proFeatures.map(f => f.id).slice(0, 5), ["relation-map", "theme-ranking", "treasure-hunt", "whale-tracks", "compare"]);
  assert.equal(samplesLib.hasSample("treasure-hunt"), true);
  assert.equal(samplesLib.hasSample("whale-tracks"), true);
  const t = treasureHuntSample;
  // QA, Nov 25: the sample shares the tour's one made-up moment (2035/03/12 09:00 JST), so its close is the last one before it.
  assert.equal(t.asOf, samplesLib.SAMPLE_CLOSE_DAY);
  assert.equal(t.asOf, "2035-03-09");
  assert.ok(Date.parse(t.computedAt) < Date.parse("2035-03-12T00:00:00.000Z"), "computed before the sample moment");
  assert.ok(t.computedAt.startsWith(t.asOf), "computed on the close day it shows");
  // Production computes trailing multiples, so the sample says 実績値 like the page (the mockup's 予想値 would misdescribe it).
  assert.equal(t.basis, "trailing");
  assert.equal(valueLib.footerLine(t.asOf, t.basis, true, true), "2035年3月9日の終値で更新・PERとPSRは実績値・売上は前年比");
  assert.equal(valueLib.footerLine(t.asOf, t.basis, false, true), "As of Mar 9, 2035 close · Trailing P/E and P/S · Revenue growth YoY");
  assert.equal(valueLib.footerLine("2026-11-20", "trailing", true), "11/20の終値で更新・PERとPSRは実績値・売上は前年比", "the page keeps its short date");
  const tech = t.universes.tech;
  assert.deepEqual(tech.items.map(i => [i.ticker, i.score, i.pe, i.ps, i.revenueGrowth]), [
    ["MU", 93, 3.8, 1.9, 190], ["QCOM", 89, 12.1, 3.4, 12], ["AMAT", 86, 14.6, 4.1, 9], ["ADBE", 86, 15.2, 5.8, 11],
    ["INTC", 84, 18.4, 1.7, 3], ["MRVL", 81, 22.9, 7.2, 22], ["TXN", 79, 24.3, 8.1, 6]]);
  // Owner, Nov 22: the scores take the magnitude production showed at the Nov 20 close.
  assert.deepEqual(tech.items.map(i => i.score), [93, 89, 86, 86, 84, 81, 79]);
  assert.deepEqual(t.universes.all.items.map(i => i.score), [93, 89, 86, 86, 85, 84, 84]);
  for (const universe of ["tech", "all"]) {
    const list = t.universes[universe];
    assert.equal(list.items.length, valueLib.FIRST_ROWS, `${universe}: the podium and 4th to 7th`);
    assert.ok(list.changes.in.length && list.changes.out.length, `${universe}: the band shows IN and OUT`);
    // Production's rule (owner, Nov 22): IN crosses 30 from below, OUT from above; a row is IN only when the band has it at its score.
    for (const c of list.changes.in) assert.ok(c.from < valueLib.CHEAP_FROM && c.to >= valueLib.CHEAP_FROM, `${universe} IN ${c.ticker}`);
    for (const c of list.changes.out) assert.ok(c.from >= valueLib.CHEAP_FROM && c.to < valueLib.CHEAP_FROM, `${universe} OUT ${c.ticker}`);
    for (const item of list.items) {
      const band = list.changes.in.find(c => c.ticker === item.ticker);
      assert.equal(item.in, Boolean(band && band.to === item.score && item.score >= valueLib.CHEAP_FROM), `${universe} ${item.ticker}`);
      assert.ok(item.previous === null || item.previous >= valueLib.CHEAP_FROM, `${universe} ${item.ticker}: no crossing outside the band`);
    }
  }
  assert.deepEqual(TREASURE_NOTE.tech, { ja: "※実際は約150銘柄のランキングです", en: "*The full ranking covers about 150 stocks" });
  assert.equal(TREASURE_NOTE.all.ja, "※実際は約500銘柄のランキングです");

  const w = whaleTracksSample;
  for (const key of ["institutional", "short", "insiders", "buybacks"]) assert.equal(w[key].length, 5, key);
  assert.equal(whaleLib.asOfLine("institutions", w, true, true), "2034年12月末時点・13F（四半期ごとに更新）");
  assert.equal(whaleLib.asOfLine("short", w, true, true), "2035年2月28日時点・FINRA（月2回更新）");
  assert.equal(whaleLib.asOfLine("institutions", w, false, true), "As of end-Dec 2034 · 13F (updated quarterly)");
  assert.equal(whaleLib.asOfLine("short", w, false, true), "As of Feb 28, 2035 · FINRA (updated twice a month)");
  assert.equal(whaleLib.asOfLine("short", w, true), "2月28日時点・FINRA（月2回更新）", "the page keeps its short date");
  assert.deepEqual(w.institutional.map(r => [r.ticker, r.pct, r.change]), [["NBIS", 58.2, 6.4], ["NVDA", 69.7, 3.1], ["MU", 77.7, 3], ["MRVL", 84.1, 2.2], ["ARM", 21.4, 1.8]]);
  assert.deepEqual(w.short.map(r => [r.ticker, r.pct, r.change, r.days]), [["SMCI", 18.4, 2.1, 3.9], ["CRWV", 14.7, -1.2, 2.6], ["PLTR", 3.1, 0.4, 1.4], ["MU", 2.07, 0.3, 1.9], ["NVDA", 1.16, -0.1, 2.8]]);
  assert.deepEqual(w.insiders.map(r => [r.date.slice(5), r.ticker, whaleLib.roleLabel(r.role, true), r.side, r.planned, whaleLib.money(r.value, true)]), [
    ["03-09", "MU", "CEO", "buy", false, "420万ドル"], ["03-08", "AMD", "CFO", "sell", true, "1,250万ドル"], ["03-07", "ORCL", "会長", "sell", true, "8,900万ドル"],
    ["03-06", "INTC", "取締役", "buy", false, "110万ドル"], ["02-26", "NVDA", "取締役", "sell", true, "2.98億ドル"]]);
  assert.deepEqual(w.buybacks.map(r => [r.ticker, r.kind, r.kind === "quarter" ? whaleLib.quarterLabel(r.end, true) : r.date.slice(5), whaleLib.money(r.amount, true)]), [
    ["AAPL", "authorization", "03-09", "1,100億ドル"], ["META", "authorization", "03-02", "500億ドル"], ["NVDA", "quarter", "10〜12月", "142億ドル"],
    ["QCOM", "quarter", "10〜12月", "38億ドル"], ["AVGO", "quarter", "10〜12月", "25億ドル"]]);
  // QA, Nov 25: every date lies on the tour's one made-up timeline, on or before the last U.S. close before 2035/03/12 09:00 JST.
  for (const day of [w.institutionalAsOf, w.shortAsOf, ...w.insiders.map(r => r.date), ...w.buybacks.flatMap(r => [r.date, ...(r.kind === "quarter" ? [r.start, r.end] : [])])]) {
    assert.match(day, /^203[45]-/); assert.ok(day <= samplesLib.SAMPLE_CLOSE_DAY, day);
  }
  for (const name of ["treasure-hunt.json", "whale-tracks.json"]) {
    const file = JSON.parse(read(`../lib/research/pro-experience-samples/${name}`));
    assert.equal(file.fictional, true, name);
    assert.match(file._source, /fictional/, name);
  }
  // The card itself says サンプル / PRO機能体験; the frame leaves out its own line for these two. No advice words.
  assert.deepEqual(samplesLib.CARD_HEAD_FEATURES, ["treasure-hunt", "whale-tracks"]);
  for (const name of ["treasure-hunt.tsx", "whale-tracks.tsx"]) {
    const source = read(`../app/research/pro-experience/samples/${name}`);
    assert.match(source, /top=\{<CardHead lang=\{lang\} \/>\}/);
    assert.doesNotMatch(source, /おすすめ|チャンス|狙い目|\b(recommend\w*|opportunit\w*|bargain\w*)\b/i);
  }
  for (const id of ["treasure-hunt", "whale-tracks"]) assert.doesNotMatch(`${samplesLib.SAMPLE_HINTS[id].ja}\n${samplesLib.SAMPLE_HINTS[id].en}`, /買い|おすすめ|チャンス|狙い目|\b(buys?|recommend\w*|opportunit\w*|bargain\w*)\b/i);
});

// ---- Hands-on: the real parts in the sample frame ----
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://techphase.app/research/pro-experience/treasure-hunt" });
for (const key of ["window", "document", "navigator", "Node", "HTMLElement", "Element", "Event", "MouseEvent"]) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const h = React.createElement;
function load(path, stubs = {}) {
  const out = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", out)(id => id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : id in stubs ? stubs[id] : require(id), mod, mod.exports);
  return mod.exports;
}
let navigations = 0;
const NextLink = ({ href, children, ...props }) => h("a", { href, ...props, onClick: event => { event.preventDefault(); navigations++; } }, children);
const rowLink = load("../app/research/stock-row-link.tsx", { "next/link": { default: NextLink } });
const shared = {
  "next/link": { default: NextLink }, "../stock-row-link": rowLink, "../research-tool-shell": { default: ({ children }) => h("main", null, children) },
  "../watchlist/stock-logo": { default: ({ ticker }) => h("span", { "data-logo": ticker }) },
  "../member-display-provider": { useMemberDisplay: () => "pro", useMemberSettled: () => true, useOwnerAccount: () => false },
  "../use-research-language": { useResearchLanguage: () => ["ja", () => {}] },
};
const treasureScreen = load("../app/research/treasure-hunt/screen.tsx", { ...shared, "@/lib/research/value-check": valueLib });
const whaleScreen = load("../app/research/whales/screen.tsx", { ...shared, "@/lib/research/whale-moves": whaleLib });
const Frame = load("../app/research/pro-experience/samples/frame.tsx", { "@/lib/research/pro-experience-samples": samplesLib }).default;
const cardHead = load("../app/research/pro-experience/samples/card-head.tsx", { "@/lib/research/pro-experience-samples": samplesLib });
const sampleStubs = { "../../stock-row-link": rowLink, "../../treasure-hunt/screen": treasureScreen, "../../whales/screen": whaleScreen, "./card-head": cardHead,
  "@/lib/research/pro-experience-sample-treasure": { treasureHuntSample, TREASURE_NOTE }, "@/lib/research/pro-experience-sample-whales": { whaleTracksSample, WHALE_NOTE } };
const TreasureSample = load("../app/research/pro-experience/samples/treasure-hunt.tsx", sampleStubs).default;
const WhaleSample = load("../app/research/pro-experience/samples/whale-tracks.tsx", sampleStubs).default;

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return { container, done: async () => { await act(async () => root.unmount()); container.remove(); } };
}
const click = async target => { await act(async () => { target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })); }); };
const text = el => el.textContent.replace(/\s+/g, " ");

test("Treasure Hunt sample: サンプル・PRO機能体験 on top, the switch works, the gold note in place of すべて見る, a stock stays in the sample", async () => {
  for (const lang of ["ja", "en"]) {
    const ja = lang === "ja";
    const ui = await mount(h(Frame, { feature: "treasure-hunt", lang }, h(TreasureSample, { lang })));
    const c = ui.container;
    assert.match(text(c), ja ? /^サンプル ?PRO機能体験 ?TREASURE HUNT/ : /^Sample ?PRO feature tour ?TREASURE HUNT/);
    assert.doesNotMatch(text(c), /2035\/03\/12/, "no frame time line");
    assert.equal(c.querySelector("h1").textContent, ja ? "トレジャーハント" : "Treasure Hunt");
    assert.equal(c.querySelectorAll("a[href]").length, 0, "no stock link inside the sample");
    const switchButtons = [...c.querySelectorAll('[role="group"] button')];
    assert.deepEqual(switchButtons.map(b => b.textContent), ja ? ["ハイテク", "全セクター"] : ["Tech", "All sectors"]);
    const tickers = () => [...c.querySelectorAll("[data-logo]")].map(el => el.getAttribute("data-logo"));
    assert.deepEqual(tickers(), ["QCOM", "MU", "AMAT", "ADBE", "INTC", "MRVL", "TXN"], "podium: 2nd, 1st, 3rd; then 4th to 7th");
    assert.match(text(c), ja ? /※実際は約150銘柄のランキングです ?2035年3月9日の終値で更新・PERとPSRは実績値・売上は前年比 ?提供：Twelve Data/
      : /\*The full ranking covers about 150 stocks ?As of Mar 9, 2035 close · Trailing P\/E and P\/S · Revenue growth YoY ?Data: Twelve Data/);
    assert.ok(![...c.querySelectorAll("button")].some(b => /すべて見る|See all/.test(b.textContent)));
    assert.match(text(c), /IN ?ARM ?27→37/);
    assert.match(text(c), /OUT ?CSCO ?33→28/);
    await click(c.querySelector("[aria-controls=treasure-hunt-about]"));
    assert.equal(c.querySelector("#treasure-hunt-about").textContent, valueLib.aboutText("trailing", ja), "the i text is the page's");
    await click(switchButtons[1]);
    assert.equal(switchButtons[1].getAttribute("aria-pressed"), "true");
    assert.deepEqual(tickers(), ["PFE", "MU", "QCOM", "AMAT", "MRK", "ADBE", "CVX"]);
    assert.match(text(c), ja ? /※実際は約500銘柄のランキングです/ : /about 500 stocks/);
    const before = navigations;
    await click(c.querySelector("[data-pro-only]"));
    assert.equal(navigations, before);
    assert.equal(c.querySelector('[role="status"]').textContent, ja ? "PROで使えます" : "Available with PRO");
    await ui.done();
  }
});

test("Whale Tracks sample: four tabs of five, every sort button reorders, the dated lines, and no way out of the sample", async () => {
  for (const lang of ["ja", "en"]) {
    const ja = lang === "ja";
    const ui = await mount(h(Frame, { feature: "whale-tracks", lang }, h(WhaleSample, { lang })));
    const c = ui.container;
    assert.match(text(c), ja ? /^サンプル ?PRO機能体験 ?WHALE TRACKS/ : /^Sample ?PRO feature tour ?WHALE TRACKS/);
    assert.equal(c.querySelector("h1").textContent, ja ? "クジラの足あと" : "Whale Tracks");
    const tabs = [...c.querySelectorAll('[role="tab"]')];
    assert.deepEqual(tabs.map(t => t.textContent), ja ? ["役員売買", "自社株買い", "空売り", "機関"] : ["Insider trades", "Buybacks", "Short interest", "Institutions"]);
    assert.deepEqual(tabs.map(t => t.getAttribute("aria-selected")), ["true", "false", "false", "false"], "insider trades open first (owner, Nov 26)");
    const order = () => [...c.querySelectorAll("[data-pro-only] [data-logo]")].map(el => el.getAttribute("data-logo"));
    const sorts = () => [...c.querySelectorAll('[role="tabpanel"] [role="group"] button')];
    const panel = () => text(c.querySelector('[role="tabpanel"]'));
    const expected = [
      [ja ? "Form 4・提出から2営業日以内" : "Form 4 · filed within 2 business days",
        [["MU", "AMD", "ORCL", "INTC", "NVDA"], ["MU", "INTC"], ["AMD", "ORCL", "NVDA"]]],
      [ja ? "10-Q・10-K・8-K（発表から自動で反映）" : "10-Q, 10-K, 8-K (added automatically when filed)",
        [["AAPL", "META", "NVDA", "QCOM", "AVGO"], ["AAPL", "META", "NVDA", "QCOM", "AVGO"]]],
      [ja ? "2035年2月28日時点・FINRA（月2回更新）" : "As of Feb 28, 2035 · FINRA (updated twice a month)",
        [["SMCI", "CRWV", "PLTR", "MU", "NVDA"], ["SMCI", "PLTR", "MU", "NVDA", "CRWV"], ["SMCI", "NVDA", "CRWV", "MU", "PLTR"]]],
      [ja ? "2034年12月末時点・13F（四半期ごとに更新）" : "As of end-Dec 2034 · 13F (updated quarterly)",
        [["NBIS", "NVDA", "MU", "MRVL", "ARM"], ["ARM", "MRVL", "MU", "NVDA", "NBIS"], ["MRVL", "MU", "NVDA", "NBIS", "ARM"]]],
    ];
    for (const [index, [line, orders]] of expected.entries()) {
      await click(tabs[index]);
      assert.equal(tabs[index].getAttribute("aria-selected"), "true");
      assert.ok(panel().startsWith(line), `${lang} ${index}: ${panel().slice(0, 60)}`);
      assert.equal(sorts().length, orders.length);
      for (let s = orders.length - 1; s >= 0; s--) {
        await click(sorts()[s]);
        assert.equal(sorts()[s].getAttribute("aria-pressed"), "true");
        assert.deepEqual(order(), orders[s], `${lang} tab ${index} sort ${s}`);
      }
    }
    await click(tabs[0]);
    assert.match(panel(), ja ? /AMD ?CFO・計画売買/ : /AMD ?CFO · Planned/);
    await click(tabs[1]);
    assert.match(panel(), ja ? /AAPL ?3\/9・新しい枠を発表 ?1,100億ドル/ : /AAPL ?Mar 9 · New authorization ?\$110B/);
    assert.match(panel(), ja ? /NVDA ?10〜12月・買い戻した金額 ?142億ドル/ : /NVDA ?Oct–Dec · Repurchased ?\$14B/);
    assert.equal(c.querySelectorAll("[class~=goldCard]").length, 2);
    assert.equal(c.querySelector("[class~=sampleNote]").textContent, ja ? "※実際は約150銘柄のデータを見られます" : "*The full version covers about 150 stocks");
    assert.equal(c.querySelectorAll("a[href]").length, 0);
    const before = navigations;
    await click(c.querySelector("[data-pro-only]"));
    assert.equal(navigations, before);
    assert.equal(c.querySelector('[role="status"]').textContent, ja ? "PROで使えます" : "Available with PRO");
    await ui.done();
  }
});

test("the PRO pages themselves are unchanged: stocks link to their pages, すべて見る, no sample mark", async () => {
  const ui = await mount(h(treasureScreen.ValueRanking, { data: treasureHuntSample, universe: "tech", ja: true }));
  assert.ok(ui.container.querySelectorAll('a[href^="/research/stocks?q="]').length >= valueLib.FIRST_ROWS);
  assert.equal(ui.container.querySelectorAll("[data-pro-only]").length, 0);
  assert.doesNotMatch(text(ui.container), /※実際は|2035年/);
  await ui.done();
  const frame = read("../app/research/pro-experience/samples/frame.tsx");
  assert.match(frame, /\{!CARD_HEAD_FEATURES\.includes\(feature\) && <div className=\{styles\.sampleHead\}>/);
});

test("Whale Tracks trial page: the gold note replaces the summary line under the sample; 約150 matches the ownership universe", async () => {
  assert.deepEqual(WHALE_NOTE, { ja: "※実際は約150銘柄のデータを見られます", en: "*The full version covers about 150 stocks" });
  const whale = proFeatures.find(f => f.id === "whale-tracks");
  assert.deepEqual(whale.textBeforeImage, { ja: "", en: "" });
  assert.deepEqual(whale.summary, { ja: "機関・空売り・自社株買いの裏側", en: "Funds, shorts & buybacks" }, "the list row keeps its summary");
  const { spawnSync } = await import("node:child_process");
  const out = spawnSync("python3", ["-c", "import ownership_data as o; print(len(o.universe()))"], { cwd: new URL("../scripts/research/", import.meta.url), encoding: "utf8" });
  const count = Number(out.stdout.trim());
  assert.ok(count >= 125 && count < 175, `about 150 stocks, got ${count}`);
  const css = read("../app/research/pro-experience/samples/samples.module.css");
  assert.match(css, /\.sampleNote\{[^}]*color:var\(--gold\)[^}]*font-size:14px/);
});

// Owner, Nov 26: the page took seconds (page, then the browser's membership check, then the API, then the monitor, one after the other).
test("Treasure Hunt opens with the day's ranking drawn by the server: no waiting for the browser's membership check, no request of its own", async () => {
  const unsettled = { ...shared, "../member-display-provider": { useMemberDisplay: () => null, useMemberSettled: () => false, useOwnerAccount: () => false } };
  const Screen = load("../app/research/treasure-hunt/screen.tsx", { ...unsettled, "@/lib/research/value-check": valueLib }).default;
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => { calls.push(String(args[0])); return new Response("{}", { status: 503 }); };
  try {
    const ui = await mount(h(Screen, { initial: treasureHuntSample }));
    assert.doesNotMatch(text(ui.container), /会員情報を確認中|データを読み込み中/);
    assert.deepEqual([...ui.container.querySelectorAll("[data-logo]")].map(el => el.getAttribute("data-logo")).slice(0, 3), ["QCOM", "MU", "AMAT"], "podium: 2nd, 1st, 3rd");
    assert.deepEqual(calls, [], "the screen does not ask the API when the server drew the ranking");
    await ui.done();
    // Without a ranking from the server (FREE, signed out, or the copy not ready in time), the screen waits for the check as before.
    const later = await mount(h(Screen, {}));
    assert.match(text(later.container), /会員情報を確認中/);
    await later.done();
  } finally { globalThis.fetch = realFetch; }
});

test("Treasure Hunt: one shared copy of the daily ranking (stale-while-revalidate), read only after the server confirms the member", () => {
  const server = read("../lib/research/value-check-server.ts");
  assert.match(server, /^import "server-only";/);
  assert.match(server, /unstable_cache\(readShared, \["value-check-snapshot-v3"\], \{ revalidate: VALUE_SNAPSHOT_REVALIDATE_SECONDS \}\)/);
  assert.match(server, /readShared\.toString = \(\) => "value-check-snapshot-v3"/, "a fixed key keeps the copy across deployments");
  assert.match(server, /VALUE_SNAPSHOT_REVALIDATE_SECONDS = 600;/);
  const route = read("../app/api/research/value-check/route.ts");
  assert.match(route, /if \(access !== 200\) return fail[^\n]*\n\s*return Response\.json\(await loadValueRanking\(\), \{ headers \}\);/);
  assert.doesNotMatch(route, /fetch\(|RESEARCH_MONITOR/, "no per-request read of the monitor");
  assert.match(route, /"Cache-Control": "private, no-store"/, "PRO data is never kept by a shared cache in front of the site");
  const page = read("../app/research/treasure-hunt/page.tsx");
  assert.match(page, /if \(member && valueCheckAccess\(member, valueCheckEnabled\(\)\) === 200\) \{\n\s*const ready = loadValueRanking\(\)/, "PRO data only for a member the server confirmed");
  // The comparison's list (values) stays out of Treasure Hunt's own payload.
  assert.match(server, /const \{ values, \.\.\.ranking \} = await loadRanking\(\);/);
  assert.doesNotMatch(server.slice(server.indexOf("export async function loadValueRanking")), /^[^\n]*sharedValues/m, "the ranking never waits on the comparison's list");
  assert.match(page, /notFound\(\)/);
  assert.match(page, /<TreasureHuntScreen initial=\{initial\} \/>/);
  // The owner's accounts always get it (AGENTS.md, operator access), with the switch off too.
  for (const owner of [{ ownerAccount: true }, { ownerMode: true }]) assert.equal(valueLib.valueCheckAccess({ status: "signed-in", plan: "free", ...owner }, false), 200);
  for (const member of [{ status: "signed-out", plan: "free" }, { status: "signed-in", plan: "free" }]) assert.notEqual(valueLib.valueCheckAccess(member, true), 200);
});
