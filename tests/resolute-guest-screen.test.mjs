import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

test('guest screen: create goes straight to PayPal; back from PayPal it completes by itself, then sign-in and explicit claim',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'.guest-screen-')),require=createRequire(import.meta.url);
 const React=require('react'),{createRoot}=require('react-dom/client');
 const dom=new JSDOM('<div id="root"></div>',{url:'https://site.test/resolute/checkout?lang=en'});
 const keys=['window','document','IS_REACT_ACT_ENVIRONMENT','fetch'],before=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 let root;
 try {
  Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:dom.window});
  Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const outfile=join(dir,'screen.cjs');
  await build({entryPoints:['app/resolute/checkout/live-screen.tsx'],outfile,bundle:true,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'}});
  const Screen=require(outfile).default,id='12345678-1234-4234-8234-123456789abc',calls=[];
  let paid=false,claimed=false,approved=false;const went=[],captures=[];
  const order=()=>({orderId:id,sandbox:false,state:paid?'paid':'created',claimRequired:!claimed,expiresAt:'2026-10-27T07:00:00Z',...(approved && !paid ? {approved:true} : {}),
   approvalUrl:paid || approved?null:'https://www.paypal.com/checkoutnow?token=ORDER12345678',quote:{kind:'initial',language:'en',currency:'USD',value:'59.00',priceClass:'launch'}});
  globalThis.fetch=async(url,options)=>{
   calls.push(String(url));
   if(String(url).endsWith('/session'))return Response.json({ready:true,sandbox:false});
   if(String(url).endsWith('/capture')){captures.push(JSON.parse(options.body));paid=true;return Response.json({state:'paid',sandbox:false});}
   if(String(url).endsWith('/claim')){assert.deepEqual(JSON.parse(options.body),{orderId:id});claimed=true;return Response.json({state:'claimed',sandbox:false});}
   return Response.json(order());
  };
  root=createRoot(document.getElementById('root'));
  const props={orderId:null,language:'en',cancelled:false,salesEnabled:true,guest:true,navigate:url=>went.push(url),
   signIn:orderId=>React.createElement('div',{'data-login-order':orderId},'Account form')};
  const click=async text=>{
   const button=[...document.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(button,text);assert.equal(button.disabled,false);
   await React.act(async()=>{button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});
  };
  await React.act(async()=>root.render(React.createElement(Screen,props)));
  // First purchase only: no purchase-type choice and no renewal explanation (owner, Nov 2026).
  assert.equal(document.querySelector('select'),null);
  assert.ok(!/renewal eligibility|Sign in for annual renewal|Purchase type/.test(document.body.textContent));
  // Lawyer review (Nov 24): without the consent tick nothing is sent and the red line shows under the button.
  await click('Pay with PayPal');
  assert.deepEqual(calls,[]);
  assert.equal(document.querySelector('[data-consent-error]').textContent,'Please check the box to agree');
  await React.act(async()=>{document.querySelector('[data-consent] input').click();});
  assert.equal(document.querySelector('[data-consent-error]'),null);
  await click('Pay with PayPal');
  assert.deepEqual(calls,['/api/resolute/live-payments/guest/session','/api/resolute/live-payments/guest/orders']);
  assert.equal(new URL(window.location.href).searchParams.get('order'),id);
  assert.equal(new URL(window.location.href).searchParams.get('guest'),'1');
  // Straight on to PayPal: no order summary, no second tick, no final button on our side (owner, Nov 24).
  assert.deepEqual(went,['https://www.paypal.com/checkoutnow?token=ORDER12345678']);
  assert.ok(!document.body.textContent.includes('Agree to the Terms and buy'));
  // PayPal sends the buyer back with the payment approved: the screen completes it by itself, once, with no consent field
  // (the server uses the consent ticked when the order was created), and shows the short thank-you and the account prompt.
  approved=true;
  await React.act(async()=>root.render(React.createElement(Screen,{...props,key:'returned',orderId:id})));
  await React.act(async()=>{await new Promise(r=>setTimeout(r,0));});
  assert.deepEqual(captures,[{orderId:id}]);
  assert.ok(document.body.textContent.includes('Thank you'));
  assert.ok(document.body.textContent.includes('Your payment is complete.'));
  assert.equal(document.querySelector('[data-consent]'),null);
  assert.equal(document.querySelector('[data-login-order]').getAttribute('data-login-order'),id);
  assert.equal(claimed,false);
  // Reload/login remount recovers from the returned order, without another capture.
  await React.act(async()=>root.render(React.createElement(Screen,{...props,key:'signed-in',orderId:id,signedIn:true,accountLabel:'buyer@example.test',salesEnabled:false})));
  assert.ok(document.body.textContent.includes('buyer@example.test'));
  assert.equal(calls.filter(x=>x.endsWith('/capture')).length,1);
  await click('Connect to this account');
  assert.equal(claimed,true);
  assert.ok([...document.querySelectorAll('a')].some(a=>a.textContent==='Start the rules quiz →'));
 } finally {
  if(root)await React.act(async()=>root.unmount());dom.window.close();
  for(const [key,descriptor] of before)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  await rm(dir,{recursive:true,force:true});
 }
});
