import test from 'node:test';
import assert from 'node:assert/strict';
import { createFavoriteSync, favoriteDisplayDocument } from '../lib/research/favorite-sync.ts';
const account='a'.repeat(64);
const document={lists:[{id:'default',name:'保有株',tickers:['MU']}],names:{MU:'Micron'},alerts:[]};
const reply=(status,data)=>({status,ok:status===200,json:async()=>data});
const state=(revision,doc=document)=>({ok:true,account,revision,document:doc});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
const add=ticker=>doc=>({...doc,lists:doc.lists.map(l=>({...l,tickers:[...l.tickers,ticker]}))});
const deviceOnly={lists:[{id:'default',name:'',tickers:['ALAB']}],names:{},alerts:[]};
function harness(transport){let latest;const sync=createFavoriteSync(transport,(cloud,status)=>{latest={cloud,status};});return {sync,get latest(){return latest;}};}

test('slow initial account lookup never flashes device-only favorites',async()=>{
 const read=deferred();const h=harness(()=>read.promise);
 const loading=h.sync.refresh();
 assert.equal(favoriteDisplayDocument(null,'loading',deviceOnly),null);
 assert.equal(favoriteDisplayDocument(null,'error',deviceOnly),null);
 read.resolve(reply(200,state(1)));await loading;
 assert.deepEqual(favoriteDisplayDocument(h.latest.cloud,h.latest.status,deviceOnly).lists[0].tickers,['MU']);
});

test('focus refresh retains the verified account list during slow and failed reads',async()=>{
 const read=deferred();let calls=0;
 const h=harness(()=>++calls===1?Promise.resolve(reply(200,state(1))):read.promise);
 await h.sync.refresh();const refreshing=h.sync.refresh();
 assert.deepEqual(favoriteDisplayDocument(h.latest.cloud,h.latest.status,deviceOnly).lists[0].tickers,['MU']);
 read.resolve(reply(503,{ok:false}));await refreshing;
 assert.equal(h.latest.status,'error');
 assert.deepEqual(favoriteDisplayDocument(h.latest.cloud,h.latest.status,deviceOnly).lists[0].tickers,['MU']);
});

test('device-only favorites appear only after a confirmed signed-out response',async()=>{
 const read=deferred();const h=harness(()=>read.promise);const loading=h.sync.refresh();
 assert.equal(favoriteDisplayDocument(null,'loading',deviceOnly),null);
 read.resolve(reply(401,{ok:false}));await loading;
 assert.equal(favoriteDisplayDocument(h.latest.cloud,h.latest.status,deviceOnly),deviceOnly);
});

test('rapid edits are serialized using each acknowledged revision',async()=>{
 const first=deferred();const writes=[];
 const h=harness(async init=>{if(!init)return reply(200,state(1));const sent=JSON.parse(init.body);writes.push(sent);if(writes.length===1)return first.promise;return reply(200,state(sent.revision+1,sent.document));});
 await h.sync.refresh();h.sync.update(add('ANET'));h.sync.update(add('LITE'));
 assert.equal(writes.length,1);assert.equal(h.latest.status,'saving');
 first.resolve(reply(200,state(2,writes[0].document)));await tick();
 assert.equal(writes.length,2);assert.equal(writes[1].revision,2);
 assert.deepEqual(h.latest.cloud.document.lists[0].tickers,['MU','ANET','LITE']);assert.equal(h.latest.status,'synced');assert.equal(h.sync.hasPending(),false);
});

test('lost save response retries without treating the same saved document as a conflict',async()=>{
 let saved;let writes=0;
 const h=harness(async init=>{if(!init)return reply(200,state(1));writes++;const sent=JSON.parse(init.body);if(writes===1){saved=state(2,sent.document);throw Error('connection lost after commit');}return reply(409,{...saved,ok:false,conflict:true});});
 await h.sync.refresh();h.sync.update(add('ANET'));await tick();assert.equal(h.latest.status,'error');assert.equal(h.sync.hasPending(),true);
 await h.sync.retry();assert.equal(h.latest.status,'synced');assert.equal(h.latest.cloud.revision,2);assert.equal(h.sync.hasPending(),false);
});

test('other device changes cause conflict and never overwrite either edit',async()=>{
 let writes=0;
 const remote=add('TSM')(document);
 const h=harness(async init=>{if(!init)return reply(200,state(1));writes++;return reply(409,{...state(2,remote),ok:false,conflict:true});});
 await h.sync.refresh();h.sync.update(add('ANET'));await tick();
 assert.equal(h.latest.status,'conflict');assert.deepEqual(h.latest.cloud.document.lists[0].tickers,['MU','ANET']);assert.equal(h.sync.update(add('LITE')),false);
 await h.sync.retry();assert.equal(writes,1);assert.deepEqual(remote.lists[0].tickers,['MU','TSM']);
});

test('stale failed read cannot turn an acknowledged save into an error',async()=>{
 const read=deferred();let reads=0;
 const h=harness(async init=>{if(!init)return ++reads===1?reply(200,state(1)):read.promise;const sent=JSON.parse(init.body);return reply(200,state(2,sent.document));});
 await h.sync.refresh();const refreshing=h.sync.refresh();h.sync.update(add('ANET'));await tick();
 read.resolve(reply(503,{ok:false}));await refreshing;
 assert.equal(h.latest.status,'synced');assert.deepEqual(h.latest.cloud.document.lists[0].tickers,['MU','ANET']);
});

test('account change on save preserves unsaved edits and never retries into the other account',async()=>{
 let writes=0;const h=harness(async init=>{if(!init)return reply(200,state(1));writes++;return reply(409,{ok:false,error:'account-changed'});});
 await h.sync.refresh();h.sync.update(add('ANET'));await tick();await h.sync.retry();
 assert.equal(h.latest.status,'conflict');assert.equal(h.latest.cloud.account,account);assert.equal(writes,1);assert.equal(h.sync.hasPending(),true);
});

test('disposed mounts ignore late responses and do not flush queued edits',async()=>{
 const write=deferred();let writes=0;const h=harness(async init=>{if(!init)return reply(200,state(1));writes++;return write.promise;});
 await h.sync.refresh();h.sync.update(add('ANET'));h.sync.update(add('LITE'));h.sync.dispose();const before=h.latest;
 write.resolve(reply(200,state(2,add('ANET')(document))));await tick();assert.equal(h.latest,before);assert.equal(writes,1);
});

test('unauthenticated storage is guest-only and malformed successful replies stay unverified',async()=>{
 const guest=harness(async()=>reply(401,{ok:false}));await guest.sync.refresh();assert.equal(guest.latest.status,'guest');assert.equal(guest.sync.update(add('ANET')),false);
 const bad=harness(async()=>reply(200,{ok:true,account,revision:'1',document}));await bad.sync.refresh();assert.equal(bad.latest.status,'error');assert.equal(bad.latest.cloud,null);
});
