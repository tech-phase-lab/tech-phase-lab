// PRO feature tour, RIZEL'S DESK sample (owner's spec, Nov 17): three tabs, the notification banner and the new note, reactions, the ask flow
// with its timings, and a sample weekly issue; all local, nothing sent anywhere. Mounted in JSDOM with fake timers.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://example.test" });
for (const key of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "MutationObserver", "getComputedStyle"])
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "getComputedStyle" ? dom.window[key].bind(dom.window) : dom.window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const root = fileURLToPath(new URL("..", import.meta.url));
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
let loaded;
async function load() {
  if (loaded) return loaded;
  const dir = await mkdtemp(new URL("../.desk-sample-", import.meta.url));
  try {
    const outfile = `${dir}/sample.mjs`;
    await build({
      stdin: { contents: `export { default as Frame } from "./app/research/pro-experience/samples/frame.tsx";
export { default as Desk, toggleReaction, BANNER_DELAY_MS, BANNER_SHOW_MS, TYPE_MS, ANSWERING_MS, ANSWER_MS } from "./app/research/pro-experience/samples/rizels-desk.tsx";`, resolveDir: root, loader: "ts" },
      bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic", outfile, tsconfig: `${root}/tsconfig.json`,
      plugins: [{ name: "stubs", setup(b) {
        b.onResolve({ filter: /^react$/, namespace: "stub" }, () => ({ path: "react", external: true }));
        // Next's image and link, and the weekly page's shell around IssueView, are replaced with plain stand-ins.
        b.onResolve({ filter: /^next\/(image|link|navigation)$|\/(research-tool-shell|use-research-language|member-display-provider|identity-provider)$/ }, args => ({ path: args.path, namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ loader: "js", contents: args.path === "next/image"
          ? "import React from 'react';export default function Image(p){return React.createElement('img',{src:p.src,alt:p.alt})}"
          : args.path === "next/link" ? "import React from 'react';export default function Link(p){return React.createElement('a',{href:p.href},p.children)}"
          : "const none=()=>null;export default none;export const useRouter=()=>({}),usePathname=()=>'/',useResearchLanguage=()=>['ja',()=>{}],useOwnerMode=()=>false,useMemberSettled=()=>true,useIdentityRefresh=()=>async()=>{};" }));
        b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default new Proxy({}, {get: (_, key) => key})", loader: "js" }));
      } }],
    });
    loaded = await import(pathToFileURL(outfile).href);
    return loaded;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Every way out to the network is recorded: the sample must not use any. */
const network = [];
globalThis.fetch = async (...args) => { network.push(["fetch", String(args[0])]); throw new Error("no network in the sample"); };
dom.window.fetch = globalThis.fetch;
globalThis.XMLHttpRequest = dom.window.XMLHttpRequest = class { open(...args) { network.push(["xhr", String(args[1])]); } send() {} setRequestHeader() {} };
dom.window.navigator.sendBeacon = (...args) => { network.push(["beacon", String(args[0])]); return true; };

async function mount(lang = "ja", { reduced = false } = {}) {
  const { Frame, Desk } = await load();
  dom.window.matchMedia = query => ({ matches: reduced && /reduce/.test(query), media: query, addEventListener() {}, removeEventListener() {} });
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-11-17T00:00:00Z") });
  const host = document.createElement("div"); document.body.append(host);
  const reactRoot = createRoot(host);
  await act(async () => { reactRoot.render(React.createElement(Frame, { feature: "rizels-desk", lang }, React.createElement(Desk, { lang }))); });
  const tick = async ms => { await act(async () => { mock.timers.tick(ms); }); };
  const click = async element => { assert.ok(element, "element to click"); await act(async () => { element.click(); }); };
  const q = selector => host.querySelector(selector), all = selector => [...host.querySelectorAll(selector)];
  return { host, q, all, tick, click, async unmount() { await act(async () => reactRoot.unmount()); host.remove(); mock.timers.reset(); } };
}
const tabs = ui => ui.all('[role="tab"]');
const selectedTab = ui => tabs(ui).find(tab => tab.getAttribute("aria-selected") === "true")?.textContent;
const hint = ui => ui.q(".sampleHint").textContent;
const toast = ui => ui.q(".notice")?.textContent ?? null;
const noteIds = ui => ui.all("[data-note]").map(note => note.getAttribute("data-note"));
const badge = (ui, id) => ui.all(`[data-note="${id}"] .badgeItem`).map(item => `${item.textContent}${item.hasAttribute("data-mine") ? "*" : ""}`);
const tabNamed = (ui, name) => tabs(ui).find(tab => tab.textContent === name);

test("desk sample: ひとりごと first; the list opens as it is, the banner comes down after 5 s, the new note goes in on top 1 s later, the banner goes up 3 s after it came", async () => {
  const ui = await mount("ja");
  try {
    assert.deepEqual(tabs(ui).map(tab => tab.textContent), ["ひとりごと", "リゼルに聞く", "週刊PRO"]);
    assert.equal(selectedTab(ui), "ひとりごと");
    assert.equal(hint(ui), "☺を押して、リアクションしてみましょう");
    assert.equal(ui.q(".banner"), null);
    assert.deepEqual(noteIds(ui), ["sample-note-n2", "sample-note-n3"], "the new note is not there yet");
    await ui.tick(4999);
    assert.equal(ui.q(".banner"), null, "not before 5 s (owner, Nov 27: no notice the moment the page opens)");
    assert.deepEqual(noteIds(ui), ["sample-note-n2", "sample-note-n3"]);
    await ui.tick(1);
    const banner = ui.q(".banner");
    assert.ok(banner, "the banner after 5 s");
    assert.equal(banner.getAttribute("data-state"), "in");
    assert.match(banner.textContent, /リゼルのひとりごと.*新しいひとりごとが届きました/);
    assert.deepEqual(noteIds(ui), ["sample-note-n2", "sample-note-n3"], "the note is not added together with the banner");
    await ui.tick(999);
    assert.deepEqual(noteIds(ui), ["sample-note-n2", "sample-note-n3"]);
    await ui.tick(1);
    assert.deepEqual(noteIds(ui), ["sample-note-n1", "sample-note-n2", "sample-note-n3"], "N1 on top, 1 s after the banner");
    assert.equal(ui.all(".newTag").length, 0, "no NEW tag (owner, 11/26)");
    assert.equal(ui.all("[data-fresh]").length, 1, "only N1 is marked fresh");
    assert.ok(ui.q('[data-note="sample-note-n1"]').hasAttribute("data-fresh"));
    assert.ok(ui.q('[data-note="sample-note-n1"]').closest(".arrive").hasAttribute("data-entering"), "N1 comes in with the entrance animation");
    assert.equal(ui.all("[data-entering]").length, 1);
    await ui.tick(600);
    assert.equal(ui.all("[data-entering]").length, 0, "the entrance plays once and its mark is taken off");
    await ui.click(tabNamed(ui, "リゼルに聞く"));
    await ui.click(tabNamed(ui, "ひとりごと"));
    assert.equal(ui.all("[data-entering]").length, 0, "coming back to the notes does not play it again");
    assert.deepEqual(noteIds(ui), ["sample-note-n1", "sample-note-n2", "sample-note-n3"]);
    await ui.tick(1399);
    const dates = ui.all("[data-note] time").map(time => time.textContent);
    assert.deepEqual(dates, ["2035/03/12 08:52", "2035/03/11 22:15", "2035/03/10 06:32"]);
    assert.deepEqual(ui.all("[data-note] .zone").map(zone => zone.textContent.trim()), ["JST", "JST", "JST"]);
    assert.equal(ui.q(".banner").getAttribute("data-state"), "in", "still there before 3 s");
    await ui.tick(1);
    assert.equal(ui.q(".banner").getAttribute("data-state"), "out", "goes up after 3 s");
    await ui.tick(400);
    assert.equal(ui.q(".banner"), null);
    assert.ok(ui.q('[data-note="sample-note-n1"]').hasAttribute("data-fresh"), "N1 stays fresh (the sample's time is fixed)");
    assert.doesNotMatch(ui.q('[data-note="sample-note-n1"]').textContent, /NEW/);
  } finally { await ui.unmount(); }
});

test("desk sample: a tap on the banner closes it at once", async () => {
  const ui = await mount("ja");
  try {
    await ui.tick(5000);
    await ui.click(ui.q(".banner"));
    assert.equal(ui.q(".banner").getAttribute("data-state"), "out");
    await ui.tick(400);
    assert.equal(ui.q(".banner"), null);
    await ui.tick(5000);
    assert.equal(ui.q(".banner"), null, "it does not come back");
  } finally { await ui.unmount(); }
});

test("desk sample: the notes' text keeps the real markup (red, marker, bold) through the real DeskBody", async () => {
  const ui = await mount("ja");
  try {
    await ui.tick(5000); await ui.tick(1000);
    const n2 = ui.q('[data-note="sample-note-n2"]');
    assert.deepEqual([...n2.querySelectorAll(".red")].map(span => span.textContent), ["・次の四半期の見通し", "・それを聞いた後の時間外の反応"]);
    assert.equal(n2.querySelectorAll(".red strong").length, 2, "red and bold");
    assert.equal(ui.q('[data-note="sample-note-n3"] mark.highlight').textContent, "出来高");
    assert.doesNotMatch(ui.host.textContent, /\[red\]|\[\/red\]|==|\*\*/);
    assert.deepEqual(badge(ui, "sample-note-n1"), ["👍12", "🔥4"]);
    assert.deepEqual(badge(ui, "sample-note-n2"), ["👍27", "😊8"]);
    assert.deepEqual(badge(ui, "sample-note-n3"), ["👍19"]);
  } finally { await ui.unmount(); }
});

test("desk sample: ☺ opens the five real emoji; choosing one adds it (+1, gold border, toast 1.8 s); choosing it again takes it back", async () => {
  const ui = await mount("ja");
  try {
    await ui.tick(5000); await ui.tick(1000);
    const face = () => ui.q('[data-note="sample-note-n1"] .faceButton');
    const choice = label => ui.all('[data-note="sample-note-n1"] .reactionChoice').find(button => button.getAttribute("aria-label").startsWith(label));
    await ui.click(face());
    assert.deepEqual(ui.all('[data-note="sample-note-n1"] .reactionChoice').map(button => button.textContent), ["👍", "😊", "😢", "😠", "🔥"]);
    await ui.click(choice("いいね"));
    assert.equal(ui.q('[data-note="sample-note-n1"] .reactionPopover'), null, "choosing closes the popover");
    assert.deepEqual(badge(ui, "sample-note-n1"), ["👍13*", "🔥4"], "+1 and mine (gold border)");
    assert.equal(toast(ui), "リアクションしました");
    await ui.tick(1799);
    assert.equal(toast(ui), "リアクションしました");
    await ui.tick(1);
    assert.equal(toast(ui), null, "the toast goes after 1.8 s");
    await ui.click(face());
    assert.equal(choice("いいね").getAttribute("aria-pressed"), "true");
    await ui.click(choice("炎"));
    assert.deepEqual(badge(ui, "sample-note-n1"), ["👍12", "🔥5*"], "one reaction per note: the new one replaces mine");
    await ui.tick(1800);
    await ui.click(face());
    await ui.click(choice("炎"));
    assert.deepEqual(badge(ui, "sample-note-n1"), ["👍12", "🔥4"], "tapping my own again takes it back");
    assert.equal(toast(ui), null, "no toast for taking it back");
    await ui.click(ui.q('[data-note="sample-note-n3"] .faceButton'));
    await ui.click(ui.all('[data-note="sample-note-n3"] .reactionChoice').find(button => button.getAttribute("aria-label") === "悲しい"));
    assert.deepEqual(badge(ui, "sample-note-n3"), ["👍19", "😢1*"], "a new emoji appears in the badge");
    // The reactions stay while switching tabs (they are reset only by opening the page again).
    await ui.click(tabNamed(ui, "リゼルに聞く"));
    await ui.click(tabNamed(ui, "ひとりごと"));
    assert.deepEqual(badge(ui, "sample-note-n3"), ["👍19", "😢1*"]);
  } finally { await ui.unmount(); }
});

test("desk sample: the tabs switch, and the line under the sample follows the tab", async () => {
  const ui = await mount("ja");
  try {
    await ui.click(tabNamed(ui, "リゼルに聞く"));
    assert.equal(selectedTab(ui), "リゼルに聞く");
    assert.equal(hint(ui), "質問を送ると、リゼルの回答が届きます");
    assert.equal(ui.q("[data-note]"), null);
    await ui.click(tabNamed(ui, "週刊PRO"));
    assert.equal(selectedTab(ui), "週刊PRO");
    assert.equal(hint(ui), "週刊PROのサンプル号を読めます");
    await ui.click(tabNamed(ui, "ひとりごと"));
    assert.equal(hint(ui), "☺を押して、リアクションしてみましょう");
  } finally { await ui.unmount(); }
});

test("desk sample: Ask Rizel — example, typed in about 1.2 s, send glows, 回答待ち, 「リゼルが回答中…」 after 1.5 s, the answer 2 s later", async () => {
  const ui = await mount("ja");
  try {
    await ui.click(tabNamed(ui, "リゼルに聞く"));
    const cards = () => ui.all("[data-question]").map(card => `${card.getAttribute("data-question")}:${card.getAttribute("data-state")}`);
    assert.deepEqual(cards(), ["sample-q2:answered", "sample-q1:answered"], "Q2 and Q1 are answered from the start");
    const q2 = ui.q('[data-question="sample-q2"]');
    assert.equal(q2.querySelector("header time").textContent, "2035/03/11 21:10");
    assert.match(q2.textContent, /✓?回答済み/);
    assert.equal(q2.querySelector(".answer header time").textContent, "03/11 21:42");
    assert.match(q2.querySelector(".answer p").textContent, /^株価が見ているのは、今回の数字より次の見通しなんですよね。\n\n確認するのはこの3つです。\n・会社が出した次の四半期の見通し/);
    assert.equal(ui.q('[data-question="sample-q1"] .answer header time').textContent, "03/10 20:11");
    const example = ui.q(".example");
    assert.equal(example.querySelector("small").textContent, "タップして質問してみる");
    assert.equal(example.querySelector("span").textContent, "持っている銘柄が増えすぎて、管理が大変です。おすすめは何銘柄でしょうか？");
    await ui.click(example);
    const input = () => ui.q("[data-typed]");
    const send = () => ui.q(".send");
    assert.equal(input().getAttribute("aria-readonly"), "true", "nothing to type by hand");
    assert.ok(input().textContent.length < 3, "typing starts");
    assert.equal(send().disabled, true);
    assert.ok(ui.q(".list").hasAttribute("data-dim"), "the list is dimmed while composing");
    await ui.tick(600);
    const half = input().textContent.length;
    assert.ok(half > 10 && half < 30, `about half typed at 0.6 s (${half})`);
    await ui.tick(700);
    assert.equal(input().textContent, "持っている銘柄が増えすぎて、管理が大変です。\nおすすめは何銘柄でしょうか？");
    assert.equal(send().disabled, false);
    assert.ok(send().hasAttribute("data-ready"), "send glows");
    assert.equal(send().textContent, "送信");
    await ui.click(send());
    assert.deepEqual(cards(), ["sample-q3:waiting", "sample-q2:answered", "sample-q1:answered"], "the question goes on top");
    const q3 = () => ui.q('[data-question="sample-q3"]');
    assert.equal(q3().querySelector("header time").textContent, "2035/03/12 09:00");
    assert.equal(q3().querySelector(".tagWait").textContent, "回答待ち");
    assert.equal(ui.q("[data-typed]"), null);
    assert.ok(ui.q(".askDone").disabled);
    assert.match(ui.q(".askDone").textContent, /リゼルに質問する.*今日は終わりました/);
    await ui.tick(1499);
    assert.equal(q3().getAttribute("data-state"), "waiting");
    await ui.tick(1);
    assert.equal(q3().getAttribute("data-state"), "answering");
    assert.equal(q3().querySelector(".answering").textContent, "リゼルが回答中…");
    assert.equal(q3().querySelectorAll(".dots i").length, 3);
    await ui.tick(1999);
    assert.equal(q3().getAttribute("data-state"), "answering");
    assert.equal(toast(ui), null);
    await ui.tick(1);
    assert.equal(q3().getAttribute("data-state"), "answered");
    assert.match(q3().querySelector("header").textContent, /回答済み/);
    assert.equal(q3().querySelector(".answer header time").textContent, "03/12 09:03");
    assert.equal(q3().querySelector(".answer p").textContent, "決算のたびに中身を確認できる数までにしています。\n追えていない銘柄は、持っている理由を説明できるかで整理するといいですよ！");
    assert.ok(q3().querySelector(".answer").hasAttribute("data-reveal"), "shown from the top down");
    assert.equal(toast(ui), "リゼルから回答が届きました");
    await ui.tick(1800);
    assert.equal(toast(ui), null);
    assert.match(ui.q(".askDone").textContent, /今日は終わりました/, "still one question a day");
  } finally { await ui.unmount(); }
});

test("desk sample: the flow keeps running while another tab is open", async () => {
  const ui = await mount("ja");
  try {
    await ui.click(tabNamed(ui, "リゼルに聞く"));
    await ui.click(ui.q(".example"));
    await ui.tick(1300);
    await ui.click(ui.q(".send"));
    await ui.click(tabNamed(ui, "ひとりごと"));
    await ui.tick(1500);
    await ui.tick(2000);
    await ui.click(tabNamed(ui, "リゼルに聞く"));
    assert.equal(ui.q('[data-question="sample-q3"]').getAttribute("data-state"), "answered");
  } finally { await ui.unmount(); }
});

test("desk sample: English texts and dates as in the spec", async () => {
  const ui = await mount("en");
  try {
    assert.deepEqual(tabs(ui).map(tab => tab.textContent), ["Notes", "Ask Rizel", "Weekly"]);
    assert.equal(hint(ui), "Tap ☺ to react to a note");
    await ui.tick(5000); await ui.tick(1000);
    assert.match(ui.q(".banner").textContent, /RIZEL's Notes.*A new note just arrived/);
    assert.deepEqual(ui.all("[data-note] time").map(time => time.textContent), ["Mar 12, 2035 at 08:52", "Mar 11, 2035 at 22:15", "Mar 10, 2035 at 06:32"]);
    assert.match(ui.q('[data-note="sample-note-n1"]').textContent, /It's a day when semiconductors all drop together\. Before selling, I want to at least check which company and what caused it\./);
    assert.deepEqual(ui.all('[data-note="sample-note-n2"] .red').map(span => span.textContent), ["• The outlook for the next quarter", "• How the stock reacts after-hours once that outlook is announced"]);
    assert.equal(ui.q('[data-note="sample-note-n3"] mark.highlight').textContent, "volume");
    await ui.click(ui.q('[data-note="sample-note-n1"] .faceButton'));
    await ui.click(ui.all(".reactionChoice").find(button => button.getAttribute("aria-label").startsWith("Fire")));
    assert.equal(toast(ui), "Reaction sent");
    await ui.click(tabNamed(ui, "Ask Rizel"));
    assert.equal(hint(ui), "Send a question and get Rizel's answer");
    assert.equal(ui.q(".example small").textContent, "Tap to try asking");
    assert.match(ui.q('[data-question="sample-q2"]').textContent, /The earnings were good, but the stock price dropped significantly… I don't understand what's happening 😭/);
    await ui.click(ui.q(".example"));
    await ui.tick(1300);
    assert.equal(ui.q("[data-typed]").textContent, "I have too many stocks, and it's difficult to manage them. How many stocks do you recommend holding?");
    await ui.click(ui.q(".send"));
    assert.equal(ui.q(".tagWait").textContent, "Waiting");
    assert.match(ui.q(".askDone").textContent, /Done for today/);
    await ui.tick(1500);
    assert.equal(ui.q(".answering").textContent, "Rizel is answering…");
    await ui.tick(2000);
    assert.match(ui.q('[data-question="sample-q3"] header').textContent, /Answered/);
    assert.equal(toast(ui), "Rizel answered your question");
  } finally { await ui.unmount(); }
});

test("desk sample: with reduced motion the new note is still added after the delay, with no entrance animation", async () => {
  const ui = await mount("ja", { reduced: true });
  try {
    await ui.tick(5000); await ui.tick(999);
    assert.deepEqual(noteIds(ui), ["sample-note-n2", "sample-note-n3"]);
    await ui.tick(1);
    assert.deepEqual(noteIds(ui), ["sample-note-n1", "sample-note-n2", "sample-note-n3"]);
    assert.equal(ui.all("[data-entering]").length, 0);
  } finally { await ui.unmount(); }
});

test("desk sample: with reduced motion the question is filled at once (no typing animation)", async () => {
  const ui = await mount("ja", { reduced: true });
  try {
    await ui.click(tabNamed(ui, "リゼルに聞く"));
    await ui.click(ui.q(".example"));
    assert.equal(ui.q("[data-typed]").textContent, "持っている銘柄が増えすぎて、管理が大変です。\nおすすめは何銘柄でしょうか？");
    assert.ok(ui.q(".send").hasAttribute("data-ready"));
  } finally { await ui.unmount(); }
  const css = read("../app/research/pro-experience/samples/rizels-desk.module.css");
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  for (const part of [".desk .banner", ".arrive[data-entering]", ".arrive[data-entering] .note", ".notes .bubble [data-mine]", ".send.send[data-ready]", ".answer[data-reveal]>p", ".dots i"])
    assert.ok(reduced.includes(part), `no animation with reduced motion: ${part}`);
});

test("desk sample: 週刊PRO shows one sample issue (2035/03/08) built by the real IssueView, in Japanese and English, with the desk markup", async () => {
  for (const lang of ["ja", "en"]) {
    const ui = await mount(lang);
    try {
      await ui.click(tabNamed(ui, lang === "ja" ? "週刊PRO" : "Weekly"));
      assert.ok(ui.q(".issue"), "the real issue layout");
      assert.match(ui.q(".issueTag").textContent, lang === "ja" ? /^サンプル号 · 03\/08$/ : /^Sample issue · 03\/08$/);
      assert.match(ui.q(".hitokoto small").textContent, /03\/08/);
      assert.ok(ui.all(".takeaways li").length === 3, `${lang}: three takeaways`);
      assert.ok(ui.all(".part h3").length >= 4, `${lang}: numbered parts`);
      assert.ok(ui.q(".issue .red"), `${lang}: red`);
      assert.ok(ui.q(".issue mark.highlight"), `${lang}: marker`);
      assert.ok(ui.q(".issue strong"), `${lang}: bold`);
      assert.doesNotMatch(ui.host.textContent, /\[red\]|\[\/red\]|==|\*\*/, `${lang}: no raw markup`);
      assert.equal(ui.q(".issue a[href]"), null, `${lang}: no links out of the sample`);
      assert.equal(ui.q(".issue img"), null, `${lang}: no photos to load`);
      assert.ok(ui.all(".schedule article").length === 3, `${lang}: next week's schedule`);
      const text = ui.q(".issue").textContent;
      assert.match(text, lang === "ja" ? /1,218\.5億ドル/ : /\$121\.85B/, `${lang}: NVDA revenue as in the 22-stock sample`);
      assert.match(text, /73\.5/);
      assert.match(text, lang === "ja" ? /決算/ : /Earnings/);
      assert.doesNotMatch(text, /undefined|NaN|null/);
    } finally { await ui.unmount(); }
  }
});

test("desk sample: the weekly figures agree with the 22-stock sample (NVDA FQ4 2035, AMD FQ4 2034)", async () => {
  const desk = JSON.parse(read("../lib/research/pro-experience-samples/desk.json"));
  const dives = JSON.parse(read("../lib/research/pro-experience-samples/watch22-dives.json")).dives;
  const nvda = dives.find(dive => dive.ticker === "NVDA").live.dive.numbers, amd = dives.find(dive => dive.ticker === "AMD").live.dive.numbers;
  const ja = desk.weekly.ja, en = desk.weekly.en;
  const cards = ja.parts.find(part => part.type === "numbers").cards, cardsEn = en.parts.find(part => part.type === "numbers").cards;
  assert.equal(cards[0].value * 100, nvda.revenue.current); assert.equal(cards[0].previous * 100, nvda.revenue.previous);
  assert.equal(cards[0].outlook * 100, (nvda.guidance.low + nvda.guidance.high) / 2);
  assert.equal(cardsEn[0].value * 1000, nvda.revenue.current); assert.equal(cardsEn[0].outlook * 1000, (nvda.guidance.low + nvda.guidance.high) / 2);
  assert.equal(cards[1].value, nvda.grossMargin.current); assert.equal(cards[1].outlook, nvda.guidance.grossMarginPercent); assert.equal(cards[1].previous, nvda.grossMargin.previous);
  assert.equal(cards[2].value, nvda.adjustedEPS); assert.match(cards[2].range, new RegExp(String(nvda.epsEstimate)));
  assert.match(ja.parts.find(part => part.heading?.startsWith("AMD")).body, new RegExp(`${amd.segments[0].revenue / 100}億ドル`));
  assert.equal(ja.date, "2035-03-08"); assert.equal(en.date, "2035-03-08");
  // The issue comes before the samples' moment and cites nothing after it.
  assert.ok(Date.parse(ja.date) < Date.parse("2035-03-12T00:00:00Z"));
  for (const issue of [ja, en]) for (const item of issue.parts.find(part => part.type === "schedule").items) assert.ok(item.date > "2035-03-12");
});

test("desk sample: the reaction rule is the real one (one per note, again to take back)", async () => {
  const { toggleReaction } = await load();
  const start = { like: { count: 12, selected: false }, fire: { count: 4, selected: false } };
  const one = toggleReaction(start, "like");
  assert.equal(one.added, true); assert.deepEqual(one.counts.like, { count: 13, selected: true });
  const two = toggleReaction(one.counts, "fire");
  assert.deepEqual(two.counts, { like: { count: 12, selected: false }, fire: { count: 5, selected: true } });
  const three = toggleReaction(two.counts, "fire");
  assert.equal(three.added, false); assert.deepEqual(three.counts, start);
  assert.equal(toggleReaction(start, "nope").counts, start);
});

test("desk sample: nothing was sent anywhere (no fetch, XHR or beacon), and the source has no request or storage", () => {
  assert.deepEqual(network, []);
  const source = read("../app/research/pro-experience/samples/rizels-desk.tsx");
  for (const banned of [/\bfetch\s*\(/, /\/api\//, /XMLHttpRequest|EventSource|WebSocket|sendBeacon/, /localStorage|sessionStorage|indexedDB|document\.cookie/, /useReactions/])
    assert.doesNotMatch(source, banned, String(banned));
});
