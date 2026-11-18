"use client";
import { useEffect } from "react";
import { TECH_PHASE_ENTRY_KEY, entersResolute } from "@/lib/resolute/tech-phase-back";

/** Remembers, for this tab, that RESOLUTE was opened from Tech Phase, so its landing page can offer the way back.
 * Captured before Next's link handler changes the address (home bar, menu card, sidebar, account). */
export default function ResoluteEntryMark() {
  useEffect(() => {
    function mark(event: MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || !entersResolute(link.href, location.origin)) return;
      try { sessionStorage.setItem(TECH_PHASE_ENTRY_KEY, "1"); } catch { /* Storage is optional; the referrer still counts. */ }
    }
    document.addEventListener("click", mark, true);
    return () => document.removeEventListener("click", mark, true);
  }, []);
  return null;
}
