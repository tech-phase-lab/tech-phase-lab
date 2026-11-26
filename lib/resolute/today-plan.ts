import type { Copy } from "../research/data.ts";

/** 今日やること (RESOLUTE home, owner Nov 25). Shared contract between the home UI and the AI backend
 * (resolute-pc-1125 §4, resolute-pc-morning-thermo-1125 §1). */
export type TodayCheck = { label: Copy; rule: Copy; today: Copy; state: "ok" | "reached" };
export type TodayPlan = {
  date: string;              // US market date the plan is for, YYYY-MM-DD
  source: "ai" | "fixed";    // fixed = fallback sentence
  direction: "up" | "down" | "flat";
  headline: Copy;            // ja <= 12 chars
  body: Copy;                // 2-4 lines
  checks: TodayCheck[];      // 0-3 items
  estimate?: { allowedDropPct: number; estimatedChangePct: number; remainingPct: number } | null; // §5, only for members with q08
};

/** How the body speaks of numbers (owner, Nov 26 §4), part of the AI's instructions (services/resolute-api/today-plan-job.mjs) and
 * checked by today-plan-validate.ts (wordingIssue). A day's move and the position from the member's base are different numbers. */
export const TODAY_WORDING_RULES = "Two different numbers: dayChangePct (and tpIndexMoves) is today's move only; fromReferencePct is the position from the member's base (reference price), the number the check rows show. "
  + "Whenever you write a same-day move, always attach 今日 in Japanese and today in English in the same sentence (例: NVDAは今日−3.9%下がりました。 / NVDA fell 3.9% today.). "
  + "Whether a buy-more line or a rise level is near or far is written only with the same from-base number as the check rows: fromReferencePct, or fromReferenceRoundedPct when a rounded figure reads better, or the row's distance (例: それでも基準より24%高い位置です。 / It is still 24% above your base.). "
  + "Never state the distance to a line with any other number, and never put a same-day move in the same sentence as the distance to a line. "
  + "Example body for a member whose NVDA fell today but is far above the base: NVDAは今日−3.9%下がりました。 / それでも基準より24%高い位置です。 / 今日は買い足す日ではありません。";

/** What the fixed plan is computed from. Every number shown comes from here: the day's Shock Gauge stories, the market gauge,
 * the member's own saved lines and their alert stocks' moves from the reference prices they set. Nothing is invented. */
export type TodayInput = {
  date: string;
  /** The day's Shock Gauge stories: stars (null = not rated) and the move of the story's own index on its first close. */
  news: { stars: number | null; changePercent: number | null }[];
  /** 相場の温度計: band 0 (cool) – 4 (hot) of the index named, and that index's move on the gauge's close when known. */
  thermometer: { index: "nas100" | "sox"; band: 0 | 1 | 2 | 3 | 4; changePercent: number | null } | null;
  /** The member's saved lines: the shallowest buy-more drop (%), the exit level (%), the up target (%). */
  lines: { buyDropPct: number | null; stopLossPct: number | null; surgeCapPct: number | null };
  /** Alert stocks with a usable current price: move from the member's reference price, in % (one decimal). */
  stocks: { symbol: string; fromReferencePct: number }[];
  estimate?: TodayPlan["estimate"];
};

