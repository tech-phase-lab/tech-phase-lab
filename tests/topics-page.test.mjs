import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { parseCompanyWire } from "../lib/research/company-wire.ts";
import { fitSummary, impactOf, publisherRank, sameTopic, SUMMARY_JA_MAX, summaryToggle, topicCards, topicCredit, topicImpact } from "../lib/research/topics.ts";

// Owner, Nov 15: 一般ニュース becomes 注目トピック, a list of open cards of the Stock News API stories.
const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const now = Date.parse("2026-11-15T03:00:00Z"); // 12:00 on Nov 15, Japan time
const iso = minutes => new Date(now - minutes * 60_000).toISOString();
const row = (id, titleEn, titleJa, { source = "stocknews", minutes = 10, sentiment, publisher = "Reuters", url = `https://news.example/${id}` } = {}) => ({
  id, titleEn, titleJa, shortJa: null, publisher, origin: "third-party", url, publishedAt: iso(minutes), source, ...(sentiment ? { sentiment } : {}) });
const wire = () => parseCompanyWire({ ok: true, items: {
  MU: [row("s1", "Micron moves HBM4 shipments forward", "マイクロン、HBM4の量産出荷を前倒しと発表", { sentiment: "positive", minutes: 30 })],
  SNDK: [row("s2", "Sandisk cuts data center SSD prices", "サンディスク、データセンター向けSSDの価格を引き下げ", { sentiment: "negative", minutes: 60 })],
  AMD: [row("s3", "AMD sets the date for its new AI accelerator", "AMD、新しいAIアクセラレーターの発表日を公表", { minutes: 24 * 60 + 30 })],
  MKT: [row("s4", "Oil jumps on Hormuz tension", "ホルムズ緊張で原油が急騰", { sentiment: "neutral", minutes: 90 })],
  NVDA: [row("y1", "Nvidia ships a new rack system", "エヌビディアが新ラックを出荷", { source: "yahoo", minutes: 5, sentiment: "positive" }),
    row("s5", "Nvidia signs a new Taiwan contract", null, { minutes: 15 })],
} }).items;
const draft = { id: "d1", title: "Micron moves HBM4 shipments forward", url: "https://news.example/s1", publisher: "Bloomberg", tickers: ["MU"],
  publishedAt: iso(30), observedAt: iso(29), approvedAt: iso(20), summaryJa: "次世代メモリHBM4の出荷開始を当初計画より1四半期早める。", summaryEn: "Shipments of HBM4 start a quarter early.",
  shortTitleJa: "マイクロン、HBM4の出荷を前倒し", shortTitleEn: "Micron brings HBM4 forward", impactJa: "影響", impactEn: "Impact", impactLabel: "mixed", confidence: "high" };
const feed = { ok: true, enabled: true, items: [draft] };

test("the Stock News API sentiment is read from the company headline feed; anything else is left out", () => {
  const items = wire();
  assert.equal(items.MU[0].sentiment, "positive");
  assert.equal(items.SNDK[0].sentiment, "negative");
  assert.equal("sentiment" in items.AMD[0], false);
  const odd = parseCompanyWire({ ok: true, items: { MU: [{ ...row("x", "Micron item", "マイクロンの記事"), sentiment: "Bullish" }, { ...row("z", "Micron other", null), sentiment: 1 }] } }).items;
  assert.deepEqual(odd.MU.map(item => "sentiment" in item), [false, false]);
});

test("impact: the reviewed impactLabel first, then the Stock News API sentiment; mixed, neutral and unknown read 中立", () => {
  assert.equal(impactOf("positive", "negative"), "positive");
  assert.equal(impactOf("mixed", "positive"), "neutral");
  assert.equal(impactOf("uncertain"), "neutral");
  assert.equal(impactOf(undefined, "negative"), "negative");
  assert.equal(impactOf(undefined, undefined), "neutral");
  assert.deepEqual(["positive", "negative", "neutral"].map(value => topicImpact(value, true)), ["▲ プラス", "▼ マイナス", "● 中立"]);
  assert.deepEqual(["positive", "negative", "neutral"].map(value => topicImpact(value, false)), ["▲ Positive", "▼ Negative", "● Neutral"]);
});

