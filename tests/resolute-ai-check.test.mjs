import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {aiCheckRequest} from '../services/resolute-api/ai-check.mjs';
import {createHandler} from '../services/resolute-api/handler.mjs';
import {OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';
const req=(method='POST',body={action:'check'})=>new Request('https://example.test/internal/v1/ai-check',{method,...(method==='POST'?{body:JSON.stringify(body)}:{})});
const env={RESOLUTE_AI_CHECK_ENABLED:'true',RESOLUTE_OPENAI_API_KEY:'test-only-not-a-real-key'};
async function fixture(t,fetcher){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE SCHEMA resolute; CREATE ROLE resolute_risk_writer;');
 await db.exec(await readFile(new URL('../scripts/resolute/ai-check-schema.sql',import.meta.url),'utf8'));
 let calls=0,reservations=0;
 const options={env,poolFactory:()=>db,reserve:async()=>{reservations++;return async()=>{};},fetcher:async(url,options)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');
  const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.reasoning.effort,'none');assert.equal(body.max_output_tokens,128);assert.equal(options.redirect,'error');
  return fetcher?fetcher():Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'RESOLUTE_OK'}]}]});
 }};
 return {db,options,calls:()=>calls,reservations:()=>reservations};
}
test('owner-only, disabled, missing key, invalid input and GET do not call AI',async t=>{
 const f=await fixture(t);
 assert.equal((await aiCheckRequest(req(),'user_other',f.options)).status,403);
 assert.equal((await aiCheckRequest(req(),OWNER_ACCOUNT_ID,{...f.options,env:{}})).status,503);
 assert.equal((await aiCheckRequest(req(),OWNER_ACCOUNT_ID,{...f.options,env:{RESOLUTE_AI_CHECK_ENABLED:'true'}})).status,503);
 assert.equal((await aiCheckRequest(req('POST',{action:'check',prompt:'anything'}),OWNER_ACCOUNT_ID,f.options)).status,400);
 assert.equal((await aiCheckRequest(req('GET'),OWNER_ACCOUNT_ID,f.options)).status,200);
 assert.equal(f.calls(),0);assert.equal(f.reservations(),0);
});
test('concurrent calls and a fresh handler share a durable single claim',async t=>{
 const f=await fixture(t);
 const results=await Promise.all(Array.from({length:8},()=>aiCheckRequest(req(),OWNER_ACCOUNT_ID,f.options)));
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,7);
 assert.equal((await aiCheckRequest(req(),OWNER_ACCOUNT_ID,{...f.options})).status,409);
 const status=await (await aiCheckRequest(req('GET'),OWNER_ACCOUNT_ID,f.options)).json();
 assert.equal(status.state,'verified');assert.equal(status.result.reply,'RESOLUTE_OK');assert.equal(f.calls(),1);assert.equal(f.reservations(),1);
 assert.equal((await f.db.query("SELECT has_table_privilege('resolute_risk_writer','resolute.ai_connection_checks','DELETE') AS allowed")).rows[0].allowed,false);
});
test('provider rejection is classified without echoing credentials or raw response',async t=>{
 const f=await fixture(t,()=>Response.json({error:{message:env.RESOLUTE_OPENAI_API_KEY}},{status:401}));
 const response=await aiCheckRequest(req(),OWNER_ACCOUNT_ID,f.options),body=await response.json();
 assert.equal(body.error,'OPENAI_AUTH_REJECTED');assert.equal(JSON.stringify(body).includes(env.RESOLUTE_OPENAI_API_KEY),false);
 assert.equal((await aiCheckRequest(req(),OWNER_ACCOUNT_ID,f.options)).status,409);assert.equal(f.calls(),1);
});
test('unknown network outcome is never retried',async t=>{
 const f=await fixture(t,()=>{throw Error('network lost');});
 assert.equal((await (await aiCheckRequest(req(),OWNER_ACCOUNT_ID,f.options)).json()).error,'RESPONSE_UNCONFIRMED');
 assert.equal((await aiCheckRequest(req(),OWNER_ACCOUNT_ID,f.options)).status,409);assert.equal(f.calls(),1);
});
test('missing ledger or budget fails closed before an AI request',async t=>{
 const f=await fixture(t);
 const response=await aiCheckRequest(req(),OWNER_ACCOUNT_ID,{...f.options,reserve:async()=>{throw Error('budget unavailable');}});
 assert.equal((await response.json()).modelRequestAttempted,false);assert.equal(f.calls(),0);
 await f.db.exec('DROP TABLE resolute.ai_connection_checks');
 assert.equal((await aiCheckRequest(req(),OWNER_ACCOUNT_ID,f.options)).status,503);assert.equal(f.calls(),0);
});
test('unexpected model output never becomes success or stored provider text',async t=>{
 const f=await fixture(t,()=>Response.json({status:'incomplete',output:[{type:'message',content:[{type:'output_text',text:'private-provider-text'}]}]}));
 const result=await (await aiCheckRequest(req(),OWNER_ACCOUNT_ID,f.options)).json();
 assert.equal(result.ok,false);assert.equal(result.error,'UNEXPECTED_RESPONSE');
 assert.equal(JSON.stringify((await f.db.query('SELECT * FROM resolute.ai_connection_checks')).rows).includes('private-provider-text'),false);
});
test('HTTP route requires authentication and rejects query selectors',async()=>{
 let calls=0;
 const handler=createHandler({},()=>{},async()=>null,undefined,undefined,undefined,undefined,async()=>{calls++;return Response.json({});});
 assert.equal((await handler(req())).status,401);assert.equal(calls,0);
 const authenticated=createHandler({},()=>{},async()=>OWNER_ACCOUNT_ID,undefined,undefined,undefined,undefined,async()=>{calls++;return Response.json({});});
 assert.equal((await authenticated(req())).status,200);
 assert.equal((await authenticated(new Request('https://example.test/internal/v1/ai-check?reset=true'))).status,404);assert.equal(calls,1);
});
