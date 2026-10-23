// Offline boot check for a clean source tree containing ONLY restored API deps.
// No provider credentials are inherited; outbound connections in the child fail.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import tls from 'node:tls';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';

const self=fileURLToPath(import.meta.url);
const mode=process.argv[2];
if(mode){
  assert.ok(['api','worker','guard-check'].includes(mode));
  const deny=()=>process.exit(73);
  net.Socket.prototype.connect=deny;
  tls.connect=deny;
  globalThis.fetch=deny;
  syncBuiltinESMExports();
  if(mode==='guard-check')net.connect({host:'127.0.0.1',port:1});
  else if(mode==='worker')await import('../../services/resolute-api/rizel-daily-review-cli.mjs');
  else await import('../../services/resolute-api/index.mjs');
}else{
  const env={PATH:process.env.PATH,NODE_ENV:'production',
    RESOLUTE_RIZEL_DAILY_REVIEW_ENABLED:'false',
    RESOLUTE_PAYMENTS_ENABLED:'false',RESOLUTE_PAYPAL_LIVE_ENABLED:'false',
    RESOLUTE_PLAN_API_ENABLED:'false',RESOLUTE_NOTIFICATION_API_ENABLED:'false',
    RESOLUTE_AI_CHECK_ENABLED:'false',RESOLUTE_PROTECTION_RETRY_ENABLED:'false',
    RESOLUTE_CLERK_ISSUER:'https://offline.invalid',
    RESOLUTE_CLERK_AUTHORIZED_PARTIES:'["https://offline.invalid"]',
    RESOLUTE_CLERK_JWT_PUBLIC_KEY:'-----BEGIN PUBLIC KEY-----\nOFFLINE_FIXTURE_ONLY\n-----END PUBLIC KEY-----',
    RESOLUTE_API_SERVICE_TOKEN:'offline-fixture-only-'.repeat(3),
    ENTITLEMENT_DB_URL:'postgresql://resolute_api_reader:offline-fixture@127.0.0.1:1/resolute'};
  function start(childMode,extra={}){
    const child=spawn(process.execPath,[self,childMode],{env:{...env,...extra},stdio:['ignore','pipe','pipe']});
    let output='';
    const timer=setTimeout(()=>child.kill('SIGKILL'),20000);
    for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{
      output+=data.toString();
      if(output.length>65536)child.kill('SIGKILL');
    });
    const closed=once(child,'close').finally(()=>clearTimeout(timer));
    // Attach immediately so a spawn failure cannot become an unhandled rejection.
    closed.catch(()=>{});
    return {child,closed,output:()=>output};
  }
  const guard=start('guard-check');
  assert.equal((await guard.closed)[0],73,'outbound guard must reject connections');
  const worker=start('worker');
  assert.equal((await worker.closed)[0],0,'disabled worker must load without I/O');
  assert.match(worker.output(),/"state":"disabled"/);
  const reservation=net.createServer();
  reservation.listen(0,'127.0.0.1');
  await once(reservation,'listening');
  const port=reservation.address().port;
  await new Promise((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
  const api=start('api',{PORT:String(port)});
  let checks=0;
  try{
    const deadline=Date.now()+15000;
    while(!api.output().includes('RESOLUTE_API_READY')){
      assert.equal(api.child.exitCode,null,'API exited before readiness');
      assert.ok(Date.now()<deadline,'API readiness timed out');
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    const routes=[['/healthz',200,{status:'ok'}],
      ['/internal/v1/entitlements',401,{error:'AUTH_REQUIRED'}],
      ['/internal/v1/plan',401,{error:'AUTH_REQUIRED'}],
      ['/internal/v1/notification-settings',401,{error:'AUTH_REQUIRED'}],
      ['/internal/v1/ai-check',401,{error:'AUTH_REQUIRED'}],
      ['/internal/v1/payments',503,{error:'PAYMENT_DISABLED'}],
      ['/internal/v1/live-payments',503,{error:'PAYMENT_DISABLED'}]];
    for(const [path,status,body] of routes){
      const response=await fetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(3000)});
      assert.equal(response.status,status,path);
      assert.deepEqual(await response.json(),body,path);
      checks++;
    }
  }finally{
    api.child.kill('SIGTERM');
    const [code,signal]=await api.closed;
    assert.equal(signal,null,'API must shut down cleanly');
    assert.equal(code,0,'API made forbidden I/O or failed');
  }
  console.log(JSON.stringify({event:'API_RESTORED_BOOT_OK',checks,
    outbound_guard_verified:true,provider_credentials_present:false,
    live_database_verified:false,authenticated_storage_verified:false,
    live_ai_calls:0,live_payments:0}));
}
