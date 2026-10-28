import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../app/research/identity-provider.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function fixture(signedIn,loaded=true) {
 let calls=0;
 const target={exports:{}};
 new Function('require','module','exports',code)(id=>{
  if(id==='react')return {...require('react'),useCallback:fn=>fn,useRef:initial=>({current:initial})};
  if(id==='@clerk/nextjs')return {ClerkProvider:()=>null,useAuth:()=>({isLoaded:loaded,isSignedIn:signedIn,sessionId:signedIn?'session_fixture':null,getToken:async()=>{calls++;return 'fixture';}})};
  if(id==='@clerk/localizations')return {jaJP:{},enUS:{}};
  if(id==='../resolute/use-diagnosis-session')return {useDiagnosisSessionIdentity:()=>{}};
  if(id==='./use-research-language')return {useResearchLanguage:()=>['ja']};
  if(id==='@/lib/research/member-recovery')return {waitForIdentity:task=>task};
  return require(id);
 },target,target.exports);
 const wrapper=target.exports.default({enabled:true,children:null});
 const session=wrapper.props.children;
 const refresh=session.type(session.props).props.value;
 return {refresh,calls:()=>calls};
}
test('server signed-out hint does not wait for browser SDK/token startup',async()=>{
 const f=fixture(false);await f.refresh(true);assert.equal(f.calls(),0);
});
test('signed-in sessions still renew and share an in-flight request',async()=>{
 const f=fixture(true);await Promise.all([f.refresh(true),f.refresh(true)]);assert.equal(f.calls(),1);
});
test('unknown identity remains unverified without starting token work',async()=>{
 const f=fixture(undefined,false);await assert.rejects(f.refresh(),/identity-loading/);assert.equal(f.calls(),0);
});
