// 今夜のひと息 rebuild (owner, Nov 25): video choice, today-like days from real index levels, the three questions, the record.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { similarDays, similarBand, bigDrops, dayLabel, periodLabel, periodRange } from "../lib/resolute/similar-days.ts";
import { tonightIndex, tonightMove, tonightVideo, recordView, alertLines, nearestLine, tonightFacts, fixedTonightQuestions, parseTonightQuestions, FIXED_QUESTIONS } from "../lib/resolute/tonight.ts";
import { parseTonightInput, createTonightStore } from "../lib/resolute/tonight-database.ts";
import { parseTonightResponse } from "../lib/resolute/tonight-transport.ts";
import { safeThermometerSnapshot } from "../lib/resolute/thermometer-runtime.ts";
import { createTonightQuestionModel, generateTonightQuestions, createTonightJobHook } from "../services/resolute-api/tonight-questions.mjs";
import { ownerAccessFromVerifiedSession } from "../lib/resolute/owner-access.ts";
import { PRODUCTION_OWNER_ACCOUNT_ID } from "../lib/membership/entitlements.ts";
import { NotificationAccessDenied } from "../lib/resolute/notification-database.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
/** Weekday sessions from `start`, with closes from `fn(i)`. */
function series(start, n, fn) {
  const out = []; const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; out.length < n; d.setUTCDate(d.getUTCDate() + 1)) { if ([0, 6].includes(d.getUTCDay())) continue; out.push({ date: d.toISOString().slice(0, 10), close: fn(i++) }); }
  return out;
}

test("the similarity band: 20% of tonight's move, 0.5 to 1.5 points, same direction", () => {
  assert.deepEqual(similarBand(-7.5), { low: -9, high: -6 });
  assert.deepEqual(similarBand(-3), { low: -3.6, high: -2.4 });
  assert.deepEqual(similarBand(-1), { low: -1.5, high: -0.5 });
  assert.deepEqual(similarBand(0.3), { low: 0.1, high: 0.8 });
  assert.deepEqual(similarBand(12), { low: 10.5, high: 13.5 });
});

test("similar days are counted from the levels: recovery is the first close above the close before the day", () => {
  // Flat at 100, with a −7% day on session 1000 that recovers 30 sessions later, and a −7% day 5 sessions before tonight that has not.
  const closes = Array(2700).fill(100);
  for (let i = 1000; i < 1030; i++) closes[i] = 93; closes[1030] = 100.5; for (let i = 1031; i < 2694; i++) closes[i] = 100.5;
  for (let i = 2694; i < 2699; i++) closes[i] = 93.4; closes[2699] = 86.9; // tonight: −7.0%
  const levels = series("2016-01-04", 2700, i => closes[i]);
  const tonight = levels.at(-1).date, h = similarDays(levels, tonight);
  assert.equal(h.direction, "down"); assert.equal(h.changePercent, -6.96);
  assert.equal(h.count, 2);
  assert.equal(h.recovered, 1);
  assert.equal(h.recent[0].date, levels[2694].date); assert.equal(h.recent[0].recoveredOn, null); assert.equal(h.recent[0].days, null);
  assert.equal(h.recent[1].date, levels[1000].date); assert.equal(h.recent[1].recoveredOn, levels[1030].date);
  assert.equal(h.minDays, h.maxDays); assert.equal(h.minDays, 42); // 30 sessions = 6 weeks = 42 calendar days
  // Not ten full years before tonight: no answer (never a shorter history).
  assert.equal(similarDays(levels.slice(200), tonight), null);
  // Tonight must be in the levels.
  assert.equal(similarDays(levels, "2030-01-01"), null);
});

test("up nights: the move one month (21 sessions) later instead of recovery", () => {
  const closes = Array(2700).fill(100); closes[1500] = 105; for (let i = 1501; i < 2699; i++) closes[i] = 105 + (i - 1500) * 0.01; closes[2699] = closes[2698] * 1.05;
  const levels = series("2016-01-04", 2700, i => closes[i]);
  const h = similarDays(levels, levels.at(-1).date);
  assert.equal(h.direction, "up"); assert.equal(h.count, 1); assert.equal(h.monthCount, 1); assert.equal(h.higherAfterMonth, 1);
  assert.equal(h.recent[0].monthAfterPercent, Math.round(100 * (closes[1521] / closes[1500] - 1) * 10) / 10);
});

