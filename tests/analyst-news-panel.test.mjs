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

test('analyst reporting is not listed in the news list (price targets have their own page)', () => {
  for (const lang of ['ja', 'en']) {
    for (const officialOnly of [false, true]) {
      const html = render([item, { ...item, id: '2' }], lang, officialOnly);
      assert.doesNotMatch(html, /NVDA|Example Research|Analyst news|アナリスト動向|<article>/);
    }
  }
});
