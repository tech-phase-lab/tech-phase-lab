import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

test('guest screen preserves order through create, payment, sign-in prompt, reload and explicit account claim',async()=>{
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
  let paid=false,claimed=false;
  const order=()=>({orderId:id,sandbox:false,state:paid?'paid':'created',claimRequired:!claimed,expiresAt:'2026-10-27T07:00:00Z',
   approvalUrl:paid?null:'https://www.paypal.com/checkoutnow?token=ORDER12345678',quote:{kind:'initial',language:'en',currency:'USD',value:'59.00',priceClass:'launch'}});
  globalThis.fetch=async(url,options)=>{
   calls.push(String(url));
   if(String(url).endsWith('/session'))return Response.json({ready:true,sandbox:false});
   if(String(url).endsWith('/capture')){paid=true;return Response.json({state:'paid',sandbox:false});}
   if(String(url).endsWith('/claim')){assert.deepEqual(JSON.parse(options.body),{orderId:id});claimed=true;return Response.json({state:'claimed',sandbox:false});}
   return Response.json(order());
  };
  root=createRoot(document.getElementById('root'));
  const props={orderId:null,language:'en',cancelled:false,salesEnabled:true,guest:true,
   signIn:orderId=>React.createElement('div',{'data-login-order':orderId},'Account form')};
  const click=async text=>{
   const button=[...document.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(button,text);assert.equal(button.disabled,false);
   await React.act(async()=>{button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});
  };
  await React.act(async()=>root.render(React.createElement(Screen,props)));
  assert.equal(document.querySelector('option[value="renewal"]').disabled,true);
  await click('Check price and continue');
  assert.deepEqual(calls,['/api/resolute/live-payments/guest/session','/api/resolute/live-payments/guest/orders']);
  assert.equal(new URL(window.location.href).searchParams.get('order'),id);
  assert.equal(new URL(window.location.href).searchParams.get('guest'),'1');
  await click('Complete payment');
  assert.equal(document.querySelector('[data-login-order]').getAttribute('data-login-order'),id);
  assert.equal(claimed,false);
  // Reload/login remount recovers from the returned order, without another capture.
  await React.act(async()=>root.render(React.createElement(Screen,{...props,key:'signed-in',orderId:id,signedIn:true,accountLabel:'buyer@example.test',salesEnabled:false})));
  assert.ok(document.body.textContent.includes('buyer@example.test'));
  assert.equal(calls.filter(x=>x.endsWith('/capture')).length,1);
  await click('Connect to this account');
  assert.equal(claimed,true);
  assert.ok([...document.querySelectorAll('a')].some(a=>a.textContent==='Open RESOLUTE'));
 } finally {
  if(root)await React.act(async()=>root.unmount());dom.window.close();
  for(const [key,descriptor] of before)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  await rm(dir,{recursive:true,force:true});
 }
});
