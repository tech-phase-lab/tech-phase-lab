import { calculatePlanAmounts } from "./plan-calculation.ts";
// RESOLUTE ルール診断(30問)の判定ロジック。純粋関数のみ。保存・検証は本体側(plan-data.ts)が担当する。
// 金額は整数(JPYなら円)。端数は切り捨て。仕様: 「RESOLUTE｜① ルール診断 30問」

export type AnswerValue = string | string[] | null;
export type Answers = Record<string, AnswerValue>; // q01〜q30。出さなかった質問・未回答は null

export type DiagnosisInput = {
  currency?: "JPY" | "USD";
  answers: Answers;
  monthlyLivingCost: number;
  savingsMonths: number | null;
  reserveMonths: number;
  nearTermExpense: number;
  financialAssets: number | null; // q07 が unknown のとき null
  investedAmount: number | null; // q08 が not_yet のとき null
  tolerancePct: number | null; // q11 が unknown のとき null
  perStockCapPct: number;
  firstDropPct: number | null; // q24 が none のとき null
  buyBudgetPct: number | null; // q24 が none のとき null
  noBuyConditions?: string[];
  haltConditions?: string[];
  fx?: { thresholdYen: number | null };
};

export type Amounts = {
  reserve: number;
  investable: number | null;
  investBase: number | null;
  toleranceDrop: number | null;
  toleranceMonths: number | null; // 小数1桁(切り捨て)
  perStockCapAmount: number | null;
  buyBudget: number | null;
};

export type BuyLine = { dropPct: number; amount: number };

export type TypeId =
  | "foundation" | "impulsive" | "concentrated" | "aggressive" | "defensive"
  | "dipbuyer" | "steady" | "patient" | "learner" | "balanced";

const a = (i: DiagnosisInput, q: string): AnswerValue => i.answers[q] ?? null;
const is = (i: DiagnosisInput, q: string, ...v: string[]): boolean => {
  const x = a(i, q);
  return typeof x === "string" && v.includes(x);
};
const pctOf = (base: number, pct: number): number => Math.floor((base * Math.round(pct * 10)) / 1000);

export function calcAmounts(i: DiagnosisInput): Amounts {
  const amounts = calculatePlanAmounts({ currency: i.currency ?? "JPY", monthlyLivingCost: i.monthlyLivingCost,
    reserveMonths: i.reserveMonths, nearTermExpense: i.nearTermExpense, financialAssets: i.financialAssets,
    investedAmount: i.investedAmount, tolerancePct: i.tolerancePct, buyBudgetPct: i.buyBudgetPct });
  return { ...amounts, perStockCapAmount: amounts.investBase === null ? null : pctOf(amounts.investBase, i.perStockCapPct) };
}

// 買い増しライン。2段階目以降は1段階目と同じ幅ずつ。端数は最後の段階に足し、合計を予算に合わせる。
export function buildBuyLines(i: DiagnosisInput, amounts: Amounts): BuyLine[] {
  const mode = a(i, "q24");
  const first = i.firstDropPct;
  const budget = amounts.buyBudget;
  if (typeof mode !== "string" || mode === "none" || first == null || budget == null) return [];
  const n = mode === "single" ? 1 : mode === "steps2" ? 2 : mode === "steps3" ? 3 : mode === "steps4" ? 4 : 0;
  if (n === 0) return [];
  const heavier = a(i, "q27") === "heavier" && n > 1;
  const weights = Array.from({ length: n }, (_, k) => (heavier ? k + 1 : 1));
  const sum = weights.reduce((x, y) => x + y, 0);
  const amountsArr = weights.map((w) => Math.floor((budget * w) / sum));
  amountsArr[n - 1] += budget - amountsArr.reduce((x, y) => x + y, 0);
  return amountsArr.map((amount, k) => ({ dropPct: Math.round(first * (k + 1) * 10) / 10, amount }));
}

// ---- タイプ判定(30問すべての答えから点を付ける) ----

const TYPE_ORDER: TypeId[] = [
  "foundation", "impulsive", "concentrated", "aggressive", "defensive",
  "dipbuyer", "steady", "patient", "learner",
];

