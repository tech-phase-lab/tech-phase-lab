// RESOLUTE ⑥ 税金計算(日本の税制)
// 依存なし・純粋関数。金額はすべて「円」の整数で扱う。
// 目安の計算であり、税務相談ではありません。

/** 対応年ごとのルール。年を足すときは、ここに1項目を追加してテストを更新する。 */
export interface TaxRules {
  label: string;
  incomeTaxRate: number;
  reconstructionRate: number;
  residentTaxRate: number;
  carryforwardYears: number;
  reviewedOn: string;
}

export const TAX_RULES: Record<number, TaxRules> = {
  2026: {
    label: '2026年分(令和8年分)',
    incomeTaxRate: 0.15, // 所得税
    reconstructionRate: 0.021, // 復興特別所得税(所得税額×2.1%)。2037年分まで
    residentTaxRate: 0.05, // 住民税
    carryforwardYears: 3, // 譲渡損失の繰越控除:翌年以後3年
    reviewedOn: '2026-10-10', // 最後に一次情報で確認した日
  },
};

export const ACCOUNT_TYPES = ['specific_withholding', 'general', 'nisa'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface Tax { incomeTax: number; reconstructionTax: number; residentTax: number; total: number }
export interface CarryforwardIn { lossYear: number; amount: number }
export interface CarryforwardUsed { lossYear: number; used: number; left: number }
export type NoteCode = string;
export interface Assumptions { taxYear: number; taxYearLabel: string; account: AccountType; rate_ja: string; reviewedOn: string }
export interface Unsupported {
  supported: false; taxYear: number; supportedYears: number[]; message_ja: string; message_en: string;
}
export interface SaleInput {
  taxYear: number; account: AccountType; proceedsJpy: number; costJpy: number;
  feesJpy?: number; otherNetGainJpy?: number; carryforwards?: CarryforwardIn[];
}
export interface SaleOk {
  supported: true; account: AccountType; gain: number; pooledGain?: number; taxableBase: number;
  tax: Tax; taxDueToThisSale?: number; netProceeds: number; netGainAfterTax: number;
  carryforward: { used: CarryforwardUsed[]; expired: CarryforwardIn[]; newLossToCarry: number };
  notes: NoteCode[]; assumptions: Assumptions; disclaimer_ja: string; disclaimer_en: string;
}
export type SaleResult = SaleOk | Unsupported;
export interface LossInput {
  taxYear: number; account: AccountType; lossJpy: number; otherNetGainJpy?: number; carryforwards?: CarryforwardIn[];
}
export interface LossOk {
  supported: true; account: AccountType; lossJpy: number; otherNetGainJpy?: number;
  taxBefore: { total: number } & Partial<Tax>; taxAfter: { total: number } & Partial<Tax>; taxChange: number;
  carryforward: { newLossToCarry: number; carryYears: number; lastUsableYear?: number | null };
  notes: NoteCode[]; assumptions: Assumptions; disclaimer_ja: string; disclaimer_en: string;
}
export type LossResult = LossOk | Unsupported;
// specific_withholding: 特定口座(源泉徴収あり)/ general: 一般口座(特定口座の源泉徴収なしを含む)/ nisa: NISA口座

export const DISCLAIMER_JA =
  '入力した条件に基づく概算であり、税務相談ではありません。';
export const DISCLAIMER_EN =
  'An estimate based on what you entered. Not tax advice.';

const floor = (n: number): number => Math.floor(n + 1e-9);

function assertInt(name: string, v: unknown): void {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${name} must be a finite number`);
  if (!Number.isSafeInteger(v)) throw new RangeError(`${name} must be an integer (yen)`);
}

function assertNonNeg(name: string, v: number): void {
  if (v < 0) throw new RangeError(`${name} must be >= 0`);
}

export function supportedYears(): number[] {
  return Object.keys(TAX_RULES).map(Number);
}

/** 税額(円)を、所得税・復興特別所得税・住民税に分けて返す。それぞれ1円未満切り捨て。 */
export function taxOnBase(base: number, rules: TaxRules): Tax {
  if (base <= 0) return { incomeTax: 0, reconstructionTax: 0, residentTax: 0, total: 0 };
  const incomeTax = floor(base * rules.incomeTaxRate);
  const reconstructionTax = floor(incomeTax * rules.reconstructionRate);
  const residentTax = floor(base * rules.residentTaxRate);
  return {
    incomeTax,
    reconstructionTax,
    residentTax,
    total: incomeTax + reconstructionTax + residentTax,
  };
}

function unsupported(taxYear: number): Unsupported {
  return {
    supported: false as const,
    taxYear,
    supportedYears: supportedYears(),
    message_ja: `${taxYear}年分の税制にはまだ対応していません。対応年:${supportedYears().join('、')}年分`,
    message_en: `Tax year ${taxYear} is not supported yet. Supported: ${supportedYears().join(', ')}`,
  };
}

/** 前年以前の繰越損失(古い順)から、今年の課税対象を減らす。 */
function applyCarryforward(
  taxableBase: number,
  carryforwards: CarryforwardIn[] | undefined,
  taxYear: number,
  rules: TaxRules,
): { taxableAfter: number; used: CarryforwardUsed[]; expired: CarryforwardIn[] } {
  let remaining = Math.max(0, taxableBase);
  const used: CarryforwardUsed[] = [];
  const expired: CarryforwardIn[] = [];
  const valid = (carryforwards || [])
    .filter((c) => c && c.amount > 0)
    .sort((a, b) => a.lossYear - b.lossYear);
  for (const c of valid) {
    const lastUsableYear = c.lossYear + rules.carryforwardYears;
    if (taxYear <= c.lossYear || taxYear > lastUsableYear) {
      if (taxYear > lastUsableYear) expired.push(c);
      continue;
    }
    const use = Math.min(remaining, c.amount);
    if (use > 0) used.push({ lossYear: c.lossYear, used: use, left: c.amount - use });
    remaining -= use;
  }
  return { taxableAfter: remaining, used, expired };
}

/** 売却したときの手取り。金額はすべて円。外貨の取得額は取得時の円換算額で入れる。 */
export function calcSale(i: SaleInput): SaleResult {
  const rules = TAX_RULES[i.taxYear];
  if (!rules) return unsupported(i.taxYear);
  if (!(ACCOUNT_TYPES as readonly string[]).includes(i.account)) throw new RangeError(`unknown account: ${i.account}`);
  assertInt('proceedsJpy', i.proceedsJpy);
  assertInt('costJpy', i.costJpy);
  assertNonNeg('proceedsJpy', i.proceedsJpy);
  assertNonNeg('costJpy', i.costJpy);
  const fees = i.feesJpy ?? 0;
  const other = i.otherNetGainJpy ?? 0;
  assertInt('feesJpy', fees);
  assertNonNeg('feesJpy', fees);
  assertInt('otherNetGainJpy', other);

  const gain = i.proceedsJpy - i.costJpy - fees; // この取引の損益
  const notes: NoteCode[] = [];
  const assumptions: Assumptions = {
    taxYear: i.taxYear,
    taxYearLabel: rules.label,
    account: i.account,
    rate_ja: '所得税15%+復興特別所得税(所得税額の2.1%)+住民税5%=20.315%',
    reviewedOn: rules.reviewedOn,
  };

  if (i.account === 'nisa') {
    notes.push('nisa_tax_free');
    if (gain < 0) notes.push('nisa_loss_not_deductible');
    return {
      supported: true as const,
      account: i.account,
      gain,
      tax: { incomeTax: 0, reconstructionTax: 0, residentTax: 0, total: 0 },
      netProceeds: i.proceedsJpy - fees,
      netGainAfterTax: gain,
      taxableBase: 0,
      carryforward: { used: [], expired: [], newLossToCarry: 0 },
      notes,
      assumptions,
      disclaimer_ja: DISCLAIMER_JA,
      disclaimer_en: DISCLAIMER_EN,
    };
  }

  // 課税口座:同じ年の他の損益と通算 → 繰越損失を控除 → 税額
  const pooled = gain + other;
  const afterOffset = Math.max(0, pooled);
  const cf = applyCarryforward(afterOffset, i.carryforwards, i.taxYear, rules);
  const taxableBase = cf.taxableAfter;
  const tax = taxOnBase(taxableBase, rules);

  if (cf.used.length) notes.push('carryforward_used');
  if (cf.expired.length) notes.push('carryforward_expired');
  if (pooled < 0) notes.push('net_loss_this_year');
  if (i.account === 'general') notes.push('filing_required');
  if (i.account === 'specific_withholding' && (cf.used.length || pooled < 0))
    notes.push('filing_required_for_carryforward');

  // この取引だけを足したことによる税額の増え方(他の損益との通算後)
  const baseWithout = applyCarryforward(Math.max(0, other), i.carryforwards, i.taxYear, rules).taxableAfter;
  const taxWithout = taxOnBase(baseWithout, rules).total;
  const taxDueToThisSale = tax.total - taxWithout;

  return {
    supported: true as const,
    account: i.account,
    gain,
    pooledGain: pooled,
    taxableBase,
    tax, // 年間の税額(他の損益・繰越控除を含めた後)
    taxDueToThisSale, // この売却で増える(減る)税額
    netProceeds: i.proceedsJpy - fees - taxDueToThisSale,
    netGainAfterTax: gain - taxDueToThisSale,
    carryforward: {
      used: cf.used,
      expired: cf.expired,
      newLossToCarry: pooled < 0 ? -pooled : 0,
    },
    notes,
    assumptions,
    disclaimer_ja: DISCLAIMER_JA,
    disclaimer_en: DISCLAIMER_EN,
  };
}

/** 損を確定したときの税額の変化。入力条件にもとづく概算で、戻ると断定しない。lossJpy は正の数で入れる。 */
export function calcLossRealization(i: LossInput): LossResult {
  const rules = TAX_RULES[i.taxYear];
  if (!rules) return unsupported(i.taxYear);
  if (!(ACCOUNT_TYPES as readonly string[]).includes(i.account)) throw new RangeError(`unknown account: ${i.account}`);
  assertInt('lossJpy', i.lossJpy);
  if (i.lossJpy < 0) throw new RangeError('lossJpy must be >= 0 (enter the loss as a positive number)');
  const other = i.otherNetGainJpy ?? 0;
  assertInt('otherNetGainJpy', other);

  const assumptions: Assumptions = {
    taxYear: i.taxYear,
    taxYearLabel: rules.label,
    account: i.account,
    rate_ja: '所得税15%+復興特別所得税(所得税額の2.1%)+住民税5%=20.315%',
    reviewedOn: rules.reviewedOn,
  };

  if (i.account === 'nisa') {
    return {
      supported: true as const,
      account: i.account,
      lossJpy: i.lossJpy,
      taxBefore: { total: 0 },
      taxAfter: { total: 0 },
      taxChange: 0,
      carryforward: { newLossToCarry: 0, carryYears: 0 },
      notes: ['nisa_loss_not_deductible'],
      assumptions,
      disclaimer_ja: DISCLAIMER_JA,
      disclaimer_en: DISCLAIMER_EN,
    };
  }

  const before = applyCarryforward(Math.max(0, other), i.carryforwards, i.taxYear, rules);
  const taxBefore = taxOnBase(before.taxableAfter, rules);

  const pooled = other - i.lossJpy;
  const afterOffset = Math.max(0, pooled);
  const after = applyCarryforward(afterOffset, i.carryforwards, i.taxYear, rules);
  const taxAfter = taxOnBase(after.taxableAfter, rules);

  const newLossToCarry = pooled < 0 ? -pooled : 0;
  const notes: NoteCode[] = [];
  if (newLossToCarry > 0) notes.push('carryforward_requires_filing');
  if (i.account === 'specific_withholding' && other > 0)
    notes.push('withholding_account_year_end_settlement');
  // 繰越控除をすでに使っている場合、損失を足すと繰越の消費が減る。その分は税額差に反映済み。

  return {
    supported: true as const,
    account: i.account,
    lossJpy: i.lossJpy,
    otherNetGainJpy: other,
    taxBefore,
    taxAfter,
    taxChange: taxAfter.total - taxBefore.total, // 負の数=税額が減る
    carryforward: {
      newLossToCarry,
      carryYears: newLossToCarry > 0 ? rules.carryforwardYears : 0,
      lastUsableYear: newLossToCarry > 0 ? i.taxYear + rules.carryforwardYears : null,
    },
    notes,
    assumptions,
    disclaimer_ja: DISCLAIMER_JA,
    disclaimer_en: DISCLAIMER_EN,
  };
}

/** 注記コード → 画面に出す文章(日英)。コードはAPI/テスト用、文章はUI用。 */
export const NOTE_TEXT: Record<string, { ja: string; en: string }> = {
  nisa_tax_free: {
    ja: 'NISA口座の売却益は非課税として計算しています。',
    en: 'This estimate treats gains in a NISA account as tax-free. NISA is a Japanese account type.',
  },
  nisa_loss_not_deductible: {
    ja: 'NISA口座の損失は、他の口座の利益と相殺できず、繰り越しもできません。',
    en: 'Losses in a NISA account cannot be offset against other gains or carried forward.',
  },
  carryforward_used: {
    ja: '確定申告で繰り越している譲渡損失を差し引いて計算しています。',
    en: 'We’ve deducted capital losses carried forward from an earlier tax return.',
  },
  carryforward_expired: {
    ja: '繰越期間(翌年以後3年)を過ぎた損失は差し引いていません。',
    en: 'Losses past the 3-year carryforward window were not deducted.',
  },
  net_loss_this_year: {
    ja: '同じ年の通算で損失になっています。確定申告をすると、翌年以後3年にわたって繰り越せます。',
    en: 'Your total for the year is a loss. You can carry it forward for up to the next 3 years by filing a tax return.',
  },
  filing_required: {
    ja: '一般口座は、利益が出た場合に自分で確定申告が必要です。',
    en: 'For a general (non-withholding) account, you file the return yourself when you have a gain.',
  },
  filing_required_for_carryforward: {
    ja: '特定口座でも、損失の繰越や他の損益との通算をするには確定申告が必要です。',
    en: 'Even with a withholding account, you must file a tax return to carry losses forward or offset them against eligible gains.',
  },
  carryforward_requires_filing: {
    ja: '相殺しきれない損失は、確定申告をすると翌年以後3年にわたって繰り越せます。',
    en: 'If a loss can’t be fully offset, you can carry it forward for the next 3 years by filing a tax return.',
  },
  withholding_account_year_end_settlement: {
    ja: '特定口座(源泉徴収あり)では、同じ口座内の損益は年末に精算されます。実際の還付・納付は証券会社の年間取引報告書で確認してください。',
    en: 'In a withholding account, gains and losses inside the same account are settled at year end. Check your broker’s annual transaction report for the actual result.',
  },
};
