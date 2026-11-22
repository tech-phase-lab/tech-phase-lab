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
import { treasureHuntSample } from "../lib/research/pro-experience-sample-treasure.ts";
import { whaleTracksSample } from "../lib/research/pro-experience-sample-whales.ts";
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
  assert.match(read("../app/api/research/value-check/route.ts"), /\/value-check`/);
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

test("samples: one fixed day and one fixed moment on the tour's 2035 timeline, by the real rules", () => {
  assert.deepEqual(proFeatures.map(f => f.id).slice(0, 5), ["relation-map", "theme-ranking", "treasure-hunt", "whale-tracks", "compare"]);
  assert.equal(samplesLib.hasSample("treasure-hunt"), true);
  assert.equal(samplesLib.hasSample("whale-tracks"), true);
  const t = treasureHuntSample;
  assert.equal(t.asOf, samplesLib.SAMPLE_CLOSE_DAY);
  for (const universe of ["tech", "all"]) {
    const list = t.universes[universe];
    assert.ok(list.items.length > valueLib.FIRST_ROWS, `${universe}: すべて見る opens more rows`);
    // IN / OUT: crossing 30 (value_check.py changes); the IN mark sits on exactly those rows.
    const ins = list.items.filter(i => i.previous !== null && i.previous < valueLib.CHEAP_FROM && i.score >= valueLib.CHEAP_FROM).map(i => i.ticker).sort();
    const outs = list.items.filter(i => i.previous !== null && i.score < valueLib.CHEAP_FROM && i.previous >= valueLib.CHEAP_FROM).map(i => i.ticker).sort();
    assert.deepEqual(list.changes.in.map(c => c.ticker).sort(), ins, universe);
    assert.deepEqual(list.changes.out.map(c => c.ticker).sort(), outs, universe);
    assert.deepEqual(list.items.filter(i => i.in).map(i => i.ticker).sort(), ins, universe);
    assert.ok(ins.length && outs.length, `${universe}: the band shows both`);
  }
  const w = whaleTracksSample;
  for (const key of ["institutional", "short", "insiders", "buybacks"]) assert.ok(w[key].length >= 5, key);
  for (const day of [w.institutionalAsOf, w.shortAsOf, ...w.insiders.map(r => r.date), ...w.buybacks.map(r => r.date)]) assert.match(day, /^203[45]-/);
  assert.ok(w.insiders.some(r => r.side === "buy") && w.insiders.some(r => r.side === "sell"));
  assert.ok(w.buybacks.some(r => r.kind === "authorization") && w.buybacks.some(r => r.kind === "quarter"));
  for (const name of ["treasure-hunt.json", "whale-tracks.json"]) {
    const file = JSON.parse(read(`../lib/research/pro-experience-samples/${name}`));
    assert.equal(file.fictional, true, name);
    assert.match(file._source, /fictional/, name);
  }
  // Each sample says it is not real data, and the copy carries no advice words.
  for (const name of ["treasure-hunt.tsx", "whale-tracks.tsx"]) {
    const source = read(`../app/research/pro-experience/samples/${name}`);
    assert.match(source, /サンプルの数値です。実際のデータではありません。/);
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
const sampleStubs = { "../../stock-row-link": rowLink, "../../treasure-hunt/screen": treasureScreen, "../../whales/screen": whaleScreen,
  "@/lib/research/pro-experience-sample-treasure": { treasureHuntSample }, "@/lib/research/pro-experience-sample-whales": { whaleTracksSample } };
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

test("Treasure Hunt sample: サンプル and the 2035 time on top, the switch and すべて見る work, a stock stays in the sample", async () => {
  for (const lang of ["ja", "en"]) {
    const ui = await mount(h(Frame, { feature: "treasure-hunt", lang }, h(TreasureSample, { lang })));
    const c = ui.container;
    assert.match(text(c), lang === "ja" ? /サンプル.*2035\/03\/12 09:00 時点/ : /Sample.*As of 2035\/03\/12 09:00/);
    assert.match(text(c), /TREASURE HUNT/);
    assert.equal(c.querySelector("h1").textContent, lang === "ja" ? "トレジャーハント" : "Treasure Hunt");
    assert.equal(c.querySelectorAll("a[href]").length, 0, "no stock link inside the sample");
    const switchButtons = [...c.querySelectorAll('[role="group"] button')];
    assert.deepEqual(switchButtons.map(b => b.textContent), lang === "ja" ? ["ハイテク", "全セクター"] : ["Tech", "All sectors"]);
    const tickers = () => [...c.querySelectorAll("[data-logo]")].map(el => el.getAttribute("data-logo"));
    assert.deepEqual(tickers().slice(0, 3), ["QCOM", "MU", "AMAT"], "podium: 2nd, 1st, 3rd");
    assert.equal(tickers().length, valueLib.FIRST_ROWS);
    assert.match(text(c), lang === "ja" ? /3\/9の終値で更新/ : /As of Mar 9 close/);
    await click([...c.querySelectorAll("button")].find(b => /すべて見る|See all/.test(b.textContent)));
    assert.equal(tickers().length, treasureHuntSample.universes.tech.items.length);
    await click(switchButtons[1]);
    assert.equal(switchButtons[1].getAttribute("aria-pressed"), "true");
    assert.equal(tickers().length, valueLib.FIRST_ROWS, "すべて見る closes again on the other universe");
    assert.ok(tickers().includes("PFE"));
    const before = navigations;
    await click(c.querySelector("[data-pro-only]"));
    assert.equal(navigations, before);
    assert.equal(c.querySelector('[role="status"]').textContent, lang === "ja" ? "PROで使えます" : "Available with PRO");
    await ui.done();
  }
});

test("Whale Tracks sample: all four tabs, their sort buttons, and no way out of the sample", async () => {
  const ui = await mount(h(Frame, { feature: "whale-tracks", lang: "en" }, h(WhaleSample, { lang: "en" })));
  const c = ui.container;
  assert.match(text(c), /WHALE TRACKS/);
  assert.equal(c.querySelector("h1").textContent, "Whale Tracks");
  const tabs = [...c.querySelectorAll('[role="tab"]')];
  assert.deepEqual(tabs.map(t => t.textContent), ["Institutions", "Short interest", "Insider trades", "Buybacks"]);
  const firstTicker = () => c.querySelector("[data-pro-only] [data-logo]").getAttribute("data-logo");
  const sorts = () => [...c.querySelectorAll('[role="tabpanel"] [role="group"] button')];
  assert.equal(firstTicker(), "SMCI", "Biggest rise first");
  await click(sorts()[1]);
  assert.equal(firstTicker(), "INTC", "Biggest fall");
  for (const [index, expected] of [[1, "SMCI"], [2, "NVDA"], [3, "AVGO"]]) {
    await click(tabs[index]);
    assert.equal(tabs[index].getAttribute("aria-selected"), "true");
    assert.equal(firstTicker(), expected, tabs[index].textContent);
  }
  await click(sorts()[1]);
  assert.equal(firstTicker(), "NVDA", "Largest buyback first");
  await click(tabs[2]);
  await click(sorts()[1]);
  assert.deepEqual([...new Set([...c.querySelectorAll("[data-pro-only] [data-logo]")].map(el => el.getAttribute("data-logo")))], ["MU", "INTC", "AMAT"], "Purchases only");
  await click(tabs[0]);
  assert.equal(firstTicker(), "INTC", "each tab keeps its own sort");
  assert.equal(c.querySelectorAll("a[href]").length, 0);
  const before = navigations;
  await click(c.querySelector("[data-pro-only]"));
  assert.equal(navigations, before);
  assert.equal(c.querySelector('[role="status"]').textContent, "Available with PRO");
  await ui.done();
});

test("the PRO page itself still links each stock to its page (sample mode is only inside the tour)", async () => {
  const ui = await mount(h(treasureScreen.ValueRanking, { data: treasureHuntSample, universe: "tech", ja: true }));
  assert.ok(ui.container.querySelectorAll('a[href^="/research/stocks?q="]').length >= valueLib.FIRST_ROWS);
  assert.equal(ui.container.querySelectorAll("[data-pro-only]").length, 0);
  await ui.done();
});
