"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MouseEvent } from "react";
import NavigationIcon from "./navigation-icon";
import styles from "./research.module.css";
export default function HomeLink({ lang }: { lang: "ja" | "en" }) {
  const pathname = usePathname();
  function goHome(event: MouseEvent<HTMLAnchorElement>) {
    if (pathname !== "/research") return;
    event.preventDefault();
    if (window.location.hash !== "#research-main") window.history.pushState(null, "", "/research#research-main");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    document.getElementById("research-main")?.scrollIntoView({ behavior: "instant", block: "start" });
  }
  return <Link href="/research#research-main" onClick={goHome} className={styles.homeIcon} aria-label={lang === "ja" ? "ホームへ戻る" : "Back to home"} title={lang === "ja" ? "ホーム" : "Home"}><NavigationIcon name="home" /></Link>;
}
