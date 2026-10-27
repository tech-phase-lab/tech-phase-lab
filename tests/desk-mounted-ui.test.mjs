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
async function component(path, editorStub=false) {
 const dir=await mkdtemp(new URL('../.desk-ui-',import.meta.url));
 try {
  const outfile=`${dir}/component.mjs`;
  await build({entryPoints:[new URL(path,import.meta.url).pathname],bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',outfile,plugins:[{name:'css',setup(b){if(editorStub){b.onResolve({filter:/^react$/,namespace:'test-editor'},()=>({path:'react',external:true}));b.onResolve({filter:/\/desk\/text-editor$/},()=>({path:'editor',namespace:'test-editor'}));b.onLoad({filter:/.*/,namespace:'test-editor'},()=>({contents:`import React from 'react';export default function Editor(p){return React.createElement('button',{type:'button',onClick:()=>p.onChange('[audio](/api/research/desk-media/12345678-1234-4123-8123-123456789abc.m4a)')},'Attach test audio')}`,loader:'js'}));}b.onLoad({filter:/\.css$/},()=>({contents:'export default new Proxy({}, {get: (_, key) => key})',loader:'js'}));}}]});
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
  await act(async()=>{root.render(React.createElement(AudioUpload,{disabled:false,onUploaded:(url,title)=>{attached.push({url,title});},onBusyChange:value=>busy.push(value)}));await tick();});
  const input=host.querySelector('input[type=file]');assert.equal(input.accept,'.mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a');
  const choose=async name=>{Object.defineProperty(input,'files',{configurable:true,value:[new File(['x'.repeat(1024)],name)]});await act(async()=>{input.dispatchEvent(new window.Event('change',{bubbles:true}));await tick();});};
  await choose('movie.mp4');assert.deepEqual(calls,['status']);assert.match(host.textContent,/MP3・M4A／50MBまで/);
  await choose('voice.'+extension);assert.equal(busy.at(-1),true);assert.deepEqual(calls,['status']);
  const titleInput=host.querySelector('input[type=text]');assert.equal(titleInput.value,'voice');
  await act(async()=>{titleInput[Object.keys(titleInput).find(key=>key.startsWith('__reactProps'))].onChange({target:{value:'週末の相場メモ'}});await tick();});
  assert.deepEqual(calls,['status']);
  await act(async()=>{host.querySelector('input[type=checkbox]').click();await tick();});
  await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='この音声を添付').click();await tick();});assert.match(host.textContent,/50%/);assert.deepEqual(attached,[]);
  await act(async()=>{const xhr=requests[0];xhr.status=200;xhr.onload();xhr.onloadend();await tick();});
  assert.deepEqual(calls,['status','start','finish']);assert.equal(busy.at(-1),false);assert.deepEqual(attached,[{url:'/api/research/desk-media/test.'+extension,title:'週末の相場メモ'}]);
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=originalFetch;if(originalXHR===undefined)delete globalThis.XMLHttpRequest;else globalThis.XMLHttpRequest=originalXHR;delete globalThis.__testRecorder;}
});

