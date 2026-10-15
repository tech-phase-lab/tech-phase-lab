import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as networkHelpers from '../lib/research/company-network.ts';
import { companyNetworkFor } from '../lib/research/company-network.server.ts';
import { companyIntroductions, companyIntroductionFields, companyIntroductionFor } from '../lib/research/company-introductions.ts';

test('every published company has six bilingual answers and dated primary sources', () => {
  const identities = new Set();
  for (const company of companyIntroductions) {
    assert.ok(!identities.has(company.cik));
    identities.add(company.cik);
    assert.match(company.reviewedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(company.sources.length > 0);
    for (const source of company.sources) {
      assert.ok(new Set(['www.sec.gov', 'ir.baidu.com', 'data.alibabagroup.com', 'www.take2games.com', 'news.sap.com', 'usa.visa.com', 'newsroom.mastercard.com', 'appian.com', 'knowledgebase.zetaglobal.com', 'newsroom.intel.com', 'www.bloomenergy.com', 'investor.vistracorp.com', 'www.gevernova.com', 'investors.digitalocean.com', 'ir.elastic.co', 'ir.gitlab.com', 'investors.jfrog.com', 'www.boxinvestorrelations.com', 'www.uipath.com', 'investors.dropbox.com', 'ir.dynatrace.com', 'investors.asana.com', 'ir.monday.com', 'ir.freshworks.com', 'www.ringcentral.com', 'www.bill.com', 'ir.appfolioinc.com', 'investors.blackline.com']).has(new URL(source.url).hostname), `Unreviewed source host: ${source.url}`);
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
function compileComponent(file, extra = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../app/research/stocks/${file}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = {exports:{}};
  new Function('require','module','exports',compiled)(name => name.endsWith('.css') ? {default:{}} : extra[name] ?? require(name), mod, mod.exports);
  return mod.exports;
}
const networkComponent = compileComponent('company-network', {'@/lib/research/company-network':networkHelpers});
const panel = compileComponent('company-introduction', {'./company-network':networkComponent});
const {renderToStaticMarkup} = require('react-dom/server');
const {createElement} = require('react');
test('renders all six localized answers with expandable source links', () => {
  const introduction = companyIntroductionFor({cik:1045810,ticker:'NVDA'});
  for (const lang of ['ja','en']) {
    const html = renderToStaticMarkup(createElement(panel.CompanyIntroductionPanel,{introduction,lang,network:companyNetworkFor({cik:introduction.cik,ticker:introduction.tickers[0]})}));
    assert.equal((html.match(/<dt>/g)??[]).length,4);
    assert.equal((html.match(/<dd>/g)??[]).length,4);
    assert.match(html, /<details/);
    assert.match(html, /2026-10-13/);
    assert.ok(html.includes(lang==='ja'?'どこと繋がる？':'Who does it work with?'));
    assert.ok(!html.includes(lang==='ja'?'Who does it work with?':'どこと繋がる？'));
    assert.ok(html.indexOf('data-topic="risks"') < html.indexOf('data-topic="competition"'));
    assert.ok(!html.includes('href="/research/stocks'));
    assert.match(html, /aria-current="true" aria-label="NVIDIA"/);
    assert.ok(!html.includes("Show connections for"));
    assert.ok(!html.includes("最初に戻る"));
    assert.ok(!html.includes("Connection details"));

    assert.ok(!html.includes('q=undefined'));
  }
});

test('all issuers render same-page selection maps in both languages', () => {
  for (const introduction of companyIntroductions) {
    for (const lang of ['ja','en']) {
      const html = renderToStaticMarkup(createElement(panel.CompanyIntroductionPanel,{introduction,lang,network:companyNetworkFor({cik:introduction.cik,ticker:introduction.tickers[0]})}));
      assert.ok(!html.includes('href="/research/stocks'));
      assert.ok(!html.includes(lang==='ja'?'最初に戻る':'Reset'));
      const network = companyNetworkFor({cik:introduction.cik,ticker:introduction.tickers[0]});
      const focus = networkHelpers.networkFocus(network, network.root, 'two');
      const visible = network.root === 'NVDA' ? network.nodes : network.nodes.filter(node => !(node.kind === 'industry' && focus.competitors.has(node.id)) && (focus.distances.has(node.id) || focus.competitors.has(node.id)));
      assert.equal((html.match(/<button/g)??[]).length,3 + visible.length);
      assert.ok(html.includes(`aria-current="true" aria-label="${introduction.name}"`), introduction.tickers[0]);
      assert.ok(html.includes(lang==='ja'?'どこと繋がる？':'Who does it work with?'));
    }
  }
});

test('Lumentum shows actual competitors, excludes anonymous rivals and removes out-of-range cards', () => {
  const introduction = companyIntroductionFor({cik:1633978,ticker:'LITE'});
  const network = companyNetworkFor({cik:1633978,ticker:'LITE'});
  const html = renderToStaticMarkup(createElement(panel.CompanyIntroductionPanel,{introduction,lang:'ja',network}));
  assert.ok(html.includes('Coherent (COHR)'));
  assert.ok(html.includes('IPG Photonics (IPGP)'));
  assert.ok(html.includes('Applied Optoelectronics (AAOI)'));
  const aaoi = introduction.maps.competition.find(entry => entry.ticker === 'AAOI');
  assert.ok(aaoi.sourceIndexes.some(index => introduction.sources[index].url.endsWith('/aaoi20251231_10k.htm')));
  assert.ok(!html.includes('光通信メーカー'));
  assert.ok(!html.includes('レーザーメーカー'));
  assert.ok(!html.includes('aria-label="Nikon"'));
});
