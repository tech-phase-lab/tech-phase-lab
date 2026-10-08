"use client";
import { useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  window.addEventListener("popstate", callback);
  return () => { window.removeEventListener("hashchange", callback); window.removeEventListener("popstate", callback); };
}
let returnTo = "/research#research-main";
/** Open/close the PRO introduction (#tech-phase-pro) and return where the reader was. */
export function useProIntroduction() {
  const pathname = usePathname();
  const router = useRouter();
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  const open = pathname === "/research" && hash === "#tech-phase-pro";
  function toggle(force?: boolean) {
    const opening = force ?? !open;
    if (opening && !open) returnTo = pathname + window.location.search + window.location.hash;
    if (opening === open) return;
    const target = opening ? "/research#tech-phase-pro" : returnTo;
    if (target.split(/[?#]/)[0] === pathname) {
      window.history.pushState(null, "", target);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      window.scrollTo({ top: 0, behavior: "instant" });
    } else router.push(target);
  }
  return { open, toggle };
}
