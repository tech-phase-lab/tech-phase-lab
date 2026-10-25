import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => overrides[name] ?? (name.endsWith('.module.css') ? { default: {} } : require(name)), loaded, loaded.exports);
  return loaded.exports;
}

test('quote preference survives navigation/reload, syncs tabs and works without storage', () => {
  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  const values = new Map();
  let store;
  const react = { useSyncExternalStore(subscribe, snapshot, serverSnapshot) { store = { subscribe, snapshot, serverSnapshot }; return snapshot(); } };
  const fresh = () => load('../app/research/companies/use-quote-visibility.ts', { react });
  try {
    globalThis.window = new EventTarget();
    globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    const hook = fresh().useQuoteVisibility;
    assert.equal(hook()[0], true);
    assert.equal(store.serverSnapshot(), null);
    let changes = 0;
    const unsubscribe = store.subscribe(() => changes++);
    hook()[1](false);
    assert.equal(changes, 1);
    assert.equal(hook()[0], false);
    assert.equal(fresh().useQuoteVisibility()[0], false);
    values.set('tech-phase:company-quote-visible:v1', 'on');
    const event = new Event('storage');
    Object.defineProperty(event, 'key', { value: 'tech-phase:company-quote-visible:v1' });
    window.dispatchEvent(event);
    assert.equal(hook()[0], true);
    unsubscribe();
    globalThis.localStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
    const blocked = fresh().useQuoteVisibility;
    assert.equal(blocked()[0], true);
    blocked()[1](false);
    assert.equal(blocked()[0], false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage;
  }
});

test('OFF and hydration omit the entire price widget; ON restores it in both languages', () => {
  for (const lang of ['ja', 'en']) for (const visible of [null, false, true]) {
    let chosen;
    const { default: Quote } = load('../app/research/companies/compact-quote.tsx', {
      './use-quote-visibility': { useQuoteVisibility: () => [visible, value => { chosen = value; }] },
      'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    });
    const element = Quote({ ticker: 'NVDA', exchange: 'NASDAQ', lang });
    const html = renderToStaticMarkup(element);
    assert.match(html, /role="switch"/);
    if (visible === true) assert.match(html, /<iframe.*NASDAQ/);
    else assert.doesNotMatch(html, /<iframe|TradingView|\/research\/stocks/);
    const control = Array.isArray(element.props.children) ? element.props.children[0] : element.props.children;
    control.props.children[1].props.onClick();
    assert.equal(chosen, !visible);
    const krx = renderToStaticMarkup(Quote({ ticker: '005930', exchange: 'KRX', lang }));
    assert.doesNotMatch(krx, /<iframe/);
    assert.equal(krx.includes('TradingView'), visible === true);
  }
});
