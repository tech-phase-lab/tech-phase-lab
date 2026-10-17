type StartupResult = { data: unknown; error?: never } | { error: true; data?: never };
type Startup = { startedAt: number; request: Promise<StartupResult> };
declare global { interface Window { __techPhaseNewsStartup?: Startup } }

/** Start the public feed with the initial HTML, not after the dashboard hydrates. */
export const newsStartupScript = `(function(){
if(window.location.pathname.replace(/\\/$/,'')!=='/research'||document.visibilityState!=='visible'||window.__techPhaseNewsStartup)return;
var began=Date.now();
window.__techPhaseNewsStartup={startedAt:began,request:fetch('/api/research/news',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)})
.then(function(r){console.info('[TechPhase news] response',Date.now()-began,'ms',r.status,r.headers?r.headers.get('server-timing'):'');if(!r.ok)throw Error('News unavailable');return r.json();})
.then(function(data){return {data:data};},function(){return {error:true};})};
})();`;

/** Adopt exactly once, so mounting the panel does not start a second request. */
export function takeNewsStartup(): Promise<StartupResult> | null {
  if (typeof window === "undefined") return null;
  const pending = window.__techPhaseNewsStartup;
  delete window.__techPhaseNewsStartup;
  if (!pending || Date.now() - pending.startedAt > 15_000) return null;
  return pending.request;
}
