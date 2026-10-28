import test from 'node:test';
import assert from 'node:assert/strict';
import { createSavedSync } from '../lib/research/saved-sync.ts';
import { emptySavedDocument, hasBrowserResearch, importBrowserResearch, mergeSavedDocuments, validateSavedDocument } from '../lib/research/saved-document.ts';
const account = 'a'.repeat(64);
const doc = (saved = [], marks = []) => ({ saved, notebooks: marks.length ? { 'a:ja': marks } : {} });
const mark = (id = 'one', note = '自分のメモ') => ({ id, kind: 'note', color: 'blue', note, parts: [{ block: 'p:2:xx', start: 0, end: 2, quote: '😀' }] });
const response = (status, data) => ({ status, ok: status === 200, json: async () => data });
const state = (revision, document = doc()) => ({ ok: true, account, revision, document });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function journal() { const values = new Map(); return { load: a => values.get(a) ?? null, save: (a, v) => values.set(a, v), clear: a => values.delete(a) }; }
function harness(transport, j = journal()) { let latest; const sync = createSavedSync(transport, (cloud, status) => latest = { cloud, status }, j); return { sync, j, get latest() { return latest; } }; }

test('schema preserves Unicode anchors and rejects malformed/oversized documents', () => {
  assert.deepEqual(validateSavedDocument(doc(['a'], [mark()])), doc(['a'], [mark()]));
  for (const invalid of [null, {}, doc(['a', 'a']), doc([], [{ ...mark(), parts: [{ ...mark().parts[0], end: 1 }] }]), doc([], [mark(), mark()])]) assert.throws(() => validateSavedDocument(invalid));
});
test('merge preserves unrelated additions, deletions, notes and both languages', () => {
  const b = doc(['a'], [mark('one'), mark('two')]);
  const l = doc(['a', 'b'], [mark('one', 'local')]);
  const r = { ...doc(['a', 'c'], [mark('one'), mark('two'), mark('three')]), notebooks: { 'a:ja': [mark('one'), mark('two'), mark('three')], 'a:en': [mark('english')] } };
  const merged = mergeSavedDocuments(b, l, r);
  assert.deepEqual(merged.saved, ['a', 'c', 'b']);
  assert.deepEqual(merged.notebooks['a:ja'].map(m => m.id), ['one', 'three']);
  assert.equal(merged.notebooks['a:ja'][0].note, 'local');
  assert.equal(merged.notebooks['a:en'][0].id, 'english');
  assert.equal(mergeSavedDocuments(b, doc(['a'], [mark('one','local')]), doc(['a'], [mark('one','remote')])), null);
  assert.equal(mergeSavedDocuments(doc([], [mark()]), doc(), doc([], [mark('one', 'edit')])), null);
});
test('loading and signed-out responses never substitute another account document', async () => {
  const pending = deferred(); const h = harness(() => pending.promise);
  const read = h.sync.refresh(); assert.equal(h.sync.update(() => doc(['x'])), false);
  pending.resolve(response(401, { ok: false })); await read;
  assert.deepEqual(h.latest, { cloud: null, status: 'guest' });
});
test('serialized edits preserve changes made while the first write is in flight', async () => {
  const write = deferred(); let calls = 0;
  const h = harness(init => !init ? Promise.resolve(response(200,state(0))) : ++calls === 1 ? write.promise : Promise.resolve(response(200,state(2, JSON.parse(init.body).document))));
  await h.sync.refresh(); h.sync.update(() => doc(['a'])); h.sync.update(() => doc(['a','b']));
  assert.ok(h.j.load(account)); write.resolve(response(200,state(1,doc(['a'])))); await tick();
  assert.equal(h.latest.status, 'synced'); assert.deepEqual(h.latest.cloud.document.saved, ['a','b']); assert.equal(h.j.load(account), null);
});
test('a stale device merges distinct changes by CAS without overwriting the server', async () => {
  let writes = 0;
  const h = harness(async init => !init ? response(200,state(0)) : ++writes === 1 ? response(409,state(1,doc(['other']))) : response(200,state(2,JSON.parse(init.body).document)));
  await h.sync.refresh(); h.sync.update(() => doc(['mine'])); await tick();
  assert.equal(h.latest.status, 'synced'); assert.deepEqual(h.latest.cloud.document.saved, ['other','mine']);
});
test('conflicting same-note edits retain the durable draft and stop writing', async () => {
  let writes = 0;
  const h = harness(async init => !init ? response(200,state(1,doc([], [mark()]))) : (writes++, response(409,state(2,doc([], [mark('one','other')])))));
  await h.sync.refresh(); h.sync.update(() => doc([], [mark('one','mine')])); await tick();
  assert.equal(h.latest.status, 'conflict'); assert.equal(h.latest.cloud.document.notebooks['a:ja'][0].note,'mine');
  await h.sync.retry(); assert.equal(writes,1); assert.ok(h.j.load(account));
  assert.equal(h.sync.update(() => doc()), false);
});
test('offline draft survives remount and is sent only for the authenticated account', async () => {
  const j = journal(); const h = harness(async init => { if (init) throw Error('offline'); return response(200,state(0)); }, j);
  await h.sync.refresh(); h.sync.update(() => doc(['mine'])); await tick(); assert.equal(h.latest.status,'error'); h.sync.dispose();
  const other = harness(async () => response(200, { ...state(0), account: 'b'.repeat(64) }), j); await other.sync.refresh(); assert.deepEqual(other.latest.cloud.document,emptySavedDocument());
  const recovered = harness(async init => response(200,init ? state(1,JSON.parse(init.body).document) : state(0)), j);
  await recovered.sync.refresh(); await tick(); assert.equal(recovered.latest.status,'synced'); assert.deepEqual(recovered.latest.cloud.document.saved,['mine']);
});
test('lost acknowledgement followed by newer edits recovers on reload', async () => {
  const j = journal(); const write = deferred(); const h = harness(init => init ? write.promise : Promise.resolve(response(200,state(0,doc([], [mark()])))),j);
  await h.sync.refresh(); h.sync.update(() => doc([], [mark('one','sent')])); h.sync.update(() => doc([], [mark('one','newer')])); h.sync.dispose();
  write.resolve(response(200,state(1,doc([], [mark('one','sent')])))); await tick();
  const recovered = harness(async init => response(200,init ? state(2,JSON.parse(init.body).document) : state(1,doc([], [mark('one','sent')]))),j);
  await recovered.sync.refresh(); await tick(); assert.equal(recovered.latest.status,'synced'); assert.equal(recovered.latest.cloud.document.notebooks['a:ja'][0].note,'newer');
});
test('account switch during write hides the old draft without deleting it', async () => {
  const h = harness(async init => init ? response(409,{ ok:false, error:'account-changed' }) : response(200,state(0)));
  await h.sync.refresh(); h.sync.update(() => doc(['mine'])); await tick();
  assert.equal(h.latest.cloud,null); assert.equal(h.latest.status,'error'); assert.ok(h.j.load(account));
});
test('quota or another tab owning the draft rejects the edit before sending', async () => {
  let writes=0; const h=harness(async init => {if(init) writes++; return response(200,state(0));},{load:()=>null,save:()=>{throw Error('quota');},clear:()=>{}});
  await h.sync.refresh(); assert.equal(h.sync.update(()=>doc(['mine'])),false); assert.equal(writes,0); assert.deepEqual(h.latest.cloud.document.saved,[]);
});
test('undo reverses only the local operation and preserves remote notes', () => {
  const before=doc([], [mark('existing')]);
  const after=doc([], [mark('existing'),mark('local')]);
  const current=doc([], [mark('existing'),mark('local'),mark('remote')]);
  assert.deepEqual(mergeSavedDocuments(after,before,current).notebooks['a:ja'].map(m=>m.id),['existing','remote']);
  assert.equal(mergeSavedDocuments(after,before,doc([], [mark('existing'),mark('local','remote edit')])),null);
});

test('browser migration adds to a populated account, keeps both conflicting notes and is idempotent', () => {
  const cloud = doc(['cloud'], [mark('shared','PCのメモ')]);
  const browser = doc(['phone'], [mark('shared','スマホのメモ')]);
  assert.equal(hasBrowserResearch(cloud,browser),true);
  const merged=importBrowserResearch(cloud,browser,()=> 'imported-phone');
  assert.deepEqual(merged.saved,['cloud','phone']);
  assert.deepEqual(merged.notebooks['a:ja'].map(m=>m.note),['PCのメモ','スマホのメモ']);
  assert.equal(hasBrowserResearch(merged,browser),false);
  assert.deepEqual(importBrowserResearch(merged,browser,()=> 'unused'),merged);
});