export function scoreTypes(i: DiagnosisInput, m: Amounts): Record<TypeId, number> {
  const p = (c: boolean, pts = 1) => (c ? pts : 0);
  const stockHeld = is(i, "q20", "stock", "mixed");
  const sectors = a(i, "q21");
  const foundation =
    p(m.investable === 0, 2) +
    p(i.savingsMonths != null && i.savingsMonths < i.reserveMonths) +
    p(is(i, "q03", "uneven", "none")) +
    p(i.investedAmount != null && m.investable != null && i.investedAmount > m.investable);
  const impulsive =
    p(is(i, "q14", "once", "often")) +
    p(is(i, "q19", "often"), 2) + p(is(i, "q19", "sometimes")) +
    p(is(i, "q17", "news")) + p(is(i, "q18", "many_daily"));
  const concentrated =
    p(is(i, "q20", "stock")) +
    p(i.perStockCapPct >= 50, 2) +
    p(is(i, "q23", "gt50"), 2) +
    p(stockHeld && Array.isArray(sectors) && sectors.length === 1);
  const aggressive =
    p(is(i, "q16", "fast"), 2) +
    p(i.tolerancePct != null && i.tolerancePct >= 30) +
    p(is(i, "q10", "rarely")) + p(is(i, "q15", "buy_more")) + p(is(i, "q09", "y10plus"));
  const defensive =
    p(is(i, "q13", "reduce"), 2) + p(is(i, "q16", "defensive"), 2) +
    p(is(i, "q10", "often")) + p(i.tolerancePct === 10) + p(is(i, "q12", "yes"));
  const dipbuyer =
    p(is(i, "q13", "buy_more"), 2) +
    p(is(i, "q24", "steps2", "steps3", "steps4")) +
    p(i.buyBudgetPct != null && i.buyBudgetPct >= 20) + p(is(i, "q17", "on_drop"));
  const steady =
    p(is(i, "q16", "steady"), 2) + p(is(i, "q17", "monthly"), 2) +
    p(is(i, "q09", "y10plus")) + p(is(i, "q18", "rarely"));
  const patient =
    p(is(i, "q13", "wait"), 2) + p(is(i, "q12", "no")) +
    p(is(i, "q10", "rarely")) + p(is(i, "q18", "weekly", "rarely"));
  const learner =
    p(is(i, "q01", "first"), 2) + p(is(i, "q10", "no_drop_yet")) +
    p(is(i, "q12", "no_drop_yet")) + p(is(i, "q14", "no_rally_yet"));
  return { foundation, impulsive, concentrated, aggressive, defensive, dipbuyer, steady, patient, learner, balanced: 0 };
}

export function decideType(i: DiagnosisInput, m: Amounts): TypeId {
  if (m.investable === 0) return "foundation";
  const s = scoreTypes(i, m);
  let best: TypeId = "balanced";
  let bestScore = 2; // 2点以下はバランス型
  for (const t of TYPE_ORDER) {
    if (s[t] > bestScore) {
      best = t;
      bestScore = s[t];
    }
  }
  return best;
}