test('selecting or recording audio never uploads automatically; review and explicit attachment are required',async()=>{
 const AudioUpload=await component('../app/research/desk/audio-upload.tsx');
 const originalFetch=globalThis.fetch, originalRecorder=globalThis.MediaRecorder, originalXHR=globalThis.XMLHttpRequest;
 let requests=[],attached=[],busy=false,stopped=0;
 globalThis.fetch=async(url,options={})=>{requests.push([url,options]);return {ok:true,json:async()=>options.method?{ok:true,file:'test.m4a',uploadUrl:'https://upload.test',contentType:'audio/mp4',url:'/api/research/desk-media/test.m4a'}:{ok:true,enabled:true}};};
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stopped++}],getAudioTracks:()=>[{addEventListener:()=>{}}]})}});
 globalThis.MediaRecorder=class { static isTypeSupported(){return true;} constructor(){Object.assign(this,{state:'inactive'});globalThis.__testRecorder=this;} start(){this.state='recording';} stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['x'.repeat(1024)])});this.onstop?.();} };
 globalThis.XMLHttpRequest=class { upload={};status=200;open(){}setRequestHeader(){}send(){this.onload?.();this.onloadend?.();}abort(){this.onabort?.();} };
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text);
 try {
  await act(async()=>{root.render(React.createElement(AudioUpload,{disabled:false,onUploaded:url=>attached.push(url),onBusyChange:value=>busy=value}));await tick();});
  const input=host.querySelector('input[type=file]');Object.defineProperty(input,'files',{configurable:true,value:[new File(['x'.repeat(1024)],'memo.m4a',{type:'audio/mp4'})]});
  await act(async()=>{input.dispatchEvent(new window.Event('change',{bubbles:true}));await tick();});
  assert.equal(busy,true);assert.equal(requests.filter(([,o])=>o.method).length,0);assert.equal(button('この音声を添付').disabled,true);assert.equal(attached.length,0);
  await act(async()=>{button('破棄').click();await tick();});assert.equal(busy,false);
  await act(async()=>{button('ここで録音').click();await tick();});assert.equal(globalThis.__testRecorder.state,'recording');assert.equal(busy,true);
  await act(async()=>{button('停止して試聴').click();await tick();});
  assert.ok(stopped>0);assert.equal(busy,true);assert.ok(host.querySelector('audio'));assert.equal(requests.filter(([,o])=>o.method).length,0);
  await act(async()=>{host.querySelector('input[type=checkbox]').click();await tick();});
  await act(async()=>{button('この音声を添付').click();await tick();});
  assert.equal(attached.length,1);assert.equal(busy,false);assert.equal(requests.filter(([,o])=>o.method).length,2);
  assert.ok(requests.every(([url])=>url==='/api/research/desk-media'));
  await act(async()=>{button('ここで録音').click();await tick();button('録音を破棄').click();await tick();});assert.equal(busy,false);assert.equal(host.querySelector('audio'),null);assert.equal(attached.length,1);
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=originalFetch;globalThis.MediaRecorder=originalRecorder;globalThis.XMLHttpRequest=originalXHR;delete globalThis.__testRecorder;}
});

test('cancel while microphone permission is pending stops the late stream without recording',async()=>{
 const Recorder=await component('../app/research/desk/audio-recorder.tsx');const original=globalThis.MediaRecorder;let resolveStream,stops=0,files=0,busy=false;
 globalThis.MediaRecorder=class { static isTypeSupported(){return true;} constructor(){throw Error('must not create recorder after cancellation');} };
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>new Promise(resolve=>resolveStream=resolve)}});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(React.createElement(Recorder,{disabled:false,onFile:()=>files++,onBusyChange:value=>busy=value})));
  await act(async()=>host.querySelector('button').click());assert.equal(busy,true);
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='録音を破棄').click());
  await act(async()=>{resolveStream({getTracks:()=>[{stop:()=>stops++}]});await tick();});
  assert.equal(stops,1);assert.equal(files,0);assert.equal(busy,false);
 }finally{await act(async()=>root.unmount());host.remove();globalThis.MediaRecorder=original;}
});

test('voice memo import reads clipboard only on tap and never uploads or publishes',async()=>{
 const Import=await component('../app/research/desk/voice-memo-import.tsx');let reads=0,files=[],busy=false;
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{reads++;return 'TECH_PHASE_VOICE_MEMO_V1:'+Buffer.alloc(1024).toString('base64');}}});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>root.render(React.createElement(Import,{disabled:false,onFile:file=>files.push(file),onBusyChange:value=>busy=value})));
  assert.equal(reads,0);assert.equal(files.length,0);
  await act(async()=>{host.querySelector('button').click();await tick();});
  assert.equal(reads,1);assert.equal(files.length,1);assert.equal(busy,false);assert.equal(files[0].size,1024);
 }finally{await act(async()=>root.unmount());host.remove();}
});

