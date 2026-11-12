"use client";
import type { Language } from "@/lib/research/data";
import Link from "next/link";
import ProOfferCard from "./pro-offer-card";
import styles from "./plan-cards.module.css";

/** The only commercial-transactions page on the site today (RESOLUTE's footer link); a Tech Phase PRO page is pending. */
export const TOKUSHOHO_HREF = "/resolute/legal/commerce";

/** The plan introduction cards (owner's design, Oct 27): one line per feature, "name｜description", with a small square,
 * grouped under small headings. Nothing here promises results, and stock prices and charts are not called "real-time". */
type Row = [name: string, note?: string];
type Group = { title: string; rows: Row[] };

function plans(ja: boolean) {
  const t = (a: string, b: string) => ja ? a : b;
  const free: Group[] = [
    { title: t("ニュース", "News"), rows: [
      [t("決算と経済指標の速報", "Earnings and economic updates")],
      [t("米国市場の一般ニュース", "U.S. market news")],
      [t("ハイテク速報", "Tech Alerts"), t("30分遅れ・5件", "30 min delay · 5 items")],
      [t("厳選ニュース", "Selected news"), t("細かな企業発表まで配信", "Selected company updates, including smaller announcements")],
    ] },
    { title: t("調べる", "Explore"), rows: [
      [t("米国株の銘柄検索", "U.S. stock search")],
      [t("株価とチャートの確認", "Prices and charts")],
      [t("決算・経済指標カレンダー", "Earnings & economic calendar")],
      [t("指数・債券・為替のマーケット情報", "Indices, bonds and currencies")],
      [t("資本マップ", "Capital Map"), t("企業・著名人の保有銘柄が分かる", "See what companies and leading investors hold")],
    ] },
    { title: t("自分用", "For you"), rows: [
      [t("ウォッチリストの銘柄登録", "Your stock watchlist")],
      [t("リサーチノート", "Research notes"), t("メモ・PDFで保存", "Save articles, add notes, and export PDFs")],
      [t("銘柄手帳", "Stock Notebook"), t("ウォッチ銘柄の動きをまとめて確認", "Your watchlist's weekly moves, all in one place")],
    ] },
  ];
  const pro: Group[] = [
    { title: t("読み解く", "Understand"), rows: [
      [t("決算リサーチ", "Earnings research"), t("一手先まで読む独自の分析", "Original analysis to help you understand the results")],
      [t("連関マップ", "Relationship maps"), t("競合・提携・協業の関係を図解", "See how companies compete and work together")],
      [t("テーマランキング", "Theme Ranking"), t("いま強い分野がすぐ分かる", "See which themes are leading")],
      [t("銘柄比較 PRO", "Compare PRO"), t("迷う2〜3銘柄を瞬時に見極める", "Compare 2–3 stocks side by side")],
      [t("財務レーダー", "Financial Radar"), t("守る力と稼ぐ力を一望", "Strength and earning power at a glance")],
    ] },
    { title: t("すぐ知る", "Stay up to date"), rows: [
      [t("ハイテク速報", "Tech Alerts"), t("リアルタイム・全件", "Real-time access to all updates")],
      [t("スマホ通知", "Mobile alerts"), t("目標株価・決算・指標・ニュース", "Price targets, earnings, economic data, and news")],
      [t("監視22銘柄", "22 Tracked Stocks"), t("主要株の変化を見逃さない", "Keep up with the key stocks")],
    ] },
    { title: t("資産を管理", "Your portfolio"), rows: [
      [t("米国株の資産管理", "U.S. stock portfolio"), t("スクショで持ち株を登録", "Add holdings from a screenshot")],
    ] },
    { title: t("会員だけの場", "Members only"), rows: [
      [t("週刊 Tech Phase PRO", "Tech Phase PRO Weekly"), t("1週間の変化と展望", "The week's shifts and outlook")],
      [t("リゼルのひとりごと", "RIZEL's Notes"), t("文章と音声で相場を語る", "Markets in words and audio")],
      [t("リゼルに聞く", "Ask Rizel"), t("会員の疑問を厳選して深掘り", "Answers to selected member questions")],
    ] },
  ];
  return { free, pro };
}
const groups = (list: Group[]) => list.map(group => <section key={group.title} className={styles.group}>
    <h4><span>{group.title}</span></h4>
    <ul>{group.rows.map(([name, note]) => <li key={name}><i aria-hidden="true" />{note ? <><b>{name}</b><em aria-hidden="true" /><span>{note}</span></> : <span className={styles.plain}>{name}</span>}</li>)}</ul>
  </section>);
/** The PRO feature list under the price (shared by the introduction card and the account card). */
export function ProFeatures({ ja }: { ja: boolean }) { return <>{groups(plans(ja).pro)}</>; }
export default function PlanCards({ lang }: { lang: Language }) {
  const ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  const { free, pro } = plans(ja);
  return <div className={styles.stack}>
    <ProOfferCard ja={ja} href="/research/account?upgrade=1">{groups(pro)}</ProOfferCard>
    <article className={styles.freeCard}>
      <div className={styles.head}><span>FREE</span></div>
      <div className={styles.tabsSpacer} aria-hidden="true" />
      <p className={styles.priceRow}><span className={styles.priceN}>{t("0円", "¥0")}</span><span className={styles.priceU}>{t("/ 月", "/ month")}</span></p>
      <h3>{t("米国株を調べる、深く知る。", "Explore US stocks in depth.")}</h3>
      {groups(free)}
    </article>
    <p className={styles.note}>{t("PROプランは自動更新です。解約はマイアカウントからいつでも可能です。", "PRO renews automatically. Cancel anytime from My Account.")}<br />
      <Link href="/terms">{t("利用規約", "Terms")}</Link> ・ <Link href={TOKUSHOHO_HREF}>{t("特定商取引法に基づく表記", "Legal Notice")}</Link></p>
  </div>;
}
