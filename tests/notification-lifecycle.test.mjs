import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {waitForIdentity} from '../lib/research/member-recovery.ts';
import * as preferencesLoad from '../lib/research/preferences-load.ts';
import * as pushSwFacts from '../lib/research/push-sw-facts.ts';
const require=createRequire(import.meta.url);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const pending=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function harness(fetch, subscription=null, props={}, serviceWorker=null) {
 let view=null;const states=[],refs=[],effects=[],tasks=new Map();let index=0,refIndex=0,mounted=false,next=0,cleanup=[];
 const window=Object.assign(new EventTarget(),{PushManager:function(){},Notification:function(){},location:{origin:'https://techphase.app'}});
 const document=Object.assign(new EventTarget(),{visibilityState:'visible'});
 const registration={active:true,pushManager:{getSubscription:async()=>subscription}};
 const navigator={serviceWorker:serviceWorker??{getRegistration:async()=>registration,register:async()=>registration}};
 const source=ts.transpileModule(readFileSync(new URL('../app/research/notification-settings.tsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const target={exports:{}};
 new Function('require','module','exports','window','document','navigator','Notification','fetch','setTimeout','clearTimeout',source)(id=>{
  if(id==='react')return {...React,useSyncExternalStore(_subscribe,_snapshot,server){return server();},useState(initial){const i=index++;if(!(i in states))states[i]=initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},useRef(initial){const i=refIndex++;return refs[i]??(refs[i]={current:initial});},useEffect(effect){if(!mounted)effects.push(effect);}};
  if(id==='next/link')return {default:({children,...props})=>React.createElement('a',props,children)};
  if(id==='@/lib/research/member-recovery')return {waitForIdentity};
  if(id==='@/lib/research/preferences-load')return preferencesLoad;
  if(id==='@/lib/research/push-sw-facts')return pushSwFacts;
  if(id==='./notification-page-view')return {default:p=>{view=p;return null;}};
  if(id==='./member-display-provider')return {useOwnerMode:()=>false,useOwnerAccount:()=>props.ownerAccount===true};
  if(id==='./push-diagnostic-panel')return {default:()=>null};
  if(id==='./identity-provider')return {useIdentityRefresh:()=>async()=>{}};
  if(id.endsWith('.css'))return {default:{}};
  return require(id);
 },target,target.exports,window,document,navigator,{permission:'granted'},fetch,(fn,delay)=>{const id=++next;tasks.set(id,{fn,delay});return id;},id=>tasks.delete(id));
 return {
  render(){index=0;refIndex=0;return renderToStaticMarkup(React.createElement(target.exports.default,{lang:'en',initiallyOpen:true,...props}));},
  click(label){index=0;refIndex=0;const tree=target.exports.default({lang:'en',initiallyOpen:true,...props});let found;function walk(node){if(!node||typeof node!=='object')return;if(node.type==='button'&&node.props.children===label)found=node;React.Children.forEach(node.props?.children,walk);}walk(tree);assert.ok(found);found.props.onClick();},
  mount(){cleanup=effects.map(fn=>fn());mounted=true;},
  stop(){for(const fn of cleanup)fn?.();},
  change(){window.dispatchEvent(new Event('tech-phase:membership-changed'));},
  resume(){for(const name of ['focus','pageshow','online'])window.dispatchEvent(new Event(name));document.dispatchEvent(new Event('visibilitychange'));},
  hide(){document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));},
  show(){document.visibilityState='visible';},
  view(){index=0;refIndex=0;renderToStaticMarkup(React.createElement(target.exports.default,{lang:'en',initiallyOpen:true,...props}));return view;},
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

// Nov 15: the notifications page said "could not load your settings" on the owner's iPhone although the device was registered and
// a test notice arrived. A read the browser cuts off must not show that error; only a real server failure does, after quiet retries.
const pageConfig=()=>Response.json({enabled:true,publicKey:'test',validUntil:Date.now()+60000,preferencesVersion:1});
const savedPrefs={priceTargets:true};
function pagePanel(preferences){
 const sub={toJSON:()=>({endpoint:'test'})};let reads=0;
 const panel=harness(async(_url,options={})=>{
  if(options.method!=='POST')return pageConfig();
  const {action}=JSON.parse(options.body);
  if(action==='status')return Response.json({ok:true,registered:true});
  if(action==='preferences')return preferences(++reads,options);
  throw new Error('unexpected '+action);
 },sub,{page:true});
 return {panel,reads:()=>reads};
}
test('a preferences read cut off while the iPhone app is in the background waits quietly and reads again when shown',async t=>{
 t.mock.method(console,'info',()=>{});
 let panel;const harnessed=pagePanel(n=>{if(n===1){panel.hide();return Promise.reject(new TypeError('Load failed'));}return Response.json({ok:true,preferences:savedPrefs});});
 panel=harnessed.panel;
 try {
  panel.render();panel.mount();await flush();
  assert.equal(harnessed.reads(),1);
  assert.notEqual(panel.view().prefsState,'error');assert.equal(panel.view().prefsMessage,'');
  panel.show();panel.resume();await panel.timer(0);await flush();
  assert.equal(harnessed.reads(),2);assert.equal(panel.view().prefsState,'ready');assert.deepEqual(panel.view().prefs,savedPrefs);
 } finally {panel.stop();}
});
test('an AbortError the page did not ask for (iOS stopping the request) is retried quietly instead of shown',async t=>{
 t.mock.method(console,'info',()=>{});
 const {panel,reads}=pagePanel(n=>n===1?Promise.reject(new DOMException('The operation was aborted.','AbortError')):Response.json({ok:true,preferences:savedPrefs}));
 try {
  panel.render();panel.mount();await flush();
  assert.equal(panel.view().prefsState,'loading');assert.equal(panel.view().prefsMessage,'');
  await panel.timer(1500);await flush();
  assert.equal(reads(),2);assert.equal(panel.view().prefsState,'ready');
 } finally {panel.stop();}
});
test('our own cancellation (a newer check) never shows the error',async t=>{
 t.mock.method(console,'info',()=>{});
 const {panel}=pagePanel((n,options)=>n===1?new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason))):Response.json({ok:true,preferences:savedPrefs}));
 try {panel.render();panel.mount();await flush();panel.resume();await panel.timer(0);await flush();assert.equal(panel.view().prefsMessage,'');assert.equal(panel.view().prefsState,'ready');} finally {panel.stop();}
});
test('a real server failure is retried twice quietly, then shown and logged with a reason code only',async t=>{
 t.mock.method(console,'info',()=>{});const warn=t.mock.method(console,'warn',()=>{});
 const {panel,reads}=pagePanel(()=>Response.json({ok:false},{status:503}));
 try {
  panel.render();panel.mount();await flush();
  assert.equal(panel.view().prefsMessage,'');await panel.timer(1500);await flush();
  assert.equal(panel.view().prefsMessage,'');await panel.timer(4000);await flush();
  assert.equal(reads(),3);assert.equal(panel.view().prefsState,'error');assert.match(panel.view().prefsMessage,/Could not load your settings/);
  assert.deepEqual(warn.mock.calls.map(c=>c.arguments),[['[notifications] preferences load failed: http-503']]);
 } finally {panel.stop();}
});
test('a lapsed sign-in is renewed once before reading again; a named refusal is shown at once',async t=>{
 t.mock.method(console,'info',()=>{});t.mock.method(console,'warn',()=>{});
 const renewed=pagePanel(n=>n===1?Response.json({ok:false,error:'sign-in'},{status:401}):Response.json({ok:true,preferences:savedPrefs}));
 try {renewed.panel.render();renewed.panel.mount();await flush();await flush();assert.equal(renewed.reads(),2);assert.equal(renewed.panel.view().prefsState,'ready');} finally {renewed.panel.stop();}
 const refused=pagePanel(()=>Response.json({ok:false,error:'not-registered'}));
 try {refused.panel.render();refused.panel.mount();await flush();assert.equal(refused.reads(),1);assert.equal(refused.panel.view().prefsState,'error');} finally {refused.panel.stop();}
});

