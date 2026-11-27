// Owner, Nov 25: the stock page has one 「▸ 出典 N件」 (確認日 at the right) instead of 「出典 N件」 + 「出典・確認日」;
// the same document and quote is shown once with its companies below; one closing note; no 「報道 報道」.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as chain from '../lib/research/chain-map-data.ts';
import { companyIntroductionFor } from '../lib/research/company-introductions.ts';

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require('react-dom/server');
const { createElement } = require('react');
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function compile(file, extra = {}) {
  const compiled = ts.transpileModule(read(`app/research/stocks/${file}.tsx`), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => name.endsWith('.css') ? { default: {} } : extra[name] ?? require(name), mod, mod.exports);
  return mod.exports;
}
const sourceList = compile('source-list');
const { chainSourceBlocks } = compile('stock-chain-map', { '@/lib/research/chain-map-core': chain, './source-list': sourceList });
const panel = compile('company-introduction', { './chain-map': { CompanyNetworkMap: () => null }, './source-list': sourceList });
const NOTE_JA = '公式資料で確認できた関係のみ';

test('the same document and quote is one block; a different quote of the same document is its own block', () => {
  const doc = { url: 'https://example.com/10-k', label: '10-K' };
  const blocks = sourceList.groupSources([
    { ...doc, quote: 'A', row: { who: 'TSM', tone: 'up', tag: '供給', text: '製造' } },
    { ...doc, quote: 'B', row: { who: 'MU', tone: 'up', tag: '供給', text: 'メモリ' } },
    { ...doc, quote: 'B', row: { who: 'SKHY', tone: 'up', tag: '供給', text: 'メモリ' } },
    { ...doc, quote: 'B', row: { who: 'SKHY', tone: 'up', tag: '供給', text: 'メモリ' } },
  ]);
  assert.deepEqual(blocks.map(block => [block.quote, block.rows.map(row => row.who)]), [['A', ['TSM']], ['B', ['MU', 'SKHY']]]);
});

test('NVDA: the memory quote of the 10-K is shown once with MU, SKHY and Samsung under it', () => {
  const data = chain.chainDataFor('NVDA');
  for (const lang of ['ja', 'en']) {
    const blocks = chainSourceBlocks(data, lang);
    const memory = blocks.filter(block => block.quote?.startsWith('We purchase memory from SK Hynix'));
    assert.equal(memory.length, 1);
    assert.deepEqual(memory[0].rows.map(row => row.who), ['MU', 'SKHY', 'Samsung']);
    // Every relation and far link still has its line; no source is dropped.
    const lines = blocks.flatMap(block => block.rows.map(row => `${row.who}|${block.url}`));
    for (const company of data.companies) for (const relation of company.relations) assert.ok(lines.includes(`${company.ticker}|${relation.source.url}`), company.ticker);
    assert.equal(new Set(blocks.map(block => `${block.url}\n${block.quote ?? ''}\n${block.date ?? ''}`)).size, blocks.length);
    const html = renderToStaticMarkup(createElement(sourceList.SourceList, { blocks, lang, reviewedOn: '2026-11-25' }));
    assert.equal((html.match(/<details/g) ?? []).length, 1);
    assert.match(html, lang === 'ja' ? new RegExp(`出典 <span[^>]*>${blocks.length}件</span>`) : new RegExp(`Sources <span[^>]*>${blocks.length}</span>`));
    assert.match(html, lang === 'ja' ? /確認日 <time dateTime="2026-11-25">2026\/11\/25<\/time>/ : /Reviewed <time dateTime="2026-11-25">2026\/11\/25<\/time>/);
    assert.match(html, lang === 'ja' ? /発表日 <time dateTime="2026-03-02">2026\/03\/02<\/time>/ : /Published <time/);
    // The quote of the memory block appears once.
    assert.equal(html.split('We purchase memory from SK Hynix').length - 1, 1);
    assert.ok(!html.includes('…'));
  }
});

test('no source label says 「報道」 / "report" twice, in any relationship map', () => {
  assert.equal(sourceList.needsPressMark('SiliconANGLE の報道', 'ja'), false);
  assert.equal(sourceList.needsPressMark('SiliconANGLE report', 'en'), false);
  assert.equal(sourceList.needsPressMark('Example News', 'en'), true);
  for (const ticker of chain.chainTickers()) for (const lang of ['ja', 'en']) {
    const html = renderToStaticMarkup(createElement(sourceList.SourceList, { blocks: chainSourceBlocks(chain.chainDataFor(ticker), lang), lang }));
    assert.ok(!/報道<\/a> <em>報道|report<\/a> <em>Media report/i.test(html), `${ticker} ${lang}`);
  }
});

test('the profile has one 「出典」 with its 確認日 and every profile source; 「出典・確認日」 is gone', () => {
  const introduction = companyIntroductionFor({ cik: 1045810, ticker: 'NVDA' });
  for (const lang of ['ja', 'en']) {
    const html = renderToStaticMarkup(createElement(panel.CompanyIntroductionPanel, { introduction, lang, network: null }));
    assert.equal((html.match(/data-chain-sources/g) ?? []).length, 1);
    assert.ok(!html.includes('出典・確認日') && !html.includes('Sources &amp; last reviewed date'));
    assert.ok(html.includes(`dateTime="${introduction.reviewedOn}">${introduction.reviewedOn.replace(/-/g, '/')}</time>`));
    for (const source of introduction.sources) assert.ok(html.includes(`href="${source.url.replace(/&/g, '&amp;')}"`), source.url);
    // Pages without the stock search footer keep the one note under 「出典」; the stock search page leaves it to its footer.
    assert.equal(html.split(lang === 'ja' ? NOTE_JA : sourceList.SOURCES_NOTE.en).length - 1, 1);
    const stockPage = renderToStaticMarkup(createElement(panel.CompanyIntroductionPanel, { introduction, lang, network: null, note: false }));
    assert.ok(!stockPage.includes(lang === 'ja' ? NOTE_JA : sourceList.SOURCES_NOTE.en));
  }
});

test('the stock search page: one note in the footer, none in the map, the 企業情報・公式資料 drawer kept', () => {
  assert.equal(sourceList.SOURCES_NOTE.ja, NOTE_JA);
  const directory = read('app/research/stocks/stock-directory.tsx');
  assert.match(directory, /<footer className=\{styles\.footer\}><span>TECH PHASE RESEARCH<\/span><p>\{t\(SOURCES_NOTE\.ja, SOURCES_NOTE\.en\)\}<\/p><\/footer>/);
  assert.ok(!directory.includes('検索結果は企業識別用'));
  assert.match(directory, /企業情報・公式資料/);
  const workspace = read('app/research/stocks/market-workspace.tsx');
  assert.match(workspace, /<CompanyIntroductionPanel [^>]*note=\{false\}/);
  assert.match(workspace, /<MergedSources lang=\{lang\}><CompanyNetworkMap /);
  // Inside <MergedSources> the maps hand their sources up and draw neither their own 「出典」 nor their note.
  for (const file of ['stock-chain-map', 'chain-map']) assert.match(read(`app/research/stocks/${file}.tsx`), /!merged ?&& ?<>/);
});
