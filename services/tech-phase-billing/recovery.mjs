// Explicit-cohort Sandbox watchdog. Never creates, cancels or captures a payment.
const BASE='https://tech-phase-billing-sandbox-production.up.railway.app';
const ORIGIN='https://tech-phase-lab-git-codex-research-preview-chehon7144-5412.vercel.app';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES=new Set(['creating','approval_pending','active','suspended','cancelled','expired']);
function summary(value) {
  if(value?.environment!=='sandbox'||!['free','pro'].includes(value.plan)||
    (value.reviewRequired!==undefined&&typeof value.reviewRequired!=='boolean')||
    (value.reviewRequired===true&&!value.subscription)||
    (value.plan==='pro'&&(typeof value.proExpiresAt!=='string'||!Number.isFinite(Date.parse(value.proExpiresAt))))||
    (value.plan==='free'&&value.proExpiresAt!==null)||
    (value.subscription!==null&&(!UUID.test(value.subscription?.id??'')||!STATES.has(value.subscription?.state))))throw Error('INVALID_RECOVERY_STATUS');
  return value;
}
async function read(response) {
  if(!response.ok||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'){
    await response.body?.cancel().catch(()=>{});
    throw Error('RECOVERY_UNAVAILABLE');
  }
  const reader=response.body?.getReader();if(!reader)throw Error('RECOVERY_UNAVAILABLE');
  let size=0;const chunks=[];
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384)throw Error('RECOVERY_RESPONSE_LIMIT');chunks.push(value);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch{await reader.cancel().catch(()=>{});throw Error('RECOVERY_UNAVAILABLE');}
  finally {reader.releaseLock();}
}
export async function runOwnerRecovery(env,fetcher=fetch,signal) {
  if(env.TECH_PHASE_BILLING_RECOVERY_ENABLED!=='true')return {outcome:'disabled'};
  if(env.TECH_PHASE_PAYPAL_ENV!=='sandbox'||env.TECH_PHASE_BILLING_RECOVERY_BRANCH!=='codex/research-preview'||
    !/^[A-Za-z0-9_-]{43,128}$/.test(env.TECH_PHASE_BILLING_SERVICE_TOKEN??'')||
    !/^user_[A-Za-z0-9]{1,120}$/.test(env.TECH_PHASE_BILLING_OWNER_ID??''))throw Error('INVALID_RECOVERY_CONFIG');
  const headers={Authorization:`Bearer ${env.TECH_PHASE_BILLING_SERVICE_TOKEN}`,
    'X-Tech-Phase-User':env.TECH_PHASE_BILLING_OWNER_ID,Origin:ORIGIN,'Content-Type':'application/json'};
  const call=async(action,body)=>{
    signal?.throwIfAborted();
    return read(await fetcher(`${BASE}/sandbox/${action}`,{
    method:body?'POST':'GET',headers,redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(55000)]):AbortSignal.timeout(55000),
    ...(body?{body:JSON.stringify(body)}:{})}));
  };
  const before=summary(await call('status'));
  if(!before.subscription||before.subscription.state==='creating')return {outcome:'no-provider-contract'};
  const result=await call('reconcile',{id:before.subscription.id});
  if(!['verified','payment-pending','review-required'].includes(result?.status)||result.environment!=='sandbox')throw Error('INVALID_RECOVERY_RESULT');
  const after=summary(await call('status'));
  if(after.subscription?.id!==before.subscription.id)throw Error('RECOVERY_CONTRACT_CHANGED');
  // Operational logs contain no payer, user, contract ID, token or raw response.
  return {outcome:after.reviewRequired===true?'review-required':result.status,plan:after.plan,state:after.subscription.state,
    changed:before.plan!==after.plan||before.proExpiresAt!==after.proExpiresAt||before.subscription.state!==after.subscription.state||
      (before.reviewRequired===true)!==(after.reviewRequired===true)};
}

// The same explicit allowlist as the Sandbox backend; never discover users from requests.
// Sequential checks bound load. A single failed member does not starve later members.
export async function runSandboxRecovery(env,fetcher=fetch,signal) {
  if(env.TECH_PHASE_BILLING_RECOVERY_ENABLED!=='true')return {outcome:'disabled'};
  const raw=env.TECH_PHASE_BILLING_SANDBOX_TEST_USERS;
  let extra=[];
  if(raw!==undefined&&raw!=='') {
    try {
      if(typeof raw!=='string'||raw.length>1024)throw Error();
      extra=JSON.parse(raw);
      if(!Array.isArray(extra)||extra.length>5||new Set(extra).size!==extra.length||
        extra.some(id=>typeof id!=='string'||!/^user_[A-Za-z0-9]{1,120}$/.test(id)))throw Error();
    }catch{throw Error('INVALID_RECOVERY_CONFIG');}
  }
  // Validate the original owner even when the allowlist contains other valid IDs.
  if(env.TECH_PHASE_PAYPAL_ENV!=='sandbox'||env.TECH_PHASE_BILLING_RECOVERY_BRANCH!=='codex/research-preview'||
    !/^[A-Za-z0-9_-]{43,128}$/.test(env.TECH_PHASE_BILLING_SERVICE_TOKEN??'')||
    !/^user_[A-Za-z0-9]{1,120}$/.test(env.TECH_PHASE_BILLING_OWNER_ID??''))throw Error('INVALID_RECOVERY_CONFIG');
  const deadline=AbortSignal.timeout(240000);
  const bounded=signal?AbortSignal.any([signal,deadline]):deadline;
  const members=[...new Set([env.TECH_PHASE_BILLING_OWNER_ID,...extra])];
  if(members.length===1)return runOwnerRecovery(env,fetcher,bounded);
  const result={outcome:'completed',total:members.length,checked:0,failed:0,unprocessed:0,reviewRequired:0,changed:0};
  for(const member of members) {
    if(bounded.aborted)break;
    result.checked++;
    try {
      const item=await runOwnerRecovery({...env,TECH_PHASE_BILLING_OWNER_ID:member},fetcher,bounded);
      if(item.outcome==='review-required')result.reviewRequired++;
      if(item.changed)result.changed++;
    }catch{result.failed++;}
  }
  result.unprocessed=result.total-result.checked;
  if(result.failed||result.unprocessed)result.outcome='partial-failure';
  return result;
}
