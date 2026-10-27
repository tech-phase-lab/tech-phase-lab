import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

test('email link is removed from the address bar before sign-in and never claims on page load',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'.receive-ui-')),require=createRequire(import.meta.url),React=require('react'),{createRoot}=require('react-dom/client');
 const id='12345678-1234-4234-8234-123456789abc',token='signedbody.'+'a'.repeat(43),dom=new JSDOM('<div id="root"></div>',{url:'https://site.test/resolute/receive?lang=en#'+token});
 const keys=['window','document','fetch','IS_REACT_ACT_ENVIRONMENT','__receiveAuth'],old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 let root;
 try{
  Object.defineProperty(globalThis,'window',{configurable:true,writable:true,value:dom.window});
  Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:dom.window.document});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.__receiveAuth={isLoaded:true,isSignedIn:false,sessionId:null};
  const outfile=join(dir,'screen.cjs');
  await build({entryPoints:['app/resolute/receive/screen.tsx'],outfile,bundle:true,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'},plugins:[{
   name:'clerk-fixture',setup(b){b.onResolve({filter:/^@clerk\/nextjs$/},()=>({path:'clerk',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`
    import React from 'react';
    export const useAuth=()=>globalThis.__receiveAuth;
    export const useUser=()=>({user:{primaryEmailAddress:{emailAddress:'buyer@example.test'}}});
    export const SignIn=()=>{if(window.location.hash)throw Error('Secret exposed to sign-in');return React.createElement('div',{'data-signin':true},'Sign in');};
    export const SignUp=SignIn;`}));},
  }]});
  const Screen=require(outfile).default,calls=[];
  globalThis.fetch=async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return Response.json(url==='/api/resolute/receive'?{ready:true,orderId:id}:{state:'claimed',sandbox:false});};
  root=createRoot(document.getElementById('root'));
  const props={orderId:null,language:'en',hasLink:false,signingUp:false};
  await React.act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(Screen,props))));
  assert.equal(window.location.hash,'');assert.equal(calls.length,1);assert.deepEqual(calls[0].body,{token});
  assert.ok(document.querySelector('[data-signin]'));assert.ok(!document.body.textContent.includes(token));
  globalThis.__receiveAuth={isLoaded:true,isSignedIn:true,sessionId:'sess_first'};
  await React.act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(Screen,props))));
  assert.equal(calls.length,1);assert.ok(document.body.textContent.includes('buyer@example.test'));
  await React.act(async()=>document.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
  assert.equal(calls.length,2);assert.deepEqual(calls[1],{url:'/api/resolute/live-payments/recovery/claim',body:{orderId:id}});
  assert.ok(document.body.textContent.includes('Your purchase is connected'));
  // A different signed-in account must not inherit the success UI.
  globalThis.__receiveAuth={isLoaded:true,isSignedIn:true,sessionId:'sess_other'};
  await React.act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(Screen,props))));
  assert.ok(!document.body.textContent.includes('Your purchase is connected'));
 }finally{
  if(root)await React.act(async()=>root.unmount());dom.window.close();
  for(const [k,v] of old)if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];await rm(dir,{recursive:true,force:true});
 }
});

test('receive session requires same origin, bounded JSON and stores the link only in a secure HttpOnly cookie',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'.receive-api-')),require=createRequire(import.meta.url),old={...process.env};
 const calls=[];globalThis.__receiveCookie=(...args)=>calls.push(args);
 try{
  const outfile=join(dir,'route.cjs');
  await build({entryPoints:['app/api/resolute/receive/route.ts'],outfile,bundle:true,platform:'node',format:'cjs',plugins:[{name:'cookie-fixture',setup(b){
   b.onResolve({filter:/^next\/headers$/},()=>({path:'cookies',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export async function cookies(){return {set:(...args)=>globalThis.__receiveCookie(...args)}}'}));
  }}]});
  const {POST}=require(outfile),id='12345678-1234-4234-8234-123456789abc',token=Buffer.from(JSON.stringify({id})).toString('base64url')+'.'+'b'.repeat(43);
  const request=(origin='https://site.test',body={token})=>POST(new Request('https://site.test/api/resolute/receive',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}));
  delete process.env.RESOLUTE_GUEST_CHECKOUT_ENABLED;assert.equal((await request()).status,503);
  Object.assign(process.env,{RESOLUTE_GUEST_CHECKOUT_ENABLED:'true',RESOLUTE_PAYPAL_LIVE_ENABLED:'true'});
  assert.equal((await request('https://attacker.test')).status,403);
  assert.equal((await request(undefined,{token:'x'.repeat(2000)})).status,413);
  assert.equal((await request(undefined,{token,account:'user_thief'})).status,400);
  assert.equal(calls.length,0);
  const response=await request();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(await response.json(),{ready:true,orderId:id});
  assert.deepEqual(calls[0],['__Host-resolute-recovery',token,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:30*86400}]);
 }finally{
  delete globalThis.__receiveCookie;for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);await rm(dir,{recursive:true,force:true});
 }
});
