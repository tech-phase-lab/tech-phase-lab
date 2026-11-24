"use client";
import Link from "next/link";
import Image from "next/image";
import { useResearchLanguage } from "./research/use-research-language";
import styles from "./not-found.module.css";

export default function NotFoundView() {
  const [lang] = useResearchLanguage();
  const ja = lang === "ja";
  return <main className={styles.page} lang={lang}>
    <section className={styles.card} aria-labelledby="not-found-title">
      <Image className={styles.mark} src="/tech-phase-192.png" alt="" width={56} height={56} priority />
      <p className={styles.code}>404</p>
      <h1 id="not-found-title" className={styles.title}>{ja ? "ページが見つかりません" : "Page not found"}</h1>
      <p className={styles.text}>{ja ? "お探しのページは移動したか、削除されたか、URLが間違っている可能性があります。" : "The page may have moved or been removed, or the address may be mistyped."}</p>
      <Link className={styles.home} href="/research">{ja ? "Tech Phaseのホームへ" : "Go to Tech Phase home"}</Link>
    </section>
  </main>;
}
