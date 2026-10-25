import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDiagnosisDraft, draftFromPlan } from '../lib/resolute/diagnosis-form.ts';
import { createReviewSamplePlan } from '../lib/resolute/review-sample.ts';
import { readDiagnosisSession, writeDiagnosisSession, clearDiagnosisSession, DIAGNOSIS_SESSION_TTL } from '../lib/resolute/diagnosis-session.ts';
import { reconcileDiagnosisSession, diagnosisSessionPrefix } from '../lib/resolute/diagnosis-session-identity.ts';
const now=1792900000000;
function storage(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),m};}
function record(){const draft=emptyDiagnosisDraft();draft.answers.q01='first';return {session:'session-a',channel:'preview',expiresAt:now+DIAGNOSIS_SESSION_TTL,draft,baseline:'null',mode:'questions',index:1,locked:false,active:true,locale:'ja'};}
test('tab draft preserves answer, current question, locale and preview entry across reload',()=>{
 const s=storage(),value=record();value.locale='en';assert.equal(writeDiagnosisSession(value,s,now),true);
 assert.deepEqual(readDiagnosisSession('session-a','preview',s,now+1000),value);
 assert.equal(readDiagnosisSession('session-a','preview',storage(),now),null,'another tab has no draft');
 assert.equal(readDiagnosisSession('session-a','live',s,now),null,'preview never becomes a live draft');
});
test('partial number and optional text remain editable; impossible result cannot crash the restored page',()=>{
 const s=storage(),value=record();value.draft.answers.q02='custom';value.draft.numbers.q02='12.';
 value.draft.noBuyConditions=['x'.repeat(101)];assert.equal(writeDiagnosisSession(value,s,now),true);
 assert.equal(readDiagnosisSession(value.session,value.channel,s,now).draft.numbers.q02,'12.');
 value.mode='result';assert.equal(writeDiagnosisSession(value,s,now),false);
 assert.equal(readDiagnosisSession(value.session,value.channel,s,now),null);
});
test('valid result and uncertain-save lock survive; explicit clear removes them',()=>{
 const s=storage(),value=record();value.draft=draftFromPlan(createReviewSamplePlan());value.mode='result';value.locked=true;
 assert.equal(writeDiagnosisSession(value,s,now),true);assert.equal(readDiagnosisSession(value.session,value.channel,s,now).locked,true);
 assert.equal(clearDiagnosisSession('preview',s),true);assert.equal(readDiagnosisSession(value.session,value.channel,s,now),null);
});
test('logout, replaced account/session, expiry and corrupt records are removed without touching other settings',()=>{
 for(const action of ['logout','changed','expiry','corrupt']){
  const s=storage();s.setItem('unrelated','keep');writeDiagnosisSession(record(),s,now);
  if(action==='corrupt')s.setItem(diagnosisSessionPrefix+'preview','{');
  reconcileDiagnosisSession(action==='logout'?null:action==='changed'?'session-b':'session-a',s,action==='expiry'?now+DIAGNOSIS_SESSION_TTL:now);
  assert.equal(s.getItem(diagnosisSessionPrefix+'preview'),null,action);assert.equal(s.getItem('unrelated'),'keep');
 }
 const s=storage();writeDiagnosisSession(record(),s,now);reconcileDiagnosisSession('session-a',s,now);
 assert.ok(readDiagnosisSession('session-a','preview',s,now));
 assert.equal(readDiagnosisSession('session-b','preview',s,now),null);
});
test('invalid stored shapes and skipped questions fail closed',()=>{
 for(const edit of [v=>v.index=29,v=>v.draft.answers.q01='forged',v=>v.draft.numbers=null,v=>v.expiresAt=now-1,v=>v.expiresAt=now+DIAGNOSIS_SESSION_TTL+1,v=>v.locale='other']){
  const s=storage(),value=record();edit(value);s.setItem(diagnosisSessionPrefix+'preview',JSON.stringify(value));
  assert.equal(readDiagnosisSession('session-a','preview',s,now),null);assert.equal(s.m.size,0);
 }
});
test('blocked storage is reported; write failure removes stale answers',()=>{
 const s=storage();writeDiagnosisSession(record(),s,now);s.setItem=()=>{throw Error('quota');};
 assert.equal(writeDiagnosisSession(record(),s,now),false);assert.equal(s.m.size,0);
 const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 assert.equal(writeDiagnosisSession(record(),blocked,now),false);assert.equal(readDiagnosisSession('session-a','preview',blocked,now),null);
 assert.doesNotThrow(()=>reconcileDiagnosisSession(null,blocked,now));
});
