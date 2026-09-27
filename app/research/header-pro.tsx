"use client";
import { useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import styles from "./research.module.css";
function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  window.addEventListener("popstate", callback);
  return () => { window.removeEventListener("hashchange", callback); window.removeEventListener("popstate", callback); };
}
let returnTo = "/research#research-main";
export default function HeaderPro() {
  const pathname = usePathname();
  const router = useRouter();
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  const open = pathname === "/research" && hash === "#tech-phase-pro";
  return <button type="button" className={styles.headerPro} aria-label="Tech Phase PRO" aria-expanded={open} onClick={() => {
    if (!open) returnTo = pathname + window.location.search + window.location.hash;
    const target = open ? returnTo : "/research#tech-phase-pro";
    if (target.split(/[?#]/)[0] === pathname) {
      window.history.pushState(null, "", target);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      window.scrollTo({ top: 0, behavior: "instant" });
    } else router.push(target);
  }}>PRO</button>;
}
