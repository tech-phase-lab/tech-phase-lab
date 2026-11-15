import test from 'node:test';
import assert from 'node:assert/strict';
import {preferencesFailure,preferencesNextStep,PREFERENCES_RETRIES} from '../lib/research/preferences-load.ts';

const base={aborted:false,hidden:false,online:true};
test('reason codes say why a preferences read failed and carry nothing personal',()=>{
 assert.equal(preferencesFailure({...base,aborted:true,error:new DOMException('x','AbortError')}),'aborted');
 assert.equal(preferencesFailure({...base,aborted:true,timedOut:true,error:new DOMException('x','TimeoutError')}),'timeout');
 assert.equal(preferencesFailure({...base,aborted:true,timedOut:true,hidden:true,error:new DOMException('x','TimeoutError')}),'aborted');
 assert.equal(preferencesFailure({...base,error:new DOMException('x','AbortError')}),'interrupted');
 assert.equal(preferencesFailure({...base,hidden:true,error:new TypeError('Load failed')}),'interrupted');
 assert.equal(preferencesFailure({...base,online:false,error:new TypeError('Load failed')}),'offline');
 assert.equal(preferencesFailure({...base,error:new TypeError('Load failed')}),'network');
 assert.equal(preferencesFailure({...base,error:new SyntaxError('json')}),'bad-response');
 assert.equal(preferencesFailure({...base,status:401}),'sign-in');
 assert.equal(preferencesFailure({...base,status:503,body:{ok:false}}),'http-503');
 assert.equal(preferencesFailure({...base,status:200,body:{ok:false,error:'not-registered'}}),'refused-not-registered');
 assert.equal(preferencesFailure({...base,status:200,body:{ok:false,error:'<script>'}}),'bad-response');
 assert.equal(preferencesFailure({...base,status:200,body:{ok:true}}),'bad-response');
});
test('cut-off reads wait or retry but are never shown; server failures are shown only after the retries',()=>{
 for(const failure of ['aborted','offline'])for(let attempt=0;attempt<5;attempt++)assert.equal(preferencesNextStep(failure,attempt),'wait');
 for(let attempt=0;attempt<5;attempt++)assert.notEqual(preferencesNextStep('interrupted',attempt),'show');
 assert.equal(preferencesNextStep('interrupted',0,true),'wait');assert.equal(preferencesNextStep('interrupted',0,false),'retry');
 for(const failure of ['http-503','network','timeout','bad-response']){
  for(let attempt=0;attempt<PREFERENCES_RETRIES;attempt++)assert.equal(preferencesNextStep(failure,attempt),'retry');
  assert.equal(preferencesNextStep(failure,PREFERENCES_RETRIES),'show');
 }
 assert.equal(preferencesNextStep('sign-in',0),'renew');assert.equal(preferencesNextStep('sign-in',1),'show');
 assert.equal(preferencesNextStep('refused-not-registered',0),'show');assert.equal(preferencesNextStep('http-403',0),'show');
});
