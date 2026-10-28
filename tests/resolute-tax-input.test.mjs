import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaxYen, TAX_INPUT_LIMIT } from '../lib/resolute/tax-input.ts';
import { calcSale, calcLossRealization } from '../lib/resolute/jp-tax.ts';
test('tax inputs preserve whole yen and reject fractional, negative and overflowing amounts', () => {
  for (const text of ['', '-1', '0.1', '1.9', 'NaN', 'Infinity', '1e6', ' 1', String(TAX_INPUT_LIMIT+1)]) assert.equal(parseTaxYen(text), null);
  assert.equal(parseTaxYen('0'), 0);
  assert.equal(parseTaxYen(String(TAX_INPUT_LIMIT)), TAX_INPUT_LIMIT);
  const input = {taxYear:2026,account:'specific_withholding',proceedsJpy:parseTaxYen('1000000'),costJpy:parseTaxYen('600000'),feesJpy:parseTaxYen('10000')};
  const result=calcSale(input);assert.equal(result.supported,true);assert.equal(result.gain,390000);assert.equal(result.netProceeds,910772);
  assert.equal(calcSale({...input,account:'nisa'}).tax.total,0);
  const loss=calcLossRealization({taxYear:2026,account:'general',lossJpy:parseTaxYen('200000'),otherNetGainJpy:parseTaxYen('500000')});assert.equal(loss.taxChange,-40630);
});
