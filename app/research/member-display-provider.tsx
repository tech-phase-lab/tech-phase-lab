"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { recoverMember } from "@/lib/research/member-recovery";
import { useIdentityRefresh } from "./identity-provider";

type InitialDisplay = { plan: "free" | "pro"; owner: boolean; ownerMode: boolean; accessExpiresAt: number };
type DisplayPlan = "free" | "pro" | null;
const MemberDisplay = createContext<DisplayPlan>(null);
const ResearchOwner = createContext(false);
const OwnerMode = createContext(false);
/** In-memory presentation state only. Every protected API still verifies membership server-side. */
export function MemberDisplayProvider({ children, initial }: { children: ReactNode; initial?: InitialDisplay }) {
  const refreshIdentity = useIdentityRefresh();
  const [plan, setPlan] = useState<DisplayPlan>(initial?.plan ?? null);
  const [owner, setOwner] = useState(initial?.owner ?? false);
  const [ownerMode, setOwnerMode] = useState(initial?.ownerMode ?? false);
  useEffect(() => {
    let active = true, generation = 0, lastChecked = 0;
    let request: AbortController | null = null;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    async function check(force = false, resume = false) {
      if (!force && !resume && Date.now() - lastChecked < 30_000) return;
      lastChecked = Date.now(); const current = ++generation;
      request?.abort(); request = new AbortController(); const signal = request.signal;
      if (force) { setPlan(null); setOwner(false); setOwnerMode(false); }
      try {
        const { response, member } = await recoverMember(refreshIdentity, AbortSignal.any([signal, AbortSignal.timeout(10000)]), resume || force);
        if (!active || signal.aborted || current !== generation) return;
        clearTimeout(expiry);
        if (!response.ok || member.status === "unavailable") { setPlan(null); setOwner(false); setOwnerMode(false); return; }
        setOwner(member.status === "signed-in" && member.isAdmin === true);
        setOwnerMode(member.status === "signed-in" && member.isAdmin === true && member.ownerMode === true);
        const pro = member.status === "signed-in" && member.plan === "pro" && Number.isFinite(member.accessExpiresAt) && member.accessExpiresAt > Date.now();
        setPlan(pro ? "pro" : "free");
        if (pro) expiry = setTimeout(() => { setPlan(null); void check(true); }, Math.min(member.accessExpiresAt - Date.now(), 2147483647));
      } catch (error) { if (error instanceof Error && error.message === "identity-loading") return; if (active && !signal.aborted && current === generation) { setPlan(null); setOwner(false); setOwnerMode(false); } }
    }
    const changed = () => { void check(true); };
    const focused = () => { if (document.visibilityState === "visible") void check(false, true); };
    const periodic = () => { if (document.visibilityState === "visible") void check(); };
    if (initial?.plan === "pro") expiry = setTimeout(() => { setPlan(null); void check(true); }, Math.max(0, Math.min(initial.accessExpiresAt - Date.now(), 2147483647)));
    void check(); const timer = setInterval(periodic, 60_000);
    window.addEventListener("tech-phase:membership-changed", changed);
    window.addEventListener("focus", focused);
    document.addEventListener("visibilitychange", focused);
    window.addEventListener("pageshow", focused);
    return () => { active = false; request?.abort(); clearTimeout(expiry); clearInterval(timer); window.removeEventListener("tech-phase:membership-changed", changed); window.removeEventListener("focus", focused); document.removeEventListener("visibilitychange", focused); window.removeEventListener("pageshow", focused); };
  }, [initial, refreshIdentity]);
  return <MemberDisplay.Provider value={plan}><ResearchOwner.Provider value={owner}><OwnerMode.Provider value={ownerMode}>{children}</OwnerMode.Provider></ResearchOwner.Provider></MemberDisplay.Provider>;
}
export function useMemberDisplay() { return useContext(MemberDisplay); }
export function useResearchOwner() { return useContext(ResearchOwner); }
export function useOwnerMode() { return useContext(OwnerMode); }
