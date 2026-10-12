import type { Amounts, DiagnosisInput, DiagnosisResult, TypeId } from "./diagnosis.ts";
export type DiagnosisLocale = "ja" | "en";
export const EN_QUESTIONS: Record<string, { text: string; options: string[]; note?: string }> = {
 q01: { text: "How long have you been investing?", options: ["Just starting", "1–3 years", "3–5 years", "5–7 years", "7–10 years", "10+ years"] },
 q02: { text: "How much do you spend on living expenses each month?", options: ["Up to ¥150,000", "¥150,000–250,000", "¥250,000–400,000", "¥400,000 or more", "Enter an amount"] },
 q03: { text: "How steady is your income?", options: ["About the same each month", "It varies", "No income right now"] },
 q04: { text: "How many months of living expenses do your savings cover?", options: ["Less than 1 month", "1–3 months", "3–6 months", "6–12 months", "12 months or more", "Enter a number"] },
 q05: { text: "How many months of living expenses do you want to keep in cash?", options: ["3 months", "6 months", "12 months", "Enter a number"] },
 q06: { text: "Do you have any major expenses coming up within 3 years?", options: ["No", "Yes — enter an amount"] },
 q07: { text: "How much do you have in financial assets?", note: "Include both savings and investments.", options: ["Enter an amount", "I’m not sure"] },
 q08: { text: "How much do you currently have invested?", options: ["I haven’t started investing", "Enter an amount"] },
 q09: { text: "When is the earliest you might need this money?", options: ["In 3–5 years", "In 5–10 years", "In 10 years or more", "I haven’t decided"] },
 q10: { text: "Do investment losses keep you up at night?", options: ["Often", "Sometimes", "Rarely", "I haven’t been through a big drop yet"] },
 q11: { text: "What percentage loss would start to feel painful?", options: ["10%", "20%", "30%", "40% or more", "I’m not sure"] },
 q12: { text: "Have you ever sold during a drop without thinking it through?", options: ["No", "Yes", "I haven’t been through a big drop yet"] },
 q13: { text: "What would you do first after a sharp drop?", options: ["Wait and do nothing", "Buy more in small steps", "Reduce my holdings and watch", "I’m not sure"] },
 q14: { text: "Have you ever got caught up in a rally and bought near the top?", options: ["Never", "Once", "Several times", "I haven’t been through a rally yet"] },
 q15: { text: "What would you do first if a stock you own rose sharply?", options: ["Keep holding", "Sell some", "Buy more", "I haven’t decided"] },
 q16: { text: "Which best describes your approach right now?", options: ["Build wealth steadily", "Aim for faster growth", "Focus on protecting what I have", "I’m still figuring it out"] },
 q17: { text: "When do you tend to buy stocks?", options: ["On a set day each month", "When prices fall", "When prices rise", "After seeing news or videos", "I don’t have a set approach"] },
 q18: { text: "How often do you check stock prices?", options: ["Several times a day", "Once a day", "A few times a week", "Hardly ever"] },
 q19: { text: "Have social posts or videos ever prompted you to buy on impulse?", options: ["Never", "Sometimes", "Often"] },
 q20: { text: "What do you mainly invest in?", options: ["Funds and ETFs", "Individual stocks", "Bonds", "Gold", "A mix of assets"] },
 q21: { text: "Which sectors or themes make up most of your stocks?", note: "Select all that apply.", options: ["Technology and semiconductors", "High-dividend stocks", "Healthcare", "Financials", "Energy and materials", "Other"] },
 q22: { text: "What share of your invested money can go into one stock?", options: ["10%", "20%", "30%", "50%", "Enter a percentage"] },
 q23: { text: "What share does your largest stock holding account for?", options: ["Up to 10%", "10–30%", "30–50%", "Over 50%", "I don’t own any stocks yet"] },
 q24: { text: "How many steps will you use to buy more during a drop?", options: ["I won’t buy more", "One purchase", "2 steps", "3 steps", "4 steps"] },
 q25: { text: "How far must the price fall before your first purchase?", options: ["−5%", "−10%", "−15%", "−20%", "I’m not sure", "Enter a percentage"] },
 q26: { text: "What share of your invested amount will you keep in cash for extra purchases?", options: ["5%", "10%", "20%", "30%", "Enter a percentage"] },
 q27: { text: "How will you split the money across those purchases?", options: ["The same amount each time", "More as the price falls further"] },
 q28: { text: "When will you hold off on buying?", note: "Select all that apply.", options: ["My savings are running low", "My income is unstable", "One stock is already above my limit", "I can’t explain why I’m buying"] },
 q29: { text: "When will you pause and reconsider?", note: "Select all that apply.", options: ["Losses exceed my limit", "I’m too worried to sleep", "My reason for buying no longer holds"] },
 q30: { text: "How will you respond to changes in USD/JPY?", options: ["No action based on exchange rates", "Review my rules after a ¥3 move either way", "Review my rules after a ¥7 move either way", "Enter a threshold"] },
};
export const EN_TYPES: Record<TypeId, { name: string; detail: string }> = {
 foundation: { name: "Foundation builder", detail: "You’re at the stage of building a cash cushion before adding to your investments. Knowing you can cover living expenses through a market drop brings peace of mind. Once your savings cover the number of months you want, gradually increasing your investments fits this plan." },
 impulsive: { name: "Quick to act", detail: "You react quickly to information and spot opportunities early. But trading in the heat of a rally or a drop can lead to regret. Before buying, check that you can explain your reason in one sentence. If your conditions aren’t met, sleep on it." },
 concentrated: { name: "Focused investor", detail: "You put more money into stocks you believe in, aiming for stronger growth. That also means a drop in one stock can move your whole portfolio. The key is to check that your limit per stock fits the loss you can tolerate." },
 aggressive: { name: "Growth seeker", detail: "Drops don’t easily shake you, and you want to grow your money faster. Staying the course is a strength. Watch for your investment amount creeping up when you feel confident. Setting limits on both your total investment and extra purchases helps keep your approach sustainable." },
 defensive: { name: "Capital protector", detail: "Avoiding large losses matters to you. Acting before worry costs you sleep is a strength. Selling down too soon, though, can mean missing a recovery. Decide in advance what would make you reduce your holdings, so you don’t have to rush." },
 dipbuyer: { name: "Dip buyer", detail: "You see a drop as a chance to add to your holdings. Buying in steps keeps you from spending everything at once. Check that the total you plan to add leaves room for your cash cushion and stays within the amount available to invest." },
 steady: { name: "Steady builder", detail: "You’re good at keeping a regular pace. Your biggest strength is staying consistent through price swings. Decide ahead of time whether you’ll keep going or pause on down days." },
 patient: { name: "Patient holder", detail: "You can choose to sit still when prices fall. Patience is a strength. Set a clear limit for how much of a drop you can sit through. That turns waiting from an endurance test into a rule." },
 learner: { name: "Experience builder", detail: "You’re still building experience with major drops and rallies. A sharp fall can feel scarier than expected. Setting and saving your rules now is useful preparation for that day." },
 balanced: { name: "Balanced investor", detail: "You don’t lean strongly in one direction and can adapt your thinking to the situation. Put your numbers and conditions on one page, ready to open when the market moves." },
};
const yen = (n: number) => `¥${n.toLocaleString("en-US")}`;
type AdviceText = (i: DiagnosisInput, m: Amounts) => string;
export const EN_ADVICE: Record<string, AdviceText> = {
 income_uneven_reserve3: i => `When income varies, a larger cash cushion can help. With monthly expenses of ${yen(i.monthlyLivingCost)}, 3 months means ${yen(i.monthlyLivingCost * 3)} and 6 months means ${yen(i.monthlyLivingCost * 6)}. That cushion can cover living costs without drawing on investments if a market drop coincides with lower income.`,
 savings_short: i => `Your savings don’t yet cover the ${i.reserveMonths} months you want to keep aside. The amount available to invest already sets aside that cash cushion. As your savings grow, the amount available can grow too.`,
 near_term_expense: () => "Money you’ll need within 3 years is excluded from the amount available to invest. This keeps that money out of the market in case prices are down when you need it.",
 investable_zero: () => "After setting aside your cash cushion and expenses due within 3 years, no money remains available to invest. Building up savings first is one option. You can revisit these answers at any time.",
 invested_over: (i,m) => `Your current investment of ${yen(i.investedAmount!)} exceeds the ${yen(m.investable!)} available after setting aside savings and near-term expenses. Decide whether to bring your investment closer to that amount or review the number of months you keep in cash.`,
 horizon_short: () => "If you’ll need the money soon, you have less time to wait for prices to recover after a drop. Some people choose a smaller loss limit for that reason.",
 sleep_often: (_i,m) => `If losses often keep you awake, your investment may be larger than feels comfortable. A smaller investment means a smaller cash loss at the same percentage drop. A 20% drop on ${yen(m.investBase!)} costs ${yen(Math.floor(m.investBase! * 0.2))}. Halving the investment halves that loss.`,
 tolerance_p10: (_i,m) => `Even a modest drop feels painful to you. Investing less reduces the cash loss from the same percentage drop. Your current loss limit is ${yen(m.toleranceDrop!)}.`,
 drop30_over_tolerance: (_i,m) => `A 30% drop would cost ${yen(Math.floor(m.investBase! * 3 / 10))}, exceeding your chosen loss limit of ${yen(m.toleranceDrop!)}. Markets have fallen more than 30% in the past. Under this rule, you pause new purchases and review your plan when losses exceed your limit.`,
 sold_in_panic: () => "If you’ve sold in a panic before, clear pause conditions can help. These are triggers, such as losses exceeding your limit, for stopping before another purchase. Until a condition is met, give yourself a night to think before selling.",
 no_big_drop_yet: () => "Your first major drop can feel scarier than expected. Save these rules now so they’re ready when that day comes.",
 chased_high: (_i,m) => `Rising prices can make buying feel exciting. Sleeping on a purchase gives you time to think. Also check that it won’t take the stock above your limit of ${yen(m.perStockCapAmount!)}.`,
 rally_buy_more: i => `Adding to a stock that has risen increases its share of your portfolio and can push it over your limit. For example, a holding at 18% is already close to a 20% cap. Before buying, check that it will stay within your ${i.perStockCapPct}% limit.`,
 fast_but_fragile: () => "You want faster growth, but losses also feel painful. Splitting extra purchases into steps keeps you from committing everything at once and can make those feelings easier to balance.",
 impulse_info: () => "If information prompts you to buy on impulse, check that you can explain your reason in one sentence first. Consider adding ‘I can’t explain why I’m buying’ to your conditions for holding off.",
 check_often: () => "The more often you check prices, the easier it is to react to small moves. RESOLUTE’s closing-price alerts email you only when the closing price after the US market session is below a line you set. That can help you check less often.",
 single_sector: () => "Stocks in the same sector can move together for the same reason. For example, a portfolio of technology stocks may fall together on interest-rate or economic news. Check the total in each sector as well as your limit per stock.",
 top_over_cap: () => "Your largest holding is already above the limit you chose. Decide whether to revise the limit to reflect your holdings or gradually bring that holding’s share back down.",
 cap50_stock: (_i,m) => `If half your portfolio is in one stock, a 30% drop in that stock cuts the whole portfolio by 15%. On ${yen(m.investBase!)}, that is ${yen(Math.floor(m.investBase! * 15 / 100))}. Compare it with your loss limit of ${yen(m.toleranceDrop!)}.`,
 buy_budget_over_investable: () => "Making every planned extra purchase would exceed the amount available to invest. Fewer steps or a smaller amount per purchase can bring it within that limit.",
 no_buy_plan: () => "You want to buy more when prices fall, but haven’t set a buying plan. Decide how much to buy at each percentage drop, so you don’t have to decide on the day.",
 no_brakes: () => "‘Hold off’ conditions, such as low savings, mean no new purchases. ‘Pause’ conditions, such as losses exceeding your limit, mean stopping to rethink your rules. Even one of each can help you slow down on a stressful day.",
 default: () => "Your numbers and conditions fit together well. When the market moves, open this page first.",
};
export function localizeDiagnosis(r: DiagnosisResult, i: DiagnosisInput, locale: DiagnosisLocale): DiagnosisResult {
 if (locale === "ja") return r;
 const m = r.amounts, type = EN_TYPES[r.type];
 const conditions = (id: "q28"|"q29", extra: string[] = []) => {
  const ids = id === "q28" ? ["cash_low","income_unstable","over_cap","no_reason"] : ["over_tolerance","cant_sleep","thesis_broken"];
  const a = i.answers[id];
  return [...(Array.isArray(a) ? a.map(x => EN_QUESTIONS[id].options[ids.indexOf(x)]).filter(Boolean) : []), ...extra].join(" / ") || "Not set yet";
 };
 return { ...r, typeName: type.name, typeDetail: type.detail,
  advice: r.advice.map(a => ({ id: a.id, text: EN_ADVICE[a.id](i,m) })),
  disclaimer: "This result is based on your answers. It does not recommend buying or selling any particular stock.",
  rows: [
   { item: "Amount available to invest", rule: m.investable === null ? "Not enough information" : yen(m.investable), meaning: m.investable === null ? "Come back once you know your total financial assets." : "What remains after setting aside your cash cushion and money needed within 3 years." },
   { item: "Loss limit", rule: m.toleranceDrop === null ? "Not set yet" : yen(m.toleranceDrop), meaning: m.toleranceDrop === null ? "Choose how much of a drop would feel painful, and the amount will appear here." : `A loss of ${yen(m.toleranceDrop)} is your cue to review your rules.${m.toleranceMonths === null ? "" : ` That equals ${m.toleranceMonths} months of living expenses.`}` },
   { item: "Limit per stock", rule: m.perStockCapAmount === null ? `${i.perStockCapPct}% of your investment` : yen(m.perStockCapAmount), meaning: `The most you plan to put into one stock: ${i.perStockCapPct}% of your invested amount.` },
   { item: "Extra purchases", rule: r.buyLines.length ? r.buyLines.map(l => `${yen(l.amount)} after a ${l.dropPct}% drop`).join(" / ") : i.answers.q24 === "none" ? "No extra purchases" : "Not set yet", meaning: "The price drops and amounts you’ve chosen for adding to your holdings." },
   { item: "Hold off on buying", rule: conditions("q28", i.noBuyConditions), meaning: "Make no new purchases while these conditions apply." },
   { item: "Pause and reconsider", rule: conditions("q29", i.haltConditions), meaning: "Stop new purchases and review your rules." },
   { item: "Exchange rates", rule: i.fx?.thresholdYen != null ? `Review after a ¥${i.fx.thresholdYen} move in USD/JPY` : "No action based on exchange rates", meaning: i.fx?.thresholdYen != null ? "Exchange rates change the yen value of US stocks and other foreign assets. Reopen these rules after a large move." : "Exchange-rate moves won’t trigger a review." },
  ],
 };
}
