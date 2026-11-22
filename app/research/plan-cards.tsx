"use client";
import type { Language } from "@/lib/research/data";
import Link from "next/link";
import ProOfferCard from "./pro-offer-card";
import styles from "./plan-cards.module.css";
import { priceFont } from "./price-font";

/** 特定商取引法に基づく表記 for both Tech Phase Research and RESOLUTE (app/commerce). */
export const TOKUSHOHO_HREF = "/commerce";

/** The plan introduction cards (owner's design, Oct 27): one line per feature, "name｜description", with a small square,
 * grouped under small headings. Nothing here promises results, and stock prices and charts are not called "real-time". */
type Row = [name: string, note?: string];
type Group = { title: string; rows: Row[] };

function plans(ja: boolean) {
  const t = (a: string, b: string) => ja ? a : b;
  // English rows (owner, Nov 22): a short table so every row keeps one line; the Japanese rows are unchanged.
  const free: Group[] = [
    { title: t("ニュース", "News"), rows: [
      [t("決算と経済指標の速報", "Earnings & economic updates")],
      [t("米国市場の注目トピック", "Top US market stories")],
      [t("ハイテク速報", "Tech Alerts"), t("30分遅れ・5件", "5 headlines · 30m lag")],
      [t("厳選ニュース", "Curated News"), t("細かな企業発表まで配信", "Company updates")],
    ] },
    { title: t("調べる", "Explore"), rows: [
      [t("米国株の銘柄検索", "US stock search")],
      [t("株価とチャートの確認", "Prices & charts")],
      [t("決算・経済指標カレンダー", "Earnings & economic calendar")],
      [t("指数・債券・為替のマーケット情報", "Indices, bonds & currencies")],
      [t("資本マップ", "Capital Map"), t("企業・著名人の保有銘柄が分かる", "See who owns what")],
    ] },
    { title: t("自分用", "For you"), rows: [
      [t("ウォッチリストの銘柄登録", "Your watchlist")],
      [t("リサーチノート", "Research Notes"), t("メモ・PDFで保存", "Memos & PDFs")],
      [t("銘柄手帳", "Stock Notebook"), t("ウォッチ銘柄の動きをまとめて確認", "Watchlist moves")],
    ] },
  ];
  // Owner, Nov 22: トレジャーハント and クジラの足あと under テーマランキング; the English rows are short so every row keeps one line.
  const pro: Group[] = [
    { title: t("読み解く", "Understand"), rows: [
      [t("決算リサーチ", "Earnings Research"), t("一手先まで読む独自の分析", "What's next")],
      [t("連関マップ", "Company Map"), t("競合・提携・協業の関係を図解", "Partners & rivals")],
      [t("テーマランキング", "Theme Rankings"), t("いま強い分野がすぐ分かる", "See what's leading")],
      [t("トレジャーハント", "Treasure Hunt"), t("割安銘柄を毎日掘り起こす", "Daily value finds")],
      [t("クジラの足あと", "Whale Tracks"), t("機関・空売り・自社株買いの裏側", "Funds, shorts & buybacks")],
      [t("銘柄比較 PRO", "Compare PRO"), t("迷う2〜3銘柄を瞬時に見極める", "2–3 stocks side by side")],
      [t("財務レーダー", "Financial Radar"), t("守る力と稼ぐ力を一望", "Health & profitability")],
    ] },
    { title: t("すぐ知る", "Stay up to date"), rows: [
      [t("ハイテク速報", "Tech Alerts"), t("リアルタイム・全件", "Every update, live")],
      [t("スマホ通知", "Push Alerts"), t("目標株価・決算・指標・ニュース", "Prices, earnings, data & news")],
      [t("監視22銘柄", "22-Stock Watchlist"), t("主要株の変化を見逃さない", "Track key changes")],
    ] },
    { title: t("資産を管理", "Your portfolio"), rows: [
      [t("米国株の資産管理", "US Portfolio"), t("スクショで持ち株を登録", "Import from a screenshot")],
    ] },
    { title: t("会員だけの場", "Members only"), rows: [
      [t("週刊 Tech Phase PRO", "PRO Weekly"), t("1週間の変化と展望", "Recap & outlook")],
      [t("リゼルのひとりごと", "RIZEL's Notes"), t("文章と音声で相場を語る", "Read or listen")],
      [t("リゼルに聞く", "Ask RIZEL"), t("会員の疑問を厳選して深掘り", "Member Q&A")],
    ] },
  ];
  return { free, pro };
}
const groups = (list: Group[], ja: boolean) => list.map(group => <section key={group.title} className={styles.group}>
    <h4><span>{group.title}</span></h4>
    <ul data-ja={ja}>{group.rows.map(([name, note]) => <li key={name}><i aria-hidden="true" />{note ? <><b>{name}</b><em aria-hidden="true" /><span>{note}</span></> : <span className={styles.plain}>{name}</span>}</li>)}</ul>
  </section>);
/** The PRO feature list under the price (shared by the introduction card and the account card). */
export function ProFeatures({ ja }: { ja: boolean }) { return <>{groups(plans(ja).pro, ja)}</>; }
export default function PlanCards({ lang }: { lang: Language }) {
  const ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  const { free, pro } = plans(ja);
  return <div className={styles.stack}>
    <ProOfferCard ja={ja} href="/research/account?upgrade=1">{groups(pro, ja)}</ProOfferCard>
    <article className={`${styles.freeCard} ${priceFont.variable}`}>
      <div className={styles.head}><span>FREE</span></div>
      <div className={styles.tabsSpacer} aria-hidden="true" />
      <p className={styles.priceRow}><span className={styles.priceN}>{t("0円", "¥0")}</span><span className={styles.priceU}>{t("/ 月", "/ month")}</span></p>
      <h3>{t("米国株を調べる、深く知る。", "Explore US stocks in depth.")}</h3>
      {groups(free, ja)}
    </article>
    <p className={styles.note}>{t("PROプランは自動更新です。解約はマイアカウントからいつでも可能です。", "PRO renews automatically. Cancel anytime from My Account.")}<br />
      <Link href="/terms">{t("利用規約", "Terms")}</Link>{t(" ・ ", " · ")}<Link href={TOKUSHOHO_HREF}>{t("特定商取引法", "Legal Notice")}</Link></p>
  </div>;
}
