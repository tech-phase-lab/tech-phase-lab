import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicNews } from "../lib/research/public-news-response.ts";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { economicResults } from "../lib/research/calendar.ts";
import { parseEventResults } from "../lib/research/general-news.ts";

// pce-results.ts imports "./calendar" without an extension, which plain Node cannot resolve; load it with that one import supplied.
const source = ts.transpileModule(readFileSync(new URL("../lib/research/pce-results.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", source)(id => (id === "./calendar" ? { economicResults } : createRequire(import.meta.url)(id)), loaded, loaded.exports);
const { mergeEconomicResults } = loaded.exports;

const event = (over = {}) => ({ id: "us-midterm-2026-11-03", titleJa: "米国中間選挙（現地11月3日投票・日本時間4日に結果）", titleEn: "U.S. midterm elections", sourceName: "CBS News・NPR(報道)", releasedAt: "2026-11-04T04:10:00+00:00",
  resultJa: "民主党が下院・上院とも多数を獲得（2社が当確を報道）", resultEn: "Democrats win control of both the House and the Senate (called by 2 outlets)", detailJa: "CBS News・NPRが報じました。認定は数週間かかります。", detailEn: "Reported by CBS News, NPR.",
  sourceUrl: "https://www.cbsnews.com/live-updates/x", verifiedOn: "2026-11-04", sources: [{ publisher: "CBS News", title: "Democrats win the House", url: "https://www.cbsnews.com/a" }, { publisher: "NPR", title: "Democrats win the House", url: "https://www.npr.org/b" }], ...over });

test("an event result reaches the results list and replaces the hand-written row of the same id", () => {
  const rows = mergeEconomicResults([], [], [event()]);
  const row = rows.find(item => item.id === "us-midterm-2026-11-03");
  assert.equal(row.result.ja, "民主党が下院・上院とも多数を獲得（2社が当確を報道）");
  assert.equal(rows.filter(item => item.id === "us-midterm-2026-11-03").length, 1);
  assert.equal(rows.filter(item => item.id === "fomc-2026-10").length, 1, "other rows stay");
});

test("the public news response carries event results through, and a malformed one never breaks the feed", () => {
  const raw = { ok: true, enabled: true, items: [], eventResults: [event()] };
  assert.equal(buildPublicNews(raw).eventResults[0].id, "us-midterm-2026-11-03");
  assert.deepEqual(buildPublicNews({ ...raw, eventResults: [{ id: "x" }] }).eventResults, []);
  assert.equal(buildPublicNews({ ok: true, enabled: true, items: [] }).eventResults, undefined);
});

test("an event result must be backed by two sources over https", () => {
  assert.throws(() => parseEventResults([event({ sources: [event().sources[0]] })]));
  assert.throws(() => parseEventResults([event({ sourceUrl: "http://example.com/x" })]));
  assert.throws(() => parseEventResults([event({ id: "Bad Id" })]));
  assert.equal(parseEventResults([event()]).length, 1);
  // A result read from an official page or the issuer's own release stands on one source (FOMC, GDP, retail sales, ADP, ISM).
  for (const publisher of ["Federal Reserve", "BEA", "Census Bureau", "ADP（公式発表）", "ISM（公式発表）"])
    assert.equal(parseEventResults([event({ sources: [{ ...event().sources[0], publisher }] })]).length, 1, publisher);
  assert.throws(() => parseEventResults([event({ sources: [{ ...event().sources[0], publisher: "Some Blog" }] })]), "one unofficial source is not enough");
  assert.throws(() => parseEventResults([event({ sources: [] })]));
});

test("withdrawing an automatic result is the owner's alone and goes through the editor token", () => {
  const route = readFileSync(new URL("../app/api/research/event-results/route.ts", import.meta.url), "utf8");
  assert.match(route, /member\.isAdmin/); assert.match(route, /owner-required/); assert.match(route, /RESEARCH_EDITOR_TOKEN/); assert.match(route, /\/admin\/event-results\/withdraw/);
  assert.match(readFileSync(new URL("../proxy.ts", import.meta.url), "utf8"), /\/api\/research\/event-results/);
  const panel = readFileSync(new URL("../app/research/calendar/economic-results-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /ownerMode && <button/);
});

test("a result read from one official page reaches the site, and one bad result never hides the good ones", () => {
  const fomc = event({ id: "fomc-2026-10-28", sourceName: "FRB", sources: [{ publisher: "Federal Reserve", title: "Federal Reserve issues FOMC statement", url: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm" }] });
  const raw = { ok: true, enabled: true, items: [], eventResults: [{ id: "x" }, fomc, event()] };
  const ids = buildPublicNews(raw).eventResults.map(item => item.id);
  assert.deepEqual(ids, ["fomc-2026-10-28", "us-midterm-2026-11-03"]);
  assert.equal(mergeEconomicResults([], [], [fomc]).find(row => row.id === "fomc-2026-10-28").sourceName, "FRB");
});

test("a number stays with its unit when the Japanese title wraps (owner, Nov 6)", async () => {
  const { noBreakUnits } = await import("../lib/research/no-break-units.ts");
  assert.equal(noBreakUnits("日本時間4日に結果"), "日本時間4⁠日に結果");
  assert.equal(noBreakUnits("+165,000人／失業率 4.1%"), "+165,000⁠人／失業率 4.1⁠%");
  assert.equal(noBreakUnits("English 4 days"), "English 4 days");
});
