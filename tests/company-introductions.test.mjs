import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { companyIntroductions, companyIntroductionFields, companyIntroductionFor } from '../lib/research/company-introductions.ts';

test('every published company has six bilingual answers and dated primary sources', () => {
  const identities = new Set();
  for (const company of companyIntroductions) {
    assert.ok(!identities.has(company.cik));
    identities.add(company.cik);
    assert.match(company.reviewedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(company.sources.length > 0);
    for (const source of company.sources) {
      assert.equal(new URL(source.url).hostname, 'www.sec.gov');
      assert.ok(source.label.trim());
    }
    for (const lang of ['ja', 'en']) {
      assert.deepEqual(Object.keys(company[lang]), [...companyIntroductionFields]);
      for (const answer of Object.values(company[lang])) assert.ok(answer.trim().length > 15);
    }
  }
});

test('requires both issuer identity and ticker; supports share classes and non-monitored issuers', () => {
  assert.equal(companyIntroductionFor({cik:1652044,ticker:'GOOG'}), companyIntroductionFor({cik:1652044,ticker:'GOOGL'}));
  assert.equal(companyIntroductionFor({cik:909832,ticker:' cost '})?.name, 'Costco');
  assert.equal(companyIntroductionFor({cik:1,ticker:'NVDA'}), null);
  assert.equal(companyIntroductionFor({cik:1045810,ticker:'NVDL'}), null);
  assert.equal(companyIntroductionFor({cik:1,ticker:'UNKNOWN'}), null);
});

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL('../app/research/stocks/company-introduction.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const mod = {exports:{}};
new Function('require','module','exports',compiled)(name => name.endsWith('.css') ? {default:{}} : require(name), mod, mod.exports);
const {renderToStaticMarkup} = require('react-dom/server');
const {createElement} = require('react');
test('renders all six localized answers with expandable source links', () => {
  const introduction = companyIntroductionFor({cik:1045810,ticker:'NVDA'});
  for (const lang of ['ja','en']) {
    const html = renderToStaticMarkup(createElement(mod.exports.CompanyIntroductionPanel,{introduction,lang}));
    assert.equal((html.match(/<dt>/g)??[]).length,4);
    assert.equal((html.match(/<dd>/g)??[]).length,4);
    assert.match(html, /<details/);
    assert.match(html, /2026-10-13/);
    assert.ok(html.includes(lang==='ja'?'どこと繋がる？':'Who does it work with?'));
    assert.ok(!html.includes(lang==='ja'?'Who does it work with?':'どこと繋がる？'));
    assert.ok(html.indexOf('data-topic="risks"') < html.indexOf('data-topic="competition"'));
    assert.match(html, /href="\/research\/stocks\?q=AMD"/);
    assert.ok(html.includes(lang==='ja'?'半導体の製造委託先':'Chip manufacturing supplier'));
    assert.ok(!html.includes('q=undefined'));
  }
});

test('all issuers render both maps in both languages without invented links for industry nodes', () => {
  for (const introduction of companyIntroductions) {
    for (const lang of ['ja','en']) {
      const html = renderToStaticMarkup(createElement(mod.exports.CompanyIntroductionPanel,{introduction,lang}));
      const entries = Object.values(introduction.maps).flat();
      assert.equal((html.match(/data-role=/g)??[]).length, entries.length);
      assert.equal((html.match(/href="\/research\/stocks\?q=/g)??[]).length, entries.filter(entry=>entry.ticker).length);
    }
  }
});
