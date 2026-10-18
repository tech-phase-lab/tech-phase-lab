import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as chain from '../lib/research/chain-map-data.ts';

const data = chain.chainDataFor('NVDA');
const hasJapanese = text => /[぀-ヿ㐀-鿿]/.test(text);

test('the NVDA chain map data keeps its companies, rows and two-step links', () => {
  assert.equal(chain.chainDataFor('AAPL'), null);
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

const BATCH = {
  NFLX: [14, 18], LRCX: [22, 24], TSLA: [17, 19], IBM: [27, 40], META: [33, 37],
  BE: [6, 9], SKHY: [14, 16], GEV: [18, 19], MSFT: [24, 29], KLAC: [8, 10],
  SNDK: [7, 15], AMD: [18, 25], ANET: [16, 22], ARM: [19, 20], LITE: [6, 10],
  VST: [6, 6], ADBE: [18, 18], MU: [10, 12], ASML: [9, 12], TSM: [20, 23],
};

test('the earnings-ordered companies use the same format with an official source on every relation', () => {
  for (const [ticker, [companies, relations]] of Object.entries(BATCH)) {
    const item = chain.chainDataFor(ticker);
    assert.ok(item, ticker);
    assert.equal(item.root.ticker, ticker);
    assert.deepEqual(chain.chainCounts(item), { companies, relations }, ticker);
    const ids = new Set(item.companies.map(company => company.id));
    assert.equal(ids.size, companies, ticker);
    for (const id of item.rivals) assert.ok(ids.has(id), `${ticker} rival ${id}`);
    assert.equal(item.far.length, 0);
    for (const company of item.companies) {
      assert.ok(company.row >= 0 && company.row < item.rows.length, company.id);
      assert.ok(company.sub && company.sub_en && !hasJapanese(company.sub_en), company.id);
      assert.ok(item.rows[company.row], `${ticker} ${company.id} row`);
      for (const relation of company.relations) {
        assert.ok(relation.text && hasJapanese(relation.text), relation.text);
        assert.ok(relation.text_en && !hasJapanese(relation.text_en), relation.text_en);
        const source = relation.source;
        assert.match(source.url, /^https:\/\//);
        assert.equal(source.level, 'official', `${ticker} ${company.id}`);
        assert.ok(source.label && source.label_en && !hasJapanese(source.label_en), source.label);
        if (source.note) assert.ok(source.note_en && !hasJapanese(source.note_en));
        if (source.quote) assert.ok(!hasJapanese(source.quote), source.quote);
      }
    }
  }
});

test('a map without suppliers, rivals or two-step links leaves those parts out, and META puts several rows above the root', () => {
  const lrcx = chain.chainDataFor('LRCX'), be = chain.chainDataFor('BE'), meta = chain.chainDataFor('META');
  assert.ok(chain.chainAbove(lrcx, 0) && !chain.chainAbove(lrcx, 1));
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(row => chain.chainAbove(meta, row)), [true, true, true, false, true, false]);
  const html = renderToStaticMarkup(createElement(StockChainMap, { data: be, lang: 'ja' }));
  assert.ok(!html.includes('供給元(上流)'), 'an empty supplier row is not drawn');
  assert.ok(html.indexOf('AIデータセンター・IT企業') > html.indexOf('BE</b>'));
  assert.ok(html.includes('6社 · 9の関係') && !html.includes('さらに先の関係') && !html.includes('競合は？'));
  const plain = renderToStaticMarkup(createElement(StockChainMap, { data: be, lang: 'en' }));
  assert.ok(!plain.includes('Who competes with it?') && !plain.includes('Further links') && !plain.includes('Competitors'));
  const metaHtml = renderToStaticMarkup(createElement(StockChainMap, { data: meta, lang: 'en' }));
  assert.ok(metaHtml.indexOf('Power') < metaHtml.indexOf('META</b>') && metaHtml.indexOf('META</b>') < metaHtml.indexOf('Glasses, social'));
  assert.ok(metaHtml.indexOf('AI &amp; device partners') < metaHtml.indexOf('META</b>'));
  assert.equal((metaHtml.match(/id="chain-card-/g) ?? []).length, 33);
});

test('the "who competes" row stays on one line (main rivals only), and unlisted companies are not shown (OpenAI and Anthropic are the owner's exceptions)', () => {
  const UNLISTED = ['TikTok', 'xAI', 'Groq', 'Scale AI', 'Crusoe', 'Westinghouse', 'Framatome', 'BMC', 'Semes', 'CXMT', 'imec', 'SK ecoplant'];
  for (const ticker of Object.keys(BATCH)) {
    const item = chain.chainDataFor(ticker);
    const labels = item.rivals.map(id => item.companies.find(company => company.id === id).ticker);
    const width = labels.reduce((sum, label) => sum + label.length * 7.8 + 24, 0) + 8 * Math.max(0, labels.length - 1);
    assert.ok(width <= 320, `${ticker} rivals row ${Math.round(width)}px`);
    for (const company of item.companies) assert.ok(!UNLISTED.includes(company.ticker) && !UNLISTED.includes(company.name), `${ticker} ${company.id}`);
  }
});
