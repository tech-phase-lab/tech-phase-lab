import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SaleInput, SaleOk, LossInput, LossOk } from './jp-tax.ts';
import {
  calcSale,
  calcLossRealization,
  taxOnBase,
  TAX_RULES,
  NOTE_TEXT,
  supportedYears,
} from './jp-tax.ts';

const R = TAX_RULES[2026];
const sale = (i: SaleInput): SaleOk => {
  const r = calcSale(i);
  assert.equal(r.supported, true);
  return r as SaleOk;
};
const loss = (i: LossInput): LossOk => {
  const r = calcLossRealization(i);
  assert.equal(r.supported, true);
  return r as LossOk;
};

test('税額:40万円の利益 → 81,260円(20.315%)', () => {
  const t = taxOnBase(400_000, R);
  assert.equal(t.incomeTax, 60_000);
  assert.equal(t.reconstructionTax, 1_260);
  assert.equal(t.residentTax, 20_000);
  assert.equal(t.total, 81_260);
});

test('税額:0円以下は0円', () => {
  assert.equal(taxOnBase(0, R).total, 0);
  assert.equal(taxOnBase(-1, R).total, 0);
});

test('税額:1円未満は所得税・復興・住民税それぞれ切り捨て', () => {
  // 12,345円 → 所得税 1,851.75→1,851 / 復興 38.87→38 / 住民税 617.25→617
  const t = taxOnBase(12_345, R);
  assert.equal(t.incomeTax, 1_851);
  assert.equal(t.reconstructionTax, 38);
  assert.equal(t.residentTax, 617);
  assert.equal(t.total, 2_506);
});

test('売却:特定口座で利益40万円 → 手取り918,740円', () => {
  const r = sale({ taxYear: 2026, account: 'specific_withholding', proceedsJpy: 1_000_000, costJpy: 600_000 });
  assert.equal(r.supported, true);
  assert.equal(r.gain, 400_000);
  assert.equal(r.tax.total, 81_260);
  assert.equal(r.taxDueToThisSale, 81_260);
  assert.equal(r.netProceeds, 918_740);
  assert.equal(r.netGainAfterTax, 318_740);
});

test('売却:手数料は利益から引く', () => {
  const r = sale({ taxYear: 2026, account: 'general', proceedsJpy: 1_000_000, costJpy: 600_000, feesJpy: 10_000 });
  assert.equal(r.gain, 390_000);
  assert.ok(r.notes.includes('filing_required'));
});

test('売却:NISAは非課税。損失は通算も繰越もできない', () => {
  const win = sale({ taxYear: 2026, account: 'nisa', proceedsJpy: 1_000_000, costJpy: 600_000 });
  assert.equal(win.tax.total, 0);
  assert.equal(win.netProceeds, 1_000_000);
  assert.ok(win.notes.includes('nisa_tax_free'));
  const lose = sale({ taxYear: 2026, account: 'nisa', proceedsJpy: 500_000, costJpy: 600_000, otherNetGainJpy: 300_000 });
  assert.equal(lose.tax.total, 0);
  assert.equal(lose.carryforward.newLossToCarry, 0);
  assert.ok(lose.notes.includes('nisa_loss_not_deductible'));
});

test('売却:同じ年の他の損と通算できる', () => {
  // 他の損 -100,000、この売却の利益 300,000 → 課税対象 200,000 → 40,630円
  const r = sale({ taxYear: 2026, account: 'specific_withholding', proceedsJpy: 1_300_000, costJpy: 1_000_000, otherNetGainJpy: -100_000 });
  assert.equal(r.taxableBase, 200_000);
  assert.equal(r.tax.total, 40_630);
  assert.equal(r.taxDueToThisSale, 40_630);
});

test('売却:売却で損失になれば税0、繰越の対象額が出る', () => {
  const r = sale({ taxYear: 2026, account: 'specific_withholding', proceedsJpy: 700_000, costJpy: 1_000_000 });
  assert.equal(r.gain, -300_000);
  assert.equal(r.tax.total, 0);
  assert.equal(r.carryforward.newLossToCarry, 300_000);
  assert.ok(r.notes.includes('net_loss_this_year'));
  assert.ok(r.notes.includes('filing_required_for_carryforward'));
});

test('売却:繰越損失(2024年分40万円)を差し引く → 税121,890円', () => {
  const r = sale({
    taxYear: 2026,
    account: 'specific_withholding',
    proceedsJpy: 2_000_000,
    costJpy: 1_000_000,
    carryforwards: [{ lossYear: 2024, amount: 400_000 }],
  });
  assert.equal(r.taxableBase, 600_000);
  assert.equal(r.tax.total, 121_890);
  assert.deepEqual(r.carryforward.used, [{ lossYear: 2024, used: 400_000, left: 0 }]);
});

test('売却:繰越は損失の年の翌年から3年。2022年分は2026年に使えない', () => {
  const r = sale({
    taxYear: 2026,
    account: 'general',
    proceedsJpy: 2_000_000,
    costJpy: 1_000_000,
    carryforwards: [{ lossYear: 2022, amount: 400_000 }],
  });
  assert.equal(r.taxableBase, 1_000_000);
  assert.ok(r.notes.includes('carryforward_expired'));
});

test('売却:繰越は損失の年と同じ年や前の年には使わない', () => {
  const r = sale({
    taxYear: 2026,
    account: 'general',
    proceedsJpy: 2_000_000,
    costJpy: 1_000_000,
    carryforwards: [{ lossYear: 2026, amount: 400_000 }],
  });
  assert.equal(r.taxableBase, 1_000_000);
});

