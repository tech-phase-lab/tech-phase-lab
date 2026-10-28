// One-time, owner-approved Sandbox acceptance. Never run against live PayPal.
// Inject dependencies so the exact guards can be tested without credentials.
export async function runUsdRefundAcceptance({env, Client, fetcher=fetch, now=Date.now, log=console.log}) {
  const owner='user_3JulL4D07KtVl5Eg2zdY1iczKbC';
  const plan='P-1HN77466YK762545WNLLQDHI';
  const paidAt=Date.parse('2026-10-20T15:24:34Z');
  const base='https://api-m.sandbox.paypal.com';
  const billing='https://tech-phase-billing-sandbox-production.up.railway.app';
  const origin='https://tech-phase-lab-git-codex-research-preview-chehon7144-5412.vercel.app';
  const isTwentyUsd=value=>typeof value==='string'&&/^20(?:\.0{1,2})?$/.test(value);
  const action=env.TECH_PHASE_PROVISION_ACTION;
  const require=(ok,code)=>{if(!ok)throw Error(code);};
  require(['inspect-usd-refund','execute-usd-refund','observe-usd-refund'].includes(action),'ACTION');
  require(now()>=Date.parse('2026-10-21T00:00:00Z')&&now()<Date.parse('2026-10-21T04:00:00Z'),'EXPIRED');
  require(env.TECH_PHASE_DISCOVERY_ENV==='sandbox'&&env.TECH_PHASE_PROVISION_DB_URL==='RETIRED','ENVIRONMENT');
  for(const k of ['TECH_PHASE_BACKUP_DB_PASSWORD','TECH_PHASE_DISCOVERY_CLIENT_ID','TECH_PHASE_DISCOVERY_CLIENT_SECRET','TECH_PHASE_CHECK_TOKEN']) require(typeof env[k]==='string'&&env[k].length>10&&env[k]!=='RETIRED','CREDENTIAL');
  const db=new Client({host:'postgres.railway.internal',port:5432,database:'tech_phase_billing_sandbox',user:'tech_phase_billing_sandbox_backup',password:env.TECH_PHASE_BACKUP_DB_PASSWORD,connectionTimeoutMillis:10000,statement_timeout:10000});
  let rows;
  try {
    await db.connect();await db.query('BEGIN READ ONLY');
    const check=(await db.query("SELECT current_database() AS db,current_user AS role,current_setting('transaction_read_only') AS ro")).rows[0];
    require(check?.db==='tech_phase_billing_sandbox'&&check.role==='tech_phase_billing_sandbox_backup'&&check.ro==='on','READ_ONLY');
    rows=(await db.query(`SELECT s.id,s.paypal_id,s.currency,s.minor,s.state,p.transaction_id,p.paid_at,r.period_end,
      EXISTS(SELECT 1 FROM tech_phase_billing_sandbox.review_holds h WHERE h.subscription_id=s.id) AS held,
      EXISTS(SELECT 1 FROM tech_phase_billing_sandbox.adverse_transactions a WHERE a.transaction_id=p.transaction_id) AS adverse
      FROM tech_phase_billing_sandbox.subscriptions s
      JOIN tech_phase_billing_sandbox.payments p ON p.subscription_id=s.id
      JOIN tech_phase_billing_sandbox.periods r ON r.transaction_id=p.transaction_id
      WHERE s.user_id=$1 ORDER BY s.created_at`,[owner])).rows;
    await db.query('COMMIT');
  } finally {await db.end();}
  require(rows.length===2,'LEDGER_COUNT');
  const usd=rows.find(r=>r.currency==='USD'),jpy=rows.find(r=>r.currency==='JPY');
  require(usd?.minor===2000&&Date.parse(usd.paid_at)===paidAt&&Date.parse(usd.period_end)===Date.parse('2026-11-21T10:00:00Z'),'USD_LEDGER');
  require(jpy?.minor===2980&&jpy.state==='cancelled'&&!jpy.held&&!jpy.adverse&&Date.parse(jpy.period_end)===Date.parse('2026-11-20T10:00:00Z'),'JPY_LEDGER');
  require(/^I-[A-Z0-9]{8,32}$/.test(usd.paypal_id)&&/^[A-Za-z0-9-]{3,50}$/.test(usd.transaction_id)&&/^[0-9a-f-]{36}$/.test(usd.id),'IDENTIFIERS');
  async function request(url,options,step) {
    const res=await fetcher(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(55000),...options});
    if(!res.ok){await res.body?.cancel();throw Error(`${step}_HTTP_${res.status}`);}
    if(res.status===204)return null;
    require(res.headers.get('content-type')?.split(';')[0].trim()==='application/json',`${step}_MEDIA`);
    const reader=res.body?.getReader();require(reader,`${step}_BODY`);
    const chunks=[];let size=0;
    try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;require(size<=262144,`${step}_LIMIT`);chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
    catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  }
  const token=await request(base+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.TECH_PHASE_DISCOVERY_CLIENT_ID+':'+env.TECH_PHASE_DISCOVERY_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'},'AUTH');
  require(typeof token.access_token==='string'&&token.access_token.length>10,'TOKEN');
  const paypal=(path,method='GET',body,key)=>request(base+path,{method,headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json',...(key?{'PayPal-Request-Id':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})},method==='POST'?'PAYPAL_MUTATION':'PAYPAL_READ');
  const api=(path,body)=>request(billing+'/sandbox/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+env.TECH_PHASE_CHECK_TOKEN,'X-Tech-Phase-User':owner,Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},'BILLING');
  const remote=await paypal('/v1/billing/subscriptions/'+usd.paypal_id);
  require(remote.id===usd.paypal_id&&remote.custom_id===usd.id&&remote.plan_id===plan&&['ACTIVE','CANCELLED'].includes(remote.status),'CONTRACT');
  require(Date.parse(remote.billing_info?.last_payment?.time)===paidAt&&remote.billing_info?.last_payment?.amount?.currency_code==='USD'&&isTwentyUsd(remote.billing_info.last_payment.amount.value),'PROVIDER_PAYMENT');
  const params=new URLSearchParams({start_time:new Date(paidAt-1000).toISOString(),end_time:new Date(paidAt+1000).toISOString()});
  const tx=await paypal('/v1/billing/subscriptions/'+usd.paypal_id+'/transactions?'+params);
  require(tx.transactions?.length===1&&tx.transactions[0].id===usd.transaction_id&&Date.parse(tx.transactions[0].time)===paidAt,'TRANSACTION');
  const sale=await paypal('/v1/payments/sale/'+usd.transaction_id);
  require(sale.id===usd.transaction_id&&sale.amount?.currency==='USD'&&isTwentyUsd(sale.amount.total)&&['completed','refunded'].includes(sale.state),'SALE');
  const before=await api('status');
  require(before.environment==='sandbox'&&before.subscription?.id===usd.id,'STATUS_CONTRACT');
  log(JSON.stringify({event:'TECH_PHASE_USD_REFUND_PREFLIGHT',action,providerState:remote.status,saleState:sale.state,plan:before.plan,reviewRequired:before.reviewRequired===true,ledgerPayments:rows.length,usdHeld:usd.held,usdAdverse:usd.adverse,jpyExpiryMatches:Date.parse(before.proExpiresAt)===Date.parse(jpy.period_end),usdExpiryMatches:Date.parse(before.proExpiresAt)===Date.parse(usd.period_end)}));
  if(action!=='execute-usd-refund')return;
  if(remote.status==='ACTIVE'){
    const cancelled=await api('cancel',{id:usd.id});require(cancelled.status==='cancelled','CANCEL_RESULT');
  }
  const stopped=await paypal('/v1/billing/subscriptions/'+usd.paypal_id);
  require(stopped.id===usd.paypal_id&&stopped.custom_id===usd.id&&stopped.status==='CANCELLED','CANCEL_VERIFY');
  log(JSON.stringify({event:'TECH_PHASE_USD_CANCEL_VERIFIED'}));
  if(sale.state==='completed') {
    require(!usd.held&&!usd.adverse,'EXISTING_HOLD');
    // Full refund of this verified $20 sale, no automatic retry on ambiguity.
    const refund=await paypal('/v1/payments/sale/'+usd.transaction_id+'/refund','POST',{},'7b13c37d-73c7-40e2-87d8-76279d918972');
    require(refund.sale_id===usd.transaction_id&&refund.amount?.currency==='USD'&&isTwentyUsd(refund.amount.total)&&['completed','pending'].includes(refund.state),'REFUND_RESULT');
    log(JSON.stringify({event:'TECH_PHASE_USD_REFUND_SUBMITTED',state:refund.state,currency:'USD',amount:'20.00'}));
  } else log(JSON.stringify({event:'TECH_PHASE_USD_REFUND_ALREADY_APPLIED'}));
  const afterSale=await paypal('/v1/payments/sale/'+usd.transaction_id);
  require(afterSale.id===usd.transaction_id,'SALE_AFTER');
  log(JSON.stringify({event:'TECH_PHASE_USD_REFUND_PROVIDER',state:afterSale.state}));
}
