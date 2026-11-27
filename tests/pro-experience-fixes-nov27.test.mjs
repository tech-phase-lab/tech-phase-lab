// Owner's review of the FREE 「PRO機能体験」 samples (Nov 27): the 「PROで使えます」 notice clears the bottom menu, a three-month price move
// is never a 長所 / 短所, a 4.1% FCF margin is no strength, one expandable live-monitor item per stock, no caption under the video.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareNow, compareSample } from "../lib/research/pro-experience-sample-data.ts";
import { FCF_STRENGTH_PCT, WEAK_SCORE, comparisonScores, detailTraits, listedTraits, overallComparison } from "../lib/research/comparison-scorecard.ts";
import { prepareTwelveComparison } from "../lib/research/twelve-data-comparison.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const items = c => listedTraits(c, c.preparedAnalysis?.items ?? [], compareNow);
const shorts = (c, kind) => items(c).filter(i => i.kind === kind).map(i => i.short.ja);

test("the 「PROで使えます」 notice sits above the phone's bottom menu and its raised centre button, safe-area aware", () => {
  const css = read("../app/research/pro-experience/samples/samples.module.css");
  const phone = css.match(/@media \(max-width:760px\)\{\.notice\{([^}]*)\}\}/);
  assert.ok(phone, "a phone rule for the notice");
  const bottom = Number(phone[1].match(/bottom:calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)/)?.[1]);
  // bottom-nav.module.css: the dock sits 10px up, the bar is about 73px tall and the 64px orb (with its 7px ring) rises to about 110px.
  assert.ok(bottom >= 120, `notice bottom ${bottom}px clears the centre button`);
  assert.match(read("../app/research/pro-experience/samples/frame.tsx"), /className=\{styles\.notice\}/, "every sample uses the frame's one notice");
});

test("Stock Comparison: price momentum is scored and drawn but never listed; a sub-10% FCF margin is no strength", () => {
  const [nvda, amd] = compareSample(["NVDA", "AMD"]).companies;
  for (const c of [nvda, amd]) {
    assert.ok(comparisonScores(c, compareNow).find(s => s.id === "momentum").value !== null, `${c.ticker}: momentum stays in the score`);
    assert.ok(!items(c).some(i => i.id === "momentum" || /約3か月の株価|3-month price/.test(i.short.ja + i.short.en)), c.ticker);
    assert.ok(!detailTraits(c, compareNow).some(i => i.id === "momentum"), c.ticker);
  }
  // AMD: 4.1% simple FCF margin is not a strength (the cash score's 7 is 10%); its one weakness is a fundamentals point from its own figure.
  assert.ok(amd.quarterFcfMargin < FCF_STRENGTH_PCT);
  assert.ok(!shorts(amd, "strength").some(s => s.includes("簡易FCF率")));
  assert.deepEqual(shorts(amd, "weakness"), [`平均株式数 +${amd.quarterDilutedSharesGrowth.toFixed(1)}%`]);
  assert.ok(amd.quarterDilutedSharesGrowth > 5);
  assert.ok(shorts(nvda, "strength").includes("簡易FCF率 22.2%"), "NVDA's 22.2% stays a strength");
  const summary = overallComparison([nvda, amd], "ja", compareNow).description;
  assert.doesNotMatch(summary, /株価が約3か月で/);
  assert.match(summary, /AMDは割安さが強みですが、平均株式数が6\.3%増えています。/);
});

