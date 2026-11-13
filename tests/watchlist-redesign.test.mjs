import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, mocks) {
  const compiled = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(id => id in mocks ? mocks[id] : id.endsWith(".css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : require(id), mod, mod.exports);
  return mod.exports;
}
const nodes = tree => tree && typeof tree === "object" ? [tree, ...[].concat(tree.props?.children ?? []).flat(Infinity).flatMap(nodes)] : [];

test("the row chart: 84×52, dotted previous close, mint above / red below, fade from the left, dot with halo and ring, high and low", () => {
  const { default: AreaChart } = load("app/research/watchlist/area-chart.tsx", { react: { useId: () => ":r1:" } });
  const tree = AreaChart({ values: [100, 101.5, 99.2, 102.25], reference: 100.5, label: "MU" });
  const all = nodes(tree);
  assert.equal(tree.props.width, 84); assert.equal(tree.props.height, 52);
  const dotted = all.find(n => n.type === "line");
  assert.equal(dotted.props.strokeDasharray, "1.5 3");
  const fills = all.filter(n => n.type === "path" && n.props.fillOpacity === "0.16").map(n => n.props.fill);
  assert.deepEqual(fills, ["#5fe0aa", "#ff7a7a"]);
  const strokes = all.filter(n => n.type === "path" && n.props.fill === "none").map(n => n.props.stroke);
  assert.deepEqual(strokes, ["#5fe0aa", "#ff7a7a"]);
  const stops = all.filter(n => n.type === "stop").map(n => n.props.stopOpacity);
  assert.equal(stops[0], "0.12"); assert.equal(stops.at(-1), "1");
  const circles = all.filter(n => n.type === "circle");
  assert.deepEqual(circles.map(n => n.props.r), ["7", "2.6", "2.6"]);
  assert.equal(circles[0].props.fillOpacity, "0.18");
  assert.equal(circles[0].props.fill, "#5fe0aa"); // the last value is above the previous close
  assert.deepEqual(all.filter(n => n.type === "text").map(n => n.props.children), ["102.25", "99.20"]);
  assert.equal(all.filter(n => n.type === "line").length, 1, "no vertical drop line from the dot");
  assert.doesNotMatch(read("app/research/watchlist/area-chart.tsx"), /scale/);
  const below = AreaChart({ values: [100, 98], reference: 100, label: "x" });
  assert.equal(nodes(below).find(n => n.type === "circle").props.fill, "#ff7a7a");
  assert.equal(AreaChart({ values: [100], reference: 100, label: "x" }), null);
});

test("the ring and the price glow stop under reduced motion; a changed price fades back in about 1.3 seconds", () => {
  assert.match(read("app/research/watchlist/area-chart.module.css"), /animation:pulse 2s ease-out infinite/);
  assert.match(read("app/research/watchlist/area-chart.module.css"), /prefers-reduced-motion: reduce\) \{ \.ring \{ animation:none/);
  const flash = read("app/research/price/flash-value.module.css");
  assert.match(flash, /1\.3s/); assert.match(flash, /#5fe0aa/); assert.match(flash, /#ff7a7a/);
  assert.match(flash, /prefers-reduced-motion: reduce\) \{ \.up, \.down \{ animation: none/);
});

test("the watchlist screen follows the Nov 13 design", () => {
  const source = read("app/research/watchlist/watchlist.tsx");
  assert.match(source, /<p className=\{styles\.eyebrow\}>WATCHLIST<\/p>/);
  assert.match(source, /const LIST_NAME_LIMIT = 9;/);
  assert.match(source, /maxLength=\{LIST_NAME_LIMIT\}/);
  assert.match(source, /\{nameLength\}\/\{LIST_NAME_LIMIT\}/);
  assert.doesNotMatch(source, /ListWheel|<select|tableHead|quoteTimeText|signed\(quote\.change\)/);
  for (const label of ["追加した順", "ティッカー順", "上昇率順", "下落率順", "自動", "取引中", "プレ", "前日比", "時間外", "現在"]) assert.match(source, new RegExp(label));
  assert.match(source, /<CurrentTime \/> JST/);
  assert.match(source, /<FlashValue scope=/);
  const css = read("app/research/watchlist/watchlist.module.css");
  assert.match(css, /\.eyebrow \{ margin:0;font-size:11px;font-weight:600;letter-spacing:\.16em;[^}]*color:#8e9aaa;/);
  assert.match(css, /\.heading h1 \{ margin:0;font-size:26px;font-weight:700;/);
  assert.match(css, /\.listButton \{[^}]*height:32px;[^}]*border:1px solid #2a3646;[^}]*background:#121a24;[^}]*font-size:12px;font-weight:700;/);
  assert.match(css, /\.rowMain \{[^}]*height:68px;/);
  assert.match(css, /\.priceValue \{ font-size:20px;font-weight:700;/);
  assert.match(css, /\.rate \{[^}]*font-size:12\.5px;/);
  assert.doesNotMatch(css.match(/\.rate[^{]*\{[^}]*\}/g).join(""), /background/);
  assert.match(css, /\.sessionTag \{[^}]*border:1px solid #3f6b5d;[^}]*font-size:9\.5px;/);
});
