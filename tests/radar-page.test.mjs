import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const screen = read("../app/research/radar/screen.tsx") + read("../app/research/radar/chart.tsx");

test("the page carries the owner's wording", () => {
  for (const text of ["FINANCIAL RADAR", "財務レーダー", "稼ぐ力と守る力を、ジャンルごとに1枚で見比べます。点線は前の決算からの動きです。",
    "↑ 守る力 ｜ 現金÷(借入+リース)", "稼ぐ力 ｜ 売上に対するフリーキャッシュフロー →", "売上が前年より増加", "減少", "大きさ=売上規模", "点線=前の決算から",
    "体力ランキング", "最新の決算 ・", "データが足りない銘柄 ・", "PRO限定", "稼ぐ力", "守る力",
    "数字は米SECの開示資料から計算しています。範囲を超える値はグラフの端に表示します。売買をすすめるものではありません。"]) assert.ok(screen.includes(text), text);
  for (const text of ["盤石", "借入で攻める", "守りで耐える", "余力が小さい"]) assert.ok(read("../lib/research/radar.ts").includes(text), text);
  for (const tab of ["AIクラウド", "半導体", "通信・光", "ソフトウェア", "電力・設備"]) assert.ok(read("../lib/research/radar.ts").includes(tab), tab);
});

test("FREE sees the chart only: the locked block says 鍵 and PRO限定 and nothing else; trails and taps are PRO-only", () => {
  assert.match(screen, /<section className=\{styles\.locked\} aria-label="PRO限定">\s*<svg[^>]*>.*<\/svg>\s*<span>PRO限定<\/span>\s*<\/section>/s);
  assert.match(screen, /onSelect=\{pro \? setSelected : undefined\}/);
  assert.match(screen, /\{pro && <li><b aria-hidden="true">┈<\/b>点線=前の決算から<\/li>\}/);
  assert.match(screen, /isPro\(dot\) && dot\.previous/);
});

test("the server decides PRO and a FREE caller is sent the dots only", () => {
  const route = read("../app/api/research/radar/route.ts");
  assert.match(route, /comparisonAccess\(member\) === 200 \? "pro" : "free"/);
  assert.match(route, /buildRadar\(genre\.id, entries, finalTier\)/);
  assert.ok(!/health/.test(route));
});

test("the menu lists 財務レーダー under Research, after 資本マップ, and not in the PRO tiles", () => {
  const header = read("../app/research/site-header.tsx");
  const map = header.indexOf('"/research/capital-map"'), radar = header.indexOf('"/research/radar"'), targets = header.indexOf('"/research/price-targets"');
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
