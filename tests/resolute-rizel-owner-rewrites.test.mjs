import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOwnerRewrites,ownerRewrites,pendingOwnerRewrite} from '../lib/resolute/rizel-owner-rewrites.ts';
import {needsReapproval,eligibleCopies} from '../lib/resolute/rizel-selection.ts';
import {markReapproval} from '../services/resolute-api/rizel-review-store.mjs';
import {rizelRewrite} from '../lib/resolute/risk-copy-check.ts';

// Synthetic ids and texts only: the real RIZEL lines and owner rewrites are private and never enter the repository.
const OWN={ja:'合成テストの直し案その一。',en:'Synthetic owner rewrite one.'};
const OWN2={ja:'合成テストの直し案その二。',en:'Synthetic owner rewrite two.'};
const raw=JSON.stringify({'A-conclusion-91':OWN,'B-reason-92':OWN2});
const entry=(id,text,en,group='A')=>({id,kind:'conclusion',group,revision:1,approval:'approved',publication:'withheld',text,textSha256:'h',english:{text:en,approval:'approved',textSha256:'h',revision:1}});
const quiet=()=>{};

test('owner rewrites: valid JSON is parsed; malformed, oversized and failing entries are ignored with code-only warnings',()=>{
 assert.deepEqual(parseOwnerRewrites(raw,quiet),{'A-conclusion-91':OWN,'B-reason-92':OWN2});
 for(const value of [undefined,'','  ','{','[1]','"text"','null','42'])assert.deepEqual(parseOwnerRewrites(value,quiet),{},String(value));
 const logs=[];const warn=line=>logs.push(line);
 const secretJa='合成の秘密テキスト。',secretEn='Synthetic secret text.',flagged='影響は限定的です。';
 const parsed=parseOwnerRewrites(JSON.stringify({
  'A-conclusion-91':OWN,
  ['not an id '+secretEn]:{ja:secretJa,en:secretEn},
  'A-conclusion-93':{ja:secretJa},
  'A-conclusion-94':{ja:secretJa,en:'x'.repeat(1001)},
  'A-conclusion-95':{ja:'   ',en:secretEn},
  'A-conclusion-96':{ja:flagged,en:secretEn},
  'A-conclusion-97':[secretJa,secretEn],
 }),warn);
 assert.deepEqual(Object.keys(parsed),['A-conclusion-91']);
 assert.equal(logs.length,6);
 for(const line of logs){
  const v=JSON.parse(line);assert.equal(v.event,'RESOLUTE_RIZEL_OWNER_REWRITE_IGNORED');
  for(const text of [secretJa,secretEn,flagged,'not an id','x'.repeat(50)])assert.ok(!line.includes(text),line);
 }
 assert.deepEqual(logs.map(l=>JSON.parse(l).reason),['invalid-id','invalid-text','invalid-text','invalid-text','copy-check','invalid-entry']);
 assert.deepEqual(JSON.parse(logs[4]).codes,['impact-size']);
 const bad=[];parseOwnerRewrites('{"A-conclusion-91":',l=>bad.push(l));assert.deepEqual(bad.map(l=>JSON.parse(l).reason),['invalid-json']);
 // Exactly 1000 characters is accepted.
 assert.equal(parseOwnerRewrites(JSON.stringify({'C-reason-01':{ja:'あ'.repeat(1000),en:'a'.repeat(1000)}}),quiet)['C-reason-01'].en.length,1000);
});

test('owner rewrites: read from the environment, empty when unset, never crash on malformed values',()=>{
 const before=console.warn;const logs=[];console.warn=l=>logs.push(l);
 try{
  assert.deepEqual(ownerRewrites({}),{});
  assert.deepEqual(ownerRewrites({RESOLUTE_RIZEL_OWNER_REWRITES_JSON:raw})['A-conclusion-91'],OWN);
  assert.deepEqual(ownerRewrites({RESOLUTE_RIZEL_OWNER_REWRITES_JSON:'{broken'}),{});
  assert.deepEqual(ownerRewrites({RESOLUTE_RIZEL_OWNER_REWRITES_JSON:'{broken'}),{});
  assert.equal(logs.length,1,'the same value is not re-parsed or re-logged');
 }finally{console.warn=before;}
});

