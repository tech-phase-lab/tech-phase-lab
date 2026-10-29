import Link from "next/link";
import type { Language } from "@/lib/research/data";
import styles from "./screen.module.css";

/** 銘柄手帳 with no stock on the watchlist: a quiet notebook with a few sample lines, and the way to add stocks. */
export default function EmptyNotebook({ lang, range }: { lang: Language; range: string }) {
  const t = (a: string, b: string) => lang === "ja" ? a : b;
  const samples = [{ kind: "earnings", label: t("決算", "Earnings"), ticker: "NVDA" }, { kind: "targets", label: t("目標株価", "Target"), ticker: "AMD" }, { kind: "news", label: t("ニュース", "News"), ticker: "MU" }] as const;
  return <>
    <section className={styles.book} aria-label={t("まだ何も書かれていません", "Nothing written yet")}>
      <span className={styles.backTwo} aria-hidden="true" /><span className={styles.backOne} aria-hidden="true" />
      <div className={styles.sheet}>
        <span className={styles.spine} aria-hidden="true" />
        {[0, 1, 2, 3, 4, 5].map(index => <i key={index} className={styles.ring} style={{ top: 60 + index * 66 }} aria-hidden="true" />)}
        <div className={styles.paper}>
          <div className={styles.dates}><time>{range}</time><span>{t("今週", "This week")}</span></div>
          <svg className={styles.pen} width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#d9b56a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" /><path d="M14.5 6.5l3 3" /></svg>
          <h2>{t("まだ何も書かれていません", "Nothing written yet")}</h2>
          <p>{lang === "ja" ? <>ウォッチリストに銘柄を入れると<br />決算、目標株価、ニュースが<br />ここに書き込まれます</> : <>Add stocks to your watchlist and<br />earnings, price targets and news<br />will be written here</>}</p>
          <ul className={styles.samples} aria-hidden="true">
            {samples.map(sample => <li key={sample.kind} data-kind={sample.kind}><span>{sample.label}</span><b>{sample.ticker}</b><i><u /><u /></i></li>)}
          </ul>
          <p className={styles.pageNo} aria-hidden="true">— 1 —</p>
        </div>
      </div>
    </section>
    <Link className={styles.add} href="/research/watchlist">＋ {t("ウォッチリストに銘柄を追加", "Add stocks to your watchlist")}</Link>
  </>;
}
