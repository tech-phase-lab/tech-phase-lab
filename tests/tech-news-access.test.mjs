import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { freeTechSelection, isFullAccess, projectFreeNews, projectFreeWire } from "../lib/research/tech-news-access.ts";

const NOW = Date.parse("2026-11-12T11:11:00Z");
const ago = minutes => new Date(NOW - minutes * 60_000).toISOString();
const SECRET = "PAID-BODY-TEXT";
const item = (id, minutes, tickers = ["MU"]) => ({ id, title: `T ${id}`, url: `https://example.com/n/${id}`, publisher: "Pub", tickers, publishedAt: ago(minutes), observedAt: ago(minutes), approvedAt: ago(minutes),
  summaryJa: `見出し${id}`, summaryEn: `Headline ${id}`, impactJa: `${SECRET}${id}`, impactEn: `${SECRET}${id}`, impactLabel: "positive", confidence: "high" });
const official = (id, minutes, tickers = ["NVDA"]) => ({ id, title: `Official ${id}`, translationJa: `公式${id}`, url: `https://example.com/o/${id}`, publisher: "Issuer", tickers, observedAt: ago(minutes), publishedAt: ago(minutes), bodyJa: SECRET, bodyEn: SECRET, researchId: "r1" });
const analyst = (id, minutes, ticker = "AMD") => ({ id, ticker, firm: "Firm", action: "upgrade", titleJa: `格上げ${id}`, titleEn: `Upgrade ${id}`, bodyJa: SECRET, bodyEn: SECRET, publishedAt: ago(minutes), observedAt: ago(minutes) });
const WIRE_TITLES = { w1: "Micron opens new memory plant in Idaho", w2: "Samsung wins HBM supply deal with Nvidia", w3: "AMD unveils datacenter accelerator roadmap" };
const wireItem = (id, minutes) => ({ id, titleEn: WIRE_TITLES[id], titleJa: `ワイヤー見出し${id}`, shortJa: null, publisher: "Wire", origin: "wire", url: `https://example.com/w/${id}`, publishedAt: ago(minutes) });
const general = { id: "g1", title: "Fed holds", url: "https://example.com/g", publisher: "Pub", tickers: [], publishedAt: ago(1), observedAt: ago(1), approvedAt: ago(1), summaryJa: "一般", summaryEn: "General", impactJa: "一般の本文", impactEn: "General body", impactLabel: "neutral", confidence: "high" };
const feed = () => ({ ok: true, enabled: true,
  items: [item("1", 5), item("2", 29), item("3", 40), general],
  officialUpdates: [official("a", 1), official("b", 35), official("c", 600), official("d", 700), official("e", 800)],
  analystUpdates: [analyst("11", 20), analyst("12", 50)],
  marketUpdates: [{ id: "m1", titleJa: "市場", titleEn: "Market", url: "https://x.com/Barchart/status/1", topic: "crude-oil", publishedAt: ago(2), observedAt: ago(2) }] });
const wire = () => ({ MU: [wireItem("w1", 3), wireItem("w2", 45)], AMD: [wireItem("w3", 90)] });

test("only the newest five stories at least 30 minutes old are selected, across all sources", () => {
  const selected = freeTechSelection(feed(), wire(), NOW);
  assert.equal(selected.size, 5);
  // Inside the delay: item 1 (5 min), item 2 (29 min), official a (1 min), wire w1 (3 min), analyst 11 (20 min).
  for (const id of ["news:1", "news:2", "official:a", "wire:w1", "analyst:11"]) assert.ok(!selected.has(id), id);
  // The newest five that are old enough: official b (35), news 3 (40), wire w2 (45), analyst 12 (50), wire w3 (90). Official c (600) is the sixth.
  assert.deepEqual([...selected].sort(), ["analyst:12", "news:3", "official:b", "wire:w2", "wire:w3"].sort());
});

