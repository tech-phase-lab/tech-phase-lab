import {Pool} from 'pg';
import {liveDatabaseConfig} from './database-config.mjs';
import {deliverBillingAlerts} from './abuse.mjs';
let pool;
try {
 const env=process.env;
 if(env.TECH_PHASE_SECURITY_ALERTS_ENABLED!=='true'||env.TECH_PHASE_BILLING_RUNTIME!=='railway-live'||!env.TECH_PHASE_BILLING_LIVE_BRANCH||env.RAILWAY_GIT_BRANCH!==env.TECH_PHASE_BILLING_LIVE_BRANCH)throw Error();
 const url=new URL(env.TECH_PHASE_SECURITY_SLACK_WEBHOOK_URL);
 if(url.origin!=='https://hooks.slack.com'||url.username||url.password||url.search||url.hash||!/^\/services\/[A-Za-z0-9/]+$/.test(url.pathname))throw Error();
 pool=new Pool(liveDatabaseConfig(env));
 const result=await deliverBillingAlerts(pool,async event=>{
  const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify({text:`Tech Phase billing security: ${event.kind}; count=${event.count}; actor=${event.actorRef}; event=${event.id}; window=${event.windowStart}`})});
  if(!response.ok)throw Error();await response.body?.cancel();
 });
 console.log(JSON.stringify({event:'BILLING_SECURITY_ALERT_DELIVERY',...result}));if(result.failed)process.exitCode=1;
}catch{console.error(JSON.stringify({event:'BILLING_SECURITY_ALERT_DELIVERY_FAILED'}));process.exitCode=1;}
finally{await pool?.end();}