test('audio publication requires a separate explicit confirmation and cancellation never sends the publish request',async()=>{
 const Composer=await component('../app/research/notes/composer.tsx',true);let sent=0,published=0,confirmation=0,allow=false;
 const oldFetch=globalThis.fetch,oldConfirm=window.confirm;
 globalThis.fetch=async(_url,options)=>{assert.equal(JSON.parse(options.body).action,'publish');sent++;return {ok:true,json:async()=>({ok:true})};};
 window.confirm=()=>{confirmation++;return allow;};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(React.createElement(Composer,{onPublished:()=>published++})));
  await act(async()=>host.querySelector('button').click());assert.equal(sent,0);
  const submit=async()=>act(async()=>{host.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await tick();});
  await submit();assert.equal(confirmation,1);assert.equal(sent,0);assert.equal(published,0);
  allow=true;await submit();assert.equal(confirmation,2);assert.equal(sent,1);assert.equal(published,1);
 }finally{await act(async()=>root.unmount());host.remove();globalThis.fetch=oldFetch;window.confirm=oldConfirm;}
});

test('recording pauses and resumes, then stops or discards correctly while paused without publishing',async()=>{
 const Recorder=await component('../app/research/desk/audio-recorder.tsx');const old=globalThis.MediaRecorder;let recorder,files=0,stops=0,busy=false;
 globalThis.MediaRecorder=class {static isTypeSupported(){return true;}state='inactive';constructor(){globalThis.__pausedRecorder=this;}start(){this.state='recording';}pause(){this.state='paused';}resume(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['x'.repeat(1024)])});this.onstop?.();}};
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stops++}],getAudioTracks:()=>[{addEventListener:()=>{}}]})}});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const click=async text=>act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent===text).click();await tick();});
 try{
  await act(async()=>root.render(React.createElement(Recorder,{disabled:false,onFile:()=>files++,onBusyChange:v=>busy=v})));
  await click('ここで録音');recorder=globalThis.__pausedRecorder;
  await click('一時停止');assert.equal(recorder.state,'paused');assert.equal(busy,true);assert.equal(files,0);assert.match(host.textContent,/一時停止中/);
  await click('録音を再開');assert.equal(recorder.state,'recording');
  await click('一時停止');await click('停止して試聴');assert.equal(files,1);assert.equal(busy,false);assert.ok(stops>0);
  await click('ここで録音');await click('一時停止');await click('録音を破棄');assert.equal(files,1);assert.equal(busy,false);
 }finally{await act(async()=>root.unmount());host.remove();globalThis.MediaRecorder=old;delete globalThis.__pausedRecorder;}
});

test('audio editing supports a cut and undo locally; cancel preserves the original without applying or uploading',async()=>{
 const Editor=await component('../app/research/desk/audio-editor.tsx');const oldContext=globalThis.AudioContext,oldEncoder=globalThis.AudioEncoder,oldData=globalThis.AudioData;let applied=0,busy=false;
 globalThis.AudioEncoder=class{static async isConfigSupported(){return {supported:true};}};globalThis.AudioData=class{};
 globalThis.AudioContext=class {state='running';async decodeAudioData(){return {length:1000,duration:10,sampleRate:100,numberOfChannels:1,getChannelData:()=>new Float32Array(1000)};}async close(){this.state='closed';}};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const click=async text=>act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent===text).click();await tick();});
 try{
  await act(async()=>root.render(React.createElement(Editor,{file:new File(['x'.repeat(1024)],'memo.m4a'),disabled:false,onApply:()=>applied++,onBusyChange:v=>busy=v})));
  await click('区間をカット');assert.equal(busy,true);assert.match(host.textContent,/音声の長さ：10.0秒/);
  await click('選択区間を削除');assert.match(host.textContent,/音声の長さ：9.0秒/);assert.equal(applied,0);
  await click('1つ戻す');assert.match(host.textContent,/音声の長さ：10.0秒/);
  await click('キャンセル');assert.equal(applied,0);assert.equal(busy,false);assert.equal(host.querySelector('svg'),null);
 }finally{await act(async()=>root.unmount());host.remove();globalThis.AudioContext=oldContext;globalThis.AudioEncoder=oldEncoder;globalThis.AudioData=oldData;}
});
