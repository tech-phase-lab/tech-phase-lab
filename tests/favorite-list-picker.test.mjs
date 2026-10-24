import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { favoriteListLimit } from '../lib/research/favorite-lists.ts';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/research/stocks/favorite-list-picker.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled)(id => {
  if (id === 'react') return { useState: () => [false, () => {}] };
  if (id === '@/lib/research/favorite-lists') return { favoriteListLimit };
  if (id.endsWith('.css')) return { default: {} };
  return require(id);
}, mod, mod.exports);
function nodes(tree) { return tree && typeof tree === 'object' ? [tree, ...[].concat(tree.props?.children ?? []).flat(Infinity).flatMap(nodes)] : []; }
function render(overrides = {}, lang = 'ja') {
  const calls = [];
  const favorites = { lists: [{id:'default',name:'保有株',tickers:['LITE']},{id:'my-list-2',name:'',tickers:[]}], editable:true,status:'synced',error:false,
    setMembership:(...args)=>{calls.push(args);return true;},retry:()=>{},...overrides };
  return { calls, nodes: nodes(mod.exports.FavoriteListPicker({ticker:'LITE',name:'Lumentum',lang,favorites})) };
}
test('picker shows existing memberships and sends the chosen list and checkbox intent', () => {
  const h = render(); const inputs = h.nodes.filter(n => n.type === 'input');
  assert.equal(inputs[0].props.checked, true);
  assert.equal(inputs[1].props.checked, false);
  inputs[1].props.onChange({target:{checked:true}});
  assert.deepEqual(h.calls, [['my-list-2','LITE',true,'Lumentum']]);
  assert.ok(h.nodes.some(n => n.type === 'span' && n.props.children === 'マイリスト2'));
});
test('full lists reject new memberships but existing memberships can still be removed', () => {
  const full = Array.from({length:100},(_,i)=>`T${i}`);
  const h=render({lists:[{id:'default',name:'',tickers:full},{id:'my-list-2',name:'',tickers:['LITE',...full.slice(1)]}]},'en');
  const inputs=h.nodes.filter(n=>n.type==='input');
  assert.equal(inputs[0].props.disabled,true);assert.equal(inputs[1].props.disabled,false);
  assert.ok(h.nodes.some(n=>n.type==='small'&&n.props.children==='Full'));
  assert.ok(h.nodes.some(n=>n.type==='span'&&n.props.children==='My list 2'));
});
test('conflicts disable inputs and direct users to review rather than overwrite', () => {
  const h=render({editable:false,error:true,status:'conflict'});
  assert.ok(h.nodes.filter(n=>n.type==='input').every(n=>n.props.disabled));
  assert.ok(h.nodes.some(n=>n.type==='a'&&n.props.href==='/research/watchlist'));
});
