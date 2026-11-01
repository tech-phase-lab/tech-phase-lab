"use client";
import { useEffect } from "react";

/** Opening a RESOLUTE page must start at the very top, not where the previous page was scrolled to.
 * iPhone Safari restores or keeps an earlier scroll after the first paint, so top is re-asserted a few
 * times until the reader touches the page. */
export function useOpenAtTop() {
 // iPhone in-app view (opened from a home-screen app): the close button and address pill float over the top of the page,
 // which then reaches under the status bar (a top safe area) without being a home-screen app itself. Content must start below them.
 useEffect(()=>{
  try {
   const probe=document.createElement("div"); probe.style.cssText="position:fixed;top:0;left:0;visibility:hidden;padding-top:env(safe-area-inset-top)";
   document.body.appendChild(probe); const inset=parseFloat(getComputedStyle(probe).paddingTop)||0; probe.remove();
   const standalone=(navigator as Navigator & {standalone?:boolean}).standalone===true || window.matchMedia("(display-mode: standalone)").matches;
   // viewport-fit=cover lets the page reach under the status bar: keep clear of it in the home-screen app too.
   if(inset>0) document.documentElement.dataset.overlayBar=standalone?"app":"1"; else delete document.documentElement.dataset.overlayBar;
  } catch { /* optional spacing */ }
  return ()=>{ delete document.documentElement.dataset.overlayBar; };
 },[]);
 useEffect(()=>{
  let touched=false; const stop=()=>{touched=true;};
  const top=()=>{ if(!touched && window.scrollY>0) window.scrollTo(0,0); };
  const previous=history.scrollRestoration;
  try { history.scrollRestoration="manual"; } catch { /* not supported */ }
  window.scrollTo(0,0);
  const frame=requestAnimationFrame(top), timers=[120,400,900,1600].map(ms=>window.setTimeout(top,ms));
  window.addEventListener("touchstart",stop,{passive:true,once:true}); window.addEventListener("wheel",stop,{passive:true,once:true});
  return ()=>{ cancelAnimationFrame(frame); timers.forEach(clearTimeout); window.removeEventListener("touchstart",stop); window.removeEventListener("wheel",stop); try { history.scrollRestoration=previous; } catch { /* not supported */ } };
 },[]);
}