test('Nov 15: the notification step record (通知の動作の記録) reaches the settings page for the owner account only', () => {
 for (const ownerAccount of [true, false]) {
  const view = harness(async () => Response.json({}), null, { page: true, ownerAccount }).view();
  assert.equal(Boolean(view.diagnostic), ownerAccount, String(ownerAccount));
 }
 const settings = readFileSync(new URL('../app/research/notification-settings.tsx', import.meta.url), 'utf8');
 assert.match(settings, /diagnostic=\{ownerAccount \? <PushDiagnosticPanel lang=\{lang\} onReinstall=\{key \? reinstall : undefined\} \/> : null\}/);
});

// Nov 16: the owner's phone kept an old worker. 「通知の仕組みを入れ直す」 removes it, installs the worker again and saves the device
// through the usual actions, carrying the old device's choices over before the old device is removed.
test('the owner reinstall button unregisters the old worker, registers it again and saves the new device with the old choices', async () => {
 const log = [];
 const oldSub = { endpoint: 'https://push.example/old', toJSON: () => ({ endpoint: 'old' }) };
 const newSub = { endpoint: 'https://push.example/new', toJSON: () => ({ endpoint: 'new' }) };
 const oldReg = { scope: 'https://techphase.app/', active: { scriptURL: 'https://techphase.app/research-sw.js' },
  pushManager: { getSubscription: async () => oldSub }, unregister: async () => { log.push('unregister'); return true; } };
 const newReg = { scope: 'https://techphase.app/', updateViaCache: 'none', active: { scriptURL: 'https://techphase.app/research-sw.js' },
  pushManager: { getSubscription: async () => null, subscribe: async () => { log.push('subscribe'); return newSub; } } };
 let installed = false;
 const serviceWorker = { getRegistration: async () => installed ? newReg : oldReg, getRegistrations: async () => installed ? [newReg] : [oldReg],
  register: async (url, options) => { log.push(['register', url, options]); installed = true; return newReg; } };
 const panel = harness(async (_url, options = {}) => {
  if (options.method !== 'POST') return pageConfig();
  const body = JSON.parse(options.body);
  if (body.action !== 'status') log.push([body.action, body.subscription.endpoint, body.preferences]);
  if (body.action === 'preferences') return Response.json({ ok: true, preferences: savedPrefs });
  return Response.json({ ok: true, registered: true });
 }, null, { page: true, ownerAccount: true }, serviceWorker);
 try {
  panel.render(); panel.mount(); await flush(); await flush();
  log.length = 0;
  const onReinstall = panel.view().diagnostic.props.onReinstall;
  assert.equal(typeof onReinstall, 'function');
  const result = await onReinstall();
  assert.deepEqual(result, { ok: true, removed: 1, hadSubscription: true, registered: true, keptPreferences: true, updateViaCache: 'none' });
  assert.deepEqual(log, ['unregister', ['register', '/research-sw.js', { scope: '/', updateViaCache: 'none' }], 'subscribe',
   ['preferences', 'old', undefined], ['register', 'new', undefined], ['save-preferences', 'new', savedPrefs], ['remove', 'old', undefined],
   ['preferences', 'new', undefined]]);
  assert.equal(panel.view().state, 'on');
 } finally { panel.stop(); }
 // Without the server's push key (not loaded yet) there is no button.
 const keyless = harness(async () => Response.json({}), null, { page: true, ownerAccount: true });
 assert.equal(keyless.view().diagnostic.props.onReinstall, undefined);
});
