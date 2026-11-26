import type { Copy } from "../research/data.ts";
import type { TodayCheck, TodayPlan } from "./today-plan.ts";
import type { CheckFact } from "./today-plan-facts.ts";

/** Strict checks for 「今日やること」 (owner, Nov 25): the model's output is used only when every rule holds; otherwise it is
 * regenerated once and then replaced by fixedTodayPlan. The same shape check guards the read API and the site route. */

export const HEADLINE_MAX_JA = 12;
export const HEADLINE_MAX_EN = 40;
const LINE_MAX = { ja: 48, en: 140 } as const;
const CELL_MAX = { ja: 24, en: 48 } as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const chars = (s: string) => [...s].length;
const cleanText = (s: unknown): s is string => typeof s === "string" && s.isWellFormed() && !/[<>\u0000-\u0009\u000b-\u001f]/.test(s);

/** Fixed rejection codes (logged; never the text). */
export const TODAY_REJECTIONS = Object.freeze(["shape", "headline-length", "body-lines", "too-many-checks", "unknown-check", "new-number", "ellipsis", "advice", "direction", "day-move", "distance"] as const);
export type TodayRejection = typeof TODAY_REJECTIONS[number];

/** Buying or selling recommendations beyond the member's own rules. The member's planned buy-more (買い増し) is their rule, so
 * 「買い増し」 alone is allowed; telling them to buy, sell, or that it is a good time is not. */
const ADVICE = /買いましょう|売りましょう|買うべき|売るべき|買った方が|売った方が|買ったほうが|売ったほうが|買い時|売り時|買い場|売り場|今が買|今が売|チャンス|おすすめ|お勧め|推奨|狙い目|仕込み|利益確定しましょう|損切りしましょう|買ってください|売ってください|\b(?:should|must) (?:buy|sell)\b|\bbuy now\b|\bsell now\b|\brecommend(?:s|ed|ation)?\b|\bbuying opportunity\b|\bgood time to (?:buy|sell)\b|\bopportunity\b/i;
/** Never cut text with an ellipsis (owner: 「…」で切らない). */
const ELLIPSIS = /…|\.\.\.|‥|。。。/;
/** Down-day / up-day wording that must not appear on the opposite day (contract: never a down-day rule on an up day). */
const DOWN_DAY = /むやみに動かない|下がった日|下落した日|急落|暴落|\bdown day\b|\bsell-?off\b/i;
const UP_DAY = /浮かれて|上がった日|上昇した日|急騰|\bup day\b|\brally\b/i;

/** Wording of the body (owner, Nov 26 §4). A same-day move is always written with 「今日」 / "today", and the distance to a line is
 * written only with the "from base" numbers of the rows: a line that carries a day move may not speak of a distance. */
const TODAY_WORD = { ja: /今日/, en: /\btoday(?:'s|’s)?\b/i } as const;
const DISTANCE_WORD = { ja: /線まで|ラインまで|あと|届/, en: /\bto go\b|\baway from\b|\bfrom (?:your|the) line\b|\breach/i } as const;
export function wordingIssue(lines: { ja: readonly string[]; en: readonly string[] }, dayMoves: readonly number[]): "day-move" | "distance" | null {
  const moves = new Set(dayMoves.map(n => String(Math.abs(n))));
  if (!moves.size) return null;
  for (const l of ["ja", "en"] as const) for (const line of lines[l]) {
    if (!numberTokens(line).some(n => moves.has(n))) continue;
    if (!TODAY_WORD[l].test(line)) return "day-move";
    if (DISTANCE_WORD[l].test(line)) return "distance";
  }
  return null;
}

/** Digits as they are compared: NFKC (full-width → ASCII), thousands separators removed, sign dropped. */
export function numberTokens(text: string): string[] {
  return (text.normalize("NFKC").match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? []).map(n => n.replace(/,/g, "").replace(/^0+(?=\d)/, ""));
}
/** Every number in the output must appear in the inputs or the member's plan (the serialized model input carries both). */
export function allowedNumbers(...sources: unknown[]): Set<string> {
  const set = new Set<string>();
  for (const s of sources) for (const n of numberTokens(typeof s === "string" ? s : JSON.stringify(s))) {
    set.add(n);
    if (n.includes(".")) set.add(n.replace(/\.?0+$/, "")); // 30.0 also allows 30
  }
  return set;
}
export const unknownNumbers = (text: string, allowed: ReadonlySet<string>) => numberTokens(text).filter(n => !allowed.has(n) && !(n.includes(".") && allowed.has(n.replace(/\.?0+$/, ""))));

const isCopy = (v: unknown, max: { ja: number; en: number }, lines = 1): v is Copy => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  const fits = (t: string, m: number) => { const l = t.split("\n"); return l.length <= lines && l.every(x => !!x.trim() && chars(x) <= m); };
  return Object.keys(c).length === 2 && cleanText(c.ja) && cleanText(c.en) && fits(c.ja, max.ja) && fits(c.en, max.en);
};
const bodyLines = (s: string) => s.split("\n");
const validBody = (v: unknown): v is Copy => {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length !== 2) return false;
  const c = v as Record<string, unknown>;
  return (["ja", "en"] as const).every(l => { const t = c[l]; if (typeof t !== "string" || !t.isWellFormed() || /[<>\u0000-\u0009\u000b-\u001f]/.test(t)) return false;
    const lines = bodyLines(t); return lines.length >= 2 && lines.length <= 4 && lines.every(x => x.trim() && x === x.trim() && chars(x) <= LINE_MAX[l]); });
};
const finitePct = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max && Math.round(v * 10) / 10 === v;