export const TYPE_INFO: Record<TypeId, { name: string; detail: string }> = {
  foundation: {
    name: "土台づくり型",
    detail:
      "投資を増やす前に、生活を支える貯金を整える段階です。株価が下がっても、生活費に手をつけずに済む状態が、いちばんの安心になります。貯金が置いておきたい月数に届いたら、投資に回す額を少しずつ増やす、という順番がこのルールには合います。",
  },
  impulsive: {
    name: "勢いで動きやすい型",
    detail:
      "情報への反応が早く、チャンスに気づきやすい人です。一方で、上がった日や下がった日の勢いで売買すると、あとから後悔しやすくなります。買う前に「なぜ買うのか」を一言で言えるか確かめる、決めた条件に当てはまらない日は一晩置く、というブレーキがよく効きます。",
  },
  concentrated: {
    name: "集中勝負型",
    detail:
      "自信のある銘柄に大きく入れて、資産を大きく伸ばしにいく人です。そのぶん、その銘柄が下がると、資産全体が大きく動きます。1銘柄の上限と、許容できる下落額が合っているかが、いちばん大事なポイントです。",
  },
  aggressive: {
    name: "攻めて伸ばす型",
    detail:
      "下落に動じにくく、早く増やしたい人です。強みは、下がっても続けられることです。気をつけたいのは、強気のときほど投資額が膨らむことです。投資に回す額と、買い増しの総額に上限を決めておくと、攻めたままでも崩れにくくなります。",
  },
  defensive: {
    name: "守りを固める型",
    detail:
      "大きく負けないことを大事にする人です。夜眠れなくなる前に動けるのが強みです。一方で、減らす判断が早すぎると、戻る場面を逃すことがあります。「何が起きたら減らすか」を先に決めておくと、慌てずに済みます。",
  },
  dipbuyer: {
    name: "押し目を拾う型",
    detail:
      "下落を、買い足す機会として見られる人です。段階を分けて買い増すと、一度に全部を使わずに済みます。確かめたいのは、買い増しの総額が、投資に回す額や貯金を圧迫しないかです。",
  },
  steady: {
    name: "コツコツ積み上げ型",
    detail:
      "決めたペースで続けるのが得意な人です。値動きに左右されにくいのが、いちばんの強みです。下落の日も、そのまま続けるか、止めるかを、あらかじめ決めておくと迷いません。",
  },
  patient: {
    name: "じっくり待つ型",
    detail:
      "下がっても動かないと決められる人です。待てることが、強みです。「どこまでなら待てるか」を数字で持っておくと、待つことが、がまんではなく、ルールになります。",
  },
  learner: {
    name: "これから鍛える型",
    detail:
      "まだ大きな下落や上昇を経験していない、これから経験を積む人です。大きな下落は、思ったより怖いものです。その日のために、いま、ルールを決めて保存しておくこと自体が、いちばんの準備になります。",
  },
  balanced: {
    name: "バランス型",
    detail:
      "特定の方向に偏らず、状況に合わせて考えられる人です。どの場面でも使えるように、数字と条件を1枚にまとめておくと、相場が動いた日に、迷わず開けます。",
  },
};

// ---- 金額の日本語表記 ----
export function formatYen(n: number): string {
  if (n < 10000) return `${n.toLocaleString("en-US")}円`;
  const man = Math.floor(n / 10000);
  const rest = n % 10000;
  return rest === 0 ? `${man.toLocaleString("en-US")}万円` : `${man.toLocaleString("en-US")}万${rest.toLocaleString("en-US")}円`;
}

const money = (i: DiagnosisInput, n: number) => i.currency === "USD" ? `US$${(n/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}` : formatYen(n);

// ---- 回答に合わせたアドバイス(上から順に当てはまるものを最大5つ) ----

type AdviceRule = { id: string; when: (i: DiagnosisInput, m: Amounts) => boolean; text: (i: DiagnosisInput, m: Amounts) => string };

const BAND_LOWER: Record<string, number> = { lt10: 0, p10to30: 10, p30to50: 30, gt50: 50, none: 0 };
const nz = (v: number | null): v is number => v != null;

