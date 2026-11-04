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
});

test("withdrawing an automatic result is the owner's alone and goes through the editor token", () => {
  const route = readFileSync(new URL("../app/api/research/event-results/route.ts", import.meta.url), "utf8");
  assert.match(route, /member\.isAdmin/); assert.match(route, /owner-required/); assert.match(route, /RESEARCH_EDITOR_TOKEN/); assert.match(route, /\/admin\/event-results\/withdraw/);
  assert.match(readFileSync(new URL("../proxy.ts", import.meta.url), "utf8"), /\/api\/research\/event-results/);
  const panel = readFileSync(new URL("../app/research/calendar/economic-results-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /ownerMode && <button/);
});