test("FREE feed has no story newer than 30 minutes, no summary, no body, and keeps everything else free", () => {
  const f = feed(), selected = freeTechSelection(f, wire(), NOW), free = projectFreeNews(f, selected);
  const json = JSON.stringify(free);
  assert.ok(!json.includes(SECRET), "no paid text");
  assert.ok(!json.includes("researchId"));
  for (const id of ["1", "2"]) assert.ok(!free.items.some(x => x.id === id));
  assert.ok(!free.officialUpdates.some(x => x.id === "a"));
  const instants = [...free.items.filter(x => x.tickers.length), ...free.officialUpdates, ...free.analystUpdates].map(x => Date.parse(x.publishedAt));
  assert.ok(instants.length <= 5 && instants.every(t => t <= NOW - 30 * 60_000));
  assert.ok(free.items.some(x => x.id === "g1" && x.impactEn === "General body"), "general news stays whole");
  assert.equal(free.marketUpdates.length, 1);
});

test("an announced earnings result is not part of the five-story limit and stays whole", () => {
  const f = feed();
  f.resultBriefs = [];
  const result = { ...official("r", 10, ["NVDA"]), title: "NVIDIA reports first quarter results", bodyEn: "Revenue $1B" };
  f.officialUpdates.push(result);
  const free = projectFreeNews(f, freeTechSelection(f, wire(), NOW));
  assert.ok(free.officialUpdates.some(x => x.id === "r" && x.bodyEn === "Revenue $1B"));
  assert.ok(!freeTechSelection(f, wire(), NOW).has("official:r"));
});

test("FREE wire carries only selected headlines; none newer than 30 minutes", () => {
  const w = wire(), selected = freeTechSelection(feed(), w, NOW), free = projectFreeWire(w, selected);
  const all = Object.values(free).flat();
  assert.deepEqual(all.map(x => x.id).sort(), ["w2", "w3"]);
  assert.ok(all.every(x => Date.parse(x.publishedAt) <= NOW - 30 * 60_000));
});

test("a day-only story waits 30 minutes from first sight, an unparseable or future time is hidden", () => {
  const f = { ok: true, enabled: true, items: [], officialUpdates: [{ ...official("p", 0), publishedAt: undefined, publishedOn: "2026-11-12", observedAt: ago(10) }, { ...official("q", 0), publishedAt: new Date(NOW + 3_600_000).toISOString() }] };
  assert.equal(freeTechSelection(f, {}, NOW).size, 0);
  f.officialUpdates[0].observedAt = ago(31);
  assert.deepEqual([...freeTechSelection(f, {}, NOW)], ["official:p"]);
});

test("viewers: signed out, FREE member, PRO member, owner (PRO), owner switched to FREE", () => {
  assert.equal(isFullAccess({ status: "signed-out", plan: "free" }), false);
  assert.equal(isFullAccess({ status: "unavailable", plan: "free" }), false);
  assert.equal(isFullAccess(undefined), false);
  assert.equal(isFullAccess({ status: "signed-in", plan: "free", isAdmin: false }), false);
  assert.equal(isFullAccess({ status: "signed-in", plan: "pro", isAdmin: false }), true);
  assert.equal(isFullAccess({ status: "signed-in", plan: "pro", isAdmin: true, testing: false }), true);
  assert.equal(isFullAccess({ status: "signed-in", plan: "free", isAdmin: true, testing: true }), false);
  const f = feed(), w = wire();
  const body = viewer => JSON.stringify(isFullAccess(viewer) ? f : projectFreeNews(f, freeTechSelection(f, w, NOW)));
  assert.ok(body({ status: "signed-in", plan: "pro" }).includes(SECRET));
  assert.ok(body({ status: "signed-in", plan: "pro", isAdmin: true }).includes(SECRET));
  for (const free of [{ status: "signed-out" }, { status: "signed-in", plan: "free" }, { status: "signed-in", plan: "free", isAdmin: true, testing: true }]) assert.ok(!body(free).includes(SECRET));
});

test("the routes decide on the server, answer privately, and sit behind the identity proxy", () => {
  const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
  for (const file of ["../app/api/research/news/route.ts", "../app/api/research/company-wire/route.ts"]) {
    const source = read(file);
    assert.match(source, /viewerHasFullNews\(\)/, file);
    assert.match(source, /PRIVATE_HEADERS/, file);
    assert.doesNotMatch(source, /GET\(request|new URL\(request|headers\.get\(/, file); // no browser-supplied plan
  }
  assert.match(read("../lib/research/tech-news-server.ts"), /private, no-store/);
  assert.match(read("../lib/research/tech-news-server.ts"), /Vary: "Cookie"/);
  assert.match(read("../proxy.ts"), /"\/api\/research\/news", "\/api\/research\/company-wire"/);
});
