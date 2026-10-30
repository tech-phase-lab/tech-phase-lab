import type { Language } from "@/lib/research/data";
import styles from "./saved-empty.module.css";

/** The empty "保存したリサーチ": a sample of what writing on an article looks like (invented, not a real article), then the way to find one. */
export default function SavedEmpty({ lang, onFind }: { lang: Language; onFind: () => void }) {
  const ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  return <div className={styles.empty}>
    <div className={styles.stack}>
      <span className={styles.backTwo} aria-hidden="true" /><span className={styles.backOne} aria-hidden="true" />
      <div className={styles.card} aria-label={t("書き込みの例", "Example of writing")}>
        <div className={styles.top}><span className={styles.example}>{t("書き込みの例", "Example")}</span></div>
        <p>{ja
          ? <>同社は新工場の<mark className={styles.hl}>稼働を来期の初めに前倒しし</mark>、<br /><span className={styles.ul}>生産能力の引き上げ</span>と<span className={styles.bx}>需要の取り込み</span>を狙う。</>
          : <>The company will <mark className={styles.hl}>start the new fab early next quarter</mark>,<br />aiming to <span className={styles.ul}>raise capacity</span> and <span className={styles.bx}>capture demand</span>.</>}</p>
        <div className={styles.memo}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d9b56a" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z" /></svg>
          <span>{t("次の決算で、設備投資の額を確認する", "Check capital spending at the next earnings")}</span>
        </div>
        <ul className={styles.legend}>
          <li><i className={styles.swHl} />{t("蛍光ペン", "Highlight")}</li><li><i className={styles.swUl} />{t("下線", "Underline")}</li>
          <li><i className={styles.swBx} />{t("囲み", "Box")}</li><li><i className={styles.swMemo} />{t("メモ", "Note")}</li>
        </ul>
      </div>
    </div>
    <h2>{t("気づきを残す、自分だけの一冊。", "A personal notebook for your insights.")}</h2>
    <p className={styles.lead}>{t("何度でも立ち戻れる場所に。", "A place to return to, time and again.")}</p>
    <button type="button" className={styles.find} onClick={onFind}>{t("保存する記事を調べる", "Find articles to save")}</button>
  </div>;
}
