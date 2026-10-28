import test from 'node:test';
import assert from 'node:assert/strict';
import { reactionState } from '../app/research/desk/reaction-state.ts';
const initial=()=>({like:{count:0,selected:false},sad:{count:2,selected:false},angry:{count:0,selected:false}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('tap updates before network and fast undo survives the first late response',async()=>{
 let shown;const calls=[];
 const state=reactionState(initial(),value=>shown=value,(key,selected)=>new Promise(resolve=>calls.push({key,selected,resolve})),()=>assert.fail());
 state.toggle('like');assert.equal(shown.like.count,1);assert.equal(shown.like.selected,true);
 state.toggle('like');assert.equal(shown.like.count,0);
 calls[0].resolve({...initial(),like:{count:1,selected:true}});await tick();
 assert.equal(shown.like.count,0);assert.equal(calls.length,2);assert.equal(calls[1].selected,false);
 calls[1].resolve(initial());await tick();assert.equal(shown.like.count,0);
});
test('a newer choice immediately replaces the old one and survives a failed earlier save',async()=>{
 let shown,errors=0;const calls=[];
 const state=reactionState(initial(),value=>shown=value,(key,selected)=>new Promise((resolve,reject)=>calls.push({key,selected,resolve,reject})),()=>errors++);
 state.toggle('like');state.toggle('sad');state.toggle('angry');
 assert.equal(shown.like.count,0);assert.equal(shown.sad.count,2);assert.equal(shown.angry.count,1);
 calls[0].reject(Error());await tick();assert.equal(errors,1);assert.equal(shown.angry.selected,true);
 assert.equal(calls.length,2);assert.equal(calls[1].key,'angry');
 calls[1].resolve({...initial(),angry:{count:1,selected:true}});await tick();
 assert.equal(Object.values(shown).filter(v=>v.selected).length,1);
 state.toggle('sad');assert.equal(shown.angry.count,0);assert.equal(shown.sad.count,3);
 calls[2].reject(Error());await tick();assert.equal(shown.angry.selected,true);assert.equal(shown.sad.selected,false);
});
test('switching choice while a request is pending never flashes the previous choice',async()=>{
 let shown;const calls=[];
 const state=reactionState(initial(),value=>shown=value,(key,selected)=>new Promise(resolve=>calls.push({key,selected,resolve})),()=>assert.fail());
 state.toggle('like');state.toggle('sad');
 calls[0].resolve({...initial(),like:{count:1,selected:true}});await tick();
 assert.equal(shown.like.selected,false);assert.equal(shown.like.count,0);assert.equal(shown.sad.count,3);
 calls[1].resolve({...initial(),sad:{count:3,selected:true}});await tick();
 assert.equal(shown.sad.selected,true);
});
test('A then B then undo B before A responds clears the actually saved vote',async()=>{
 let shown;const calls=[];
 const state=reactionState(initial(),value=>shown=value,(key,selected)=>new Promise(resolve=>calls.push({key,selected,resolve})),()=>assert.fail());
 state.toggle('like');state.toggle('sad');state.toggle('sad');
 assert.equal(Object.values(shown).filter(v=>v.selected).length,0);
 calls[0].resolve({...initial(),like:{count:1,selected:true}});await tick();
 assert.equal(calls[1].key,'like');assert.equal(calls[1].selected,false);
 calls[1].resolve(initial());await tick();
 assert.equal(Object.values(shown).filter(v=>v.selected).length,0);
});