const ADVICE: AdviceRule[] = [
  {
    id: "income_uneven_reserve3",
    when: (i) => is(i, "q03", "uneven", "none") && i.reserveMonths === 3 && i.monthlyLivingCost > 0,
    text: (i) =>
      `収入に波があるなら、手をつけない貯金は多めにしておくと安心です。たとえば生活費が${money(i, i.monthlyLivingCost)}なら、3か月分は${money(i, i.monthlyLivingCost * 3)}、6か月分は${money(i, i.monthlyLivingCost * 6)}です。下落と収入の減る時期が重なっても、投資に手をつけずに生活できます。`,
  },
  {
    id: "savings_short",
    when: (i) => i.savingsMonths != null && i.savingsMonths < i.reserveMonths,
    text: (i) =>
      `いまの貯金は、置いておきたい月数(${i.reserveMonths}か月分)に届いていません。「投資に回せる額」は、その月数分の貯金を先に取り分けて計算しています。貯金が増えれば、回せる額も増えます。`,
  },
  {
    id: "near_term_expense",
    when: (i) => is(i, "q06", "has"),
    text: () =>
      "3年以内に使うお金は、投資に回せる額から外しています。使う日に株価が下がっていても、必要なお金が減らないようにするためです。",
  },
  {
    id: "investable_zero",
    when: (i, m) => m.investable === 0,
    text: () =>
      "いまの金融資産から、手をつけない貯金と、3年以内に使うお金を引くと、投資に回せる額が残りません。まず貯金を整えることも、選べる道です。答えを変えれば、いつでもやり直せます。",
  },
  {
    id: "invested_over",
    when: (i, m) => nz(i.investedAmount) && nz(m.investable) && i.investedAmount > m.investable,
    text: (i, m) =>
      `いま投資している額(${money(i, i.investedAmount as number)})が、貯金と近い支出を引いて計算した「回せる額」(${money(i, m.investable as number)})より多くなっています。投資額を回せる額に近づけるか、置いておく貯金の月数を見直すか、どちらにするか決めておきましょう。`,
  },
  {
    id: "horizon_short",
    when: (i) => is(i, "q09", "y3to5"),
    text: () =>
      "使う時期が近いと、株価が下がったとき、戻るのを待つ時間が短くなります。そのため、許容できる下落を小さめにする人もいます。",
  },
  {
    id: "sleep_often",
    when: (i, m) => is(i, "q10", "often") && nz(m.investBase),
    text: (i, m) =>
      `夜眠れないことがよくあるなら、いまの投資額が気持ちに対して大きいサインかもしれません。投資額を小さくすると、同じ割合の下落でも、減る金額が小さくなります。たとえば投資額が${money(i, m.investBase as number)}で20%下がると${money(i, Math.floor((m.investBase as number) * 0.2))}減ります。投資額を半分にすれば、減る額も半分です。`,
  },
  {
    id: "tolerance_p10",
    when: (i, m) => i.tolerancePct === 10 && nz(m.toleranceDrop),
    text: (i, m) =>
      `少し減るだけでつらいと感じるタイプです。投資額を小さめにすると、同じ割合の下落でも減る金額が小さくなります。いまの許容できる下落は${money(i, m.toleranceDrop as number)}です。`,
  },
  {
    id: "drop30_over_tolerance",
    when: (i, m) => nz(m.investBase) && nz(m.toleranceDrop) && Math.floor((m.investBase * 3) / 10) > m.toleranceDrop,
    text: (i, m) =>
      `投資額が30%下がると、${money(i, Math.floor(((m.investBase as number) * 3) / 10))}減ります。あなたが決めた許容できる下落(${money(i, m.toleranceDrop as number)})を超えます。過去の相場には、30%以上下がった時期もありました。このルールでは、許容額を超えたら新しく買わず、ルールを読み直します。`,
  },
  {
    id: "sold_in_panic",
    when: (i) => is(i, "q12", "yes"),
    text: () =>
      "一度売ってしまった経験があるなら、「手を止める条件」が支えになります。これは、「許容できる下落を超えたとき」など、新しく買う前に立ち止まるための決めごとです。決めた条件に当てはまらないうちは、売る前に一晩置いてから考えましょう。",
  },
  {
    id: "no_big_drop_yet",
    when: (i) => is(i, "q10", "no_drop_yet") || is(i, "q12", "no_drop_yet"),
    text: () =>
      "初めての大きな下落は、思ったより怖いものです。その日のために、このルールを保存しておきましょう。",
  },
  {
    id: "chased_high",
    when: (i, m) => is(i, "q14", "once", "often") && nz(m.perStockCapAmount),
    text: (i, m) =>
      `上がっているときは、気分が高まって買いやすくなります。買う前に一晩置くと、冷静になれます。また、買ったあとに1銘柄の上限(${money(i, m.perStockCapAmount as number)})を超えないかも、確かめておきましょう。`,
  },
  {
    id: "rally_buy_more",
    when: (i) => is(i, "q15", "buy_more"),
    text: (i) =>
      `上がった株を買い増すと、その銘柄の割合が増えて、上限を超えやすくなります。たとえば上限が20%で、いま18%なら、少し上がっただけで超えます。買う前に、上限(${i.perStockCapPct}%)に収まるかを見ておきましょう。`,
  },
  {
    id: "fast_but_fragile",
    when: (i) => is(i, "q16", "fast") && (is(i, "q10", "often") || i.tolerancePct === 10 || i.tolerancePct === 20),
    text: () =>
      "早く増やしたい気持ちと、減ったときのつらさが、両方あります。買い増しを段階に分けると、一度に全部を使わずに済むので、気持ちのバランスを取りやすくなります。",
  },
  {
    id: "impulse_info",
    when: (i) => is(i, "q19", "often"),
    text: () =>
      "情報を見て勢いで買うことがあるなら、買う前に「なぜ買うのか」を一言で言えるかを確かめる習慣が役に立ちます。「買う理由を説明できないときは買わない」を、「買わない条件」に入れておくと安心です。",
  },
  {
    id: "check_often",
    when: (i) => is(i, "q18", "many_daily"),
    text: () =>
      "株価を見る回数が多いほど、小さな値動きにも気持ちが動きやすくなります。RESOLUTEの終値通知なら、アメリカ市場が閉まったあとの終値で、決めたラインを下回ったときだけメールが届くので、見る回数を減らせます。",
  },
  {
    id: "single_sector",
    when: (i) => is(i, "q20", "stock", "mixed") && Array.isArray(a(i, "q21")) && (a(i, "q21") as string[]).length === 1,
    text: () =>
      "同じセクターの銘柄は、同じ理由でまとめて動くことがあります。たとえばハイテク株だけだと、金利や景気のニュースで、持っている銘柄がそろって下がることがあります。1銘柄ずつの上限に加えて、セクターごとの合計も見ておくと安心です。",
  },
  {
    id: "top_over_cap",
    when: (i) => {
      const band = a(i, "q23");
      return typeof band === "string" && (band === "gt50" ? i.perStockCapPct <= 50 : (BAND_LOWER[band] ?? 0) > i.perStockCapPct);
    },
    text: () =>
      "一番多い銘柄が、あなたが決めた上限をすでに超えています。上限を今に合わせるか、これから割合を少しずつ戻すか、どちらかを決めておきましょう。",
  },
  {
    id: "cap50_stock",
    when: (i, m) => i.perStockCapPct >= 50 && is(i, "q20", "stock", "mixed") && nz(m.investBase) && nz(m.toleranceDrop),
    text: (i, m) =>
      `1銘柄に半分まで入れるルールだと、その銘柄が30%下がっただけで、投資額全体の15%が減ります。投資額が${money(i, m.investBase as number)}なら${money(i, Math.floor(((m.investBase as number) * 15) / 100))}です。許容できる下落(${money(i, m.toleranceDrop as number)})と比べて、収まるかを確かめましょう。`,
  },
  {
    id: "buy_budget_over_investable",
    when: (i, m) => nz(m.buyBudget) && nz(m.investable) && m.buyBudget > m.investable,
    text: () =>
      "買い増しを全部実行すると、投資に回せる額を超えます。段階の数か、1回の金額を減らすと収まります。",
  },
  {
    id: "no_buy_plan",
    when: (i) => is(i, "q24", "none") && is(i, "q13", "buy_more"),
    text: () =>
      "下がったら買い増したいのに、買い増しが決まっていません。「何%下がったらいくら買う」を決めておくと、その日に迷いません。",
  },
  {
    id: "no_brakes",
    when: (i) => (i.noBuyConditions ?? []).length === 0 && (i.haltConditions ?? []).length === 0 &&
      (!Array.isArray(a(i, "q28")) || (a(i, "q28") as string[]).length === 0) &&
      (!Array.isArray(a(i, "q29")) || (a(i, "q29") as string[]).length === 0),
    text: () =>
      "「買わないとき」は、たとえば貯金が減ったときなど、新しく買わない条件です。「止めるとき」は、許容できる下落を超えたときなど、いったん手を止めて考え直す条件です。どちらも1つだけでも決めておくと、慌てた日のブレーキになります。",
  },
];

