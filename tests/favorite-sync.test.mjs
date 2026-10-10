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
function harness(transport,journal){let latest;const sync=createFavoriteSync(transport,(cloud,status)=>{latest={cloud,status};},journal);return {sync,get latest(){return latest;}};}
function memoryJournal(){const entries=new Map();return {load:key=>entries.get(key)??null,save:(key,value)=>entries.set(key,value),clear:key=>entries.delete(key)};}

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

test('account change on save hides the old draft and verifies the new account before any retry',async()=>{
 const journal=memoryJournal();let writes=0, switched=false;
 const other='b'.repeat(64), otherDocument=add('TSM')(document);
 const h=harness(async init=>{if(!init)return reply(200,switched?{...state(1,otherDocument),account:other}:state(1));writes++;switched=true;return reply(409,{ok:false,error:'account-changed'});},journal);
 await h.sync.refresh();h.sync.update(add('ANET'));await tick();
 assert.equal(h.latest.status,'error');assert.equal(h.latest.cloud,null);assert.equal(h.sync.hasPending(),false);
 assert.equal(favoriteDisplayDocument(h.latest.cloud,h.latest.status,deviceOnly),null);
 assert.equal(h.sync.update(add('LITE')),false);assert.ok(journal.load(account));
 await h.sync.retry();assert.equal(h.latest.status,'synced');assert.equal(h.latest.cloud.account,other);
 assert.deepEqual(h.latest.cloud.document,otherDocument);assert.equal(writes,1);assert.ok(journal.load(account));
});

test('logout during a save hides account data while retaining the draft for the same account',async()=>{
 const journal=memoryJournal();let signedIn=true, writes=0;
 const h=harness(async init=>{if(!init)return signedIn?reply(200,state(1)):reply(401,{ok:false});writes++;if(writes===1){signedIn=false;return reply(401,{ok:false});}const sent=JSON.parse(init.body);return reply(200,state(2,sent.document));},journal);
 await h.sync.refresh();h.sync.update(add('AAPL'));await tick();
 assert.equal(h.latest.status,'guest');assert.equal(h.latest.cloud,null);assert.equal(h.sync.hasPending(),false);
 assert.equal(favoriteDisplayDocument(h.latest.cloud,h.latest.status,deviceOnly),deviceOnly);assert.ok(journal.load(account));
 await h.sync.retry();assert.equal(writes,1);assert.equal(h.latest.status,'guest');
 signedIn=true;await h.sync.refresh();await tick();
 assert.equal(writes,2);assert.equal(h.latest.status,'synced');assert.deepEqual(h.latest.cloud.document.lists[0].tickers,['MU','AAPL']);assert.equal(journal.load(account),null);
});

