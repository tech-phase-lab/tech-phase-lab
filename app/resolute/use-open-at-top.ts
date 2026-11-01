"use client";
import { useEffect } from "react";

/** Opening a RESOLUTE page must start at the very top, not where the previous page was scrolled to.
 * iPhone Safari restores or keeps an earlier scroll after the first paint, so top is re-asserted a few
 * times until the reader touches the page. */
export function useOpenAtTop() {
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
