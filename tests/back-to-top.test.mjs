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
    if(name==='react')return {useSyncExternalStore:()=>true,useRef:()=>({current:null}),useEffect:()=>{}};
    if(name.endsWith('/use-research-language'))return {useResearchLanguage:()=>[globalThis.__lang??'ja']};
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

test('the pill is named for screen readers in both languages and reads 先頭へ / Top', t => {
  const previousWindow=globalThis.window;
  globalThis.window={};
  t.after(()=>{globalThis.window=previousWindow;delete globalThis.__lang;});
  const load=()=>{const mod={exports:{}};new Function('require','module','exports',code)(name=>{
    if(name==='react')return {useSyncExternalStore:()=>true,useRef:()=>({current:null}),useEffect:()=>{}};
    if(name.endsWith('/use-research-language'))return {useResearchLanguage:()=>[globalThis.__lang]};
    if(name==='next/navigation')return {usePathname:()=>'/research'};
    if(name.endsWith('.css'))return {default:{}};
    return require(name);},mod,mod.exports);return mod.exports.default;};
  const text=node=>JSON.stringify(node.props.children);
  globalThis.__lang='ja';
  let button=load()().props.children;
  assert.equal(button.props['aria-label'],'ページの先頭へ戻る');
  assert.match(text(button),/先頭へ/);
  globalThis.__lang='en';
  button=load()().props.children;
  assert.equal(button.props['aria-label'],'Back to top');
  assert.match(text(button),/Top/);
});

test('phone styling is a 34px pill that fades up; reduced motion removes the transition', () => {
  const css=readFileSync(new URL('../app/research/back-to-top.module.css',import.meta.url),'utf8');
  assert.match(css,/height:34px; padding:0 14px 0 11px; border-radius:999px/);
  assert.match(css,/#2a3a52/); assert.match(css,/blur\(8px\)/); assert.match(css,/transition:opacity \.25s, transform \.25s/);
  assert.match(css,/prefers-reduced-motion:reduce\)[^}]*transition:none/);
});
