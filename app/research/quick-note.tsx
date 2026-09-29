"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useResearchOwner } from "./member-display-provider";
import styles from "./quick-note.module.css";
export default function QuickNote() {
  const owner = useResearchOwner();
  const pathname = usePathname();
  if (!owner || pathname === "/research/write" || pathname.endsWith("/widget") || pathname === "/research/editorial") return null;
  return <Link className={styles.button} href="/research/write" aria-label="ひとりごとを書く" title="ひとりごとを書く"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 4 5 5M4 20l1-6L16 3a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L10 19l-6 1Z" /></svg><span>書く</span></Link>;
}
