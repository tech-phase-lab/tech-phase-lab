"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { recoverMember } from "@/lib/research/member-recovery";
import { useIdentityRefresh } from "./identity-provider";

type InitialDisplay = { plan: "free" | "pro"; owner: boolean; ownerMode: boolean; ownerAccount?: boolean; accessExpiresAt: number };
type DisplayPlan = "free" | "pro" | null;
// Presentation hint only (APIs still verify server-side): the last verified paid state lets the header and
// RIZEL'S DESK render at once on the next open; the real check below confirms or clears it.
const HINT_KEY = "tech-phase:member-hint";
function readHint(): InitialDisplay | null {
  try {
    const hint = JSON.parse(window.localStorage.getItem(HINT_KEY) ?? "null") as InitialDisplay | null;
    return (hint?.plan === "pro" || hint?.ownerAccount === true) && Number.isFinite(hint.accessExpiresAt) && hint.accessExpiresAt > Date.now() ? hint : null;
  } catch { return null; }
}
function writeHint(hint: InitialDisplay | null) {
  try { if (hint) window.localStorage.setItem(HINT_KEY, JSON.stringify(hint)); else window.localStorage.removeItem(HINT_KEY); } catch { /* storage may be blocked */ }
}
const MemberDisplay = createContext<DisplayPlan>(null);
const ResearchOwner = createContext(false);
const OwnerMode = createContext(false);
const OwnerAccount = createContext(false);
const MemberSettled = createContext(false);
/** In-memory presentation state only. Every protected API still verifies membership server-side. */
export function MemberDisplayProvider({ children, initial }: { children: ReactNode; initial?: InitialDisplay }) {
  const refreshIdentity = useIdentityRefresh();
  const [plan, setPlan] = useState<DisplayPlan>(initial?.plan ?? null);
  const [owner, setOwner] = useState(initial?.owner ?? false);
  const [ownerMode, setOwnerMode] = useState(initial?.ownerMode ?? false);
  const [ownerAccount, setOwnerAccount] = useState(initial?.ownerAccount ?? false);
  // Owner, Oct 10: the app must not open on FREE before the check answers.
  const [settled, setSettled] = useState(initial !== undefined);
  useEffect(() => {
    let active = true, generation = 0, lastChecked = 0;
    let request: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    function retrySoon() {
      if (retries++ < 3) retryTimer = setTimeout(() => { void check(true, true); }, 2_000);
    }
    let expiry: ReturnType<typeof setTimeout> | undefined;
    async function check(force = false, resume = false) {
      // focus, pageshow and visibilitychange can arrive together on resume.
      // Reuse the running verification instead of aborting/restarting it.
      if (!force && request && !request.signal.aborted) return;
      if (!force && Date.now() - lastChecked < (resume ? 1_000 : 30_000)) return;
      clearTimeout(retryTimer);
      lastChecked = Date.now(); const current = ++generation;
      request?.abort(); request = new AbortController(); const signal = request.signal;
      if (force) { setPlan(null); setOwner(false); setOwnerMode(false); setOwnerAccount(false); setSettled(false); }
      try {
        const { response, member } = await recoverMember(refreshIdentity, AbortSignal.any([signal, AbortSignal.timeout(10000)]), resume || force);
        if (!active || signal.aborted || current !== generation) return;
        clearTimeout(expiry);
        setSettled(true);
        if (!response.ok || member.status === "unavailable") { setPlan(null); setOwner(false); setOwnerMode(false); setOwnerAccount(false); retrySoon(); return; }
        retries = 0;
        setOwner(member.status === "signed-in" && member.isAdmin === true);
        setOwnerMode(member.status === "signed-in" && member.isAdmin === true && member.ownerMode === true);
        // Server-decided: only the approved owner account (never an admin role).
        setOwnerAccount(member.status === "signed-in" && member.ownerAccount === true);
        const pro = member.status === "signed-in" && member.plan === "pro" && Number.isFinite(member.accessExpiresAt) && member.accessExpiresAt > Date.now();
        // A signed-out or restoring session is not a verified FREE membership.
        setPlan(member.status === "signed-in" ? (pro ? "pro" : "free") : null);
        // The owner account reads as a member without a paid plan, so it keeps its own short-lived hint.
        const ownerHint = member.status === "signed-in" && member.ownerAccount === true;
        writeHint(pro || ownerHint ? { plan: pro ? "pro" : "free", owner: member.isAdmin === true, ownerMode: member.ownerMode === true, ownerAccount: ownerHint, accessExpiresAt: pro ? member.accessExpiresAt : Date.now() + 7 * 24 * 3_600_000 } : null);
        if (pro) expiry = setTimeout(() => { setPlan(null); void check(true); }, Math.min(member.accessExpiresAt - Date.now(), 2147483647));
      } catch (error) { if (error instanceof Error && error.message === "identity-loading") return; if (active && !signal.aborted && current === generation) { setSettled(true); setPlan(null); setOwner(false); setOwnerMode(false); setOwnerAccount(false); retrySoon(); } }
      finally { if (current === generation) request = null; }
    }
    const changed = () => { retries = 0; void check(true); };
    const focused = () => { if (document.visibilityState === "visible") void check(false, true); };
    const periodic = () => { if (document.visibilityState === "visible") void check(); };
    if (initial?.plan === "pro") expiry = setTimeout(() => { setPlan(null); void check(true); }, Math.max(0, Math.min(initial.accessExpiresAt - Date.now(), 2147483647)));
    const hint = initial ? null : readHint();
    if (hint) {
      setPlan(hint.plan); setOwner(hint.owner); setOwnerMode(hint.ownerMode); setOwnerAccount(hint.ownerAccount === true); setSettled(true);
      if (hint.plan === "pro") expiry = setTimeout(() => { setPlan(null); void check(true); }, Math.max(0, Math.min(hint.accessExpiresAt - Date.now(), 2147483647)));
    }
    void check(); const timer = setInterval(periodic, 60_000);
    window.addEventListener("tech-phase:membership-changed", changed);
    window.addEventListener("focus", focused);
    window.addEventListener("online", changed);
    document.addEventListener("visibilitychange", focused);
    window.addEventListener("pageshow", focused);
    return () => { active = false; request?.abort(); clearTimeout(expiry); clearTimeout(retryTimer); clearInterval(timer); window.removeEventListener("online", changed); window.removeEventListener("tech-phase:membership-changed", changed); window.removeEventListener("focus", focused); document.removeEventListener("visibilitychange", focused); window.removeEventListener("pageshow", focused); };
  }, [initial, refreshIdentity]);
  return <MemberDisplay.Provider value={plan}><ResearchOwner.Provider value={owner}><OwnerMode.Provider value={ownerMode}><OwnerAccount.Provider value={ownerAccount}><MemberSettled.Provider value={settled}>{children}</MemberSettled.Provider></OwnerAccount.Provider></OwnerMode.Provider></ResearchOwner.Provider></MemberDisplay.Provider>;
}
export function useMemberDisplay() { return useContext(MemberDisplay); }
export function useResearchOwner() { return useContext(ResearchOwner); }
export function useOwnerMode() { return useContext(OwnerMode); }
/** True only for the approved owner account (header "運営者/Owner" label). */
export function useOwnerAccount() { return useContext(OwnerAccount); }
/** False while the first membership check is still running (header shows no plan yet). */
export function useMemberSettled() { return useContext(MemberSettled); }
