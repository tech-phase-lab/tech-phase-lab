"use client";
import { useEffect, useState } from "react";

// Display only; access decisions remain on the server. Never cache member data on disk.
export default function MembershipLabel() {
  const [plan, setPlan] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    let lastChecked = 0;
    const check = async () => {
      if (busy || Date.now() - lastChecked < 60_000) return;
      busy = true;
      lastChecked = Date.now();
      try {
        const response = await fetch("/api/research/member", {cache:"no-store",signal:controller.signal});
        if (!response.ok) throw new Error("membership");
        const member = await response.json();
        setPlan(member.status === "signed-in" && ["free","pro"].includes(member.plan) ? member.plan.toUpperCase() : null);
      } catch { if (!controller.signal.aborted) setPlan(null); }
      finally { busy = false; }
    };
    void check();
    window.addEventListener("focus", check);
    return () => { controller.abort(); window.removeEventListener("focus", check); };
  }, []);
  return <small>{plan ? `RESEARCH · ${plan}` : "RESEARCH"}</small>;
}