/** The stored / served shape, checked strictly (unknown keys reject the whole plan). */
export function parseTodayPlan(value: unknown): TodayPlan {
  const bad = () => { throw new Error("INVALID_TODAY_PLAN"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad();
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v), allowed = ["date", "source", "direction", "headline", "body", "checks", "estimate"];
  if (keys.some(k => !allowed.includes(k)) || allowed.slice(0, 6).some(k => !Object.hasOwn(v, k))) return bad();
  if (typeof v.date !== "string" || !DATE.test(v.date) || !Number.isFinite(Date.parse(v.date + "T00:00:00Z"))) return bad();
  if (v.source !== "ai" && v.source !== "fixed") return bad();
  if (!["up", "down", "flat"].includes(v.direction as string)) return bad();
  if (!isCopy(v.headline, { ja: HEADLINE_MAX_JA, en: HEADLINE_MAX_EN }) || !validBody(v.body)) return bad();
  if (!Array.isArray(v.checks) || v.checks.length > 3) return bad();
  const checks = (v.checks as unknown[]).map((raw): TodayCheck => {
    const c = raw as Record<string, unknown>;
    if (!c || typeof c !== "object" || Object.keys(c).length !== 4 || !isCopy(c.label, CELL_MAX) || !isCopy(c.rule, CELL_MAX, 2) || !isCopy(c.today, CELL_MAX) || (c.state !== "ok" && c.state !== "reached")) return bad();
    return { label: { ja: c.label.ja, en: c.label.en }, rule: { ja: c.rule.ja, en: c.rule.en }, today: { ja: c.today.ja, en: c.today.en }, state: c.state };
  });
  let estimate: TodayPlan["estimate"] | undefined;
  if (Object.hasOwn(v, "estimate")) {
    const e = v.estimate as Record<string, unknown> | null;
    if (e === null) estimate = null;
    else if (!e || typeof e !== "object" || Object.keys(e).length !== 3 || !finitePct(e.allowedDropPct, 0.1, 100) || !finitePct(e.estimatedChangePct, -100, 10000) || !finitePct(e.remainingPct, 0, 10100)) return bad();
    else estimate = { allowedDropPct: e.allowedDropPct as number, estimatedChangePct: e.estimatedChangePct as number, remainingPct: e.remainingPct as number };
  }
  const texts = [v.headline, v.body, ...checks.flatMap(c => [c.label, c.rule, c.today])].flatMap(c => [(c as Copy).ja, (c as Copy).en]);
  if (texts.some(t => ELLIPSIS.test(t))) return bad();
  return { date: v.date, source: v.source, direction: v.direction as TodayPlan["direction"], headline: { ja: v.headline.ja, en: v.headline.en },
    body: { ja: (v.body as Copy).ja, en: (v.body as Copy).en }, checks, ...(estimate !== undefined ? { estimate } : {}) };
}

/** What the model returns (json_schema, strict). Checks name a candidate by id; the state always comes from the facts. */
export type ModelTodayOutput = {
  headline: Copy; body: { ja: string[]; en: string[] };
  checks: { id: string; label: Copy; rule: Copy; today: Copy }[];
};
const copySchema = { type: "object", additionalProperties: false, properties: { ja: { type: "string" }, en: { type: "string" } }, required: ["ja", "en"] };
export const TODAY_OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["headline", "body", "checks"],
  properties: {
    headline: copySchema,
    body: { type: "object", additionalProperties: false, required: ["ja", "en"], properties: { ja: { type: "array", items: { type: "string" } }, en: { type: "array", items: { type: "string" } } } },
    checks: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "label", "rule", "today"],
      properties: { id: { type: "string" }, label: copySchema, rule: copySchema, today: copySchema } } },
  },
} as const;