test('売却:繰越の残りが出る。古い損失から使う', () => {
  const r = sale({
    taxYear: 2026,
    account: 'general',
    proceedsJpy: 1_300_000,
    costJpy: 1_000_000,
    carryforwards: [
      { lossYear: 2025, amount: 200_000 },
      { lossYear: 2024, amount: 200_000 },
    ],
  });
  assert.equal(r.taxableBase, 0);
  assert.deepEqual(r.carryforward.used, [
    { lossYear: 2024, used: 200_000, left: 0 },
    { lossYear: 2025, used: 100_000, left: 100_000 },
  ]);
});

test('損を確定:利益50万円と相殺 → 税が40,630円減る', () => {
  const r = loss({ taxYear: 2026, account: 'general', lossJpy: 200_000, otherNetGainJpy: 500_000 });
  assert.equal(r.taxBefore.total, 101_575);
  assert.equal(r.taxAfter.total, 60_945);
  assert.equal(r.taxChange, -40_630);
  assert.equal(r.carryforward.newLossToCarry, 0);
});

test('損を確定:相殺しきれない分は3年繰越(確定申告が必要)', () => {
  const r = loss({ taxYear: 2026, account: 'specific_withholding', lossJpy: 300_000, otherNetGainJpy: 100_000 });
  assert.equal(r.taxAfter.total, 0);
  assert.equal(r.taxChange, -20_315);
  assert.equal(r.carryforward.newLossToCarry, 200_000);
  assert.equal(r.carryforward.carryYears, 3);
  assert.equal(r.carryforward.lastUsableYear, 2029);
  assert.ok(r.notes.includes('carryforward_requires_filing'));
});

test('損を確定:今年の利益がなければ税は変わらず、全額が繰越', () => {
  const r = loss({ taxYear: 2026, account: 'general', lossJpy: 300_000 });
  assert.equal(r.taxChange, 0);
  assert.equal(r.carryforward.newLossToCarry, 300_000);
});

test('損を確定:NISAは税が変わらない', () => {
  const r = loss({ taxYear: 2026, account: 'nisa', lossJpy: 300_000, otherNetGainJpy: 500_000 });
  assert.equal(r.taxChange, 0);
  assert.ok(r.notes.includes('nisa_loss_not_deductible'));
});

test('損を確定:損失は正の数で入力する(負はエラー)', () => {
  assert.throws(() => loss({ taxYear: 2026, account: 'general', lossJpy: -1 }), RangeError);
});

test('対応年:未対応の年は計算せず、対応年を返す', () => {
  const r = calcSale({ taxYear: 2027, account: 'general', proceedsJpy: 1, costJpy: 0 });
  assert.equal(r.supported, false);
  assert.deepEqual(r.supportedYears, supportedYears());
  assert.match(r.message_ja, /2027年分/);
  assert.equal(calcLossRealization({ taxYear: 2025, account: 'general', lossJpy: 1 }).supported, false);
});

test('入力:不明な口座・数値以外はエラー', () => {
  assert.throws(() => sale({ taxYear: 2026, account: 'x' as never, proceedsJpy: 1, costJpy: 0 }), RangeError);
  assert.throws(() => sale({ taxYear: 2026, account: 'general', proceedsJpy: Number.NaN, costJpy: 0 }), TypeError);
});

test('文面:すべての注記コードに日英の文章がある。断定表現がない', () => {
  const codes = new Set<keyof typeof NOTE_TEXT>();
  const inputs = [
    sale({ taxYear: 2026, account: 'nisa', proceedsJpy: 1, costJpy: 2 }),
    sale({ taxYear: 2026, account: 'general', proceedsJpy: 1, costJpy: 2, carryforwards: [{ lossYear: 2024, amount: 5 }, { lossYear: 2020, amount: 5 }] }),
    sale({ taxYear: 2026, account: 'specific_withholding', proceedsJpy: 5, costJpy: 1, carryforwards: [{ lossYear: 2024, amount: 2 }] }),
    loss({ taxYear: 2026, account: 'specific_withholding', lossJpy: 10, otherNetGainJpy: 5 }),
  ];
  for (const r of inputs) for (const n of r.notes) codes.add(n);
  for (const c of codes) {
    assert.ok(NOTE_TEXT[c]?.ja && NOTE_TEXT[c]?.en, `missing text for ${c}`);
  }
  for (const [code, t] of Object.entries(NOTE_TEXT)) {
    assert.doesNotMatch(t.ja, /必ず|確実に|戻ります/, code);
    assert.doesNotMatch(t.en, /\b(guarantee|always|definitely)\b/i, code);
  }
});

test('入力: 円は整数のみ。小数・負の売却額・負の取得額・負の手数料はエラー', () => {
  const base = { taxYear: 2026, account: 'nisa' as const, proceedsJpy: 1000, costJpy: 500 };
  assert.throws(() => calcSale({ ...base, proceedsJpy: 100.5 }), RangeError);
  assert.throws(() => calcSale({ ...base, proceedsJpy: -1 }), RangeError);
  assert.throws(() => calcSale({ ...base, costJpy: -1 }), RangeError);
  assert.throws(() => calcSale({ ...base, feesJpy: -1 }), RangeError);
  assert.equal(calcSale({ ...base, otherNetGainJpy: -100 }).supported, true); // 他の損益は負でよい
});
