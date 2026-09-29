import type { Language } from "@/lib/research/data";
import styles from "./index-strip.module.css";

export default function IndexStrip({ lang }: { lang: Language }) {
  return <section className={styles.strip} aria-label={lang === "ja" ? "主要3指数のCFD参考値" : "Three index CFD reference quotes"}>
    <p className={styles.heading}>{lang === "ja" ? "主要3指数 · CFD参考値" : "Three major indices · Indicative CFDs"}</p>
    <iframe className={styles.quotes} src={`/research/market/ticker-widget?lang=${lang}`} title={lang === "ja" ? "ダウ・NASDAQ 100・S&P 500の価格と騰落率" : "Dow, NASDAQ 100 and S&P 500 quotes and changes"} />
  </section>;
}
