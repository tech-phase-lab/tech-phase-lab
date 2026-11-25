import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defaultNotificationSettings,parseNotificationSnapshot} from '../lib/resolute/notification-settings.ts';
import {fetchNotificationSettings} from '../lib/resolute/notification-http.ts';
import {notificationDeliveryLive,NOTIFICATION_DELIVERY_HEADER} from '../lib/resolute/notification-delivery-state.ts';
import {withRizelLine,rizelLinePublished} from '../lib/resolute/rizel-line.ts';
import {renewalHref} from '../lib/resolute/renewal-link.ts';
import {OWNER_ACCOUNT_ID,PRODUCTION_OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';
import {createHandler} from '../services/resolute-api/handler.mjs';

const settings=defaultNotificationSettings();
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('delivery is live only when both cron switches are on, and only for the test allowlist while it is set',()=>{
 const on={RESOLUTE_NOTIFICATION_QUEUE_ENABLED:'true',RESOLUTE_MAIL_DELIVERY_ENABLED:'true'};
 assert.equal(notificationDeliveryLive({},'user_a'),false);
 assert.equal(notificationDeliveryLive({RESOLUTE_NOTIFICATION_QUEUE_ENABLED:'true'},'user_a'),false);
 assert.equal(notificationDeliveryLive({RESOLUTE_MAIL_DELIVERY_ENABLED:'true'},'user_a'),false);
 assert.equal(notificationDeliveryLive({...on,RESOLUTE_MAIL_DELIVERY_ENABLED:'1'},'user_a'),false);
 assert.equal(notificationDeliveryLive(on,'user_a'),true);
 assert.equal(notificationDeliveryLive({...on,RESOLUTE_NOTIFICATION_QUEUE_ONLY_USER_IDS:'user_owner, user_b'},'user_a'),false);
 assert.equal(notificationDeliveryLive({...on,RESOLUTE_NOTIFICATION_QUEUE_ONLY_USER_IDS:'user_owner, user_b'},'user_b'),true);
});

test('resolute-api reports delivery in a header and the frontend turns it into delivery:true',async()=>{
 const saved={...process.env};
 try{
  const handler=createHandler({},async()=>{},async()=>'user_buyer',undefined,async()=>({settings,revision:2}));
  const call=()=>fetchNotificationSettings('jwt','https://resolute.up.railway.app','x'.repeat(43),'GET',undefined,async(url,init)=>handler(new Request(url,init)));
  delete process.env.RESOLUTE_NOTIFICATION_QUEUE_ENABLED;delete process.env.RESOLUTE_MAIL_DELIVERY_ENABLED;delete process.env.RESOLUTE_NOTIFICATION_QUEUE_ONLY_USER_IDS;
  const raw=await handler(new Request('https://service/internal/v1/notification-settings',{headers:{}}));
  assert.equal(raw.headers.get(NOTIFICATION_DELIVERY_HEADER),'off');assert.deepEqual(await raw.json(),{settings,revision:2});
  assert.deepEqual((await call()).body,{settings,revision:2});
  process.env.RESOLUTE_NOTIFICATION_QUEUE_ENABLED='true';process.env.RESOLUTE_MAIL_DELIVERY_ENABLED='true';
  assert.deepEqual((await call()).body,{settings,revision:2,delivery:true});
  process.env.RESOLUTE_NOTIFICATION_QUEUE_ONLY_USER_IDS='user_owner';
  assert.deepEqual((await call()).body,{settings,revision:2});
 }finally{for(const k of ['RESOLUTE_NOTIFICATION_QUEUE_ENABLED','RESOLUTE_MAIL_DELIVERY_ENABLED','RESOLUTE_NOTIFICATION_QUEUE_ONLY_USER_IDS']){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
 // A body-level claim from the service is never trusted: only the header counts.
 const forged=await fetchNotificationSettings('jwt','https://resolute.up.railway.app','x'.repeat(43),'GET',undefined,async()=>Response.json({settings,revision:1,delivery:true}));
 assert.deepEqual(forged.body,{settings,revision:1});
 assert.deepEqual(parseNotificationSnapshot({settings,revision:1,delivery:true}),{settings,revision:1,delivery:true});
 assert.throws(()=>parseNotificationSnapshot({settings,revision:1,delivery:false}));
 assert.throws(()=>parseNotificationSnapshot({settings,revision:1,extra:true}));
});

test('the 「通知の配信は準備中です」 line depends on the reported delivery state',()=>{
 const screen=read('app/resolute/notifications-screen.tsx');
 const line=screen.split('\n').find(l=>l.includes('通知の配信は準備中です'));
 assert.ok(line?.includes('snapshot?.delivery?'),'the preparing line must be conditional');
});

test('RIZELの一言 reaches members only when RESOLUTE_RIZEL_LINE_PUBLISHED=true; owner accounts always',()=>{
 const feed={state:'ready',date:'2026-11-25',articles:[],quotes:[{id:'q'}]};
 assert.deepEqual(withRizelLine(feed,'user_member',{}),{...feed,quotes:[]});
 assert.deepEqual(withRizelLine(feed,'user_member',{RESOLUTE_RIZEL_LINE_PUBLISHED:'1'}),{...feed,quotes:[]});
 assert.equal(withRizelLine(feed,'user_member',{RESOLUTE_RIZEL_LINE_PUBLISHED:'true'}),feed);
 for(const owner of [OWNER_ACCOUNT_ID,PRODUCTION_OWNER_ACCOUNT_ID]){assert.equal(rizelLinePublished(owner,{}),true);assert.equal(withRizelLine(feed,owner,{}),feed);}
 assert.deepEqual(withRizelLine({error:'NOTIFICATION_ENTITLEMENT_REQUIRED'},'user_member',{}),{error:'NOTIFICATION_ENTITLEMENT_REQUIRED'});
 const proxy=read('lib/resolute/risk-proxy.ts');assert.match(proxy,/withRizelLine\(value,session\.userId\)/);
 const news=read('app/resolute/news/screen.tsx');assert.match(news,/feed\?\.quotes\.find\(q=>q\.id===article\.quoteId/);
});

test('expired members get the renewal checkout link instead of a disabled button',()=>{
 assert.equal(renewalHref('ja'),'/resolute/checkout?lang=ja&kind=renewal');
 assert.equal(renewalHref('en'),'/resolute/checkout?lang=en&kind=renewal');
 for(const path of ['app/resolute/home/screen.tsx','app/resolute/news/screen.tsx']){
  const source=read(path);
  assert.ok(!source.includes('更新の受付は準備中です'),path);assert.ok(!source.includes('not open yet'),path);
  assert.match(source,/href=\{renewalHref\(locale\)\}/,path);
 }
 // The account screen opens the same renewal checkout, where the consent tick is required before an order is created.
 assert.match(read('app/research/account/account-view.tsx'),/\/resolute\/checkout\?lang=ja&kind=renewal/);
 assert.match(read('app/resolute/checkout/live-screen.tsx'),/consent\.require\(\)/);
});
