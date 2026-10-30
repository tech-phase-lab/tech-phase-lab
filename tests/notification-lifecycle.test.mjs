import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {waitForIdentity} from '../lib/research/member-recovery.ts';
const require=createRequire(import.meta.url);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const pending=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function harness(fetch, subscription=null) {
 const states=[],refs=[],effects=[],tasks=new Map();let index=0,refIndex=0,mounted=false,next=0,cleanup=[];
 const window=Object.assign(new EventTarget(),{PushManager:function(){},Notification:function(){}});
 const document=Object.assign(new EventTarget(),{visibilityState:'visible'});
 const registration={active:true,pushManager:{getSubscription:async()=>subscription}};
 const navigator={serviceWorker:{getRegistration:async()=>registration,register:async()=>registration}};
 const source=ts.transpileModule(readFileSync(new URL('../app/research/notification-settings.tsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const target={exports:{}};
 new Function('require','module','exports','window','document','navigator','Notification','fetch','setTimeout','clearTimeout',source)(id=>{
  if(id==='react')return {...React,useSyncExternalStore(_subscribe,_snapshot,server){return server();},useState(initial){const i=index++;if(!(i in states))states[i]=initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},useRef(initial){const i=refIndex++;return refs[i]??(refs[i]={current:initial});},useEffect(effect){if(!mounted)effects.push(effect);}};
  if(id==='next/link')return {default:({children,...props})=>React.createElement('a',props,children)};
  if(id==='@/lib/research/member-recovery')return {waitForIdentity};
  if(id==='./notification-page-view')return {default:()=>null};
  if(id.endsWith('.css'))return {default:{}};
  return require(id);
 },target,target.exports,window,document,navigator,{permission:'granted'},fetch,(fn,delay)=>{const id=++next;tasks.set(id,{fn,delay});return id;},id=>tasks.delete(id));
 return {
  render(){index=0;refIndex=0;return renderToStaticMarkup(React.createElement(target.exports.default,{lang:'en',initiallyOpen:true}));},
  click(label){index=0;refIndex=0;const tree=target.exports.default({lang:'en',initiallyOpen:true});let found;function walk(node){if(!node||typeof node!=='object')return;if(node.type==='button'&&node.props.children===label)found=node;React.Children.forEach(node.props?.children,walk);}walk(tree);assert.ok(found);found.props.onClick();},
  mount(){cleanup=effects.map(fn=>fn());mounted=true;},
  stop(){for(const fn of cleanup)fn?.();},
  change(){window.dispatchEvent(new Event('tech-phase:membership-changed'));},
  resume(){for(const name of ['focus','pageshow','online'])window.dispatchEvent(new Event(name));document.dispatchEvent(new Event('visibilitychange'));},
  delays(){return [...tasks.values()].map(t=>t.delay);},
  async timer(delay){const entry=[...tasks].find(([,t])=>delay===undefined||t.delay===delay);assert.ok(entry);tasks.delete(entry[0]);entry[1].fn();await flush();},
 };
}
const config=(validUntil=Date.now()+60000)=>Response.json({enabled:true,publicKey:'test',validUntil});
test('new membership result wins over late config and cancels the obsolete read',async()=>{
 const old=pending();const calls=[];
 const panel=harness((url,options)=>{calls.push(options);return calls.length===1?old.promise:Promise.resolve(Response.json({enabled:false,reason:'pro-required'}));});
 try {panel.render();panel.mount();panel.change();await flush();assert.equal(calls[0].signal.aborted,true);assert.match(panel.render(),/available with PRO/);old.resolve(config());await flush();assert.match(panel.render(),/available with PRO/);assert.doesNotMatch(panel.render(),/Turn on notifications/);}finally{panel.stop();}
});
test('late device-status response cannot override a newer signed-out result',async()=>{
 const old=pending();let reads=0;const sub={toJSON:()=>({endpoint:'test'})};
 const panel=harness((_url,options)=>options.method==='POST'?old.promise:Promise.resolve(++reads===1?config():Response.json({reason:'sign-in'})),sub);
 try {panel.render();panel.mount();await flush();panel.change();await flush();old.resolve(Response.json({ok:true,registered:true}));await flush();assert.match(panel.render(),/Sign in to use notifications/);assert.doesNotMatch(panel.render(),/This device: on/);}finally{panel.stop();}
});
test('timer cap revalidates a long entitlement without falsely expiring it',async()=>{
 let reads=0;const panel=harness(async()=>{reads++;return config(Date.now()+40*86400000);});
 try {panel.render();panel.mount();await flush();assert.deepEqual(panel.delays(),[2147483647]);await panel.timer();assert.equal(reads,2);assert.match(panel.render(),/This device: off/);assert.doesNotMatch(panel.render(),/available with PRO/);}finally{panel.stop();}
});
test('expiry rechecks renewal; service failure stays unavailable and offers retry',async()=>{
 let reads=0;const panel=harness(async()=>++reads===3?new Response('',{status:503}):config());
 try {panel.render();panel.mount();await flush();await panel.timer();assert.equal(reads,2);assert.match(panel.render(),/This device: off/);await panel.timer();assert.match(panel.render(),/Notification service unavailable/);assert.match(panel.render(),/Try again/);assert.doesNotMatch(panel.render(),/available with PRO/);}finally{panel.stop();}
});
test('resume events coalesce and cleanup prevents pending requests from updating state',async()=>{
 const late=pending();let reads=0;let signal;const panel=harness(async(_url,options)=>{signal=options.signal;return ++reads===1?config():late.promise;});
 try {panel.render();panel.mount();await flush();panel.resume();assert.equal(panel.delays().filter(d=>d===0).length,1);await panel.timer(0);assert.equal(reads,2);panel.stop();assert.equal(signal.aborted,true);late.resolve(config());await flush();assert.match(panel.render(),/Checking/);}finally{panel.stop();}
});
test('missing or elapsed expiry never enables notification controls',async()=>{
 for(const validUntil of [undefined,0,Date.now()-1]){const panel=harness(async()=>Response.json({enabled:true,publicKey:'test',validUntil}));try{panel.render();panel.mount();await flush();assert.match(panel.render(),/available with PRO/);assert.doesNotMatch(panel.render(),/Turn on notifications/);}finally{panel.stop();}}
});

test('confirmed expiry removes usable controls only after the server answers',async()=>{
 let reads=0;const panel=harness(async()=>++reads===1?config():Response.json({reason:'pro-required'}));
 try {panel.render();panel.mount();await flush();assert.match(panel.render(),/Turn on notifications/);await panel.timer();assert.match(panel.render(),/available with PRO/);assert.doesNotMatch(panel.render(),/Turn on notifications/);}finally{panel.stop();}
});

test('turning off a device supersedes an older inspection and cannot be undone by its late response',async()=>{
 const late=pending(),unsubscribed=pending();let reads=0;
 const sub={toJSON:()=>({endpoint:'test'}),unsubscribe:()=>unsubscribed.promise};
 const panel=harness(async(_url,options)=>options.method==='POST'?Response.json({ok:true,registered:true}):++reads===1?config():late.promise,sub);
 try {panel.render();panel.mount();await flush();assert.match(panel.render(),/This device: on/);panel.resume();await panel.timer(0);panel.click('Turn off on this device');await flush();unsubscribed.resolve(true);await flush();assert.match(panel.render(),/This device: off/);late.resolve(config());await flush();assert.match(panel.render(),/This device: off/);assert.doesNotMatch(panel.render(),/This device: on/);}finally{panel.stop();}
});