export const ADVICE_MAX = 5;
export const ADVICE_DEFAULT =
  "数字と条件がよくつながったルールです。相場が動いた日は、まずこの1枚を開いてください。";

export function pickAdvice(i: DiagnosisInput, m: Amounts): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const r of ADVICE) {
    if (out.length >= ADVICE_MAX) break;
    if (r.when(i, m)) out.push({ id: r.id, text: r.text(i, m) });
  }
  return out.length > 0 ? out : [{ id: "default", text: ADVICE_DEFAULT }];
}

export const DISCLAIMER =
  "特定の銘柄の売買を勧めるものではありません。";

// ---- 結果の画面(表) ----

const NO_BUY_LABEL: Record<string, string> = {
  cash_low: "貯金が減ったとき",
  income_unstable: "収入が不安定なとき",
  over_cap: "1銘柄が上限を超えているとき",
  no_reason: "買う理由を説明できないとき",
};
const HALT_LABEL: Record<string, string> = {
  over_tolerance: "許容できる下落を超えたとき",
  cant_sleep: "眠れないほど不安なとき",
  thesis_broken: "買った理由が崩れたとき",
};

export type ResultRow = { item: string; rule: string; meaning: string };

export function buildResultRows(i: DiagnosisInput, m: Amounts, lines: BuyLine[] = buildBuyLines(i, m)): ResultRow[] {
  const list = (ids: AnswerValue, labels: Record<string, string>, free: string[] | undefined): string => {
    const picked = Array.isArray(ids) ? ids.map((x) => labels[x]).filter(Boolean) : [];
    const all = [...picked, ...(free ?? [])];
    return all.length > 0 ? all.join(" / ") : "まだ決めていません";
  };
  const buyRule =
    lines.length === 0
      ? (a(i, "q24") === "none" ? "買い増しはしない" : "まだ決めていません")
      : lines.map((l) => `${l.dropPct}%下がったら${money(i, l.amount)}`).join(" / ");
  const fxRule =
    i.fx?.thresholdYen != null ? `ドル円が${i.fx.thresholdYen}円動いたら、ルールを読み直す` : "特に動かない";
  return [
    {
      item: "投資に回す額",
      rule: m.investable == null ? "計算できません" : money(i, m.investable),
      meaning:
        m.investable == null
          ? "金融資産が分かったら、やり直せます"
          : "貯金と、3年以内に使うお金を除いた、投資に使える額です",
    },
    {
      item: "許容できる下落",
      rule: m.toleranceDrop == null ? "決めていません" : money(i, m.toleranceDrop),
      meaning:
        m.toleranceDrop == null
          ? "つらいと感じる下落の割合が決まったら、金額が出ます"
          : `投資額が${money(i, m.toleranceDrop)}減ったら、ルールを読み直す目安です${m.toleranceMonths != null ? `。生活費${m.toleranceMonths}か月分にあたります` : ""}`,
    },
    {
      item: "1銘柄の上限",
      rule: m.perStockCapAmount == null ? `投資額の${i.perStockCapPct}%` : money(i, m.perStockCapAmount),
      meaning: `1つの銘柄に入れる上限です。投資額の${i.perStockCapPct}%にあたります`,
    },
    { item: "買い増し", rule: buyRule, meaning: "株価が下がったときに買い足す、段階と金額です" },
    {
      item: "買わないとき",
      rule: list(a(i, "q28"), NO_BUY_LABEL, i.noBuyConditions),
      meaning: "この状態のときは、新しく買いません",
    },
    {
      item: "手を止めるとき",
      rule: list(a(i, "q29"), HALT_LABEL, i.haltConditions),
      meaning: "新しく買うのをやめて、ルールを読み直します",
    },
    {
      item: "為替",
      rule: fxRule,
      meaning:
        i.fx?.thresholdYen != null
          ? "アメリカ株などは、為替で円の評価額が変わります。大きく動いた日は、このルールをもう一度開きます"
          : "為替では、ルールを読み直しません",
    },
  ];
}

export type DiagnosisResult = {
  amounts: Amounts;
  buyLines: BuyLine[];
  type: TypeId;
  typeName: string;
  typeDetail: string;
  rows: ResultRow[];
  advice: { id: string; text: string }[];
  disclaimer: string;
};

export function diagnose(i: DiagnosisInput): DiagnosisResult {
  const amounts = calcAmounts(i);
  const buyLines = buildBuyLines(i, amounts);
  const type = decideType(i, amounts);
  return {
    amounts,
    buyLines,
    type,
    typeName: TYPE_INFO[type].name,
    typeDetail: TYPE_INFO[type].detail,
    rows: buildResultRows(i, amounts, buyLines),
    advice: pickAdvice(i, amounts),
    disclaimer: DISCLAIMER,
  };
}