test("the cards are the Stock News API stories, newest first, each with a publisher and an article link; no English on the Japanese page", () => {
  const ja = topicCards(null, wire(), "ja");
  assert.deepEqual(ja.map(card => card.id), ["wire-s1", "wire-s2", "wire-s4", "wire-s3"], "the Yahoo row and the untranslated Nvidia story are not listed");
  assert.ok(ja.every(card => /[぀-ヿ㐀-鿿]/.test(card.title) && card.publisher && card.url.startsWith("https://")));
  assert.deepEqual(ja.map(card => card.impact), ["positive", "negative", "neutral", "neutral"]);
  assert.equal(ja.find(card => card.id === "wire-s4").tickers, "市場");
  assert.equal(ja[0].summary, undefined, "a headline-only story has no summary");
  assert.deepEqual(topicCards(null, wire(), "en").map(card => card.id), ["wire-s5", "wire-s1", "wire-s2", "wire-s4", "wire-s3"]);
});

test("a law firm's shareholder solicitation is never a topic card, from the company wire or the reviewed feed (owner, Nov 15)", () => {
  const ad = parseCompanyWire({ ok: true, items: { GILT: [row("g1", "Gilat Satellite Networks news for holders", "GIL T投資家にSBS法律事務所とジラット衛星ネットワーク詐欺調査参加の機会", { publisher: "Business Wire" })] } }).items;
  assert.deepEqual(topicCards(null, { ...wire(), ...ad }, "ja").map(card => card.id), ["wire-s1", "wire-s2", "wire-s4", "wire-s3"]);
  const reviewed = { ...draft, id: "d2", url: "https://news.example/gilt", title: "GILT Investors Have Opportunity to Join Gilat Satellite Networks Ltd. Fraud Investigation with SBS Law Firm",
    shortTitleJa: "ジラット投資家に調査参加の機会", shortTitleEn: "Gilat investors invited" };
  assert.equal(topicCards({ ...feed, items: [reviewed] }, {}, "ja").length, 0);
  assert.equal(topicCards({ ...feed, items: [reviewed] }, {}, "en").length, 0);
});

test("a reviewed article shows its checked summary and impactLabel, and the same article is listed once", () => {
  const ja = topicCards(feed, wire(), "ja");
  assert.deepEqual(ja.map(card => card.id), ["news-d1", "wire-s2", "wire-s4", "wire-s3"]);
  assert.deepEqual({ ...ja[0] }, { id: "news-d1", tickers: "MU", impact: "neutral", at: draft.publishedAt, title: draft.shortTitleJa,
    summary: draft.summaryJa, publisher: "Bloomberg", url: "https://news.example/s1" });
  assert.equal(topicCards(feed, wire(), "en")[1].summary, draft.summaryEn);
  // Publication switched off: only the company headline stories.
  assert.deepEqual(topicCards({ ...feed, enabled: false }, wire(), "ja")[0].id, "wire-s1");
  // A reviewed article without a short headline uses its summary as the headline, and does not repeat it below.
  const plain = topicCards({ ...feed, items: [{ ...draft, shortTitleJa: undefined, shortTitleEn: undefined }] }, {}, "ja")[0];
  assert.equal(plain.title, draft.summaryJa);
  assert.equal(plain.summary, undefined);
});