const INDEX_NAME = { nas100: { ja: "TP大型株100", en: "TP Large Cap 100" }, sox: { ja: "TP半導体40", en: "TP Semiconductor 40" } } as const;
const BAND = { ja: ["冷えている", "やや冷えている", "平常", "やや熱い", "熱い"], en: ["Cool", "Slightly cool", "Normal", "Slightly hot", "Hot"] } as const;
const num = (n: number) => String(Math.round(Math.abs(n) * 10) / 10);
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${num(n)}%`;
const both = (ja: string, en: string): Copy => ({ ja, en });
const DASH = both("—", "—");

/** The day's direction: the move of the top-rated story's own index (the first story among equals). No rated story: flat. */
export function todayDirection(news: TodayInput["news"]): { stars: number | null; direction: TodayPlan["direction"] } {
  let top: TodayInput["news"][number] | null = null;
  for (const item of news) if (item.stars !== null && (!top || item.stars > (top.stars ?? 0))) top = item;
  if (!top) return { stars: null, direction: "flat" };
  const c = top.changePercent;
  return { stars: top.stars, direction: c === null || c === 0 ? "flat" : c > 0 ? "up" : "down" };
}

/** The fixed 今日やること (the contract's fallback sentences, in this order of precedence):
 * 1 exit line reached → 決めたラインに届いた, 2 buy-more line reached → 決めていた買い増しの日,
 * 3 gauge hot or up target reached → 買いすぎに気をつける, 4 ★3–5 up → 浮かれて買い足さない,
 * 5 ★3–5 down (or flat) → むやみに動かない, 6 ★1–2 or no news → いつも通りでいい.
 * A down-day sentence is never chosen on an up day. */
export function fixedTodayPlan(input: TodayInput): TodayPlan {
  const { stars, direction } = todayDirection(input.news);
  const { buyDropPct, stopLossPct, surgeCapPct } = input.lines;
  const estimate = input.estimate ?? null;
  const lowest = [...input.stocks].sort((a, b) => a.fromReferencePct - b.fromReferencePct)[0] ?? null;
  const highest = [...input.stocks].sort((a, b) => b.fromReferencePct - a.fromReferencePct)[0] ?? null;
  const buyHit = buyDropPct !== null && lowest && lowest.fromReferencePct <= -buyDropPct ? lowest : null;
  const upHit = surgeCapPct !== null && highest && highest.fromReferencePct >= surgeCapPct ? highest : null;
  const exitHit = stopLossPct !== null && estimate !== null && estimate.estimatedChangePct <= -stopLossPct;
  const hot = input.thermometer?.band === 4;

  // Row shape (owner, Nov 26 §3): small label with the line and the stock, two bold lines (what the number is, the distance to the
  // line while it is not reached), the number alone on the right. The stock shown is the one that reached the line, else the closest.
  const position = (distancePct: number | null) => distancePct === null ? both("基準からの位置", "Position vs. your base")
    : both(`基準からの位置\n線まであと${num(distancePct)}%`, `Position vs. your base\n${num(distancePct)}% to go`);
  const buyStock = buyHit ?? lowest, upStock = upHit ?? highest;
  const checks: Record<"buy" | "up" | "gauge" | "estimate", TodayCheck | null> = {
    buy: buyDropPct === null || !buyStock ? null : {
      label: both(`買い増しライン −${num(buyDropPct)}%　${buyStock.symbol}`, `Buy-more line −${num(buyDropPct)}% · ${buyStock.symbol}`),
      rule: position(buyHit ? null : buyDropPct + buyStock.fromReferencePct),
      today: both(signed(buyStock.fromReferencePct), signed(buyStock.fromReferencePct)),
      state: buyHit ? "reached" : "ok",
    },
    up: surgeCapPct === null || !upStock ? null : {
      label: both(`上昇の目安 +${num(surgeCapPct)}%　${upStock.symbol}`, `Up target +${num(surgeCapPct)}% · ${upStock.symbol}`),
      rule: position(upHit ? null : surgeCapPct - upStock.fromReferencePct),
      today: both(signed(upStock.fromReferencePct), signed(upStock.fromReferencePct)),
      state: upHit ? "reached" : "ok",
    },
    gauge: !input.thermometer ? null : {
      label: both(`相場の温度計　${INDEX_NAME[input.thermometer.index].ja}`, `Market gauge · ${INDEX_NAME[input.thermometer.index].en}`),
      rule: both(BAND.ja[input.thermometer.band], BAND.en[input.thermometer.band]),
      today: input.thermometer.changePercent === null ? DASH : both(signed(input.thermometer.changePercent), signed(input.thermometer.changePercent)),
      state: hot ? "reached" : "ok",
    },
    estimate: !estimate ? null : {
      label: both(`許容できる下落 −${num(estimate.allowedDropPct)}%`, `Loss you can accept −${num(estimate.allowedDropPct)}%`),
      rule: estimate.remainingPct <= 0 ? both("いまの資産の下落", "Drop in your assets now")
        : both(`いまの資産の下落\n線まであと${num(estimate.remainingPct)}%`, `Drop in your assets now\n${num(estimate.remainingPct)}% to go`),
      today: both(signed(estimate.estimatedChangePct), signed(estimate.estimatedChangePct)),
      state: estimate.remainingPct <= 0 ? "reached" : "ok",
    },
  };
  const order = direction === "up" ? ["gauge", "up", "buy", "estimate"] as const
    : direction === "down" ? ["buy", "estimate", "gauge", "up"] as const
      : ["buy", "gauge", "up", "estimate"] as const;
  const picked = order.map(k => checks[k]).filter((c): c is TodayCheck => c !== null).slice(0, 3);

  const big = stars !== null && stars >= 3;
  let headline: Copy, body: Copy;
  if (exitHit) {
    headline = both("決めたラインに届いた", "You reached your line");
    body = both(`投資額の推定が、あなたの決めた損切りライン −${num(stopLossPct!)}%に届きました。\n決めておいた手順を、一冊で確かめる日です。`,
      `Your estimated investments have reached the exit level you set, −${num(stopLossPct!)}%.\nA day to check the steps you decided on in your rulebook.`);
  } else if (buyHit) {
    headline = both("決めていた買い増しの日", "A buy-more day you planned");
    body = both(`${buyHit.symbol}が、あなたの買い増しライン −${num(buyDropPct!)}%に届きました。\n決めていた金額と配分を、一冊で確かめる日です。`,
      `${buyHit.symbol} has reached your buy-more line, −${num(buyDropPct!)}%.\nA day to check the amount and split you decided on in your rulebook.`);
  } else if (hot || upHit) {
    headline = both("買いすぎに気をつける", "Mind not to overbuy");
    body = upHit
      ? both(`${upHit.symbol}が、あなたの上昇の目安 +${num(surgeCapPct!)}%に届きました。\n持ち分の偏りを、あなたのルールと照らし合わせる日です。`,
        `${upHit.symbol} has reached your up target, +${num(surgeCapPct!)}%.\nA day to compare how your holdings are spread with your rules.`)
      : both("相場の温度計が「熱い」位置にあります。\n勢いで買い足すと、決めた配分を超えやすい日です。",
        "The market gauge reads Hot.\nBuying on momentum can push you past the split you set.");
  } else if (big && direction === "up") {
    headline = both("浮かれて買い足さない", "Don’t chase the rally");
    body = buyDropPct !== null
      ? both(`★${stars}のニュースで、大きく上がった日です。\nあなたのルールは下がったときに買い足す形なので\n今日は買う日ではありません。`,
        `A ★${stars} story, and the market rose sharply.\nYour rules add on the way down,\nso today is not a buying day.`)
      : both(`★${stars}のニュースで、大きく上がった日です。\n上がった勢いで、ルールにない買い足しはしない日です。`,
        `A ★${stars} story, and the market rose sharply.\nA day not to add anything your rules don’t include.`);
  } else if (big) {
    headline = both("むやみに動かない", "No sudden moves");
    body = both(`★${stars}のニュースが出ていますが\nあなたのルールが動くのは、価格が決めたラインに届いたときです。\nニュースだけで、ルールは変わりません。`,
      `There is a ★${stars} story today,\nbut your rules act only when a price reaches a line you set.\nA headline alone doesn’t change them.`);
  } else {
    headline = both("いつも通りでいい", "Business as usual");
    body = both("大きなニュースは出ていません。\nあなたのルールどおりの、いつもの一日です。",
      "No major news today.\nAn ordinary day, by your rules.");
  }
  return { date: input.date, source: "fixed", direction, headline, body, checks: picked, estimate };
}

const copy = (v: unknown): v is Copy => !!v && typeof v === "object" && (["ja", "en"] as const).every(k => {
  const s = (v as Record<string, unknown>)[k];
  return typeof s === "string" && s.length > 0 && s.length <= 400 && !/[<>\u0000]|…/.test(s);
});
const finitePct = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1000;
/** The site route's answer (GET /api/resolute/today-plan: {plan: TodayPlan | null}), checked again on the screen. Anything else,
 * or a plan that breaks the card's rules (headline ≤ 12 JA chars, 2–4 body lines, ≤ 3 checks, no "…"), is null: the fixed plan. */
export function parseTodayPlanResponse(value: unknown): TodayPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join() !== "plan") return null;
  const p = (value as { plan: unknown }).plan as TodayPlan | null;
  if (!p || typeof p !== "object") return null;
  if (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !["ai", "fixed"].includes(p.source) || !["up", "down", "flat"].includes(p.direction)) return null;
  if (!copy(p.headline) || [...p.headline.ja].length > 12 || !copy(p.body)) return null;
  const lines = p.body.ja.split("\n").length;
  if (lines < 2 || lines > 4 || !Array.isArray(p.checks) || p.checks.length > 3) return null;
  if (!p.checks.every(c => c && copy(c.label) && copy(c.rule) && copy(c.today) && (c.state === "ok" || c.state === "reached"))) return null;
  const e = p.estimate;
  if (!(e === undefined || e === null || finitePct(e.allowedDropPct) && finitePct(e.estimatedChangePct) && finitePct(e.remainingPct))) return null;
  return { date: p.date, source: p.source, direction: p.direction, headline: { ja: p.headline.ja, en: p.headline.en }, body: { ja: p.body.ja, en: p.body.en },
    checks: p.checks.map(c => ({ label: { ...c.label }, rule: { ...c.rule }, today: { ...c.today }, state: c.state })), estimate: e ?? null };
}