test("first open: past big falls with only the time to get back (no fall size)", () => {
  const closes = Array(2700).fill(100);
  for (let i = 1100; i < 1160; i++) closes[i] = 80; closes[1160] = 101; for (let i = 1161; i < 2700; i++) closes[i] = 101;
  for (let i = 2600; i < 2700; i++) closes[i] = 84; // a fall still under water
  const levels = series("2016-01-04", 2700, i => closes[i]);
  const drops = bigDrops(levels, levels.at(-1).date);
  assert.equal(drops.length, 2);
  assert.deepEqual(Object.keys(drops[0]).sort(), ["days", "peak", "recoveredOn", "trough"]);
  assert.equal(drops[0].recoveredOn, levels[1160].date);
  assert.equal(drops[1].recoveredOn, null);
});

test("names only for days everyone knows; other days by date; periods as words", () => {
  assert.equal(dayLabel("2025-04-04", "ja"), "2025年4月 関税ショック");
  assert.equal(dayLabel("2020-03-16", "ja"), "2020年3月 コロナショック");
  assert.equal(dayLabel("2019-08-05", "ja"), "2019年8月5日");
  assert.equal(periodLabel(3, "ja"), "3日"); assert.equal(periodLabel(29, "ja"), "約4週間"); assert.equal(periodLabel(30, "ja"), "約1か月"); assert.equal(periodLabel(92, "ja"), "約3か月");
  assert.equal(periodLabel(365, "ja"), "約1年"); assert.equal(periodLabel(500, "ja"), "約1年4か月");
  assert.equal(periodRange(31, 365, "ja"), "約1か月〜1年");
  assert.equal(periodRange(50, 365, "ja"), "約2か月〜1年");
});

