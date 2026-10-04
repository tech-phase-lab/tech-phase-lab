import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatTargetTime } from '../lib/research/price-target-time.ts';
import { publicPriceTargets } from '../lib/research/price-targets.ts';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../app/research/price-target-card.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', compiled)(name => name.endsWith('.module.css') ? { default: {} }
  : name.endsWith('/price-target-time') ? { formatTargetTime } : require(name), loaded, loaded.exports);
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


test('new badges follow the current clock and reject unknown, future or stale times', () => {
  const render = asOf => renderToStaticMarkup(React.createElement(Card, { item: target, lang: 'ja', now: asOf ? Date.parse(asOf) : null }));
  assert.match(render('2026-10-02T10:02:00Z'), /NEW/);
  for (const asOf of [null, '2026-10-01T10:02:00Z', '2026-10-03T10:02:00Z']) assert.doesNotMatch(render(asOf), /NEW/);
});
