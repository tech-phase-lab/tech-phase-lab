import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {latestSettledSession,createCloseProvider} from '../lib/resolute/notification-closes.ts';
import {templateNote,acceptModelNote,composeMorningNote,withMorningNote,withProviderCredit,usableFacts} from '../lib/resolute/morning-note.ts';
import {createNotificationQueueRunner} from '../lib/resolute/notification-queue-runner.ts';
import {renderAlertMail,renderNextMorningMail} from '../lib/resolute/mail-templates.ts';

const at=s=>new Date(s);
test('settled session follows the US calendar, early closes and holidays',()=>{
 // Thu 2026-11-12 22:00Z = 17:00 EST: Thursday closed 16:00 + 30 min passed
 assert.equal(latestSettledSession(at('2026-11-12T22:00:00Z')),'2026-11-12');
 // 21:10Z = 16:10 EST: not yet settled, so Wednesday
 assert.equal(latestSettledSession(at('2026-11-12T21:10:00Z')),'2026-11-11');
 // Saturday and Sunday JST mornings still read Friday
 assert.equal(latestSettledSession(at('2026-11-14T22:00:00Z')),'2026-11-13');
 // Thanksgiving 2026-11-26 is closed: Friday morning (JST) after it reads Wednesday
 assert.equal(latestSettledSession(at('2026-11-26T22:00:00Z')),'2026-11-25');
 // early close 2026-11-27 13:00 ET: settled at 13:30 ET = 18:30Z
 assert.equal(latestSettledSession(at('2026-11-27T18:40:00Z')),'2026-11-27');
 assert.equal(latestSettledSession(at('2026-11-27T18:10:00Z')),'2026-11-25');
 // outside the calendar nothing is guessed
 assert.equal(latestSettledSession(at('2028-03-01T22:00:00Z')),null);
 assert.equal(latestSettledSession(new Date(NaN)),null);
});

function series(symbol,rows,extra={}){return {meta:{symbol,currency:'USD',interval:'1day',...extra},values:rows.map(([datetime,close])=>({datetime,open:close,high:close,low:close,close:String(close),volume:'1'})),status:'ok'};}
test('close provider returns only the settled day, once per symbol per run, and never leaks the key',async()=>{
 const seen=[];
 const request=async url=>{seen.push(String(url));const s=url.searchParams.get('symbol');
  if(s==='NVDA')return Response.json(series('NVDA',[['2026-11-12',180.5],['2026-11-11',170]]));
  if(s==='AMD')return Response.json(series('AMD',[['2026-11-11',100]])); // today's bar not out yet
  if(s==='BAD')return Response.json({status:'error',code:400,message:'x'});
  if(s==='EUR')return Response.json(series('EUR',[['2026-11-12',1]],{currency:'EUR'}));
  return new Response('x',{status:500});};
 const provider=createCloseProvider({apiKey:'secret-key-value',now:()=>at('2026-11-12T22:00:00Z'),request});
 const a=await provider(['NVDA','AMD','BAD','EUR','ZZZ']);
 assert.equal(a.marketDate,'2026-11-12');
 assert.deepEqual(a.closes,[{symbol:'NVDA',date:'2026-11-12',close:180.5,isFinal:true}]);
 await provider(['NVDA']);
 assert.equal(seen.filter(u=>u.includes('symbol=NVDA')).length,1);
 assert.ok(!JSON.stringify(a).includes('secret'));
 const none=await createCloseProvider({apiKey:undefined,now:()=>at('2026-11-12T22:00:00Z'),request:async()=>assert.fail('no call')})(['NVDA']);
 assert.deepEqual(none.closes,[]);
 const off=await createCloseProvider({apiKey:'k',now:()=>at('2029-01-01T22:00:00Z'),request:async()=>assert.fail('no call')})(['NVDA']);
 assert.equal(off.marketDate,null);
});

const events=[{kind:'line_reached',symbol:'NVDA',close:120.5,dropPct:12.3,newLines:[10]},{kind:'surge_cap',symbol:'AMD',close:200,risePct:55.5}];
test('morning note uses only supplied facts and has a fixed fallback',()=>{
 assert.match(templateNote(events,'ja'),/NVDA\(終値 \$120\.50、基準から -12\.3%\)/);
 assert.match(templateNote(events,'en'),/NVDA \(closed at \$120\.50, down 12\.3% from your reference price\)/);
 for(const bad of [undefined,[],[{kind:'line_reached',symbol:'nvda',close:1,dropPct:1}],[{kind:'x'}]]){
  assert.equal(usableFacts(bad).length,0);assert.ok(!/\d/.test(templateNote(bad,'ja')));
 }
 assert.ok(!/買うべき|おすすめ/.test(templateNote(events,'ja')));
});
test('model note: strict JSON, facts-only numbers/symbols, no advice phrasing; anything else falls back',async()=>{
 const ok=`{"note":"NVDAは終値$120.50(-12.3%)でした。焦らず計画を読み直しましょう"}`;
 assert.equal((await composeMorningNote({events,locale:'ja',generate:async()=>ok})).source,'model');
 for(const raw of ['not json','{"note":"NVDAは$999になる"}','{"note":"NVDAを買うべき"}','{"note":"x","extra":1}','{"note":"TSLAは$120.50"}','{"note":"https://x.test"}','[]','{"note":12}'])
  assert.equal((await composeMorningNote({events,locale:'ja',generate:async()=>raw})).source,'template',raw);
 assert.equal((await composeMorningNote({events,locale:'ja',generate:async()=>{throw new Error('down');}})).source,'template');
 assert.equal(acceptModelNote('a'.repeat(200),events,'ja'),null);
});
test('note and credit are added without changing the approved templates',()=>{
 const m=renderNextMorningMail({locale:'ja',planUrl:'https://t.test/p',unsubscribeUrl:'https://t.test/u',doneUrl:'https://t.test/d',skippedUrl:'https://t.test/s',unsureUrl:'https://t.test/n'});
 const n=withMorningNote(m,'ひとこと');assert.ok(n.text.startsWith('ひとこと\n\n'));assert.ok(n.text.endsWith(m.text));assert.equal(n.subject,m.subject);
 assert.throws(()=>withMorningNote(m,'a\nb'));
 const a=renderAlertMail({locale:'en',date:'2026-11-12',items:[events[0]],planUrl:'https://t.test/p',unsubscribeUrl:'https://t.test/u'});
 const c=withProviderCredit(a,'en');
 assert.ok(c.text.indexOf('Price data provided by Twelve Data')<c.text.indexOf('Unsubscribe:'));assert.equal(c.subject,a.subject);
 assert.ok(withProviderCredit(a,'ja').text.includes('価格データ提供: Twelve Data'));
});

