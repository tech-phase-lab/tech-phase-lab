/** Runs before the header paints: the last verified paid state (same key the display provider keeps) is
 * exposed as a data attribute so CSS can show the owner/PRO label and reload ring on the first paint.
 * Presentation only; the real membership check still confirms or clears it after hydration. */
export const memberHintBoot = `(function(){try{var h=JSON.parse(localStorage.getItem('tech-phase:member-hint')||'null');
if(h&&Number.isFinite(h.accessExpiresAt)&&h.accessExpiresAt>Date.now()){
if(h.ownerAccount===true)document.documentElement.dataset.memberHint='owner';
else if(h.plan==='pro')document.documentElement.dataset.memberHint='pro';}}catch(e){}})();`;
