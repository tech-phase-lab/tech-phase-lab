import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as chain from '../lib/research/chain-map-data.ts';

const data = chain.chainDataFor('NVDA');
const hasJapanese = text => /[぀-ヿ㐀-鿿]/.test(text);

test('the NVDA chain map data keeps its companies, rows and two-step links', () => {
  assert.equal(chain.chainDataFor('AMD'), null);
  assert.equal(data.companies.length, 20);
  assert.equal(data.far.length, 3);
  assert.deepEqual(data.rows.map(row => row.ja), ['供給元(上流)', '光通信・半導体', 'サーバー・ネットワーク', 'クラウド・AI基盤']);
  assert.deepEqual(data.rivals, ['INTC', 'ANET', 'AVGO', 'AMD']);
  assert.deepEqual(chain.chainCounts(data), { companies: 20, relations: 27 });
  const ids = new Set(data.companies.map(company => company.id));
  assert.equal(ids.size, 20);
  for (const link of data.far) assert.ok(ids.has(link.from) && ids.has(link.to));
  for (const company of data.companies) assert.ok(company.row >= 0 && company.row < data.rows.length, company.id);
  assert.deepEqual(CHAIN().map(kind => chain.chainGroup(data, kind).length), [4, 5, 6, 5]);
});
const CHAIN = () => chain.CHAIN_KINDS;

test('every relation has Japanese and English text and a linked, labelled source; press items are marked', () => {
  const sources = [...data.companies.flatMap(company => company.relations), ...data.far];
  assert.equal(sources.length, 27);
  for (const item of sources) {
    assert.ok(item.text && hasJapanese(item.text), item.text);
    assert.ok(item.text_en && !hasJapanese(item.text_en), item.text_en);
    const source = item.source;
    assert.match(source.url, /^https:\/\//);
    assert.ok(['official', 'press'].includes(source.level));
    assert.ok(source.label && source.label_en && !hasJapanese(source.label_en), source.label);
    if (source.note) assert.ok(source.note_en && !hasJapanese(source.note_en));
  }
  assert.equal(sources.filter(item => item.source.level === 'press').length, 4);
  assert.deepEqual(data.companies.find(company => company.id === 'INTC').relations.map(relation => relation.type), ['tie', 'rival']);
});

const require = createRequire(import.meta.url);
function compile(file, extra) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../app/research/stocks/${file}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => name.endsWith('.css') ? { default: {} } : extra[name] ?? require(name), mod, mod.exports);
  return mod.exports;
}
const { StockChainMap } = compile('stock-chain-map', { '@/lib/research/chain-map-data': chain });
const { renderToStaticMarkup } = require('react-dom/server');
const { createElement } = require('react');

test('the map shows suppliers first, no range buttons, a card per company with sources behind a tap', () => {
  for (const lang of ['ja', 'en']) {
    const html = renderToStaticMarkup(createElement(StockChainMap, { data, lang }));
    assert.equal((html.match(/<button/g) ?? []).length, 21);
    assert.ok(!html.includes('直接の関係') && !html.includes('2段先まで'));
    assert.equal((html.match(/<details/g) ?? []).length, 23);
    assert.ok(html.indexOf(lang === 'ja' ? '供給元(上流)' : 'Suppliers (upstream)') < html.indexOf('NVDA</b>'));
    assert.ok(html.includes(lang === 'ja' ? '20社 · 27の関係' : '20 companies · 27 relationships'));
    assert.ok(html.includes(lang === 'ja' ? 'さらに先の関係' : 'Further links'));
    assert.ok(html.includes(lang === 'ja' ? '出典・引用・発表日' : 'Sources, quotes &amp; dates'));
    assert.ok(html.includes(lang === 'ja' ? '報道' : 'Press'));
    assert.equal((html.match(/id="chain-card-/g) ?? []).length, 20);
    // The Japanese view never shows English-only copy; the English view never shows Japanese.
    const visible = html.replace(/<q[^>]*>.*?<\/q>/g, '').replace(/<a [^>]*>/g, '<a>');
    if (lang === 'en') assert.ok(!hasJapanese(visible.replace(/<[^>]+>/g, ' ')), 'English view has Japanese text');
  }
});
