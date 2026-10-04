"use client";
import Link from "next/link";
import ResearchToolShell from "./research-tool-shell";
import { useResearchLanguage } from "./use-research-language";
import styles from "./loading.module.css";

/** Streams before slow page data; navigation stays usable while the page resolves. */
export default function ResearchLoading() {
  const [lang,setLang]=useResearchLanguage();
  const ja=lang==="ja";
  return <ResearchToolShell lang={lang} setLang={setLang} title="" description="" showHeading={false} showTools={false}>
    <nav className={styles.links} aria-label={ja?"よく使う機能":"Quick tools"}>
      <Link href="/research/stocks">{ja?"銘柄検索":"Stock search"}</Link>
      <Link href="/research/watchlist">{ja?"お気に入り":"Watchlist"}</Link>
      <Link href="/research/calendar">{ja?"決算・経済指標":"Earnings & economy"}</Link>
      <Link href="/research/compare">{ja?"銘柄比較PRO":"Compare PRO"}</Link>
    </nav>
    <p role="status" className={styles.status}>{ja?"読み込み中…":"Loading…"}</p>
    <div className={styles.placeholder} aria-hidden="true"><i/><i/><i/></div>
  </ResearchToolShell>;
}
