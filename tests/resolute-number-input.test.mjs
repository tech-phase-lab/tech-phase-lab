import test from 'node:test';
import assert from 'node:assert/strict';
import {formatNumberInput,normalizeNumberInput,scaledNumberInput} from '../lib/resolute/number-input.ts';
import {parseTaxAmount} from '../lib/resolute/tax-input.ts';
import {calcSale} from '../lib/resolute/jp-tax.ts';
test('large grouped financial input preserves all digits and decimal precision',()=>{
 for(const value of ['0','100000000','1000000000000','12345.67','0.0001','12.'])assert.equal(normalizeNumberInput(formatNumberInput(value),true),value);
 assert.equal(formatNumberInput('100000000'),'100,000,000');
 assert.equal(normalizeNumberInput('１２３，４５６'), '123456');
 for(const invalid of ['-1','1e6','1.2.3','Infinity','abc','1円'])assert.equal(normalizeNumberInput(invalid,true),null);
 assert.equal(normalizeNumberInput('12.34'),null);
});
test('万円 input converts exactly to yen without changing the tax calculation',()=>{
 assert.equal(parseTaxAmount('100','man'),1000000);
 assert.equal(parseTaxAmount('0.0001','man'),1);
 assert.equal(parseTaxAmount('1.2345','man'),12345);
 assert.equal(parseTaxAmount('100000000','man'),1e12);
 for(const invalid of ['0.00001','100000000.0001','-1','1e6'])assert.equal(parseTaxAmount(invalid,'man'),null);
 assert.equal(parseTaxAmount('1.5','yen'),null);
 const r=calcSale({taxYear:2026,account:'specific_withholding',proceedsJpy:parseTaxAmount('100','man'),costJpy:parseTaxAmount('60','man'),feesJpy:parseTaxAmount('10000','yen')});
 assert.equal(r.tax.total,79228);
});

test('simulation display amounts preserve integer yen and cents',()=>{
 assert.equal(scaledNumberInput('2.1234',4),21234);
 assert.equal(scaledNumberInput('0.0001',4),1);
 assert.equal(scaledNumberInput('12.34',2),1234);
 assert.equal(scaledNumberInput('0.00001',4),null);
 assert.equal(scaledNumberInput('12.345',2),null);
 assert.equal(scaledNumberInput('100000000',4),1e12);
 assert.equal(scaledNumberInput('100000000.0001',4),null);
});
