import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{pretendToBeVisual:true,url:'https://example.test'});
for(const key of ['window','document','navigator','Node','Element','HTMLElement','MutationObserver','DOMParser','getComputedStyle','requestAnimationFrame','cancelAnimationFrame']) Object.defineProperty(globalThis,key,{configurable:true,value:typeof dom.window[key]==='function'&&['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(key)?dom.window[key].bind(dom.window):dom.window[key]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
dom.window.Range.prototype.getClientRects=()=>[];
dom.window.Range.prototype.getBoundingClientRect=()=>({top:0,left:0,bottom:0,right:0,width:0,height:0});
const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
async function component(path) {
 const dir=await mkdtemp(new URL('../.desk-ui-',import.meta.url));
 try {
  const outfile=`${dir}/component.mjs`;
  await build({entryPoints:[new URL(path,import.meta.url).pathname],bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',outfile,plugins:[{name:'css',setup(b){b.onLoad({filter:/\.css$/},()=>({contents:'export default new Proxy({}, {get: (_, key) => key})',loader:'js'}));}}]});
  return (await import(pathToFileURL(outfile).href)).default;
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('loading then reacting renders exactly one icon per button, with one selected choice',async()=>{
 const Reactions=await component('../app/research/desk/reactions.tsx');
 const original=globalThis.fetch;let resolveLoad;
 let votes=Object.fromEntries(['like','smile','sad','angry','fire'].map(k=>[k,{count:0,selected:false}]));
 globalThis.fetch=async(_url,options)=>{
  if(!options.method) await new Promise(resolve=>resolveLoad=resolve);
  else {const input=JSON.parse(options.body);votes=Object.fromEntries(Object.keys(votes).map(k=>[k,{count:Number(input.selected&&input.emoji===k),selected:input.selected&&input.emoji===k}]));}
  return {ok:true,json:async()=>({ok:true,reactions:votes})};
 };
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(React.createElement(Reactions,{postId:'note-reaction-test',ja:true})));
  assert.equal(host.querySelectorAll('button').length,5);
  await act(async()=>{resolveLoad();await tick();});
  const buttons=[...host.querySelectorAll('button')];
  for(const button of buttons) assert.equal(button.querySelectorAll('[aria-hidden=true]').length,1);
  assert.equal(host.textContent.split('👍').length-1,1);
  await act(async()=>{buttons[0].click();await tick();});
  await act(async()=>{buttons[2].click();await tick();});
  assert.equal(host.querySelectorAll('[aria-pressed=true]').length,1);
  assert.equal(buttons[2].getAttribute('aria-pressed'),'true');
  await act(async()=>{buttons[2].click();await tick();});
  assert.equal(host.querySelectorAll('[aria-pressed=true]').length,0);
  for(const button of buttons) assert.equal(button.children.length,2);
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=original;}
});
test('selecting differently formatted text updates toolbar without resetting editor options or DOM selection',async()=>{
 const RichEditor=await component('../app/research/desk/rich-editor.tsx');
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>{root.render(React.createElement(RichEditor,{value:'**あいう**えお',onChange:()=>{}}));await tick();});
  const surface=host.querySelector('[contenteditable=true]');assert.ok(surface);
  const editor=surface.editor;assert.ok(editor);
  const original=editor.setOptions.bind(editor);let resets=0;
  editor.setOptions=(...args)=>{resets++;return original(...args);};
  await act(async()=>{editor.commands.setTextSelection({from:1,to:3});await tick();});
  assert.equal(host.querySelector('[aria-label="太字"]').getAttribute('aria-pressed'),'true');
  await act(async()=>{editor.commands.setTextSelection({from:4,to:6});await tick();});
  assert.equal(host.querySelector('[aria-label="太字"]').getAttribute('aria-pressed'),'false');
  assert.equal(resets,0);
  assert.equal(host.querySelector('[contenteditable=true]'),surface);
  assert.equal(editor.state.selection.from,4);assert.equal(editor.state.selection.to,6);
 }finally{await act(async()=>root.unmount());host.remove();}
});
for (const extension of ['mp3','m4a']) test(extension+' picker rejects video, reports upload progress and attaches only after server verification',async()=>{
 const AudioUpload=await component('../app/research/desk/audio-upload.tsx');
 const originalFetch=globalThis.fetch,originalXHR=globalThis.XMLHttpRequest;
 const calls=[],busy=[],attached=[],requests=[];
 globalThis.fetch=async(url,options)=>{
  const body=options?.body&&JSON.parse(options.body);calls.push(body?.action||'status');
  return {ok:true,json:async()=>body?.action==='start'?{ok:true,file:'test.'+extension,contentType:extension==='m4a'?'audio/mp4':'audio/mpeg',uploadUrl:'https://r2.test/upload'}:body?.action==='finish'?{ok:true,url:'/api/research/desk-media/test.'+extension}:{ok:true,enabled:true}};
 };
 globalThis.XMLHttpRequest=class{constructor(){requests.push(this);this.upload={};}open(method,url){assert.equal(method,'PUT');assert.equal(url,'https://r2.test/upload');}setRequestHeader(name,value){assert.equal(name,'Content-Type');assert.equal(value,extension==='m4a'?'audio/mp4':'audio/mpeg');}send(){this.upload.onprogress({lengthComputable:true,loaded:512,total:1024});}abort(){this.onabort();this.onloadend();}};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>{root.render(React.createElement(AudioUpload,{disabled:false,onUploaded:url=>attached.push(url),onBusyChange:value=>busy.push(value)}));await tick();});
  const input=host.querySelector('input[type=file]');assert.equal(input.accept,'.mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a');
  const choose=async name=>{Object.defineProperty(input,'files',{configurable:true,value:[{name,size:1024}]});await act(async()=>{input.dispatchEvent(new window.Event('change',{bubbles:true}));await tick();});};
  await choose('movie.mp4');assert.deepEqual(calls,['status']);assert.match(host.textContent,/動画は添付できません/);
  await choose('voice.'+extension);assert.deepEqual(busy,[true]);assert.match(host.textContent,/50%/);assert.deepEqual(attached,[]);
  await act(async()=>{const xhr=requests[0];xhr.status=200;xhr.onload();xhr.onloadend();await tick();});
  assert.deepEqual(calls,['status','start','finish']);assert.deepEqual(busy,[true,false]);assert.deepEqual(attached,['/api/research/desk-media/test.'+extension]);
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=originalFetch;if(originalXHR===undefined)delete globalThis.XMLHttpRequest;else globalThis.XMLHttpRequest=originalXHR;}
});
