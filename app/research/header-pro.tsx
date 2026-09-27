"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./research.module.css";

export default function HeaderPro() {
  const pathname = usePathname();
  return <Link className={styles.headerPro} href="/research#tech-phase-pro" aria-label="Tech Phase PRO" onClick={(event) => {
    if (pathname !== "/research") return;
    event.preventDefault();
    if (window.location.hash !== "#tech-phase-pro") window.history.pushState(null, "", "/research#tech-phase-pro");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.scrollTo({ top: 0, behavior: "instant" });
  }}>PRO</Link>;
}