test('owner rewrites: both locales are flagged until each approved text matches, with the owner text as the suggestion',()=>{
 const rewrites=parseOwnerRewrites(raw,quiet);
 // English has no banned wording, Japanese does: both are listed, both suggest the owner rewrite.
 const old=entry('A-conclusion-91','見出しほど、中身は大きくありません。','Synthetic old English line.');
 let m=markReapproval(old,rewrites);
 assert.equal(m.needsReapproval,true);
 assert.deepEqual(m.issues.en,['owner-rewrite']);assert.ok(m.issues.ja.includes('importance')&&m.issues.ja.includes('owner-rewrite'));
 assert.deepEqual(m.suggestion,{ja:OWN.ja,en:OWN.en},'owner rewrite takes precedence over the in-repo rewrite and the general line');
 assert.notEqual(rizelRewrite(old.text,'ja'),OWN.ja);
 assert.equal(needsReapproval(old,rewrites),true);
 // Japanese approved as the owner rewrite: only English remains.
 m=markReapproval({...old,text:OWN.ja},rewrites);
 assert.deepEqual(m.issues,{ja:[],en:['owner-rewrite']});assert.deepEqual(m.suggestion,{ja:null,en:OWN.en});assert.equal(m.needsReapproval,true);
 assert.equal(needsReapproval({...old,text:OWN.ja},rewrites),true);
 // Both approved: no longer flagged.
 const done={...old,text:OWN.ja,english:{...old.english,text:OWN.en}};
 m=markReapproval(done,rewrites);
 assert.equal(m.needsReapproval,false);assert.deepEqual(m.issues,{ja:[],en:[]});assert.deepEqual(m.suggestion,{ja:null,en:null});
 assert.equal(needsReapproval(done,rewrites),false);
 assert.equal(pendingOwnerRewrite(done,'en',rewrites),null);
 // Ids outside the list keep the regex-based behaviour.
 const other=entry('A-conclusion-01','見出しほど、中身は大きくありません。','Synthetic clean English.');
 m=markReapproval(other,rewrites);
 assert.deepEqual(m.issues.en,[]);assert.equal(m.suggestion.en,null);assert.equal(m.suggestion.ja,rizelRewrite(other.text,'ja'));
 assert.equal(markReapproval(entry('A-conclusion-02','合成の問題ない文。','Synthetic fine line.'),rewrites).needsReapproval,false);
 // Without the variable nothing changes for a clean line.
 assert.equal(markReapproval(entry('A-conclusion-91','合成の問題ない文。','Synthetic fine line.'),{}).needsReapproval,false);
});

test('owner rewrites: selection never uses a pair while either locale still differs from the owner rewrite',()=>{
 const rewrites=parseOwnerRewrites(raw,quiet);
 const article={id:'n',revision:'v',stars:1,text:''};
 const bank=[
  entry('A-conclusion-91','合成の古い日本語。','Synthetic old English line.'),
  entry('A-conclusion-02','合成の問題ない文。','Synthetic fine line.'),
 ];
 assert.deepEqual(eligibleCopies(bank,article,[],rewrites).map(e=>e.id),['A-conclusion-02']);
 bank[0]={...bank[0],text:OWN.ja};
 assert.deepEqual(eligibleCopies(bank,article,[],rewrites).map(e=>e.id),['A-conclusion-02'],'old English still blocks the pair');
 bank[0]={...bank[0],english:{...bank[0].english,text:OWN.en}};
 assert.deepEqual(eligibleCopies(bank,article,[],rewrites).map(e=>e.id),['A-conclusion-91','A-conclusion-02']);
 // Without the list the old regex-only rule applies.
 assert.deepEqual(eligibleCopies([entry('A-conclusion-91','合成の古い日本語。','Synthetic old English line.')],article,[],{}).map(e=>e.id),['A-conclusion-91']);
});
