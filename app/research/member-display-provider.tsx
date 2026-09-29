"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type DisplayPlan = "free" | "pro" | null;
const MemberDisplay = createContext<DisplayPlan>(null);
const ResearchOwner = createContext(false);
/** In-memory presentation state only. Every protected API still verifies membership server-side. */
export function MemberDisplayProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<DisplayPlan>(null);
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    let active = true, generation = 0, lastChecked = 0;
    let request: AbortController | null = null;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    async function check(force = false) {
      if (!force && Date.now() - lastChecked < 30_000) return;
      lastChecked = Date.now(); const current = ++generation;
      request?.abort(); request = new AbortController(); const signal = request.signal;
      if (force) { setPlan(null); setOwner(false); }
      try {
        const response = await fetch("/api/research/member", { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
        const member = await response.json();
        if (!active || signal.aborted || current !== generation) return;
        clearTimeout(expiry);
        if (!response.ok || member.status === "unavailable") { setPlan(null); setOwner(false); return; }
        setOwner(member.status === "signed-in" && member.isAdmin === true);
        const pro = member.status === "signed-in" && member.plan === "pro" && Number.isFinite(member.accessExpiresAt) && member.accessExpiresAt > Date.now();
        setPlan(pro ? "pro" : "free");
        if (pro) expiry = setTimeout(() => { setPlan(null); void check(true); }, Math.min(member.accessExpiresAt - Date.now(), 2147483647));
      } catch { if (active && !signal.aborted && current === generation) { setPlan(null); setOwner(false); } }
    }
    const changed = () => { void check(true); };
    const focused = () => { void check(); };
    void check(); const timer = setInterval(focused, 60_000);
    window.addEventListener("tech-phase:membership-changed", changed);
    window.addEventListener("focus", focused);
    return () => { active = false; request?.abort(); clearTimeout(expiry); clearInterval(timer); window.removeEventListener("tech-phase:membership-changed", changed); window.removeEventListener("focus", focused); };
  }, []);
  return <MemberDisplay.Provider value={plan}><ResearchOwner.Provider value={owner}>{children}</ResearchOwner.Provider></MemberDisplay.Provider>;
}
export function useMemberDisplay() { return useContext(MemberDisplay); }
export function useResearchOwner() { return useContext(ResearchOwner); }
