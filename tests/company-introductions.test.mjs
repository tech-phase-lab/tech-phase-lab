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
    assert.equal((html.match(/<dt>/g)??[]).length,6);
    assert.equal((html.match(/<dd>/g)??[]).length,6);
    assert.match(html, /<details/);
    assert.match(html, /2026-10-13/);
    assert.ok(html.includes(lang==='ja'?'どことつながる？':'Who does it work with?'));
    assert.ok(!html.includes(lang==='ja'?'Who does it work with?':'どことつながる？'));
  }
});