test('a slow old-account read cannot restore account data after a save confirms logout',async()=>{
 const read=deferred();let reads=0;
 const h=harness(async init=>init?reply(401,{ok:false}):++reads===1?reply(200,state(1)):read.promise);
 await h.sync.refresh();const refreshing=h.sync.refresh();h.sync.update(add('AAPL'));await tick();
 assert.equal(h.latest.status,'guest');read.resolve(reply(200,state(1)));await refreshing;
 assert.equal(h.latest.cloud,null);assert.equal(h.latest.status,'guest');
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

test('navigation restores all queued edits after the old mount commits only its first save',async()=>{
 const journal=memoryJournal(), first=deferred();let remote=state(1);const writes=[];
 const transport=async init=>{if(!init)return reply(200,remote);const sent=JSON.parse(init.body);writes.push(sent);if(writes.length===1)return first.promise;assert.equal(sent.revision,remote.revision);remote=state(sent.revision+1,sent.document);return reply(200,remote);};
 const old=harness(transport,journal);await old.sync.refresh();old.sync.update(add('AAPL'));old.sync.update(add('ANET'));old.sync.dispose();
 remote=state(2,writes[0].document);first.resolve(reply(200,remote));await tick();
 const next=harness(transport,journal);await next.sync.refresh();await tick();
 assert.deepEqual(remote.document.lists[0].tickers,['MU','AAPL','ANET']);
 assert.equal(next.latest.status,'synced');assert.equal(writes.length,2);assert.equal(journal.load(account),null);
});

test('failed saves survive navigation and resume only after account verification',async()=>{
 const journal=memoryJournal();const old=harness(async init=>init?reply(503,{ok:false}):reply(200,state(1)),journal);
 await old.sync.refresh();old.sync.update(add('AAPL'));await tick();old.sync.dispose();
 const read=deferred();let writes=0;
 const next=harness(async init=>{if(!init)return read.promise;writes++;const sent=JSON.parse(init.body);return reply(200,state(2,sent.document));},journal);
 const loading=next.sync.refresh();assert.equal(writes,0);assert.equal(next.latest,undefined);
 read.resolve(reply(200,state(1)));await loading;await tick();
 assert.equal(writes,1);assert.deepEqual(next.latest.cloud.document.lists[0].tickers,['MU','AAPL']);assert.equal(journal.load(account),null);
});

test('saved response lost during navigation does not send the same edit again',async()=>{
 const journal=memoryJournal();let remote=state(1),writes=0;
 const transport=async init=>{if(!init)return reply(200,remote);writes++;const sent=JSON.parse(init.body);remote=state(2,sent.document);throw Error('response lost');};
 const old=harness(transport,journal);await old.sync.refresh();old.sync.update(add('AAPL'));await tick();old.sync.dispose();
 const next=harness(transport,journal);await next.sync.refresh();
 assert.equal(next.latest.status,'synced');assert.equal(writes,1);assert.equal(journal.load(account),null);
});

test('restored edits never overwrite a different device or another account',async()=>{
 const journal=memoryJournal();const queued=state(1,add('AAPL')(document));journal.save(account,JSON.stringify({cloud:queued,sent:null}));let writes=0;
 const conflict=harness(async init=>{if(init)writes++;return reply(200,state(2,add('TSM')(document)));},journal);
 await conflict.sync.refresh();assert.equal(conflict.latest.status,'conflict');assert.equal(writes,0);assert.deepEqual(conflict.latest.cloud.document,queued.document);assert.ok(journal.load(account));
 const other='b'.repeat(64);const switched=harness(async init=>{if(init)writes++;return reply(200,{...state(1),account:other});},journal);
 await switched.sync.refresh();assert.equal(switched.latest.cloud.account,other);assert.deepEqual(switched.latest.cloud.document,document);assert.equal(writes,0);assert.ok(journal.load(account));
});

test('unavailable tab storage rejects an edit instead of showing an unsaved success',async()=>{
 let writes=0;const journal={load:()=>null,save:()=>{throw Error('quota');},clear:()=>{}};
 const h=harness(async init=>{if(init)writes++;return reply(200,state(1));},journal);await h.sync.refresh();
 assert.equal(h.sync.update(add('AAPL')),false);assert.equal(h.latest.status,'error');assert.deepEqual(h.latest.cloud.document,document);assert.equal(writes,0);
});

test('only explicit conflict recovery discards the pending draft and loads the saved list',async()=>{
 const journal=memoryJournal(),remote=state(3,add('TSM')(document));
 journal.save(account,JSON.stringify({cloud:state(1,add('AAPL')(document)),sent:null}));let writes=0;
 const h=harness(async init=>{if(init)writes++;return reply(200,remote);},journal);
 await h.sync.refresh();assert.equal(h.latest.status,'conflict');await h.sync.retry();assert.ok(journal.load(account));
 await h.sync.discardPending();assert.equal(h.latest.status,'synced');assert.deepEqual(h.latest.cloud.document,remote.document);assert.equal(journal.load(account),null);assert.equal(writes,0);
});

test('returning to the page retries failed edits without a read replacing the unsaved list',async()=>{
 const journal=memoryJournal(), resumed=deferred();let reads=0,writes=0;
 const changed={...document,lists:[{id:'default',name:'同期確認',tickers:['AAPL']}],alerts:[{ticker:'AAPL',price:200,direction:'above',currency:'USD'}]};
 const h=harness(async init=>{if(!init){reads++;return reply(200,state(1));}writes++;return writes===1?reply(503,{ok:false}):resumed.promise;},journal);
 await h.sync.refresh();h.sync.update(()=>changed);await tick();assert.equal(h.latest.status,'error');assert.ok(journal.load(account));
 const wakeups=[h.sync.refresh(),h.sync.refresh(),h.sync.refresh()];
 assert.equal(reads,1);assert.equal(writes,2);assert.deepEqual(h.latest.cloud.document,changed);
 resumed.resolve(reply(200,state(2,changed)));await Promise.all(wakeups);
 assert.equal(h.latest.status,'synced');assert.equal(h.sync.hasPending(),false);assert.equal(journal.load(account),null);
});

test('repeated page wake-ups preserve a conflicting draft without automatic writes',async()=>{
 const journal=memoryJournal();let writes=0;
 const h=harness(async init=>{if(!init)return reply(200,state(1));writes++;return reply(409,{...state(2,add('TSM')(document)),ok:false});},journal);
 await h.sync.refresh();h.sync.update(add('AAPL'));await tick();
 await h.sync.refresh();await h.sync.refresh();assert.equal(writes,1);assert.equal(h.latest.status,'conflict');assert.deepEqual(h.latest.cloud.document.lists[0].tickers,['MU','AAPL']);assert.ok(journal.load(account));
});
