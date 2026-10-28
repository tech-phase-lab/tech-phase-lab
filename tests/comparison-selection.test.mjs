import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonChoices, enterChoice, moveChoice } from '../lib/research/comparison-selection.ts';
const companies = [{ticker:'MU',name:'Micron'}, {ticker:'MULN',name:'Mullen'}, {ticker:'AVGO',name:'Broadcom'}];
test('keyboard and mouse exclude a company already selected in another slot', () => {
  const choices = comparisonChoices(companies, ['MU', '', ''], 1);
  assert.deepEqual(choices.map(c => c.ticker), ['MULN', 'AVGO']);
  assert.equal(enterChoice(choices, 'MU', null), undefined);
  assert.equal(enterChoice(choices, 'MU', 'MU'), undefined);
  assert.equal(comparisonChoices(companies, ['MU'], 0)[0].ticker, 'MU');
});
test('Enter accepts an exact ticker but never silently chooses the first partial match', () => {
  assert.equal(enterChoice(companies, ' mu ', null).ticker, 'MU');
  assert.equal(enterChoice(companies, 'M', null), undefined);
  assert.equal(enterChoice(companies, 'M', 'MULN').ticker, 'MULN');
});
test('arrow selection wraps and tolerates a changed or empty response', () => {
  assert.equal(moveChoice(companies, null, 1), 'MU');
  assert.equal(moveChoice(companies, null, -1), 'AVGO');
  assert.equal(moveChoice(companies, 'AVGO', 1), 'MU');
  assert.equal(moveChoice(companies, 'MU', -1), 'AVGO');
  assert.equal(moveChoice(companies, 'STALE', 1), 'MU');
  assert.equal(moveChoice([], null, 1), null);
});
