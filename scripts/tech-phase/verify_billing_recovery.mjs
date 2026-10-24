// Restored billing boot only: no real credentials, DB, PayPal or network calls.
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
  assert.ok(['server','guard-check'].includes(mode));
  const deny=()=>process.exit(73);
  net.Socket.prototype.connect=deny;
  tls.connect=deny;
  globalThis.fetch=deny;
  syncBuiltinESMExports();
  if(mode==='guard-check')net.connect({host:'127.0.0.1',port:1});
  else await import('../../services/tech-phase-billing/server.mjs');
}else{
  const token='offline_fixture_only_'.repeat(3);
  const env={PATH:process.env.PATH,NODE_ENV:'production',
    TECH_PHASE_BILLING_OWNER_ID:'user_offlinefixture',
    TECH_PHASE_BILLING_SANDBOX_ENABLED:'false',
    TECH_PHASE_BILLING_SANDBOX_WEBHOOK_ENABLED:'false',
    TECH_PHASE_PAYPAL_ENV:'sandbox'};
  function start(childMode,extra={}){
    const child=spawn(process.execPath,[self,childMode],{env:{...env,...extra},stdio:['ignore','pipe','pipe']});
    let bytes=0;
    const timer=setTimeout(()=>child.kill('SIGKILL'),20000);
    for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{
      bytes+=data.length;
      if(bytes>65536)child.kill('SIGKILL');
    });
    const closed=once(child,'close').finally(()=>clearTimeout(timer));
    closed.catch(()=>{});
    return {child,closed};
  }
  const guard=start('guard-check');
  assert.equal((await guard.closed)[0],73,'outbound guard must reject connections');
  let checks=0;
  for(const gateway of [false,true]){
    const reservation=net.createServer();
    reservation.listen(0,'127.0.0.1');
    await once(reservation,'listening');
    const port=reservation.address().port;
    await new Promise((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
    const server=start('server',{PORT:String(port),...(gateway?{
      TECH_PHASE_BILLING_RUNTIME:'railway-sandbox',RAILWAY_GIT_BRANCH:'codex/research-preview',
      TECH_PHASE_BILLING_SERVICE_TOKEN:token}:{} )});
    async function check(path,method,status,body,authenticated=false){
      const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,
        headers:authenticated?{Authorization:`Bearer ${token}`,'X-Tech-Phase-User':'user_offlinefixture'}:{},
        signal:AbortSignal.timeout(1500)});
      assert.equal(response.status,status,path);
      assert.deepEqual(await response.json(),body,path);
      checks++;
    }
    try{
      const deadline=Date.now()+10000;
      while(true){
        assert.equal(server.child.exitCode,null,'billing exited before readiness');
        assert.ok(Date.now()<deadline,'billing readiness timed out');
        try{
          const response=await fetch(`http://127.0.0.1:${port}/healthz`,{signal:AbortSignal.timeout(500)});
          assert.equal(response.status,200);
          assert.deepEqual(await response.json(),{status:'up',environment:'sandbox'});
          checks++;
          break;
        }catch(error){
          if(!(error instanceof TypeError)&&error.name!=='TimeoutError')throw error;
          await new Promise(resolve=>setTimeout(resolve,25));
        }
      }
      for(const action of ['status','create','cancel','reconcile']){
        const method=action==='status'?'GET':'POST';
        await check(`/sandbox/${action}`,method,gateway?401:503,
          {error:gateway?'service-auth':'billing-disabled'});
        if(gateway)await check(`/sandbox/${action}`,method,503,{error:'billing-disabled'},true);
      }
      await check('/webhooks/paypal/sandbox','POST',503,{error:'billing-disabled'});
      if(gateway)await check('/sandbox/unknown','GET',404,{error:'not-found'},true);
    }finally{
      server.child.kill('SIGTERM');
      const [code,signal]=await server.closed;
      assert.equal(signal,null,'billing must shut down cleanly');
      assert.equal(code,0,'billing made forbidden I/O or failed');
    }
  }
  console.log(JSON.stringify({event:'BILLING_RESTORED_BOOT_OK',checks,
    outbound_guard_verified:true,provider_credentials_present:false,
    live_database_verified:false,payment_processing_verified:false,
    live_ai_calls:0,live_payments:0}));
}
