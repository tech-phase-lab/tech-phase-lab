/** Runs once per document; client navigation and returning from background do not replay it. */
export const launchBoot = `(function(){
var el=document.getElementById('tech-phase-launch');
if(!el||window.__techPhaseLaunchStarted)return;
window.__techPhaseLaunchStarted=true;
var nav=performance.getEntriesByType('navigation')[0];
if(nav&&nav.type==='back_forward')return;
function dismiss(){delete el.dataset.active;document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',dismiss);}
function hide(){if(document.visibilityState!=='visible')dismiss();}
function start(){
 document.removeEventListener('visibilitychange',ready);
 el.dataset.active='true';
 document.addEventListener('visibilitychange',hide);
 window.addEventListener('pagehide',dismiss);
 window.setTimeout(dismiss,1200);
}
function ready(){if(document.visibilityState==='visible')start();}
if(document.visibilityState==='visible')start();
else document.addEventListener('visibilitychange',ready);
})();`;
