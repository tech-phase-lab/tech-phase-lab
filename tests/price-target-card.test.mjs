import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatTargetTime } from '../lib/research/price-target-time.ts';
import { publicPriceTargets } from '../lib/research/price-targets.ts';
import { priceTargetSplitView } from '../lib/research/price-target-splits.ts';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../app/research/price-target-card.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', compiled)(name => name.endsWith('.module.css') ? { default: {} }
  : name.endsWith('/price-target-time') ? { formatTargetTime } : name.endsWith('/price-target-splits') ? { priceTargetSplitView } : require(name), loaded, loaded.exports);
const Card = loaded.exports.default;
const primary = { id: 1, source: 'X · Market reporters', url: 'https://x.com/wallstengine/status/101', publishedAt: '2026-10-02T10:00:00Z', observedAt: '2026-10-02T10:00:01Z' };
const secondary = { id: 2, source: 'X · TipRanks', url: 'https://x.com/TipRanks/status/102', publishedAt: '2026-10-02T10:01:00Z', observedAt: '2026-10-02T10:01:01Z' };
// Synthetic fixtures exercise the requested shape, not a claim about live values.
const target = { ...primary, ticker: 'ASTS', firm: 'B. Riley', previous: 85, latest: 65, sources: [primary, secondary] };

test('JA and EN targets show broker, actual change, direction and exactly one publication time', () => {
  for (const lang of ['ja', 'en']) {
    const [item] = publicPriceTargets({ ok: true, items: [target] }).items;
    const before = JSON.stringify(item);
    const html = renderToStaticMarkup(React.createElement(Card, { item, lang, now: Date.parse("2026-10-02T10:02:00Z") }));
    assert.match(html, /ASTS/);
    assert.match(html, /B\. Riley/);
    assert.match(html, /\$85 → \$65/);
    assert.ok(html.includes(lang === 'ja' ? '引き下げ' : 'Lowered'));
    assert.equal((html.match(/<time /g) ?? []).length, 1);
    assert.ok(html.includes(`dateTime="${primary.publishedAt}"`));
    assert.ok(html.includes(formatTargetTime(primary.publishedAt, lang)));
    assert.doesNotMatch(html, /wallstengine|TipRanks|Market reporters|X投稿日時|X post time|href=/);
    assert.ok(!html.includes(secondary.publishedAt));
    assert.equal(JSON.stringify(item), before);
    assert.deepEqual(item.sources, [primary, secondary]);
  }
});

test('compact targets use real payload values for other companies, brokers and directions', () => {
  const item = { ...target, ticker: 'MU', firm: 'Citi', previous: 110.5, latest: 125.25 };
  for (const lang of ['ja', 'en']) {
    const html = renderToStaticMarkup(React.createElement(Card, { item, lang, now: Date.parse("2026-10-02T10:02:00Z") }));
    assert.match(html, /MU|Citi/);
    assert.match(html, /\$110\.5 → \$125\.25/);
    assert.ok(html.includes(lang === 'ja' ? '引き上げ' : 'Raised'));
    assert.doesNotMatch(html, /ASTS|B\. Riley|\$85|\$65/);
  }
});


test('no NEW badge at any time, even right after publication (owner, 11/26)', () => {
  const render = asOf => renderToStaticMarkup(React.createElement(Card, { item: target, lang: 'ja', now: asOf ? Date.parse(asOf) : null }));
  for (const asOf of ['2026-10-02T10:02:00Z', null, '2026-10-01T10:02:00Z', '2026-10-03T10:02:00Z']) assert.doesNotMatch(render(asOf), /NEW/);
});

test('SNDK 8-for-1: a pre-split old target is shown on the new basis and is not a cut; a pre-split action gets the converted figures', () => {
  const now = Date.parse('2026-11-21T01:00:00Z');
  const after = { ...primary, publishedAt: '2026-11-20T12:00:00Z', observedAt: '2026-11-20T12:00:01Z', ticker: 'SNDK', firm: 'Firm', previous: 1400, latest: 180 };
  const before = { ...after, publishedAt: '2026-11-18T12:00:00Z', observedAt: '2026-11-18T12:00:01Z', previous: 1200, latest: 1400 };
  const html = renderToStaticMarkup(React.createElement(Card, { item: after, lang: 'ja', now, earlier: [before, after] }));
  assert.match(html, /\$175 → \$180/); assert.match(html, /引き上げ/); assert.match(html, /旧目標 \$1,400 は株式分割（8:1）前の基準/);
  // Without the firm's own pre-split action the size of the change alone never turns it into a raise.
  assert.match(renderToStaticMarkup(React.createElement(Card, { item: after, lang: 'ja', now })), /\$1,400 → \$180/);
  const old = renderToStaticMarkup(React.createElement(Card, { item: before, lang: 'en', now }));
  assert.match(old, /\$1,200 → \$1,400/); assert.match(old, /on today&#x27;s basis \$150 → \$175/);
});
