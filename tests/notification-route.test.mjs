import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../app/api/research/notifications/route.ts',import.meta.url),'utf8')
 .replace('import { getMembership } from "@/lib/membership/server";', 'const getMembership = async () => globalThis.__pushMember;')
 .replace('"@/lib/membership/entitlements"', JSON.stringify(new URL('../lib/membership/entitlements.ts',import.meta.url).href))
 .replace('"@/lib/research/push-diagnostic"', JSON.stringify(new URL('../lib/research/push-diagnostic.ts',import.meta.url).href))
 .replace('"@/lib/research/push-send-log"', JSON.stringify(new URL('../lib/research/push-send-log.ts',import.meta.url).href))
 .replace('"@/lib/research/push-subscribe"', JSON.stringify(new URL('../lib/research/push-subscribe.ts',import.meta.url).href))
 .replace('"@/lib/research/push-server-notice"', JSON.stringify(new URL('../lib/research/push-server-notice.ts',import.meta.url).href));
const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
test('member notification routes enforce verified identity, expiry and fixed owned-device paths',async()=>{
 const saved={fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
 process.env.RESEARCH_MONITOR_URL='https://monitor.example';process.env.RESEARCH_MONITOR_TOKEN='private';
 const calls=[];
 globalThis.fetch=async(url,options)=>{ calls.push([String(url),options.body?JSON.parse(options.body):null]);return Response.json({ok:true,enabled:true,memberAccessVersion:1,publicKey:'public',registered:true}); };
 const req=(action='register',origin='https://example.test')=>new Request('https://example.test/api/research/notifications',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action,memberId:'user_victim',accessExpiresAt:9999999999999,subscription:{endpoint:'device'}})});
 try {
  assert.equal((await POST(req('register','https://attacker.test'))).status,403);
  for(const [member,status] of [[{status:'unavailable'},503],[{status:'signed-out'},401],[{status:'signed-in',plan:'free'},403],[{status:'signed-in',plan:'pro',accessExpiresAt:0},403]]) {
   globalThis.__pushMember=member;assert.equal((await POST(req())).status,status);
  }
  for (const expiry of [0, Date.now()-1, undefined, NaN]) {
   globalThis.__pushMember={status:'signed-in',plan:'pro',accessExpiresAt:expiry};
   assert.equal((await (await GET()).json()).reason,'pro-required');
  }
  assert.equal(calls.length,0);
  globalThis.__pushMember={status:'signed-in',userId:'user_owner',plan:'pro',accessExpiresAt:Date.now()+60000};
  for(const action of ['register','status','test','remove']) assert.equal((await POST(req(action))).status,200);
  assert.deepEqual(calls.map(c=>c[0]),['register','status','test','remove'].map(a=>'https://monitor.example/push/member/'+a));
  for(const [,body] of calls) { assert.equal(body.memberId,'user_owner');assert.equal(body.accessExpiresAt,globalThis.__pushMember.accessExpiresAt/1000);assert.equal('code' in body,false); }
  assert.equal((await (await GET()).json()).enabled,true);
  globalThis.__pushMember={status:'signed-in',userId:'user_owner',plan:'free',accessExpiresAt:0};
  assert.equal((await POST(req('remove'))).status,200);
  assert.equal((await (await GET()).json()).reason,'pro-required');
  globalThis.__pushMember={status:'signed-out'};
  assert.equal((await (await GET()).json()).reason,'sign-in');
 } finally {globalThis.fetch=saved.fetch;delete globalThis.__pushMember;for(const [key,value] of [['RESEARCH_MONITOR_URL',saved.url],['RESEARCH_MONITOR_TOKEN',saved.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('preference reads and writes require current PRO, preserve partial patches and trusted ownership',async()=>{
 const saved={fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
 process.env.RESEARCH_MONITOR_URL='https://monitor.example';process.env.RESEARCH_MONITOR_TOKEN='fixture';
 const calls=[];const preferences={targets:false,earnings:true,news:true,newsTickers:[],weeklyNotebook:false};
 globalThis.fetch=async(url,options)=>{calls.push({url:String(url),body:JSON.parse(options.body)});return Response.json({ok:true,preferences});};
 const req=(action,patch,origin='https://example.test')=>new Request('https://example.test/api/research/notifications',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action,subscription:{endpoint:'fixture'},preferences:patch,memberId:'user_other',accessExpiresAt:9999999999999})});
 try {
  for(const action of ['preferences','save-preferences']) {
   for(const [member,status] of [[{status:'signed-out'},401],[{status:'unavailable'},503],[{status:'signed-in',plan:'free'},403],[{status:'signed-in',plan:'pro',accessExpiresAt:0},403]]) {
    globalThis.__pushMember=member;assert.equal((await POST(req(action,{targets:false}))).status,status);
   }
   globalThis.__pushMember={status:'signed-in',userId:'user_owner',plan:'pro',accessExpiresAt:Date.now()+60000};
   assert.equal((await POST(req(action,{targets:false},'https://elsewhere.test'))).status,403);
  }
  assert.equal(calls.length,0);
  const read=await POST(req('preferences'));assert.deepEqual(await read.json(),{ok:true,preferences});assert.match(read.headers.get('cache-control'),/no-store/);
  const write=await POST(req('save-preferences',{newsTickers:[]}));assert.equal(write.status,200);
  assert.deepEqual(calls.map(c=>c.url),['preferences','save-preferences'].map(a=>'https://monitor.example/push/member/'+a));
  for(const c of calls){assert.equal(c.body.memberId,'user_owner');assert.equal(c.body.accessExpiresAt,globalThis.__pushMember.accessExpiresAt/1000);assert.equal('weeklyNotebook' in c.body,false);}
  assert.deepEqual(calls[1].body.preferences,{newsTickers:[]});
 } finally {globalThis.fetch=saved.fetch;delete globalThis.__pushMember;for(const [key,value] of [['RESEARCH_MONITOR_URL',saved.url],['RESEARCH_MONITOR_TOKEN',saved.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('a monitor refusal with a known reason reaches the screen; anything else stays a generic failure', async () => {
 const saved={fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
 process.env.RESEARCH_MONITOR_URL='https://monitor.example';process.env.RESEARCH_MONITOR_TOKEN='fixture';
 const req=()=>new Request('https://example.test/api/research/notifications',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({action:'test',subscription:{endpoint:'https://push.example/x'}})});
 try {
  globalThis.__pushMember={status:'signed-in',userId:'user_owner',plan:'pro',accessExpiresAt:Date.now()+60000};
  for (const [status,body,expected] of [[400,{ok:false,error:'not-owned'},'not-owned'],[400,{ok:false,error:'expired-membership'},'expired-membership'],
    [400,{ok:false,error:'https://push.example/secret'},undefined],[503,{ok:false,error:'not-owned'},undefined]]) {
   globalThis.fetch=async()=>Response.json(body,{status});
   const response=await POST(req());
   const json=await response.json();
   assert.equal(json.error,expected);
   assert.equal(json.ok,false);
  }
 } finally {globalThis.fetch=saved.fetch;delete globalThis.__pushMember;for(const [key,value] of [['RESEARCH_MONITOR_URL',saved.url],['RESEARCH_MONITOR_TOKEN',saved.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('Nov 15: the notification step record is logged for owner accounts only, cleaned, one line, rate limited, never sent on', async () => {
 const {OWNER_ACCOUNT_ID,PRODUCTION_OWNER_ACCOUNT_ID}=await import('../lib/membership/entitlements.ts');
 const saved={fetch:globalThis.fetch,info:console.info};
 const calls=[],lines=[];
 globalThis.fetch=async(...args)=>{calls.push(args);return Response.json({ok:true});};
 console.info=(...args)=>lines.push(args.join(' '));
 const at=Date.UTC(2026,10,15,12,0,0);
 const record={v:'2026-11-15-inapp-banner',id:'n-123',push:at,shown:at+400,listApi:true,listed:true,foreground:at+9000,query:at+9100,banner:at+9200,
  title:'secret title',url:'/research/news',endpoint:'https://push.example/secret',userId:'user_x',via:'banner',navigated:at+12000,bannerOpen:at+11900,stillListed:'yes'};
 const req=(body,origin='https://example.test')=>new Request('https://example.test/api/research/notifications',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 try {
  for(const [member,status] of [[{status:'signed-out'},401],[{status:'unavailable'},503],
    [{status:'signed-in',userId:'user_member',plan:'pro',accessExpiresAt:Date.now()+60000,isAdmin:true},403],
    [{status:'signed-in',userId:'user_member',plan:'free',accessExpiresAt:0},403]]) {
   globalThis.__pushMember=member;
   assert.equal((await POST(req({action:'diagnostic',record}))).status,status,JSON.stringify(member));
  }
  globalThis.__pushMember={status:'signed-in',userId:OWNER_ACCOUNT_ID,plan:'pro',accessExpiresAt:Date.now()+60000};
  assert.equal((await POST(req({action:'diagnostic',record},'https://elsewhere.test'))).status,403);
  assert.equal(lines.length,0);
  assert.equal((await POST(req({action:'diagnostic',record:{id:'<bad>'}}))).status,400);
  // The owner account is allowed whatever its plan reads (owner, Nov 13: the owner can use everything).
  for (const userId of [OWNER_ACCOUNT_ID,PRODUCTION_OWNER_ACCOUNT_ID]) {
   globalThis.__pushMember={status:'signed-in',userId,plan:'free',accessExpiresAt:0};
   const response=await POST(req({action:'diagnostic',record}));
   assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
  }
  assert.equal(lines.length,2);
  const line=lines[0];
  assert.match(line,/^\[push-diag\] v=2026-11-15-inapp-banner id=n-123 at=2026-11-15T12:00:00\.000Z push=\+0\.0s shown=\+0\.4s foreground=\+9\.0s query=\+9\.1s /);
  assert.match(line,/banner=\+9\.2s bannerOpen=\+11\.9s navigated=\+12\.0s listApi=yes listed=yes via=banner$/);
  for (const secret of ['secret','/research/news','user_','push.example','stillListed']) assert.equal(line.includes(secret),false,secret);
  assert.equal(calls.length,0,'nothing goes to the monitor');
  let limited=0;
  for (let i=0;i<40;i++) if ((await POST(req({action:'diagnostic',record}))).status===429) limited++;
  assert.ok(limited>=10,`rate limited ${limited}`);
 } finally {globalThis.fetch=saved.fetch;console.info=saved.info;delete globalThis.__pushMember;}
});

test('Nov 16: the send log is for owner accounts only, read from the monitor and cleaned again', async () => {
 const {OWNER_ACCOUNT_ID,PRODUCTION_OWNER_ACCOUNT_ID}=await import('../lib/membership/entitlements.ts');
 const saved={fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
 process.env.RESEARCH_MONITOR_URL='https://monitor.example';process.env.RESEARCH_MONITOR_TOKEN='fixture';
 const calls=[];
 const item={at:1794799114,device:'0123456789ab',host:'web.push.apple.com',status:201,kind:'test',page:'/research/notifications',ms:90,failure:null,gone:false,registered:true};
 globalThis.fetch=async(url,options)=>{calls.push([String(url),options.method,options.body]);return Response.json({ok:true,items:[{...item,endpoint:'https://web.push.apple.com/secret'}]});};
 const req=(origin='https://example.test')=>new Request('https://example.test/api/research/notifications',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action:'send-log'})});
 try {
  for(const [member,status] of [[{status:'signed-out'},401],[{status:'unavailable'},503],
    [{status:'signed-in',userId:'user_member',plan:'pro',accessExpiresAt:Date.now()+60000,isAdmin:true},403]]) {
   globalThis.__pushMember=member;assert.equal((await POST(req())).status,status,JSON.stringify(member));
  }
  globalThis.__pushMember={status:'signed-in',userId:OWNER_ACCOUNT_ID,plan:'pro',accessExpiresAt:Date.now()+60000};
  assert.equal((await POST(req('https://elsewhere.test'))).status,403);
  assert.equal(calls.length,0);
  // The owner is allowed whatever the plan reads (owner, Nov 13).
  for (const userId of [OWNER_ACCOUNT_ID,PRODUCTION_OWNER_ACCOUNT_ID]) {
   globalThis.__pushMember={status:'signed-in',userId,plan:'free',accessExpiresAt:0};
   const response=await POST(req());
   assert.equal(response.status,200);
   assert.deepEqual(await response.json(),{ok:true,items:[item]});
  }
  assert.deepEqual(calls,[['https://monitor.example/push/send-log','GET',undefined],['https://monitor.example/push/send-log','GET',undefined]]);
 } finally {globalThis.fetch=saved.fetch;delete globalThis.__pushMember;for(const [key,value] of [['RESEARCH_MONITOR_URL',saved.url],['RESEARCH_MONITOR_TOKEN',saved.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

// Nov 16: the app's own banner asks the server for the newest notice sent to this member's current device, then marks it opened or
// dismissed. Any signed-in member (FREE or PRO); the member id comes from the session, never the body; only the cleaned notice returns.
test('Nov 16: recent-notice, notice-opened and notice-dismissed are for the signed-in member, with the session member id only', async () => {
 const saved={fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
 process.env.RESEARCH_MONITOR_URL='https://monitor.example';process.env.RESEARCH_MONITOR_TOKEN='fixture';
 const id='0123456789abcdef0123456789abcdef';
 const clean={id,kind:'test',page:'/research/notifications',title:'テスト通知',sentAt:1,ageMs:4000,state:'new',openedAt:null,dismissedAt:null};
 const calls=[];let answer={ok:true,registered:true,notice:{...clean,endpoint:'https://web.push.apple.com/secret'}};
 globalThis.fetch=async(url,options)=>{calls.push({url:String(url),body:JSON.parse(options.body)});return Response.json(answer);};
 const req=(action,extra={},origin='https://example.test')=>new Request('https://example.test/api/research/notifications',{method:'POST',headers:{origin,'content-type':'application/json'},
  body:JSON.stringify({action,subscription:{endpoint:'https://web.push.apple.com/x'},memberId:'user_victim',...extra})});
 try {
  for(const action of ['recent-notice','notice-opened','notice-dismissed','notice-status']) {
   for(const [member,status] of [[{status:'signed-out'},401],[{status:'unavailable'},503]]) { globalThis.__pushMember=member;assert.equal((await POST(req(action))).status,status); }
   globalThis.__pushMember={status:'signed-in',userId:'user_member',plan:'free',accessExpiresAt:0};
   assert.equal((await POST(req(action,{},'https://attacker.test'))).status,403);
  }
  assert.equal(calls.length,0);
  // A FREE member and an owner account alike reach their own device's notice.
  for (const member of [{status:'signed-in',userId:'user_member',plan:'free',accessExpiresAt:0},{status:'signed-in',userId:'user_owner',plan:'pro',accessExpiresAt:Date.now()+60000,ownerAccount:true}]) {
   globalThis.__pushMember=member;calls.length=0;
   assert.deepEqual(await (await POST(req('recent-notice'))).json(),{ok:true,registered:true,notice:clean});
   assert.equal(calls[0].url,'https://monitor.example/push/member/recent-notice');
   assert.equal(calls[0].body.memberId,member.userId);
   assert.equal('noticeId' in calls[0].body,false);
  }
  answer={ok:true,marked:true};calls.length=0;
  assert.deepEqual(await (await POST(req('notice-opened',{noticeId:id}))).json(),{ok:true,marked:true});
  assert.deepEqual(await (await POST(req('notice-dismissed',{noticeId:{x:1}}))).json(),{ok:true,marked:true});
  assert.deepEqual(calls.map(c=>[c.url,c.body.noticeId,c.body.memberId]),[['https://monitor.example/push/member/notice-opened',id,'user_owner'],['https://monitor.example/push/member/notice-dismissed','','user_owner']]);
  globalThis.fetch=async()=>Response.json({ok:false,error:'not-owned'},{status:400});
  assert.deepEqual(await (await POST(req('notice-opened',{noticeId:id}))).json(),{ok:false,error:'not-owned'});
 } finally {globalThis.fetch=saved.fetch;delete globalThis.__pushMember;for(const [key,value] of [['RESEARCH_MONITOR_URL',saved.url],['RESEARCH_MONITOR_TOKEN',saved.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

// Owner, Nov 16: the app asks recent-notice every 20 s while it is open, so the notice actions are limited per device (and per member)
// before the monitor is called; a refused ask reads as "no notice" in the app.
test('Nov 16: the notice actions are rate limited per device and per member before the monitor is asked', async () => {
 const saved={fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
 process.env.RESEARCH_MONITOR_URL='https://monitor.example';process.env.RESEARCH_MONITOR_TOKEN='fixture';
 const {PUSH_NOTICE_DEVICE_LIMIT,PUSH_NOTICE_MEMBER_LIMIT}=await import('../lib/research/push-server-notice.ts');
 let monitorCalls=0;
 globalThis.fetch=async()=>{monitorCalls+=1;return Response.json({ok:true,registered:true,notice:null});};
 const req=(endpoint,action='recent-notice')=>new Request('https://example.test/api/research/notifications',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},
  body:JSON.stringify({action,subscription:{endpoint}})});
 try {
  globalThis.__pushMember={status:'signed-in',userId:'user_rate_limited',plan:'free',accessExpiresAt:0};
  for(let i=0;i<PUSH_NOTICE_DEVICE_LIMIT;i+=1) assert.equal((await POST(req('https://web.push.apple.com/device-a'))).status,200);
  const refused=await POST(req('https://web.push.apple.com/device-a'));
  assert.equal(refused.status,429);
  assert.deepEqual(await refused.json(),{ok:false,error:'rate-limited'});
  assert.equal((await POST(req('https://web.push.apple.com/device-a','notice-status'))).status,429,'every notice action counts');
  assert.equal(monitorCalls,PUSH_NOTICE_DEVICE_LIMIT,'the monitor is not asked once the device is over its limit');
  // Another device of the same member has its own allowance, until the member's limit is reached.
  monitorCalls=0;let limited=0;
  for(let i=0;i<PUSH_NOTICE_MEMBER_LIMIT;i+=1) { if((await POST(req(`https://web.push.apple.com/device-${i}`))).status===429) limited+=1; }
  assert.ok(monitorCalls>0&&limited>0);
  assert.ok(monitorCalls+PUSH_NOTICE_DEVICE_LIMIT<=PUSH_NOTICE_MEMBER_LIMIT,'never more than the member limit across devices');
  // Another member is not affected.
  globalThis.__pushMember={status:'signed-in',userId:'user_rate_other',plan:'free',accessExpiresAt:0};
  assert.equal((await POST(req('https://web.push.apple.com/device-a'))).status,200);
 } finally {globalThis.fetch=saved.fetch;delete globalThis.__pushMember;for(const [key,value] of [['RESEARCH_MONITOR_URL',saved.url],['RESEARCH_MONITOR_TOKEN',saved.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('Nov 17: a failed or retried enable is logged as a stage and an error name only, for any signed-in member, rate limited', async () => {
 const saved={fetch:globalThis.fetch,warn:console.warn};const calls=[],lines=[];
 globalThis.fetch=async(...args)=>{calls.push(args);return Response.json({ok:true});};
 console.warn=(...args)=>lines.push(args.join(' '));
 const req=(body,origin='https://example.test')=>new Request('https://example.test/api/research/notifications',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 const report={stage:'subscribe',name:'AbortError',retry:'failed',retryStage:'subscribe',retryName:'AbortError',endpoint:'https://push.example/secret',message:'secret text'};
 try {
  globalThis.__pushMember={status:'signed-out'};
  assert.equal((await POST(req({action:'client-error',report}))).status,401);
  globalThis.__pushMember={status:'signed-in',userId:'user_free_member',plan:'free',accessExpiresAt:0};
  assert.equal((await POST(req({action:'client-error',report},'https://elsewhere.test'))).status,403);
  assert.equal((await POST(req({action:'client-error',report:{stage:'anything',name:'AbortError',retry:'ok'}}))).status,400);
  const response=await POST(req({action:'client-error',report}));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
  assert.deepEqual(lines,['[push-client] stage=subscribe name=AbortError retry=failed retryStage=subscribe retryName=AbortError']);
  for (const secret of ['secret','push.example','user_']) assert.equal(lines[0].includes(secret),false,secret);
  assert.equal(calls.length,0,'nothing goes to the monitor');
  let limited=0;
  for (let i=0;i<20;i++) if ((await POST(req({action:'client-error',report:{stage:'worker',name:'Weird<script>',retry:'none'}}))).status===429) limited++;
  assert.ok(limited>=10,`rate limited ${limited}`);
  assert.match(lines[1],/^\[push-client\] stage=worker name=Other retry=none$/);
 } finally {globalThis.fetch=saved.fetch;console.warn=saved.warn;delete globalThis.__pushMember;}
});
