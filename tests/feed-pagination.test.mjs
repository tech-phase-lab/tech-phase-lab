import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require=createRequire(import.meta.url);
const source=(await readFile(new URL('../app/research/news/feed-pagination.tsx',import.meta.url),'utf8'))
  .replace('import styles from "./general-news.module.css";', 'const styles={pagination:"pagination",pageGap:"pageGap"};');
const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText
  .replace('"react/jsx-runtime"',JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
const {default:FeedPagination,newsPageNumbers}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const render=(page,pages,ja=true)=>renderToStaticMarkup(React.createElement(FeedPagination,{page,pages,ja,onChange:()=>{}}));

function buttons(page,pages,ja,onChange) {
  const nav=FeedPagination({page,pages,ja,onChange});
  return React.Children.toArray(nav.props.children).filter(child=>child.type==='button');
}

test('sixteen-page news navigation uses no more than five number/gap slots',()=>{
  assert.deepEqual(newsPageNumbers(1,16),[1,2,3,'gap',16]);
  assert.deepEqual(newsPageNumbers(8,16),[1,'gap',8,'gap',16]);
  assert.deepEqual(newsPageNumbers(16,16),[1,'gap',14,15,16]);
  for(let page=1;page<=16;page++) {
    const slots=newsPageNumbers(page,16), numbers=slots.filter(n=>typeof n==='number');
    assert.ok(slots.length<=5);
    assert.ok(numbers.includes(page));
    assert.equal(numbers[0],1);
    assert.equal(numbers.at(-1),16);
    assert.deepEqual(numbers,[...new Set(numbers)].sort((a,b)=>a-b));
  }
});

test('every retained page stays reachable through previous/next and first/last controls',()=>{
  for(const ja of [true,false]) for(const pages of [2,5,6,16,36,100]) for(let page=1;page<=pages;page++) {
    const changes=[], controls=buttons(page,pages,ja,n=>changes.push(n));
    const previous=controls[0], next=controls.at(-1);
    assert.equal(previous.props.disabled,page===1);
    assert.equal(next.props.disabled,page===pages);
    if(page>1) {previous.props.onClick();assert.equal(changes.pop(),page-1);}
    if(page<pages) {next.props.onClick();assert.equal(changes.pop(),page+1);}
    const numbers=controls.slice(1,-1);
    assert.equal(numbers.filter(button=>button.props['aria-current']==='page').length,1);
    for(const button of numbers) {button.props.onClick();assert.equal(changes.pop(),button.props.children);}
    assert.ok(controls.every(button=>button.props.type==='button'));
  }
});

test('single-page feeds hide navigation and short feeds retain all their page buttons',()=>{
  assert.equal(render(1,1),'');
  assert.equal(render(1,0),'');
  for(const pages of [2,3,4,5]) assert.deepEqual(newsPageNumbers(1,pages),Array.from({length:pages},(_,i)=>i+1));
});

test('JA and EN keep accessible page and direction labels with decorative gaps',()=>{
  for(const ja of [true,false]) {
    const html=render(8,16,ja);
    assert.match(html,/aria-current="page"/);
    assert.ok(html.includes(ja?'aria-label="8ページ目"':'aria-label="Page 8"'));
    assert.ok(html.includes(ja?'aria-label="前へ"':'aria-label="Previous"'));
    assert.ok(html.includes(ja?'aria-label="次へ"':'aria-label="Next"'));
    assert.equal((html.match(/class="pageGap" aria-hidden="true">…/g)??[]).length,2);
    assert.doesNotMatch(html,/aria-label="(?:9ページ目|Page 9)"/);
  }
});

test('news navigation is one non-scrolling row and cannot accumulate all sixteen buttons',async()=>{
  const css=await readFile(new URL('../app/research/news/general-news.module.css',import.meta.url),'utf8');
  const rule=/\.pagination\{([^}]+)\}/.exec(css)[1];
  assert.match(rule,/flex-wrap:nowrap/);
  assert.doesNotMatch(rule,/overflow[^;]*:auto|flex-wrap:wrap/);
  for(let page=1;page<=16;page++) assert.ok((render(page,16).match(/<button/g)??[]).length<=7);
});