/** The model's output → TodayPlan, or the reason it cannot be used. `inputs` is everything the model was given (numbers allowed). */
export function validateTodayOutput(output: unknown, ctx: { date: string; direction: TodayPlan["direction"]; checks: readonly CheckFact[]; estimate: TodayPlan["estimate"]; inputs: unknown[]; dayMoves?: readonly number[] }):
  { ok: true; plan: TodayPlan } | { ok: false; reason: TodayRejection } {
  const o = output as ModelTodayOutput;
  if (!o || typeof o !== "object" || !o.headline || !o.body || !Array.isArray(o.checks) || !Array.isArray(o.body.ja) || !Array.isArray(o.body.en)) return { ok: false, reason: "shape" };
  if (o.checks.length > 3) return { ok: false, reason: "too-many-checks" };
  const headline = { ja: String(o.headline.ja ?? "").trim(), en: String(o.headline.en ?? "").trim() };
  if (!headline.ja || !headline.en || chars(headline.ja) > HEADLINE_MAX_JA || chars(headline.en) > HEADLINE_MAX_EN) return { ok: false, reason: "headline-length" };
  const lines = { ja: o.body.ja.map(x => String(x).trim()), en: o.body.en.map(x => String(x).trim()) };
  if ((["ja", "en"] as const).some(l => lines[l].length < 2 || lines[l].length > 4 || lines[l].some(x => !x || x.includes("\n") || chars(x) > LINE_MAX[l]))) return { ok: false, reason: "body-lines" };
  const facts = new Map(ctx.checks.map(c => [c.id, c]));
  const seen = new Set<string>();
  const checks: TodayCheck[] = [];
  for (const c of o.checks) {
    const fact = typeof c?.id === "string" ? facts.get(c.id) : undefined;
    if (!fact || seen.has(c.id)) return { ok: false, reason: "unknown-check" };
    seen.add(c.id);
    // The row's words are the candidate's own (owner, Nov 26 §3: one fixed layout, the same numbers as the body); the model only picks.
    checks.push({ label: { ...fact.label }, rule: { ...fact.rule }, today: { ...fact.today }, state: fact.state });
  }
  const texts = [headline.ja, headline.en, ...lines.ja, ...lines.en, ...checks.flatMap(c => [c.label.ja, c.label.en, c.rule.ja, c.rule.en, c.today.ja, c.today.en])];
  if (texts.some(t => ELLIPSIS.test(t))) return { ok: false, reason: "ellipsis" };
  if (texts.some(t => ADVICE.test(t))) return { ok: false, reason: "advice" };
  const all = texts.join("\n");
  if (ctx.direction === "up" && DOWN_DAY.test(all) || ctx.direction === "down" && UP_DAY.test(all)) return { ok: false, reason: "direction" };
  if (unknownNumbers(all, allowedNumbers(...ctx.inputs)).length) return { ok: false, reason: "new-number" };
  const wording = wordingIssue({ ja: [headline.ja, ...lines.ja], en: [headline.en, ...lines.en] }, ctx.dayMoves ?? []);
  if (wording) return { ok: false, reason: wording };
  const plan = { date: ctx.date, source: "ai" as const, direction: ctx.direction, headline, body: { ja: lines.ja.join("\n"), en: lines.en.join("\n") }, checks,
    ...(ctx.estimate !== undefined ? { estimate: ctx.estimate } : {}) };
  try { return { ok: true, plan: parseTodayPlan(plan) }; } catch { return { ok: false, reason: "shape" }; }
}
