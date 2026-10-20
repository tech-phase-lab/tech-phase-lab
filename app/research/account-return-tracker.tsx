"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { accountReturnKey, safeAccountReturn } from "@/lib/research/account-return";
import { effectiveHash } from "@/lib/research/view-hash";

/** Capture before Next's link handler changes the address, including menu links. */
export default function AccountReturnTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (/^\/research\/account(?:\/|$)/.test(pathname)) return;
    try { sessionStorage.removeItem(accountReturnKey); } catch { /* Storage is optional. */ }
    function remember(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self")) return;
      const destination = new URL(link.href);
      if (destination.origin !== location.origin || !/^\/research\/account(?:\/sign-up)?\/?$/.test(destination.pathname)) return;
      const path = safeAccountReturn(location.pathname + location.search + effectiveHash());
      if (path) try { sessionStorage.setItem(accountReturnKey, JSON.stringify({ path, at: Date.now() })); } catch { /* Keep the normal account destination. */ }
    }
    document.addEventListener("click", remember, true);
    return () => document.removeEventListener("click", remember, true);
  }, [pathname]);
  return null;
}
