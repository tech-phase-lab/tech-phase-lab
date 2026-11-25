import type { PlanInput } from "./plan-data.ts";
import { notebookResult } from "./plan-summary.ts";
import type { DiagnosisLocale } from "./diagnosis-copy.ts";

/** What the home Shock Gauge card shows under the day's news (owner, Nov 25: 「今日やること: ルールを読み返す」 is too weak for a
 * paid product). It shows the member's OWN saved rules that apply on a shock day, word for word from their rulebook; it never
 * makes up advice. ★1–2: nothing. ★3: one rule. ★4–5: up to two rules, prominently, with a link to open the rulebook.
 * No saved plan, or none of these rules set: a short prompt to set one. */
export type ShockRuleView = { kind: "quiet" } | { kind: "rules"; prominent: boolean; lines: string[] } | { kind: "missing"; prominent: boolean };

/** The rules that apply when the market is shaken, in this order: when to pause (their own conditions), the loss that is
 * their cue to review (amount and %), their exit level. Each line is their saved rule as the rulebook shows it. */
export function shockRules(plan: PlanInput, locale: DiagnosisLocale): string[] {
  const en = locale === "en", rows = notebookResult(plan, locale).rows, out: string[] = [];
  const q29 = plan.answers.q29, pause = (Array.isArray(q29) && q29.length > 0) || plan.haltConditions.length > 0;
  if (pause) out.push(en ? `${rows[5].item}: ${rows[5].rule} → ${rows[5].meaning}` : `${rows[5].item}：${rows[5].rule} → ${rows[5].meaning}`);
  if (plan.tolerancePct !== null && plan.toleranceDrop !== null) out.push(en ? `${rows[1].item} (−${plan.tolerancePct}%): ${rows[1].meaning}` : `${rows[1].item}（−${plan.tolerancePct}%）：${rows[1].meaning}`);
  if (plan.stopLossPct != null) out.push(en ? `Exit rule: my chosen exit level is −${plan.stopLossPct}%` : `損切りのルール：自分で決めた損切りラインは −${plan.stopLossPct}%`);
  return out;
}

export function shockRuleView(plan: PlanInput | null | undefined, stars: number | null, locale: DiagnosisLocale): ShockRuleView {
  if (stars === null || stars <= 2) return { kind: "quiet" };
  const lines = plan ? shockRules(plan, locale) : [];
  if (!lines.length) return { kind: "missing", prominent: stars >= 4 };
  return stars >= 4 ? { kind: "rules", prominent: true, lines: lines.slice(0, 2) } : { kind: "rules", prominent: false, lines: lines.slice(0, 1) };
}
