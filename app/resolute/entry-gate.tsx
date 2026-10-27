"use client";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BAR_EVENT, BAR_STATE_KEY, needsRefresh, parseBarState, writeBarState } from "@/lib/research/resolute-bar-state";
import { FIRST_VISIT_KEY, entryDecision, signedInFromCookies } from "@/lib/resolute/landing-gate";
import { requestPlan } from "@/lib/resolute/plan-client";

/** Opening RESOLUTE: a purchaser goes to the home (the quiz first, once), everyone else sees the landing page.
 * Decided from what this device remembers, refreshed in the background; while the device cannot say for
 * sure the page stays plain dark, so a purchaser never sees the landing page, not even for a moment. */
function subscribe(notify: () => void) {
 window.addEventListener("storage", notify);
 window.addEventListener(BAR_EVENT, notify);
 return () => { window.removeEventListener("storage", notify); window.removeEventListener(BAR_EVENT, notify); };
}
const snapshot = () => {
 try { return `${localStorage.getItem(BAR_STATE_KEY) ?? ""}|${signedInFromCookies(document.cookie) ? "1" : "0"}|${localStorage.getItem(FIRST_VISIT_KEY) ?? ""}`; } catch { return "||"; }
};
const serverSnapshot = () => "";
const splash = <div style={{ minHeight: "100vh", background: "#070b14" }} aria-hidden="true" />;

export default function EntryGate({ landing, children }: { landing: ReactNode; children: ReactNode }) {
 const router = useRouter();
 const [failed, setFailed] = useState(false);
 const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
 const [stateRaw, signedRaw, visited] = raw.split("|");
 const signedIn = raw === "" ? null : signedRaw === "1";
 const decision = entryDecision(stateRaw || null, signedIn);
 const firstVisit = decision === "home" && !visited;

 useEffect(() => {
  if (signedIn === null) return;
  if (decision !== "unknown" && !needsRefresh(parseBarState(stateRaw || null), signedIn, Date.now())) return;
  const controller = new AbortController();
  (async () => {
   try {
    const response = await fetch("/api/resolute/entitlements", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
    if (controller.signal.aborted) return;
    if (response.status === 401) { writeBarState({ owned: false, anon: true }); return; }
    if (!response.ok) { setFailed(true); return; }
    const body = await response.json();
    if (body && typeof body.canUseTools === "boolean") writeBarState({ owned: body.canUseTools, anon: false }); else setFailed(true);
   } catch { if (!controller.signal.aborted) setFailed(true); }
  })();
  return () => controller.abort();
 }, [signedIn, decision, stateRaw]);

 useEffect(() => {
  if (!firstVisit) return;
  const controller = new AbortController();
  requestPlan(undefined, controller.signal).then(snapshot => {
   if (controller.signal.aborted) return;
   try { localStorage.setItem(FIRST_VISIT_KEY, "1"); } catch { /* storage may be blocked */ }
   window.dispatchEvent(new Event(BAR_EVENT));
   if (snapshot.plan === null) router.replace("/resolute/diagnosis");
  }, () => {
   // Cannot tell: show the home rather than keep the purchaser waiting.
   if (!controller.signal.aborted) { try { localStorage.setItem(FIRST_VISIT_KEY, "1"); } catch { /* storage may be blocked */ } window.dispatchEvent(new Event(BAR_EVENT)); }
  });
  return () => controller.abort();
 }, [firstVisit, router]);

 // If the answer cannot be had, the home explains and offers a retry; the landing page is never guessed.
 if (decision === "unknown" && failed) return <>{children}</>;
 if (decision === "unknown" || firstVisit) return splash;
 return decision === "home" ? <>{children}</> : <>{landing}</>;
}
