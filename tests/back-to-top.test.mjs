import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../app/research/back-to-top.tsx', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;

test('tap returns to the top without focusing the brand; keyboard activation keeps a usable focus target', t => {
  const previousWindow=globalThis.window, previousDocument=globalThis.document;
  const scroll=[], focus=[];
  globalThis.window={scrollTo:options=>scroll.push(options)};
  globalThis.document={querySelector:selector=>{assert.equal(selector,'header a');return {focus:options=>focus.push(options)};}};
  t.after(()=>{globalThis.window=previousWindow;globalThis.document=previousDocument;});
  const mod={exports:{}};
  new Function('require','module','exports',code)(name=>{
    if(name==='react')return {useSyncExternalStore:()=>true};
    if(name==='next/navigation')return {usePathname:()=>'/research/watchlist'};
    if(name.endsWith('.css'))return {default:{}};
    return require(name);
  },mod,mod.exports);
  const button=mod.exports.default().props.children;
  button.props.onClick({detail:1});
  assert.deepEqual(scroll,[{top:0,behavior:'instant'}]);
  assert.equal(focus.length,0);
  button.props.onClick({detail:0});
  assert.equal(scroll.length,2);
  assert.deepEqual(focus,[{preventScroll:true}]);
});
