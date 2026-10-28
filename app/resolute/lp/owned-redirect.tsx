"use client";
import { useEffect } from "react";
import { BAR_STATE_KEY, needsRefresh, parseBarState, writeBarState } from "@/lib/research/resolute-bar-state";

/** A purchaser must never see this page. The remembered answer hides the page before it is painted
 * (see the inline guard in landing.tsx); the purchase answer is refreshed in the background and, if it says
 * "purchased", the visitor is taken to RESOLUTE. Signed-out and unknown stay on the page. */
export default function OwnedRedirect() {
 useEffect(() => {
  const go = () => window.location.replace("/resolute");
  let state = null;
  try { state = parseBarState(localStorage.getItem(BAR_STATE_KEY)); } catch { /* storage may be blocked */ }
  if (state?.owned) { go(); return; }
  if (!needsRefresh(state, false, Date.now())) return;
  const controller = new AbortController();
  (async () => {
   try {
    const response = await fetch("/api/resolute/entitlements", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
    if (controller.signal.aborted) return;
    if (response.status === 401) { writeBarState({ owned: false, anon: true }); return; }
    if (!response.ok) return;
    const body = await response.json();
    if (body && typeof body.canUseTools === "boolean") {
     writeBarState({ owned: body.canUseTools, anon: false });
     if (body.canUseTools) go();
    }
   } catch { /* unknown keeps the page */ }
  })();
  return () => controller.abort();
 }, []);
 return null;
}
