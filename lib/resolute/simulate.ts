// RESOLUTE ② 下落・急騰シミュレーション(純粋関数)
// 将来を予測するものではなく、入力した前提での計算です。

export type Currency = 'JPY' | 'USD';

export interface BuyLine {
  dropPct: number; // 基準からの下落率(%)。例: 10
  amount: number; // その段階での購入予定額(通貨単位)
}

export interface Plan {
  currency: Currency;
  monthlyExpenses: number; // 月の生活費
  tolerableLoss: number; // 許容できる下落額
  singleStockCapPct: number; // 1銘柄の上限割合(%)
  buyLines: BuyLine[];
}

/** 通貨ごとの丸め。円は整数に切り捨て、ドルは小数2桁に切り捨て。 */
export function roundMoney(value: number, currency: Currency): number {
  if (currency === 'JPY') return Math.floor(value + 1e-9);
  return Math.floor(value * 100 + 1e-6) / 100;
}

function assertNonNeg(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0) throw new RangeError(`${name} must be a finite number >= 0`);
}

export interface DropResult {
  lossAmount: number;
  monthsOfExpenses: number | null; // 生活費0のときは null
  withinTolerance: boolean;
  valueAfter: number;
  reachedLines: BuyLine[]; // 到達した買い増しライン(浅い順)
  plannedBuyTotal: number;
}

/** 保有想定額が dropPct(%) 下がったときの計算。 */
export function simulateDrop(plan: Plan, holdingsValue: number, dropPct: number): DropResult {
  assertNonNeg('holdingsValue', holdingsValue);
  assertNonNeg('monthlyExpenses', plan.monthlyExpenses);
  assertNonNeg('tolerableLoss', plan.tolerableLoss);
  if (!Number.isFinite(dropPct) || dropPct < 0 || dropPct > 100) {
    throw new RangeError('dropPct must be between 0 and 100');
  }
  assertNonNeg('singleStockCapPct', plan.singleStockCapPct);
  for (const l of plan.buyLines) {
    assertNonNeg('buyLine.amount', l.amount);
    if (!Number.isFinite(l.dropPct) || l.dropPct < 0 || l.dropPct > 100) {
      throw new RangeError('buyLine.dropPct must be between 0 and 100');
    }
  }
  const rawLoss = (holdingsValue * dropPct) / 100;
  const lossAmount = roundMoney(rawLoss, plan.currency);
  const monthsOfExpenses =
    plan.monthlyExpenses > 0 ? Math.floor((lossAmount / plan.monthlyExpenses) * 10 + 1e-9) / 10 : null;
  const reachedLines = plan.buyLines
    .filter((l) => l.dropPct <= dropPct + 1e-9)
    .sort((a, b) => a.dropPct - b.dropPct);
  const plannedBuyTotal = roundMoney(
    reachedLines.reduce((s, l) => s + l.amount, 0),
    plan.currency,
  );
  return {
    lossAmount,
    monthsOfExpenses,
    withinTolerance: rawLoss <= plan.tolerableLoss + 1e-9, // 丸める前の額で比べる(切り捨てで超過を見逃さない)
    valueAfter: roundMoney(holdingsValue - lossAmount, plan.currency),
    reachedLines,
    plannedBuyTotal,
  };
}

export interface Holding {
  name: string;
  value: number;
}

export interface SurgeItem {
  name: string;
  valueAfter: number;
  sharePct: number; // 全体に占める割合(%、小数1桁に切り捨て)
  overCap: boolean;
}

export interface SurgeResult {
  totalAfter: number;
  items: SurgeItem[];
  overCapNames: string[];
}

/** 全銘柄が risePct(%) 上がったと仮定したときの、1銘柄の上限割合の確認。
 *  riseByName で銘柄ごとに別の上昇率を指定できる(未指定は risePct)。 */
export function simulateSurge(
  plan: Plan,
  holdings: Holding[],
  risePct: number,
  riseByName: Record<string, number> = {},
): SurgeResult {
  if (!Number.isFinite(risePct) || risePct < -100) throw new RangeError('risePct must be >= -100');
  const after = holdings.map((h) => {
    assertNonNeg('holding value', h.value);
    const r = riseByName[h.name] ?? risePct;
    if (!Number.isFinite(r) || r < -100) throw new RangeError('rise must be >= -100');
    return { name: h.name, valueAfter: roundMoney((h.value * (100 + r)) / 100, plan.currency) };
  });
  const totalAfter = roundMoney(after.reduce((s, h) => s + h.valueAfter, 0), plan.currency);
  const items = after.map((h) => {
    const share = totalAfter > 0 ? (h.valueAfter / totalAfter) * 100 : 0;
    return {
      name: h.name,
      valueAfter: h.valueAfter,
      sharePct: Math.floor(share * 10 + 1e-9) / 10,
      overCap: share > plan.singleStockCapPct + 1e-9,
    };
  });
  return { totalAfter, items, overCapNames: items.filter((i) => i.overCap).map((i) => i.name) };
}
