import { questions, questionCopy } from './diagnosis-form.ts';
import type { PlanSnapshot } from './plan-data.ts';
/** The member's own rules in their shortest form (owner, Nov 27: the Shock Gauge's くわしく panel), read-only: up to three lines —
 * the conditions for holding off, the conditions for pausing and the exit line — with the same labels as the plan screen
 * (notifications-screen.tsx) and today's plan (today-plan-facts.ts). Lines with nothing set are left out; no saved plan → none. */
export type ShortRule = { key: 'noBuy' | 'halt' | 'stopLoss'; label: string; text: string };
const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
export function shortRules(snapshot: PlanSnapshot | null | undefined, locale: 'ja' | 'en'): ShortRule[] {
  const plan = snapshot?.plan;
  if (!plan) return [];
  const en = locale === 'en';
  const conditions = (id: 'q28' | 'q29', extra: readonly string[]) => {
    const question = questions.find(q => q.id === id), selected = (plan.answers as Record<string, unknown> | undefined)?.[id];
    const chosen = question && Array.isArray(selected) ? questionCopy(question, locale).options.filter(o => selected.some(v => v === o.id)).map(o => o.label) : [];
    return [...chosen, ...extra.filter(t => typeof t === 'string' && t.trim())].join(' / ');
  };
  const out: ShortRule[] = [];
  const noBuy = conditions('q28', plan.noBuyConditions ?? []), halt = conditions('q29', plan.haltConditions ?? []);
  if (noBuy) out.push({ key: 'noBuy', label: en ? 'Conditions for holding off' : '買わない条件', text: noBuy });
  if (halt) out.push({ key: 'halt', label: en ? 'Conditions for pausing' : '立ち止まる条件', text: halt });
  if (typeof plan.stopLossPct === 'number' && plan.stopLossPct > 0) out.push({ key: 'stopLoss', label: en ? 'Exit line' : '損切りのライン', text: `−${pct(plan.stopLossPct)}` });
  return out;
}
/** The story's source link for 「記事を読む →」, or null for a story the owner added without a link (its placeholder URL). */
export const OWNER_ADDED_PLACEHOLDER = 'https://techphase.app/resolute/news';
export function articleLink(url: string): string | null {
  try { const u = new URL(url); return u.protocol === 'https:' && u.href.replace(/\/$/, '') !== OWNER_ADDED_PLACEHOLDER ? u.href : null; } catch { return null; }
}
