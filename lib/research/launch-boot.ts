/** Runs as the initial HTML is parsed, before React or identity SDK hydration. */
export const launchBoot = `(function(){
var el=document.getElementById('tech-phase-launch');
if(!el)return;
var standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
var nav=performance.getEntriesByType('navigation')[0];
// Never show a late splash after the user has already been looking at the page.
if(!standalone||document.visibilityState!=='visible'||performance.now()>1800||nav&&nav.type!=='navigate')return;
try{if(sessionStorage.getItem('tech-phase:launch-seen'))return;sessionStorage.setItem('tech-phase:launch-seen','1');}catch(e){return;}
el.dataset.active='true';
function dismiss(){delete el.dataset.active;document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',dismiss);}
function hide(){if(document.visibilityState!=='visible')dismiss();}
document.addEventListener('visibilitychange',hide);
window.addEventListener('pagehide',dismiss);
window.setTimeout(dismiss,1200);
})();`;
