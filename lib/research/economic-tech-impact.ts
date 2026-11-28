/**
 * 「ハイテク株にとって」 (owner, Nov 28, econ-tech-impact-1128): one badge and one fixed sentence under an opened release's number.
 * Decided by a fixed rule table per indicator comparing this release with the previous one; no AI, so the same numbers always give
 * the same words. The sentences never forecast a price or recommend buying or selling: they only say what the number means.
 * An indicator outside the table (PPI, an election or any other event) gets no box, and neither does a release without a previous figure.
 */
import type { Value } from "./economic-release-view.ts";

type Lang = "ja" | "en";
type Copy = { ja: string; en: string };
export type ImpactBadge = "tailwind" | "neutral" | "headwind";
/** `case` names the sentence: the badge, or for jobs the two kinds of 中立 (a surge of at least twice the previous gain, or anything else). */
export type ImpactCase = ImpactBadge | "neutral-surge";
export type TechImpact = { badge: ImpactBadge; case: ImpactCase; label: string; badgeText: string; text: string };

export const IMPACT_LABEL: Copy = { ja: "ハイテク株にとって", en: "For tech stocks" };
export const BADGE_TEXT: Record<ImpactBadge, Copy> = {
  tailwind: { ja: "追い風", en: "Tailwind" },
  neutral: { ja: "中立", en: "Neutral" },
  headwind: { ja: "逆風", en: "Headwind" },
};

/** The rule table's rows. PCE and CPI share the price row; ADP and the jobs report share the jobs row. */
type Rule = "prices" | "claims" | "jobs" | "retail" | "gdp" | "ism" | "fomc";
export const RULE_OF: Record<string, Rule> = { pce: "prices", cpi: "prices", claims: "claims", jobs: "jobs", adp: "jobs", retail: "retail", gdp: "gdp", ism: "ism", fomc: "fomc" };

/** One sentence per cell of the rule table (indicator × badge), about 40 characters in Japanese (owner, Nov 28): noun-ending fragments
 * (体言止め) with no 「です」, each part closed by 「。」, each naming what the number means for tech (spending, IT and data-center investment,
 * rate-cut expectations, long-term rates). Claims never take 追い風. */
export const SENTENCES: Record<Rule, Partial<Record<ImpactCase, Copy>>> = {
  prices: {
    tailwind: { ja: "物価の伸びが前回より鈍化。利下げ期待と長期金利の低下を後押しする数字。", en: "Price growth slower than last time. Supports rate-cut hopes and lower long-term rates." },
    headwind: { ja: "物価の伸びが前回より加速。利下げ期待を後退させ、長期金利を押し上げる数字。", en: "Price growth faster than last time. Pushes rate cuts back and long-term rates up." },
    neutral: { ja: "物価の伸びは前回と同じ水準。利下げ期待や長期金利を大きく動かさない数字。", en: "Price growth same as last time. Little change to rate-cut hopes or long-term rates." },
  },
  claims: {
    headwind: { ja: "申請が大きく増加。雇用の冷え込みで、消費やIT投資の先行きに不安を残す数字。", en: "Claims up sharply. Cooling hiring clouds consumer and IT spending." },
    neutral: { ja: "申請は少なく雇用は底堅い状態。景気には安心材料、利下げは遠のく方向。", en: "Claims low, hiring solid. Reassuring for growth; rate cuts further off." },
  },
  jobs: {
    tailwind: { ja: "雇用の伸びが前回から加速。所得と消費を通じてIT需要の支えになる数字。", en: "Job growth faster than last time. Income and spending support IT demand." },
    headwind: { ja: "働く人の数が減少。消費や企業のIT投資に冷え込みの兆しを示す数字。", en: "Payrolls down. Signs of cooling in consumer and IT spending." },
    "neutral-surge": { ja: "雇用が前回の2倍以上に急増。景気は強いが、利下げ期待は遠のく方向。", en: "Hiring over twice last time. Strong growth; rate cuts further off." },
    neutral: { ja: "雇用の伸びは前回並みか鈍化。景気と利下げの見通しを大きく変えない数字。", en: "Job growth level or slower. Little change to the growth and rate outlook." },
  },
  retail: {
    tailwind: { ja: "売上の伸びが前回から加速。スマホやPCを含む個人消費の強さを示す数字。", en: "Sales growth faster than last time. Strong consumer spending, phones and PCs included." },
    headwind: { ja: "売上が前月から減少。スマホやPCを含む個人消費の弱まりを示す数字。", en: "Sales down from last month. Weaker consumer spending, phones and PCs included." },
    neutral: { ja: "売上の伸びは前回並みか鈍化。個人消費の見方を大きく変えない数字。", en: "Sales growth level or slower. Little change to the spending view." },
  },
  gdp: {
    tailwind: { ja: "景気の伸びが前回から加速。企業のIT投資や消費の支えになる数字。", en: "Growth faster than last time. Support for business IT investment and spending." },
    headwind: { ja: "景気がマイナス成長に転落。企業のIT投資や消費の縮小を示す数字。", en: "Economy contracting. Points to shrinking IT investment and spending." },
    neutral: { ja: "景気の伸びは前回並みか鈍化。IT投資や消費の見方を大きく変えない数字。", en: "Growth level or slower. Little change to the IT-investment and spending view." },
  },
  ism: {
    tailwind: { ja: "景況感が50以上で前回から改善。半導体など製造業の需要拡大を示す数字。", en: "50 or above and improving. Growing demand at chipmakers and other factories." },
    headwind: { ja: "景況感が50未満で前回から悪化。半導体など製造業の需要縮小を示す数字。", en: "Below 50 and worsening. Shrinking demand at chipmakers and other factories." },
    neutral: { ja: "景況感の水準と前回からの動きが不一致。製造業の方向感が定まらない数字。", en: "Level and direction disagree. No clear signal for factories." },
  },
  fomc: {
    tailwind: { ja: "政策金利の引き下げ。データセンター投資などの資金コストを軽くする決定。", en: "Policy rate cut. Lower funding costs for data-center and other investment." },
    headwind: { ja: "政策金利の引き上げ。データセンター投資などの資金コストを重くする決定。", en: "Policy rate hike. Higher funding costs for data-center and other investment." },
    neutral: { ja: "政策金利の据え置き。投資の資金コストは前回から変わらない決定。", en: "Policy rate on hold. Funding costs unchanged from last time." },
  },
};

