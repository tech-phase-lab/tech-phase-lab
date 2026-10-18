import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {companyIntroductions} from '../../lib/research/company-introductions.ts';
import {companyNetworkFor} from '../../lib/research/chain-network.server.ts';
import {chainFocus} from '../../lib/research/chain-network.ts';
import universe from '../../lib/research/chain_universe.json' with {type:'json'};
import {expansionGraph,sparseGraph} from '../../tests/fixtures/chain-map.mjs';
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url),{build}=require('esbuild');
const {chromium}=createRequire('C:/Users/amweb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const out=path.resolve(base,process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'../../outputs/v2/screenshots');await fs.mkdir(out,{recursive:true});
const fixture=process.argv.includes('--fixture');
const allRoots=universe.companies.filter(c=>c.group==='root').map(c=>c.id);
const roots=process.argv.includes('--all-roots')?allRoots:process.argv.find(a=>a.startsWith('--roots='))?.slice(8).split(',')??['BE','NVDA','NBIS','ORCL','MU'];
if(new Set(roots).size!==roots.length)throw new Error('Duplicate root tickers');
if(process.argv.includes('--all-roots')&&(allRoots.length!==50||new Set(roots).size!==50))throw new Error('Expected the fixed 50 root companies');
const graphs=fixture?[expansionGraph,sparseGraph]:roots.map(t=>{const c=companyIntroductions.find(c=>c.tickers.includes(t));return companyNetworkFor({ticker:t,cik:c.cik})});
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {CompanyNetworkMap} from './app/research/stocks/chain-map';const r=createRoot(document.getElementById('app'));window.showGraph=g=>r.render(React.createElement(CompanyNetworkMap,{key:g.root,graph:g,lang:'ja'}));`,resolveDir:base,loader:'tsx'},bundle:true,write:false,outdir:'out',platform:'browser',format:'iife',tsconfig:path.join(base,'tsconfig.json')});
const css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'',js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--disable-extensions']});
const page=await browser.newPage();await page.route('**/*',r=>r.abort());const results=[];
const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const expectedEdges=(graph,focus)=>focus.edges.map(e=>`${e.from}|${e.to}|${e.kind==='competition'?'competition':e.kind==='supply'?e.to===graph.root?'upstream':e.from===graph.root?'downstream':'indirect':'partner'}`);
const textLayout=()=>{
 const failures=[],rects=[],walker=document.createTreeWalker(document.querySelector('section'),NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){
  const node=walker.currentNode,parent=node.parentElement;if(!node.textContent.trim()||!parent||!parent.checkVisibility())continue;
  const range=document.createRange();range.selectNodeContents(node);
  for(const r of range.getClientRects()){
   if(!r.width||!r.height)continue;rects.push({r,parent});
   for(let el=parent;el;el=el.parentElement){const css=getComputedStyle(el),box=el.getBoundingClientRect();if((['hidden','clip'].includes(css.overflowX)&&(r.left<box.left-.5||r.right>box.right+.5))||(['hidden','clip'].includes(css.overflowY)&&(r.top<box.top-.5||r.bottom>box.bottom+.5))){failures.push({type:'clipped_text',text:node.textContent.trim().slice(0,50)});break;}}
  }
 }
 rects.sort((a,b)=>a.r.top-b.r.top);
 for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length&&rects[j].r.top<rects[i].r.bottom-.5;j++){
  const a=rects[i],b=rects[j];if(a.parent===b.parent)continue;
  if(a.r.left<b.r.right-.5&&a.r.right>b.r.left+.5&&a.r.top<b.r.bottom-.5)failures.push({type:'text_overlap_in_page',text:a.parent.textContent.trim().slice(0,35)});
 }
 return failures;
};
try{
 for(const graph of graphs)for(const width of [360,1280]){
  await page.setViewportSize({width,height:1000});await page.setContent(`<html lang="ja"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#0e1824;font-family:Arial,'Yu Gothic',sans-serif}${css}</style><div id="app"></div><script>${js.replaceAll('</script','<\\/script')}</script></html>`);
  await page.evaluate(g=>window.showGraph(g),graph);await page.locator('section').waitFor();
  for(const mode of ['direct','two','all']){
   if(mode==='all'&&!graph.edges.length){results.push({root:graph.root,width,mode,status:'skipped',reason:'No all-mode control for an empty graph',failures:[]});continue;}
   if(mode==='two')await page.getByRole('button',{name:'2段先まで',exact:true}).click();
   if(mode==='all'&&graph.edges.length)await page.getByRole('button',{name:'全体を見る',exact:true}).click();
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const check=await page.evaluate(()=>{
    const fails=[],cards=[...document.querySelectorAll('[data-company]')];
    const overlap=(a,b)=>a.left<b.right-.5&&a.right>b.left+.5&&a.top<b.bottom-.5&&a.bottom>b.top+.5;
    for(const card of cards){const cr=card.getBoundingClientRect();const rects=[];for(const child of card.children){const range=document.createRange();range.selectNodeContents(child);const rs=[...range.getClientRects()];for(const r of rs)if(r.left<cr.left-.5||r.right>cr.right+.5||r.top<cr.top-.5||r.bottom>cr.bottom+.5)fails.push({company:card.dataset.company,type:'text_outside_card'});rects.push(child.getBoundingClientRect());}for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++)if(overlap(rects[i],rects[j]))fails.push({company:card.dataset.company,type:'text_overlap'});}
    for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++)if(overlap(cards[i].getBoundingClientRect(),cards[j].getBoundingClientRect()))fails.push({type:'card_overlap'});
    const ids=[...document.querySelectorAll('[data-company-detail]')].map(n=>n.dataset.companyDetail);if(new Set(ids).size!==ids.length)fails.push({type:'duplicate_detail_card'});
    if(document.documentElement.scrollWidth>innerWidth)fails.push({type:'horizontal_overflow'});
    const paths=[...document.querySelectorAll('svg path')],root=cards[0]?.dataset.company;
    const connected=kind=>new Set(paths.filter(p=>(p.dataset.tone==='competition')===kind).flatMap(p=>[p.dataset.from,p.dataset.to]).filter(id=>id&&id!==root)).size;
    return {cards:cards.length,companyIds:cards.map(c=>c.dataset.company),detailCards:ids.length,detailIds:ids,edges:paths.length,edgeKeys:paths.map(p=>`${p.dataset.from}|${p.dataset.to}|${p.dataset.tone}`),actualMode:document.querySelector('section').dataset.mode,directCompanies:connected(false),competitorCompanies:connected(true),failures:fails};
   });
   const expected=chainFocus(graph,mode),expectedIds=graph.edges.length?expected.nodes.map(n=>n.id):[];
   if(check.actualMode!==mode)check.failures.push({type:'mode_state',expected:mode,actual:check.actualMode});
   if(!same(check.companyIds,expectedIds))check.failures.push({type:'company_set_mismatch',expected:expectedIds,actual:check.companyIds});
   if(!same(check.edgeKeys,expectedEdges(graph,expected)))check.failures.push({type:'edge_set_mismatch'});
   if(!same(check.detailIds,expectedIds.filter(id=>id!==graph.root)))check.failures.push({type:'detail_set_mismatch'});
   if(mode!=='direct'){const direct=chainFocus(graph,'direct'),expanded=expected.nodes.some(n=>!direct.nodes.some(d=>d.id===n.id))||expected.edges.some(e=>!direct.edges.some(d=>d.id===e.id));if(!expanded&&!(await page.getByRole('status').textContent()).includes('この銘柄は、2段先の関係がまだありません'))check.failures.push({type:'missing_no_expansion_notice'});}
   if(mode==='direct'&&check.cards>17)check.failures.push({type:'direct_cap'});
   if(mode==='direct'&&check.directCompanies>12)check.failures.push({type:'direct_company_cap'});
   if(mode==='direct'&&check.competitorCompanies>4)check.failures.push({type:'competition_cap'});
   if(mode==='two'&&check.cards>21)check.failures.push({type:'two_cap'});
   if(fixture){const expected=graph===expansionGraph?{direct:3,two:6,all:7}[mode]:3;if(check.cards!==expected)check.failures.push({type:'fixture_node_count',expected,actual:check.cards});const edgeCount=await page.locator('svg path').count();const expectedEdges=graph===expansionGraph?{direct:2,two:5,all:6}[mode]:2;if(edgeCount!==expectedEdges)check.failures.push({type:'fixture_edge_count',expected:expectedEdges,actual:edgeCount});if(await page.locator('section').getAttribute('data-mode')!==mode)check.failures.push({type:'mode_state'});if(mode!=='direct'&&graph===sparseGraph&&!(await page.getByRole('status').textContent()).includes('この銘柄は、2段先の関係がまだありません'))check.failures.push({type:'missing_no_expansion_notice'});if(check.detailCards!==expected-1)check.failures.push({type:'fixture_detail_count'});}
   check.failures.push(...await page.evaluate(textLayout));
   await page.evaluate(()=>document.querySelectorAll('details').forEach(d=>{d.open=true}));
   check.failures.push(...(await page.evaluate(textLayout)).map(f=>({...f,type:`expanded_evidence_${f.type}`})));
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))check.failures.push({type:'expanded_evidence_horizontal_overflow'});
   await page.evaluate(()=>document.querySelectorAll('details').forEach(d=>{d.open=false}));
   if(mode==='direct'||process.argv.includes('--all-modes'))await page.screenshot({path:path.join(out,`${graph.root}${fixture?graph===expansionGraph?'-fixture':'-sparse':''}-${width}${mode==='direct'?'':`-${mode}`}.png`),fullPage:true});
   if(mode==='all'){await page.getByRole('button',{name:'直接の関係に戻る',exact:true}).click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));const reset=await page.evaluate(()=>({mode:document.querySelector('section').dataset.mode,ids:[...document.querySelectorAll('[data-company]')].map(n=>n.dataset.company)}));if(reset.mode!=='direct'||!same(reset.ids,chainFocus(graph,'direct').nodes.map(n=>n.id)))check.failures.push({type:'return_to_direct_failed'});check.returnToDirectVerified=reset.mode==='direct'&&same(reset.ids,chainFocus(graph,'direct').nodes.map(n=>n.id));}
   results.push({root:graph.root,...(fixture?{fixture:graph===expansionGraph?'expanding':'sparse'}:{}),width,mode,status:check.failures.length?'failed':'passed',...check});
  }
 }
 await fs.writeFile(path.join(out,`checks-${fixture?'fixture':roots.length>10?'all-'+roots.length:roots.join('-')}.json`),JSON.stringify({scope:fixture?'Synthetic relationship fixtures rendered in the actual React component; not company evidence':'Actual React component in isolated local browser; interactions verified; not a deployed full-page screenshot',results},null,2));
 console.log(JSON.stringify({roots:fixture?['BE expanding fixture','BE sparse fixture']:roots,cases:results.length,passed:results.filter(r=>r.status==='passed').length,skipped:results.filter(r=>r.status==='skipped').length,failures:results.flatMap(r=>r.failures).length}));if(results.some(r=>r.failures.length))process.exitCode=1;
}finally{await browser.close()}
