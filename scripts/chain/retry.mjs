export const RETRY_DELAYS_MS=[60_000,120_000,240_000,480_000,600_000];
export const secURL=url=>/(^|\.)sec\.gov$/.test(new URL(url).hostname);
export const validContact=value=>typeof value==='string'&&!/[\r\n]/.test(value)&&/[\w.+-]+@(?!example\.(?:com|org|net)\b)[\w.-]+\.[A-Za-z]{2,}/.test(value);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let queue=Promise.resolve(),lastRequest=0,cooldownUntil=0;
// Every SEC network request, including redirects and retries, shares this queue.
export function pacedRequest(fn){
 const run=queue.then(async()=>{
  while(Date.now()<Math.max(lastRequest+250,cooldownUntil))await sleep(Math.min(1000,Math.max(lastRequest+250,cooldownUntil)-Date.now()));
  lastRequest=Date.now();return fn();
 });queue=run.catch(()=>{});return run;
}
export async function retry429(request,{wait=sleep,onRetry=()=>{},globalCooldown=true}={}){
 for(let attempt=0;;attempt++){
  const response=await request(attempt);
  if(response.status!==429||attempt===RETRY_DELAYS_MS.length)return response;
  await response.body?.cancel();
  const delay=RETRY_DELAYS_MS[attempt];
  if(globalCooldown)cooldownUntil=Math.max(cooldownUntil,Date.now()+delay);
  onRetry({attempt:attempt+1,delayMs:delay});
  // Release the caller periodically; do not send other SEC requests in cooldown.
  let remaining=delay;while(remaining>0){const step=Math.min(remaining,30_000);await wait(step);remaining-=step;}
 }
}