/** A value as the screen shows it: a percentage, index or rate at its own decimals; a count of jobs or claims at 1,000 from 10,000 up
 * (18.9万 / 189K), exact below. "Same as last time" means the same on screen. */
function shown(rule: Rule, v: Value) {
  if (rule === "claims" || rule === "jobs") return Math.abs(v.value) >= 10_000 ? Math.round(v.value / 1_000) * 1_000 : Math.round(v.value);
  return Number(v.value.toFixed(v.decimals));
}
/** −1, 0 or 1: this release against the previous one at the shown precision (the larger of the two decimals). */
function versus(rule: Rule, now: Value, before: Value) {
  const d = Math.max(now.decimals, before.decimals);
  const a = shown(rule, { ...now, decimals: d }), b = shown(rule, { ...before, decimals: d });
  return a > b ? 1 : a < b ? -1 : 0;
}

/** The rule table (owner, Nov 28). Null when the indicator is not in the table, or this or the previous figure is missing. */
export function techImpactCase(key: string, value: Value | null, previous: Value | null): ImpactCase | null {
  const rule = RULE_OF[key];
  if (!rule || !value) return null;
  // FOMC: the decision itself (cut / hike / hold); only when the text names none, the upper bound against the previous meeting's.
  if (rule === "fomc") {
    if (value.action) return value.action === "cut" ? "tailwind" : value.action === "hike" ? "headwind" : "neutral";
    if (!previous) return null;
    const vs = versus(rule, value, previous);
    return vs < 0 ? "tailwind" : vs > 0 ? "headwind" : "neutral";
  }
  if (!previous) return null;
  const vs = versus(rule, value, previous);
  const now = shown(rule, value), before = shown(rule, previous);
  switch (rule) {
    case "prices": return vs < 0 ? "tailwind" : vs > 0 ? "headwind" : "neutral";
    // 25万件以上, or 10% or more above the previous week
    case "claims": return now >= 250_000 || now * 10 >= before * 11 ? "headwind" : "neutral";
    case "jobs":
      if (now < 0) return "headwind";
      // a gain of at least twice the previous gain is too hot to be a tailwind; the 2× test needs a previous gain above zero
      if (vs > 0) return before > 0 && now >= before * 2 ? "neutral-surge" : "tailwind";
      return "neutral";
    case "retail":
    case "gdp": return now < 0 ? "headwind" : vs > 0 ? "tailwind" : "neutral";
    case "ism": return now >= 50 && vs > 0 ? "tailwind" : now < 50 && vs < 0 ? "headwind" : "neutral";
  }
}

export function techImpact(key: string, value: Value | null, previous: Value | null, lang: Lang): TechImpact | null {
  const found = techImpactCase(key, value, previous);
  const sentence = found && SENTENCES[RULE_OF[key]][found];
  if (!found || !sentence) return null;
  const badge: ImpactBadge = found === "neutral-surge" ? "neutral" : found;
  return { badge, case: found, label: IMPACT_LABEL[lang], badgeText: BADGE_TEXT[badge][lang], text: sentence[lang] };
}