function poolWith(rows){const calls=[];return {calls,pool:{connect:async()=>({query:async(sql,args)=>{calls.push(args);return {rows};},release(){}})}};}
test('queue runner is off by default and selects only users of the current JST hour; one failure does not stop others',async()=>{
 const off=await createNotificationQueueRunner({connect:async()=>assert.fail('no DB')},{recipient:async()=>assert.fail(),closes:async()=>assert.fail()})();
 assert.equal(off.enabled,false);
 const f=poolWith([{clerk_user_id:'user_a'},{clerk_user_id:'user_b'},{clerk_user_id:'user_c'}]);
 const jobs=[];
 const report=await createNotificationQueueRunner(f.pool,{enabled:true,now:()=>at('2026-11-12T22:00:00Z'),recipient:async()=>({locale:'ja',preferencesConfigured:true,verified:true,unsubscribed:false}),
  closes:async()=>({marketDate:'2026-11-12',closes:[]}),
  makeJob:resolve=>async id=>{jobs.push(id);await resolve(id,['NVDA']);if(id==='user_b')throw new Error('private');return id==='user_a'?[{kind:'alerts',status:'queued'}]:[];}})();
 assert.deepEqual(f.calls[0],['7',201]); // 22:00Z = 07:00 JST
 assert.deepEqual(jobs,['user_a','user_b','user_c']);
 assert.deepEqual([report.queued,report.errors,report.skipped,report.users],[1,1,1,3]);
 assert.equal(report.marketDate,'2026-11-12');assert.ok(!JSON.stringify(report).includes('private'));
});
test('queue and cron entry points are disabled by default and refuse a wrong role before any I/O',()=>{
 const run=(file,env)=>spawnSync(process.execPath,['--experimental-strip-types',file],{encoding:'utf8',env:{PATH:process.env.PATH,...env}});
 let r=run('services/resolute-api/notification-queue.mjs',{});assert.equal(r.status,1);assert.deepEqual(JSON.parse(r.stdout),{enabled:false});
 r=run('services/resolute-api/notification-queue.mjs',{RESOLUTE_NOTIFICATION_QUEUE_ENABLED:'true',RESOLUTE_ENTITLEMENT_SOURCE:'live',TWELVE_DATA_API_KEY:'k',RESOLUTE_MAIL_CLERK_SECRET_KEY:'k',RESOLUTE_NOTIFICATION_QUEUE_DB_URL:'postgres://resolute_notification_writer:p@db.example/resolute?sslmode=verify-full'});
 assert.deepEqual(JSON.parse(r.stdout),{error:'NOTIFICATION_QUEUE_UNAVAILABLE'});
 r=run('services/resolute-notifications/run.mjs',{});assert.equal(r.status,0); // disabled is not a failure for the scheduler
 
 assert.equal(r.stdout.trim().split('\n').length,2);
 for(const line of r.stdout.trim().split('\n'))assert.deepEqual(JSON.parse(line),{enabled:false});
});
test('cron entry: an enabled but broken step is still a failure (non-zero), a disabled one is not',()=>{
 const run=env=>spawnSync(process.execPath,['--experimental-strip-types','services/resolute-notifications/run.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH,...env}});
 // queue enabled with no configuration: fails; mail worker disabled: reported as disabled
 let r=run({RESOLUTE_NOTIFICATION_QUEUE_ENABLED:'true'});
 assert.equal(r.status,1);assert.match(r.stdout,/NOTIFICATION_QUEUE_UNAVAILABLE/);assert.match(r.stdout,/"enabled":false/);
 // mail worker enabled with missing prerequisites: fails even though the queue step is disabled
 r=run({RESOLUTE_MAIL_DELIVERY_ENABLED:'true'});
 assert.equal(r.status,1);assert.match(r.stdout,/MAIL_WORKER_UNAVAILABLE/);
 // no secret or exception text leaks
 assert.ok(!/postgres|secret|key/i.test(r.stdout+r.stderr));
});
