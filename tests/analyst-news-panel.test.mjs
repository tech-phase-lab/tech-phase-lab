import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { availableNewsPayload } from '../lib/research/general-news.ts';

const require = createRequire(import.meta.url);
const base = new URL('../app/research/news/', import.meta.url);
function loadComponent(name, hooks) {
  const source = readFileSync(new URL(`${name}.tsx`, base), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name.endsWith('.module.css')) return { default: {} };
    if (name === 'react') return { ...React, ...hooks };
    if (name.startsWith('@/lib/research/')) return require(`../lib/research/${name.slice('@/lib/research/'.length)}.ts`);
    if (name.startsWith('./')) return { default: loadComponent(name.slice(2)) };
    return require(name);
  }, loaded, loaded.exports);
  return loaded.exports.default;
}
const item = { id: '12345', ticker: 'NVDA', firm: 'Example Research', action: 'top-pick',
  titleJa: '報道によると、Example ResearchがNVDAをトップピックに選定',
  titleEn: 'Reportedly, Example Research names NVDA a top pick',
  bodyJa: '報道によると、評価は据え置き。', bodyEn: 'Reportedly, the rating is unchanged.',
  publishedAt: '2026-10-02T08:09:10+09:00', observedAt: '2026-10-03T00:00:00.000Z' };
function render(rows, lang, officialOnly = false, page = 1) {
  const feed = availableNewsPayload({ ok: true, enabled: false, items: [], analystUpdates: rows });
  let stateIndex = 0;
  const Panel = loadComponent('general-news-panel', {
    useState: initial => {
      const index = stateIndex++;
      return [index === 0 ? feed : index === 4 ? page : typeof initial === 'function' ? initial() : initial, () => {}];
    },
    useRef: () => ({ current: null }), useEffect: () => {},
  });
  return renderToStaticMarkup(React.createElement(Panel, { lang, officialOnly }));
}

test('news list renders JA and EN analyst reporting with general news disabled and no source links or assessment', () => {
  for (const lang of ['ja', 'en']) {
    const ja = lang === 'ja', html = render([item], lang);
    for (const text of [ja ? 'アナリスト動向 · NVDA' : 'Analyst news · NVDA', ja ? item.titleJa : item.titleEn,
      ja ? item.bodyJa : item.bodyEn, '8:09:10 JST']) assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /href=|x\.com|WallStEngine|確信度|Confidence|事業への影響|Business impact|Official|公式発表|2026\/10\/3/);
  }
});

test('analyst headline-only story stays readable without fake details and never enters official-only view', () => {
  const headlineOnly = { ...item };
  delete headlineOnly.bodyJa; delete headlineOnly.bodyEn;
  for (const lang of ['ja', 'en']) {
    const html = render([headlineOnly], lang);
    assert.ok(html.includes(lang === 'ja' ? item.titleJa : item.titleEn));
    assert.doesNotMatch(html, /<details|<summary|＋/);
    const official = render([item], lang, true);
    assert.doesNotMatch(official, /NVDA|Example Research|Analyst news|アナリスト動向/);
    assert.ok(official.includes(lang === 'ja' ? '現在、掲載中の公式発表はありません。' : 'No official updates currently listed.'));
  }
});

test('valid analyst story survives a malformed adjacent row in the news list', () => {
  const html = render([{ ...item, action: 'not-supported' }, item], 'ja');
  assert.equal(html.split(item.titleJa).length - 1, 1);
  assert.doesNotMatch(html, /not-supported/);
});

test('analyst stories participate in pagination and source-time order without the general feed', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ ...item, id: String(i), titleEn: `Reported analyst action ${i}`,
    publishedAt: `2026-10-01T0${i}:00:00Z` }));
  const first = render(rows, 'en'), second = render(rows, 'en', false, 2);
  assert.equal((first.match(/<article>/g) ?? []).length, 5);
  assert.ok(first.indexOf('Reported analyst action 5') < first.indexOf('Reported analyst action 1'));
  assert.ok(!first.includes('Reported analyst action 0'));
  assert.equal((second.match(/<article>/g) ?? []).length, 1);
  assert.ok(second.includes('Reported analyst action 0'));
  assert.ok(!second.includes('Reported analyst action 5'));
});
