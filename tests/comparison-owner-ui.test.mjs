import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/research/compare/screen.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
let plan = 'free', owner = false, lang = 'ja';
const loaded = { exports: {} };
new Function('require', 'module', 'exports', code)(id => {
  if (id === '../member-display-provider') return { useMemberDisplay: () => plan, useOwnerAccount: () => owner };
  if (id === '../use-research-language') return { useResearchLanguage: () => [lang, () => {}] };
  if (id === '../research-tool-shell') return { default: ({ children }) => children };
  if (id === 'next/link') return { default: ({ children, ...props }) => React.createElement('a', props, children) };
  if (id.endsWith('.module.css')) return { default: {} };
  if (id === './comparison-visuals' || id === './ticker-search' || id === './detail-panels') return { default: () => null };
  if (id.startsWith('@/lib/research/')) return require(`../lib/research/${id.split('/').at(-1)}.ts`);
  return require(id);
}, loaded, loaded.exports);

test('comparison controls render for PRO and owner, while FREE receives only the membership prompt', () => {
  for (lang of ['ja', 'en']) {
    for (const state of [{ plan: 'free', owner: false }, { plan: 'pro', owner: false }, { plan: 'free', owner: true }]) {
      plan = state.plan; owner = state.owner;
      const html = renderToStaticMarkup(React.createElement(loaded.exports.default));
      const allowed = plan === 'pro' || owner;
      assert.equal(html.includes('id="stock-0"'), allowed);
      assert.equal(html.includes('href="/research/account"'), !allowed);
    }
  }
});
