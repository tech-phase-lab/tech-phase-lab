"use client";
import type { Language } from "@/lib/research/data";
import styles from "./plan-cards.module.css";

/** The plan introduction cards (owner's design, Oct 27): one line per feature, "name｜description", with a small square,
 * grouped under small headings. Nothing here promises results, and stock prices and charts are not called "real-time". */
type Row = [name: string, note?: string];
type Group = { title: string; rows: Row[] };

export default function PlanCards({ lang }: { lang: Language }) {
  const ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  const free: Group[] = [
    { title: t("ニュース", "News"), rows: [
      [t("決算と経済指標の速報", "Earnings and economic flashes")],
      [t("米国市場の一般ニュース", "U.S. market news")],
      [t("ハイテク速報", "Tech Alerts"), t("30分遅れ・見出しのみ・5件", "30 min delay · headlines · 5 items")],
    ] },
    { title: t("調べる", "Explore"), rows: [
      [t("米国株の銘柄検索", "U.S. stock search")],
      [t("株価とチャートの確認", "Prices and charts")],
      [t("決算・経済指標カレンダー", "Earnings & economic calendar")],
      [t("指数・債券・為替のマーケット情報", "Indices, bonds and currencies")],
      [t("資本マップ", "Capital Map"), t("企業・著名人の保有銘柄が分かる", "What companies and notable investors hold")],
    ] },
    { title: t("自分用", "For you"), rows: [
      [t("ウォッチリストの銘柄登録", "Your stock watchlist")],
      [t("保存したリサーチ", "Saved research"), t("メモ・PDFで保存", "Save with notes or as PDF")],
      [t("銘柄手帳", "Stock Notebook"), t("ウォッチ銘柄の動きをまとめて確認", "Your watchlist's moves in one place")],
    ] },
  ];
  const pro: Group[] = [
    { title: t("読み解く", "Understand"), rows: [
      [t("決算リサーチ", "Earnings research"), t("一手先まで読む独自の分析", "Our own analysis, a step ahead")],
      [t("連関マップ", "Relationship maps"), t("競合・提携・協業の関係を図解", "Rivals, partners and collaborators mapped")],
      [t("テーマランキング", "Theme Ranking"), t("いま強い分野がすぐ分かる", "See which themes are strong now")],
      [t("銘柄比較 PRO", "Compare PRO"), t("迷う2〜3銘柄を瞬時に見極める", "Weigh 2–3 stocks at a glance")],
    ] },
    { title: t("すぐ知る", "Know first"), rows: [
      [t("ハイテク速報", "Tech Alerts"), t("リアルタイム・全件・詳細表示", "Real-time · every item · details")],
      [t("スマホ通知", "Mobile alerts"), t("目標株価・決算・指標・ニュース", "Price targets, earnings, data, news")],
      [t("監視22銘柄", "22 Tracked Stocks"), t("主要株の変化を見逃さない", "Keep up with the key stocks")],
      [t("厳選ニュース", "Selected news"), t("細かな企業発表まで配信", "Down to the smaller company releases")],
    ] },
    { title: t("会員だけの場", "Members only"), rows: [
      [t("週刊 Tech Phase PRO", "Tech Phase PRO Weekly"), t("1週間の変化と展望", "The week's shifts and outlook")],
      [t("リゼルのひとりごと", "RIZEL's Notes"), t("文章と音声で相場を語る", "Markets in words and audio")],
      [t("リゼルに聞く", "Ask Rizel"), t("会員の疑問を厳選して深掘り", "Member questions, explored")],
    ] },
  ];
  const groups = (list: Group[]) => list.map(group => <section key={group.title} className={styles.group}>
    <h4><span>{group.title}</span></h4>
    <ul>{group.rows.map(([name, note]) => <li key={name}><i aria-hidden="true" />{note ? <><b>{name}</b><em aria-hidden="true" /><span>{note}</span></> : <span className={styles.plain}>{name}</span>}</li>)}</ul>
  </section>);
  return <div className={styles.stack}>
    <article className={styles.proCard}>
      <p className={styles.kicker}>TECH PHASE PRO</p>
      <p className={styles.price}>{t("¥2,980", "$20")}<small>{t(" / 月", " / month")}</small></p>
      <button type="button" className={styles.cta} disabled>{t("お申し込み準備中", "Coming soon")}</button>
      <p className={styles.includes}>{t("無料プランのすべての機能に加えて", "Everything in Free, plus")}</p>
      {groups(pro)}
    </article>
    <article className={styles.freeCard}>
      <p className={styles.kicker}>FREE</p>
      <p className={styles.price}>{t("¥0", "$0")}<small>{t(" / 月", " / month")}</small></p>
      <h3>{t("米国株を調べる", "Research US stocks")}</h3>
      {groups(free)}
    </article>
  </div>;
}
