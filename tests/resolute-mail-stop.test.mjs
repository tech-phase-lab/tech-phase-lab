import test from 'node:test';
import assert from 'node:assert/strict';
import {createClerkNotificationRecipient} from '../lib/resolute/notification-recipient.ts';
import {createMailStopTokens,InvalidStopToken,mailStopLinks} from '../lib/resolute/notification-stop-token.ts';
import {createMailStopPage,forwardMailStop} from '../lib/resolute/notification-stop-page.ts';
import {createMailStopService,mailStopRequest} from '../lib/resolute/notification-stop-service.ts';
import {createHandler} from '../services/resolute-api/handler.mjs';
const epoch=Date.parse('2027-02-03T22:00:00Z'),key=Buffer.alloc(32,7);
const tokens=createMailStopTokens(key,()=>epoch),token=tokens.issue('user_buyer','en');
const origin='https://app.test',path=origin+'/resolute/unsubscribe',secret='s'.repeat(43);
const form=(body,source=origin)=>new Request(path+'?lang=en',{method:'POST',headers:{Origin:source,'Content-Type':'application/x-www-form-urlencoded'},body});
const body=()=>new URLSearchParams({token,confirm:'stop'});
test('recipient uses fresh verified primary Clerk email and configured preferences only',async()=>{
 let calls=0;
 let user={id:'user_buyer',primaryEmailAddressId:'primary',emailAddresses:[{id:'primary',emailAddress:'primary@example.test',verification:{status:'verified'}},{id:'secondary',emailAddress:'secondary@example.test',verification:{status:'verified'}}],publicMetadata:{locale:'en',timezone:'UTC',email:'spoof@example.test'}};
 const read=createClerkNotificationRecipient({users:{getUser:async id=>{assert.equal(id,'user_buyer');calls++;return user;}}});
 const valid=structuredClone(user);
 assert.deepEqual(await read('user_buyer'),{userId:'user_buyer',email:'primary@example.test',verified:true,preferencesConfigured:true,unsubscribed:false,locale:'en'});
 for(const patch of [{primaryEmailAddressId:'absent'},{banned:true},{locked:true},{emailAddresses:[valid.emailAddresses[1]]},{emailAddresses:[{...valid.emailAddresses[0],verification:{status:'unverified'}}]},{emailAddresses:[{...valid.emailAddresses[0],emailAddress:'a@example.test\r\nBcc:other@example.test'}]}]){
  user={...valid,...patch};const r=await read('user_buyer');assert.equal(r.verified,false);assert.equal(r.email,'');
 }
 user={...valid,publicMetadata:{locale:'en'}};assert.equal((await read('user_buyer')).preferencesConfigured,false);
 user={...valid,id:'user_other'};await assert.rejects(()=>read('user_buyer'),/mismatch/);assert.equal(calls,9);
 await assert.rejects(()=>read('invalid'),/identity/);assert.equal(calls,9);
 const failed=createClerkNotificationRecipient({users:{getUser:async()=>{throw Error('offline');}}});await assert.rejects(()=>failed('user_buyer'));
});
test('stop capabilities are randomized, encrypted, authenticated, bounded and expire',()=>{
 assert.deepEqual(tokens.verify(token),{userId:'user_buyer',locale:'en'});
 assert.notEqual(tokens.issue('user_buyer','en'),token);assert.ok(!Buffer.from(token.slice(3),'base64url').includes(Buffer.from('user_buyer')));
 for(const bad of [null,'',token+'=',token.slice(0,-5)+'AAAAA','u2.'+token.slice(3),'u1.'+'a'.repeat(1001)])assert.throws(()=>tokens.verify(bad),InvalidStopToken);
 assert.throws(()=>createMailStopTokens(Buffer.alloc(32,8),()=>epoch).verify(token),InvalidStopToken);
 assert.throws(()=>createMailStopTokens(key,()=>epoch-1000).verify(token),InvalidStopToken);
 assert.throws(()=>createMailStopTokens(key,()=>epoch+366*86400000).verify(token),InvalidStopToken);
 assert.throws(()=>tokens.issue('user_buyer:other','en'));assert.throws(()=>createMailStopTokens(Buffer.alloc(16)));
 const links=mailStopLinks(origin,tokens,'user_buyer','ja');const url=new URL(links.unsubscribeUrl);
 assert.equal(links.planUrl,origin+'/resolute/notebook');assert.equal(url.pathname,'/resolute/unsubscribe');assert.equal(url.searchParams.get('lang'),'ja');assert.equal(tokens.verify(url.searchParams.get('token')).userId,'user_buyer');
 for(const bad of ['http://app.test',origin+'/sub',origin+'/',origin+'?a=1'])assert.throws(()=>mailStopLinks(bad,tokens,'user_buyer','en'));
});
test('GET scanners cannot stop mail; explicit same-origin confirmation is required',async()=>{
 let calls=0;const page=createMailStopPage({enabled:()=>true,forward:async value=>{calls++;assert.equal(value,token);return true;}});
 const preview=await page.GET(new Request(path+'?token='+token+'&lang=en'));
 assert.equal(preview.status,200);assert.match(await preview.text(),/Stop emails/);assert.equal(calls,0);
 assert.equal(preview.headers.get('referrer-policy'),'no-referrer');assert.match(preview.headers.get('cache-control'),/no-store/);assert.match(preview.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 for(const query of ['?token=%22%3E%3Cscript%3E','?token='+token+'&token='+token,'?token='+token+'&email=x','?token='+token+'&lang=fr'])assert.equal((await page.GET(new Request(path+query))).status,400);
 for(const invalid of [new URLSearchParams({token}),new URLSearchParams({token,confirm:'yes'}),body().toString()+'&token='+token,body().toString()+'&userId=user_other','token='+'a'.repeat(3000)])assert.equal((await page.POST(form(invalid))).status,400);
 assert.equal((await page.POST(form(body(),'https://evil.test'))).status,400);assert.equal(calls,0);
 assert.equal((await page.POST(form(body()))).status,200);assert.equal(calls,1);
 const disabled=createMailStopPage({enabled:()=>false,forward:async()=>{throw Error('must not call');}});assert.equal((await disabled.GET(new Request(path+'?token='+token))).status,503);assert.equal((await disabled.POST(form(body()))).status,503);
 for(const [forward,status] of [[async()=>false,400],[async()=>{throw Error('private');},503]]){const r=await createMailStopPage({enabled:()=>true,forward}).POST(form(body()));assert.equal(r.status,status);assert.ok(!(await r.text()).includes('private'));}
});
test('public confirmation forwards only stop capability through service auth, without Clerk session',async()=>{
 let stopped=[];let sessions=0;
 const service=createMailStopService(tokens.verify,async id=>{stopped.push(id);return {stopped:true};});
 const handler=createHandler({serviceToken:secret},async()=>{},async()=>{sessions++;throw Error('no session');},undefined,undefined,undefined,undefined,undefined,service);
 const transport=async(url,init)=>{assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.headers.Authorization,undefined);return handler(new Request(url,init));};
 const page=createMailStopPage({enabled:()=>true,forward:t=>forwardMailStop(t,'https://resolute.up.railway.app',secret,transport)});
 assert.equal((await page.POST(form(body()))).status,200);assert.deepEqual(stopped,['user_buyer']);assert.equal(sessions,0);
 assert.equal((await handler(new Request('https://service/internal/v1/notification-stop',{method:'POST',body:JSON.stringify({token})}))).status,401);
 assert.equal((await handler(new Request('https://service/internal/v1/notification-stop'))).status,405);
 const request=value=>new Request('https://service/internal/v1/notification-stop',{method:'POST',headers:{'X-Resolute-Service-Token':secret,'Content-Type':'application/json'},body:JSON.stringify(value)});
 assert.equal((await handler(request({token,userId:'user_other'}))).status,400);
 assert.equal((await handler(request({token:'u1.'+'a'.repeat(40)}))).status,400);assert.deepEqual(stopped,['user_buyer']);
 assert.equal(await forwardMailStop('u1.'+'a'.repeat(40),'https://resolute.up.railway.app',secret,transport),false);
 const fail=createMailStopService(tokens.verify,async()=>{throw Error('db secret');});const r=await fail(request({token}));assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'STOP_UNAVAILABLE'});
});
test('forwarder fails closed on untrusted destinations, malformed responses and disabled runtime',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json({stopped:true});};
 for(const base of ['http://resolute.up.railway.app','https://evil.test','https://resolute.up.railway.app.evil.test','https://u:p@resolute.up.railway.app','https://resolute.up.railway.app/path'])await assert.rejects(()=>forwardMailStop(token,base,secret,fetcher));assert.equal(calls,0);
 for(const response of [()=>Response.json({stopped:false}),()=>Response.json({stopped:true,extra:1}),()=>Response.json({error:'offline'},{status:503}),()=>new Response('bad')])await assert.rejects(()=>forwardMailStop(token,'https://resolute.up.railway.app',secret,async()=>response()));
 const previous=process.env.RESOLUTE_MAIL_STOP_ENABLED;delete process.env.RESOLUTE_MAIL_STOP_ENABLED;
 try{assert.equal((await mailStopRequest(new Request(path))).status,503);}finally{if(previous!==undefined)process.env.RESOLUTE_MAIL_STOP_ENABLED=previous;}
});