test("listedTraits: a saved momentum bullet or a low-FCF strength is dropped; a missing weakness is filled only by a genuinely weak factor", () => {
  const [, amd] = compareSample(["NVDA", "AMD"]).companies;
  const copy = (ja, en = ja) => ({ ja, en });
  const saved = [
    { id: "momentum", kind: "weakness", short: copy("約3か月の株価 -8.6%"), detail: copy("") },
    { id: "momentum", kind: "strength", short: copy("約3か月 +20.0%"), detail: copy("") },
    { id: "cash-generation", kind: "strength", short: copy("簡易FCF率 4.1%"), detail: copy("") },
    { id: "revenue-growth", kind: "strength", short: copy("売上成長 +44.7%"), detail: copy("") },
  ];
  // AMD's weakest fundamental (profitability, 21.2% margin = 4.2) is above WEAK_SCORE: no filler.
  assert.deepEqual(listedTraits(amd, saved, compareNow).map(i => i.short.ja), ["売上成長 +44.7%"]);
  // The same company with a 9% operating margin: profitability scores 1.8, at or below WEAK_SCORE, so it is listed as the weakness.
  const thin = { ...amd, quarterOperatingMargin: 9 };
  const score = comparisonScores(thin, compareNow).find(s => s.id === "profitability").value;
  assert.ok(score <= WEAK_SCORE);
  const filled = listedTraits(thin, saved, compareNow);
  assert.deepEqual(filled.filter(i => i.kind === "weakness").map(i => i.short.ja), ["営業利益率 9.0%"]);
  assert.ok(!detailTraits({ ...thin, preparedAnalysis: { ...thin.preparedAnalysis, items: saved } }, compareNow).some(i => i.id.startsWith("weak-")),
    "the filled-in point has no prepared explanation, so the detail panel leaves it out");
  // With a weakness of its own, nothing is added.
  const own = [...saved, { id: "share-count", kind: "weakness", short: copy("平均株式数 +6.3%"), detail: copy("") }];
  assert.deepEqual(listedTraits(thin, own, compareNow).filter(i => i.kind === "weakness").map(i => i.short.ja), ["平均株式数 +6.3%"]);
});

test("the real comparison writes no momentum bullet and an FCF strength only from 10%", () => {
  const base = { ticker: "X", currency: "USD", periodEnd: "2026-09-30", revenue: 100, revenueGrowthPct: null, operatingMarginPct: null,
    operatingIncomeBasis: "operating", retrievedAt: "2026-11-01T00:00:00Z" };
  const kinds = pct => prepareTwelveComparison({ ...base, freeCashFlowMarginPct: pct }, undefined, Date.parse("2026-11-02T00:00:00Z"))
    .items.filter(i => i.id === "cash-generation").map(i => i.kind);
  assert.deepEqual(kinds(4.1), []);
  assert.deepEqual(kinds(10), ["strength"]);
  assert.deepEqual(kinds(-2), ["weakness"]);
  assert.doesNotMatch(read("../lib/research/twelve-data-financials.ts"), /約3か月の株価/);
  for (const file of ["../app/research/compare/comparison-visuals.tsx", "../app/research/compare/screen.tsx", "../app/research/compare/sample/screen.tsx", "../app/research/pro-experience/samples/compare.tsx"])
    assert.match(read(file), /listedTraits|detailTraits/, file);
});

test("監視22銘柄 live monitor: only the first item of each stock opens (+), with 3-4 lines; the others are headlines only", () => {
  const { dives } = JSON.parse(read("../lib/research/pro-experience-samples/watch22-dives.json"));
  for (const dive of dives) {
    const [first, ...rest] = dive.top.news;
    for (const lang of ["Ja", "En"]) {
      const lines = first[`impact${lang}`].split("\n");
      assert.ok(lines.length >= 3 && lines.length <= 4, `${dive.ticker} ${lang}: ${lines.length} lines`);
      assert.ok(lines.every(line => line.trim().length > 20));
      for (const item of rest) assert.equal(item[`impact${lang}`], "", `${item.id} has no + (summary only)`);
    }
  }
});

test("スマホ通知: no 「動画 0:30・タップで再生」 caption under the video, in either language", () => {
  const screen = read("../app/research/pro-experience/screen.tsx");
  assert.doesNotMatch(screen, /タップで再生|tap to play|videoLabel/);
});