function loadTopics(file = "../app/research/news/topics-list.tsx") {
  const output = ts.transpileModule(read(file), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  const styles = new Proxy({}, { get: (_, name) => String(name) });
  new Function("require", "module", "exports", output)(name => {
    if (name.endsWith(".module.css")) return { default: styles };
    if (name.startsWith("@/lib/research/")) return require(`../lib/research/${name.slice("@/lib/research/".length)}.ts`);
    if (name.startsWith("./")) return { default: loadTopics(`../app/research/news/${name.slice(2)}.tsx`) };
    return require(name);
  }, loaded, loaded.exports);
  return loaded.exports.default;
}

test("the page: TOPICS / 注目トピック, an automatic-update line, open cards with day dividers, and no refresh button or notes", () => {
  const page = read("../app/research/general-news/page.tsx");
  assert.match(page, /eyebrow="TOPICS" title=\{lang === "ja" \? "注目トピック" : "Top Topics"\}/);
  const Topics = loadTopics();
  const html = renderToStaticMarkup(React.createElement(Topics, { lang: "ja", data: feed, wire: wire(), wireReady: true, error: false,
    receivedAt: new Date(now).toISOString(), page: 1, onPage: () => {} }));
  assert.match(html, /自動で更新中/);
  assert.doesNotMatch(html, /更新<\/button>|<details|日英の内容を確認|画面取得|確信度|事業への影響/);
  // Owner, Nov 26: a closed card shows its headline only; the one card with a summary has 「＋」, the others none.
  assert.equal((html.match(/<button/g) ?? []).length, 1, "「＋」 only on the card with a summary");
  assert.doesNotMatch(html, /topicSummary/, "no summary preview under a closed card's headline");
  assert.deepEqual([...html.matchAll(/<h2 class="topicDay">([^<]+)<\/h2>/g)].map(match => match[1]), ["今日", "昨日"]);
  assert.equal((html.match(/<article /g) ?? []).length, 4);
  assert.match(html, /<time dateTime="[^"]+">11:30<\/time>/, "the time alone, in Japan time");
  assert.match(html, /<span class="topicTicker">MU<\/span><span class="topicImpact">● 中立<\/span>/);
  assert.match(html, /class="topicCard topicNegative"/);
  assert.match(html, /<div class="topicFoot"><p class="topicPublisher">Bloomberg<\/p><button type="button" class="topicMore" aria-expanded="false" aria-controls="news-d1-summary" aria-label="要約をすべて表示">＋<\/button><\/div>/);
  // Owner, Nov 21: the articles are in English, so the Japanese headline is plain text with no link.
  assert.match(html, /<h3 class="topicTitle" lang="ja">マイクロン、HBM4の出荷を前倒し<\/h3>/, "the Japanese headline is plain text");
  assert.doesNotMatch(html, /元記事を読む|Read the article|↗/, "no per-card link row");
  assert.equal((html.match(/<a |href=|target=/g) ?? []).length, 0, "no link to the English article on the Japanese page");
  const en = renderToStaticMarkup(React.createElement(Topics, { lang: "en", data: feed, wire: wire(), wireReady: true, error: false,
    receivedAt: new Date(now).toISOString(), page: 1, onPage: () => {} }));
  assert.match(en, /<h3 class="topicTitle" lang="en"><a href="https:\/\/news\.example\/s1" target="_blank" rel="noopener noreferrer">Micron brings HBM4 forward<\/a><\/h3>/, "the English headline is the link");
  assert.equal((en.match(/<a /g) ?? []).length, (en.match(/<article /g) ?? []).length, "one link per English card: its headline");
  assert.match(html, /<\/div><p class="topicCredit">提供：Stock News API<\/p><\/section>$/, "one credit line at the bottom");
  const empty = renderToStaticMarkup(React.createElement(Topics, { lang: "ja", data: { ok: true, enabled: false, items: [] }, wire: {}, wireReady: true, error: false, receivedAt: null, page: 1, onPage: () => {} }));
  assert.match(empty, /現在、掲載中のトピックはありません。/);
});

test("the cards follow the owner's colours and sizes, with no gold", () => {
  const css = read("../app/research/news/general-news.module.css");
  const topics = css.slice(css.indexOf("/* 注目トピック")).replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of [/\.topicCard\{[^}]*border-radius:12px;background:#111822;border:1px solid #1c2633/, /\.topicCard::before\{[^}]*width:3px/,
    /\.topicPositive\{--topic-tone:#5fe0aa\}/, /\.topicNegative\{--topic-tone:#ff7a7a\}/, /\.topicNeutral\{--topic-tone:#9aa7b7\}/,
    /\.topicList\{[^}]*gap:10px/, /\.topicTitle\{[^}]*font-size:15\.5px;font-weight:700/, /\.topicSummary\{[^}]*font-size:12\.5px;[^}]*color:#aab6c4/,
    /\.topicLive\{[^}]*font-size:12px;[^}]*color:#8e9aaa/, /\.topicLive span\{[^}]*background:#8fe3c0/, /\.topicTicker\{[^}]*font-weight:700;color:#8fe3c0/,
    /\.topicMore\{[^}]*color:#8fe3c0/, /\.topicPublisher\{[^}]*font-size:11px/]) assert.match(topics, rule);
  assert.doesNotMatch(topics, /#d0ae65|#dcc58e|gold|#c9a|#e6c|#f5d/i);
  assert.doesNotMatch(topics, /text-overflow:ellipsis|\.topicSource/);
  assert.doesNotMatch(topics.match(/\.topicTitle\{[^}]*\}/)[0], /line-clamp|overflow:hidden/, "headlines are never cut");
  assert.doesNotMatch(topics, /line-clamp/, "nothing is clamped: the summary opens whole behind 「＋」");
});

test("the name 注目トピック is used everywhere the page is named", () => {
  assert.match(read("../app/research/home-sidebar.tsx"), /label: t\("注目トピック", "Top Topics"\), href: "\/research\/general-news"/);
  assert.match(read("../app/research/site-header.tsx"), /item\("\/research\/general-news", "news", ja \? "注目トピック" : "Top Topics"\)/);
  // English FREE card (owner, Nov 22): the short table names it "Top US market stories"; the Japanese row keeps 注目トピック.
  assert.match(read("../app/research/plan-cards.tsx"), /\[t\("米国市場の注目トピック", "Top US market stories"\)\]/);
  assert.match(read("../app/research/news/general-news-panel.tsx"), /注目トピックですべて見る/);
  for (const file of ["../app/research/home-sidebar.tsx", "../app/research/site-header.tsx", "../app/research/plan-cards.tsx", "../app/research/news/general-news-panel.tsx", "../app/research/general-news/page.tsx"]) {
    assert.doesNotMatch(read(file), /一般ニュース|General News|GENERAL NEWS/, file);
  }
});

// Owner, Nov 15 (注目トピックの要約・重複・リンク).
const summaryJa = "イタリアの競争当局は、メタがWhatsAppでAIチャットボットの競合を締め出したとして8億8700万ユーロの制裁金を科した。メタは不服を申し立てる方針を示した。";
const summaryEn = "Italy's antitrust authority fined Meta 887 million euros, saying it shut rival AI chatbots out of WhatsApp. Meta said it would appeal.";
const meta = (id, titleEn, titleJa, publisher, minutes, extra = {}) => ({ ...row(id, titleEn, titleJa, { publisher, minutes }), ...extra });

test("the feed carries the Stock News article summary in English and, beside a Japanese headline, in checked Japanese", () => {
  const items = parseCompanyWire({ ok: true, items: { META: [
    meta("m1", "Meta fined $887 million by Italian antitrust regulator", "メタ、伊競争当局から8億8700万ドルの制裁金", "Reuters", 20, { summaryEn, summaryJa }),
    meta("m2", "Meta item without Japanese", null, "Reuters", 30, { summaryEn, summaryJa }),
    meta("m3", "Meta item with a bad summary", "メタの記事", "Reuters", 40, { summaryEn: "x".repeat(1201), summaryJa: "English only" }),
    meta("m4", "Meta item with odd fields", "メタの記事2", "Reuters", 50, { summaryEn: 5, summaryJa: "あ".repeat(301) }),
    meta("m5", "Meta item with NUL", "メタの記事3", "Reuters", 60, { summaryEn: "a\0b", summaryJa: "  " }),
  ] } }).items.META;
  assert.deepEqual(items.map(item => [item.summaryEn ?? null, item.summaryJa ?? null]), [[summaryEn, summaryJa], [summaryEn, null], [null, null], [null, null], [null, null]]);
  assert.equal(items.length, 5, "a bad summary never drops the headline");
});

test("a card shows the summary under the headline: Japanese on the Japanese page, English on the English page; headline-only rows show none", () => {
  const items = { META: [meta("m1", "Meta fined $887 million by Italian antitrust regulator", "メタ、伊競争当局から8億8700万ドルの制裁金", "Reuters", 20, { summaryEn, summaryJa })],
    NVDA: [meta("n1", "Nvidia signs a supply deal with Foxconn", "エヌビディア、フォックスコンと供給契約", "Reuters", 25, { summaryEn: "Nvidia signed a deal." })] };
  const wireItems = parseCompanyWire({ ok: true, items }).items;
  const ja = topicCards(null, wireItems, "ja"), en = topicCards(null, wireItems, "en");
  assert.equal(ja[0].summary, summaryJa);
  assert.equal(en[0].summary, summaryEn);
  assert.equal(ja[1].summary, undefined, "no Japanese summary: the Japanese card shows the headline only");
  assert.equal(en[1].summary, "Nvidia signed a deal.");
  assert.equal(topicCards(null, wire(), "ja").every(card => card.summary === undefined), true);
});

test("the same story from different publishers is one card, the most reputable publisher's, listing every company", () => {
  const items = parseCompanyWire({ ok: true, items: {
    META: [meta("m1", "Italy fines Meta 887 mln euros over WhatsApp AI chatbots", "イタリア、メタに8億8700万ユーロの制裁金", "Business Insider", 50),
      meta("m2", "Meta fined $887 million by Italian antitrust regulator", "メタ、伊競争当局から制裁金8億8700万", "Reuters", 40, { summaryEn, summaryJa }),
      meta("m3", "Meta launches a new Llama model for business", "メタ、企業向けの新Llamaモデルを発表", "TechCrunch", 30)],
    GOOGL: [meta("g1", "Italy fines Google over Android Auto access", "イタリア、グーグルに制裁金", "Reuters", 45)],
  } }).items;
  const ja = topicCards(null, items, "ja");
  assert.deepEqual(ja.map(card => card.id), ["wire-m3", "wire-g1", "wire-m2"], "the Italian fine is listed once; Google's own fine stays separate");
  const fine = ja.find(card => card.id === "wire-m2");
  assert.equal(fine.publisher, "Reuters");
  assert.equal(fine.summary, summaryJa);
  assert.equal(fine.at, iso(50), "the story is dated when it first appeared");
  assert.equal(topicCards(null, items, "en").length, 3);
  // A story more than 24 hours apart is a new card.
  const later = parseCompanyWire({ ok: true, items: { META: [meta("a", "Meta fined $887 million by Italian antitrust regulator", "メタに制裁金8億8700万", "Reuters", 26 * 60),
    meta("b", "Italy fines Meta 887 mln euros over WhatsApp AI chatbots", "メタに8億8700万ユーロ", "CNBC", 10)] } }).items;
  assert.equal(topicCards(null, later, "ja").length, 2);
});

test("different companies' look-alike headlines are separate cards; the same article filed under two companies is one", () => {
  // Owner, Nov 26: seven companies' "Reports Third Quarter 2026 Results" were shown as one card dated at the first of them.
  const items = parseCompanyWire({ ok: true, items: {
    GDS: [meta("q1", "GDS Holdings Limited Reports Third Quarter 2026 Results", "GDSホールディングス、2026年第3四半期決算を発表", "GlobeNewsWire", 300)],
    LICT: [meta("q2", "LICT Corporation Reports Third Quarter 2026 Results", "LICT、2026年第3四半期決算を発表", "Business Wire", 60)],
    DBX: [meta("c1", "Dropbox to Present at the 2026 UBS Global Technology and AI Conference", "Dropbox、UBS会議で発表", "Business Wire", 20)],
    CTSH: [meta("c2", "Cognizant to Present at the 30th Annual UBS Global Technology and AI Conference", "コグニザント、UBS会議で発表", "PRNewsWire", 50)],
    MKT: [meta("k1", "Kioxia and NVIDIA Collaborate to Expand Effective HBM Capacity", "キオクシアとエヌビディアが協業", "Business Wire", 10, { url: "https://news.example/k" })],
    NVDA: [meta("k2", "Kioxia and NVIDIA Collaborate to Expand Effective HBM Capacity", "キオクシアとエヌビディアが協業", "Business Wire", 10, { url: "https://news.example/k" })],
  } }).items;
  const ja = topicCards(null, items, "ja");
  assert.deepEqual(ja.map(card => card.tickers), ["市場 · NVDA", "DBX", "CTSH", "LICT", "GDS"]);
  assert.equal(ja.find(card => card.tickers === "LICT").at, iso(60), "each card keeps its own time");
});

test("the same-story rule and the publisher order", () => {
  assert.equal(sameTopic("Italy fines Meta 887 mln euros over WhatsApp AI chatbots", "Meta fined $887 million by Italian antitrust regulator"), true);
  assert.equal(sameTopic("Nvidia shares rise after earnings beat", "Nvidia shares fall after earnings miss"), false);
  assert.equal(sameTopic("Meta launches a new Llama model", "Meta fined $887 million in Italy"), false);
  assert.ok(publisherRank("Reuters") < publisherRank("Business Wire"));
  assert.ok(publisherRank("Business Wire") < publisherRank("CNBC"));
  assert.ok(publisherRank("CNBC") < publisherRank("TechCrunch"));
  assert.ok(publisherRank("TechCrunch") < publisherRank("Some Blog"));
});

test("a closed card shows the headline only; 「＋」 opens the whole summary of up to 100 characters in whole sentences", () => {
  // Owner, Nov 26 (agreed Nov 16: about 80 to 100 characters): a longer summary keeps its leading whole sentences; never a cut sentence.
  assert.equal(SUMMARY_JA_MAX, 100);
  const first = "シンガポールのiConnections Global Alts Asia会議で、AIブームによるリスクと機会が議論された。";
  const second = "DSC Meridian CapitalのSheru Chowdhryは、AIの評価や景気後退懸念にもかかわらず、データセンターは引き続き魅力的な投資先と述べた。";
  assert.equal(fitSummary(first + second, true), first, "the 142-character summary keeps its first sentence");
  assert.equal(fitSummary("あ".repeat(100), true), "あ".repeat(100));
  assert.equal(fitSummary("あ".repeat(101) + "。", true), undefined, "a first sentence over 100 characters is not shown, never cut");
  assert.equal(fitSummary("いい。".repeat(40), true).length, 99);
  assert.equal(fitSummary("「あ。」".repeat(30), true), "「あ。」".repeat(25), "a closing bracket stays with its sentence");
  assert.equal(fitSummary("x".repeat(600), false), "x".repeat(600), "the English summary is the article's own text, unchanged");
  assert.equal(fitSummary("  ", true), undefined);
  assert.deepEqual(summaryToggle(false, true), { text: "＋", label: "要約をすべて表示" });
  assert.deepEqual(summaryToggle(true, true), { text: "−", label: "要約を閉じる" });
  assert.deepEqual(summaryToggle(false, false), { text: "＋", label: "Show the full summary" });
  assert.equal(topicCredit(true), "提供：Stock News API");
  assert.equal(topicCredit(false), "Source: Stock News API");
  const Topics = loadTopics();
  const items = parseCompanyWire({ ok: true, items: {
    META: [meta("m1", "Meta fined $887 million by Italian antitrust regulator", "メタ、伊当局から8億8700万ドルの制裁金", "Reuters", 20, { summaryEn, summaryJa: first + second })],
    NVDA: [meta("n1", "Nvidia signs a supply deal with Foxconn", "エヌビディア、フォックスコンと供給契約", "Reuters", 25)] } }).items;
  const render = lang => renderToStaticMarkup(React.createElement(Topics, { lang, data: null, wire: items, wireReady: true, error: false,
    receivedAt: new Date(now).toISOString(), page: 1, onPage: () => {} }));
  const html = render("ja");
  assert.doesNotMatch(html, /topicSummary|シンガポール/, "the closed card shows no summary preview");
  assert.equal((html.match(/<button/g) ?? []).length, 1, "the card without a summary has no 「＋」");
  assert.match(html, /<p class="topicPublisher">Reuters<\/p><button type="button" class="topicMore" aria-expanded="false" aria-controls="wire-m1-summary" aria-label="要約をすべて表示">＋<\/button>/);
  const en = render("en");
  assert.doesNotMatch(en, /topicSummary/);
  assert.match(en, /<p class="topicCredit">Source: Stock News API<\/p>/);
  assert.doesNotMatch(en, /Read the article|元記事/);
  const source = read("../app/research/news/topics-list.tsx");
  assert.match(source, /setOpen\(!open\)/, "the button opens and closes the summary");
  assert.match(source, /summary && open && <p id=\{panel\} className=\{styles\.topicSummary\}/, "the summary is shown only when open");
  assert.match(source, /\{summary && <button/, "no 「＋」 without a summary");
});

test("the dot beside 自動で更新中 blinks only while a check runs, and never with reduced motion", () => {
  const Topics = loadTopics();
  const render = updating => renderToStaticMarkup(React.createElement(Topics, { lang: "ja", data: feed, wire: wire(), wireReady: true, updating, error: false,
    receivedAt: new Date(now).toISOString(), page: 1, onPage: () => {} }));
  assert.match(render(true), /<p class="topicLive"><span aria-hidden="true" class="topicLiveUpdating"><\/span>自動で更新中<\/p>/);
  assert.match(render(false), /<p class="topicLive"><span aria-hidden="true"><\/span>自動で更新中<\/p>/, "steady when idle, as before");
  const css = read("../app/research/news/general-news.module.css");
  assert.match(css, /\.topicLive span\.topicLiveUpdating\{animation:topicLiveFlash \.9s infinite\}/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.topicLive span\.topicLiveUpdating\{animation:none\}/);
  const panel = read("../app/research/news/general-news-panel.tsx");
  assert.match(panel, /const updating = generalOnly && \(!wireAt \|\| \(!!receivedAt && Date\.parse\(wireAt\) < Date\.parse\(receivedAt\)\)\)/);
  assert.match(panel, /updating=\{updating\}/);
});
