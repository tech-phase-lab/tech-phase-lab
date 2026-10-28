import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaypal, RETURN_URL } from '../services/tech-phase-billing/paypal.mjs';
const config={environment:'sandbox',returnUrl:RETURN_URL,base:'https://api-m.sandbox.paypal.com',clientId:'fixture',secret:'fixture',webhookId:'fixture',plans:{JPY:'P-'+'J'.repeat(24),USD:'P-'+'U'.repeat(24)}};
test('PayPal reads release locks on success, invalid JSON and oversize responses',async()=>{
 for(const payload of ['{}','invalid','x'.repeat(262145)]) {
  let cancelled=0;
  const response=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(payload));if(payload.length<262144)c.close();},cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}});
  const token=Response.json({access_token:'fixture',expires_in:300});
  const api=createPaypal(config,async url=>url.endsWith('/token')?token:response);
  if(payload==='{}')assert.deepEqual(await api.get('I-ABCDEFGHIJKL'),{});
  else await assert.rejects(api.get('I-ABCDEFGHIJKL'),{message:'PAYPAL_UNAVAILABLE'});
  assert.equal(token.body.locked,false);assert.equal(response.body.locked,false);
  assert.equal(cancelled,payload.length>262144?1:0);
 }
});
test('non-JSON provider response is cancelled without exposing its body',async()=>{
 let cancelled=0;
 const response=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('private-provider-data'));},cancel(){cancelled++;}}),{headers:{'content-type':'application/jsonp'}});
 const api=createPaypal(config,async()=>response);
 await assert.rejects(api.get('I-ABCDEFGHIJKL'),{message:'PAYPAL_UNAVAILABLE'});
 assert.equal(cancelled,1);assert.equal(response.body.locked,false);
});