test("the thermometer snapshot keeps similar days and big falls only when they are sound", () => {
  const h = { date: "2026-11-24", changePercent: -7.5, direction: "down", low: -9, high: -6, from: "2016-11-24", count: 6, recovered: 6, minDays: 30, maxDays: 365,
    monthCount: 6, higherAfterMonth: 3, monthMin: -5, monthMax: 8, recent: [{ date: "2025-04-04", changePercent: -6.2, recoveredOn: "2025-05-12", days: 38, monthAfterPercent: 4.1 }] };
  const drops = [{ peak: "2020-02-19", trough: "2020-03-16", recoveredOn: "2020-06-05", days: 107 }];
  const s = safeThermometerSnapshot({ asOf: "2026-11-24", nas100: { status: "unavailable", reason: "x" }, sox: { status: "unavailable", reason: "x" }, vix: { status: "unavailable", reason: "x" },
    history: { nas100: h, sox: { ...h, date: "2026-11-21" } }, drops: { nas100: drops, sox: [{ peak: "x" }] } }, "2026-11-24");
  assert.deepEqual(s.history.nas100, h);
  assert.equal(s.history.sox, null, "another night's history is dropped");
  assert.deepEqual(s.drops.nas100, drops);
  assert.equal(s.drops.sox, null);
  const provider = read("../lib/resolute/thermometer-provider.ts");
  assert.match(provider, /history = \{ nas100: 'levels' in large \? similarDays\(large\.levels, confirmedSession\)/, "from the same basket levels: no extra provider calls");
});

test("tonight's index, move and video", () => {
  assert.equal(tonightIndex({ answers: { q20: "stock", q21: "tech_semis" } }), "sox");
  assert.equal(tonightIndex({ answers: { q20: "mixed", q21: "tech_semis" } }), "sox");
  assert.equal(tonightIndex({ answers: { q20: "fund_etf", q21: "tech_semis" } }), "nas100");
  assert.equal(tonightIndex(null), "nas100");
  const snap = { asOf: "2026-11-24", moves: { nas100: { date: "2026-11-24", previousDate: "2026-11-21", changePercent: -7.5 }, sox: { date: "2026-11-24", previousDate: "2026-11-21", changePercent: 2.1 } } };
  assert.equal(tonightMove(snap, "nas100").direction, "down"); assert.equal(tonightMove(snap, "sox").direction, "up");
  assert.equal(tonightVideo("down"), 1, "down night: 変わらないもの"); assert.equal(tonightVideo("up"), 0, "up night: 深呼吸"); assert.equal(tonightVideo(null), 0);
});

test("the record sentence follows the morning answers", () => {
  assert.equal(recordView({ total: 1, tonight: true, pastCalm: 0, nights: [] }, "ja").sentence, "今夜が1回目の記録になります");
  assert.equal(recordView({ total: 1, tonight: true, pastCalm: 0, nights: [] }, "ja").count, 1);
  assert.equal(recordView({ total: 4, tonight: true, pastCalm: 3, nights: [] }, "ja").sentence, "これまでの3回は、3回とも慌てて注文せずに朝を迎えています");
  assert.equal(recordView({ total: 4, tonight: true, pastCalm: 2, nights: [] }, "ja").sentence, "これまでの3回のうち2回は、慌てて注文せずに朝を迎えています");
  assert.equal(recordView({ total: 3, tonight: false, pastCalm: 0, nights: [] }, "ja").sentence, "これまでに3回、荒れた夜にここを開いています");
  assert.equal(recordView({ total: 3, tonight: false, pastCalm: 0, nights: [] }, "ja").ordinal, false);
});

test("the nearest alert line not yet reached", () => {
  const lines = alertLines({ watchItems: [{ symbol: "NVDA", referencePrice: 180 }, { symbol: "MU", referencePrice: 100 }], surgeCapPct: 50 }, { buyLines: [{ dropPct: 10, amount: 1 }, { dropPct: 20, amount: 1 }] });
  assert.deepEqual(lines.filter(l => l.symbol === "NVDA").map(l => l.price), [162, 144, 270]);
  assert.deepEqual(nearestLine(lines, { NVDA: 170, MU: 121 }), { symbol: "NVDA", kind: "buy", price: 162, pct: 10 });
  assert.deepEqual(nearestLine(lines, { NVDA: 160 }), { symbol: "NVDA", kind: "buy", price: 144, pct: 20 }, "a line already passed is not the next one");
  assert.equal(nearestLine(lines, {}), null, "no current price: nothing shown");
});

const plan = { tolerancePct: 30, perStockCapPct: 10, reserveMonths: 6, buyLines: [{ dropPct: 10, amount: 1 }] };
const settings = { watchItems: [{ symbol: "NVDA", referencePrice: 180 }], surgeCapPct: null, deliveryHourJst: 7, morningEnabled: true };
const facts = tonightFacts({ direction: "down", index: "nas100", movePct: -7.46, plan, settings });

test("the fixed three questions carry the member's own numbers", () => {
  const q = fixedTonightQuestions("2026-11-24", facts);
  assert.deepEqual(q.questions.map(x => x.ask), FIXED_QUESTIONS);
  assert.equal(q.questions[0].note.ja, "あなたは−30%までは持ち続けると決めています");
  assert.equal(q.questions[1].note.ja, "翌朝のひとことは朝7:00に届きます");
  assert.equal(q.questions[2].note.ja, "生活費の現金は6か月分残すと決めています");
  assert.equal(facts.notes.find(n => n.id === "buy-NVDA").ja, "次の買い増しはNVDAが$162に届いた日です");
  assert.equal(facts.movePct, 7.5);
});

test("AI questions: no digits of their own, tickers from the member's list, notes picked by id", () => {
  const ok = JSON.stringify({ questions: [
    { ja: "NVDAを売りたくなっていませんか？", en: "Do you feel like selling NVDA?", note: "tolerance" },
    { ja: "今夜すぐ買い足そうとしていませんか？", en: "Are you about to buy more tonight?", note: "buy-NVDA" },
    { ja: "明日の朝も、同じ判断をしますか？", en: "Would you decide the same tomorrow morning?", note: null } ] });
  const q = parseTonightQuestions(ok, facts, "2026-11-24");
  assert.equal(q.source, "ai"); assert.equal(q.questions[1].note.ja, "次の買い増しはNVDAが$162に届いた日です"); assert.equal(q.questions[2].note, null);
  const bad = (patch, i = 0) => { const v = JSON.parse(ok); Object.assign(v.questions[i], patch); return parseTonightQuestions(JSON.stringify(v), facts, "2026-11-24"); };
  assert.equal(bad({ ja: "NVDAが7%下がっても売りませんか？" }), null, "a number written by the AI");
  assert.equal(bad({ ja: "AAPLを売りたくなっていませんか？" }), null, "a ticker the member does not watch");
  assert.equal(bad({ note: "made-up" }), null);
  assert.equal(bad({ note: "buy-NVDA" }), null, "the same note twice");
  assert.equal(bad({ ja: "今が買い時ではありませんか？" }), null, "no buy or sell advice");
  assert.equal(bad({ ja: "NVDAを売りたくなっていませんか…？" }), null, "no ellipsis");
  assert.equal(parseTonightQuestions("{}", facts, "2026-11-24"), null);
});

const good = JSON.stringify({ questions: [{ ja: "NVDAを売りたくなっていませんか？", en: "Do you feel like selling NVDA?", note: "tolerance" }, { ja: "明日の朝も、同じ判断をしますか？", en: "Same decision tomorrow morning?", note: "morning" }, { ja: "暮らしのお金に影響しませんか？", en: "Will it touch your living money?", note: "reserve" }] });

test("the model: 「今日やること」's model, budget bucket and strict JSON; the questions: one regeneration, then null (the fixed three)", async () => {
  const bodies = [], reserved = [];
  const fetcher = async (url, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ status: "completed", usage: { input_tokens: 900, output_tokens: 200 }, output: [{ type: "message", content: [{ type: "output_text", text: good }] }] }), { status: 200, headers: { "content-type": "application/json" } }); };
  // The real reservation runs against the today-plan bucket; a fake pool records the table it is asked for.
  const pool = { query: async (sql, values) => { reserved.push(sql.replace(/\s+/g, " ").slice(0, 60)); return { rows: [{ reserved_usd: values?.[1] }] }; } };
  const model = createTonightQuestionModel({ apiKey: "k", pool, fetcher, limit: 10 });
  const reply = await model(facts);
  assert.equal(bodies[0].model, "gpt-5.4-mini"); assert.equal(bodies[0].text.format.strict, true); assert.match(bodies[0].input, /"notes"/);
  assert.ok(reserved[0].includes("resolute.today_plan_budget"), "the same monthly bucket as 「今日やること」");
  assert.equal(parseTonightQuestions(reply.text, facts, "2026-11-24").source, "ai");
  let calls = 0;
  const bad = async () => { calls++; return { text: "not json", usage: null }; };
  assert.equal((await generateTonightQuestions(facts, "2026-11-24", bad)).questions, null);
  assert.equal(calls, 2, "one regeneration");
  const budget = async () => { calls++; throw Error("BUDGET_LIMIT"); };
  calls = 0; assert.deepEqual((await generateTonightQuestions(facts, "2026-11-24", budget)).reasons, ["BUDGET_LIMIT"]); assert.equal(calls, 1, "no retry when the budget refuses");
  assert.equal((await generateTonightQuestions(facts, "2026-11-24", null)).questions, null);
});

test("the daily job hook: one claimed attempt per member and night, stored for the page", async () => {
  const writes = []; let claimed = false;
  const pool = { query: async (sql, values) => {
    if (sql.includes("INSERT INTO resolute.tonight_questions")) { if (claimed) return { rows: [] }; claimed = true; return { rows: [{}] }; }
    writes.push(values); return { rows: [] };
  } };
  const hook = createTonightJobHook({ pool, model: async () => ({ text: good, usage: null }) });
  const snapshot = { asOf: "2026-11-24", moves: { nas100: { date: "2026-11-24", previousDate: "2026-11-21", changePercent: -7.46 }, sox: null } };
  assert.equal(await hook({ id: "user_a", session: "2026-11-24", snapshot, plan: { ...plan, answers: {} }, settings }), "ai");
  assert.equal(writes[0][2], "ready"); assert.equal(JSON.parse(writes[0][3]).questions.length, 3);
  assert.equal(await hook({ id: "user_a", session: "2026-11-24", snapshot, plan: { ...plan, answers: {} }, settings }), "existing");
  assert.equal(await hook({ id: "user_a", session: "2026-11-24", snapshot: { asOf: "2026-11-24" }, plan: { ...plan, answers: {} }, settings }), "no-move");
  const job = read("../services/resolute-api/today-plan-job.mjs");
  assert.match(job, /if\(tonight\)\{try\{const t=await tonight\(\{id,session,snapshot,plan,settings\}\)/, "called from the 「今日やること」 member loop");
  assert.match(job, /RESOLUTE_TONIGHT_AI_ENABLED==='true'\?createTonightJobHook/);
});

test("the record store: rough nights only, the alert day from delivered alerts, the owner always allowed", async () => {
  const calls = [];
  const pool = { query: async sql => {
    calls.push(sql.replace(/\s+/g, " ").trim().slice(0, 40));
    if (sql.includes("FROM resolute.entitlements")) return { rowCount: 0, rows: [] };
    if (sql.includes("notification_outbox")) return { rowCount: 0, rows: [] };
    if (sql.includes("count(*)")) return { rows: [{ total: 2, tonight: 1, calm: 1 }] };
    if (sql.includes("ORDER BY night_date DESC")) return { rows: [{ night: "2026-11-10", stars: 4, alert: false, answer: "done" }] };
    if (sql.includes("SELECT state, questions")) return { rows: [] };
    if (sql.includes("INSERT INTO resolute.tonight_questions")) return { rowCount: 1, rows: [{}] };
    return { rowCount: 1, rows: [] };
  } };
  const store = createTonightStore(pool, "sandbox", { readPlan: async () => plan, readSettings: async () => settings, today: () => "2026-11-25" });
  const owner = ownerAccessFromVerifiedSession({ sub: PRODUCTION_OWNER_ACCOUNT_ID, iss: "https://clerk.techphase.app", azp: "https://techphase.app", fva: [0, 1], exp: Date.now() / 1000 + 600 });
  await assert.rejects(store("user_member1", { action: "open", night: "2026-11-24", stars: 5, direction: "down", index: "nas100", movePct: -7.5 }), NotificationAccessDenied);
  const out = await store(PRODUCTION_OWNER_ACCOUNT_ID, { action: "open", night: "2026-11-24", stars: 5, direction: "down", index: "nas100", movePct: -7.5 }, owner);
  assert.equal(out.record.total, 2); assert.equal(out.record.nights[0].answer, "done");
  assert.equal(out.questions.source, "fixed", "no stored AI questions: the fixed three");
  assert.ok(calls.some(c => c.startsWith("INSERT INTO resolute.tonight_nights")), "★5: recorded");
  calls.length = 0;
  await store(PRODUCTION_OWNER_ACCOUNT_ID, { action: "open", night: "2026-11-24", stars: 2, direction: "down", index: "nas100", movePct: -1 }, owner);
  assert.ok(!calls.some(c => c.startsWith("INSERT INTO resolute.tonight_nights")), "★2 and no alert: not a rough night");
});

test("inputs and responses are checked on both sides", () => {
  assert.deepEqual(parseTonightInput({ action: "answer", answer: "skipped" }), { action: "answer", answer: "skipped" });
  assert.throws(() => parseTonightInput({ action: "answer", answer: "bought" }));
  assert.throws(() => parseTonightInput({ action: "open", night: "2026-12-30", stars: 4, direction: "down", index: "nas100", movePct: -2 }, "2026-11-25"), "no future night");
  assert.throws(() => parseTonightInput({ action: "open", night: "2026-11-24", stars: 9, direction: "down", index: "nas100", movePct: -2 }, "2026-11-25"));
  assert.throws(() => parseTonightInput({ action: "open", night: "2026-11-24", stars: 4, direction: "down", index: "nas100", movePct: -2, amount: 1 }, "2026-11-25"));
  assert.throws(() => parseTonightResponse({ record: { total: -1, tonight: true, pastCalm: 0, nights: [] }, questions: null }));
  const r = parseTonightResponse({ record: { total: 1, tonight: true, pastCalm: 0, nights: [] }, questions: { night: "2026-11-24", source: "ai", questions: [{ ask: { ja: "a…", en: "b" }, note: null }, 1, 2] } });
  assert.equal(r.questions, null, "a bad questions block falls back to the fixed three on the page");
});

test("the page: four panels, no loss amount or asset %, the removed sections are gone, the video has its own controls", () => {
  const screen = read("../app/resolute/tonight/screen.tsx");
  for (const gone of ["あなたの足元", "TODAY’S NEWS", "買う前の3つの質問", "YOUR BASE", "lossAmount", "coverPlay"]) assert.ok(!screen.includes(gone), gone);
  assert.match(screen, /<ToolShell identityReady=\{identityReady\} pc>/);
  assert.match(screen, /今夜はこの1本を選んでいます/);
  assert.match(screen, /今夜は決めない/);
  assert.match(screen, /これからの値動きを約束するものではありません/);
  assert.match(screen, /次にあなたが動くとき/);
  assert.match(screen, /それまでは何もしなくていいと、あなた自身が決めています。/);
  assert.match(screen, /requestFullscreen/);
  assert.match(screen, /className=\{s\.bigPlay\}/);
  const css = read("../app/resolute/tonight/reference.module.css");
  assert.match(css, /\.pc \.grid \{ display:grid; grid-template-columns:minmax\(0,1\.3fr\) minmax\(0,1fr\); gap:24px; align-items:stretch; \}/);
  assert.doesNotMatch(css, /coverPlay/);
  const sql = read("../db/resolute/028_tonight.sql");
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON resolute\.tonight_nights, resolute\.tonight_questions TO resolute_notification_writer;/);
  assert.doesNotMatch(sql, /GRANT[^;]*DELETE|DROP TABLE/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON resolute\.tonight_questions TO resolute_today_plan_writer;/);
  assert.match(sql, /CREATE TRIGGER resolute_forget_tonight AFTER INSERT OR UPDATE OF plan ON resolute\.plans/);
});
