"use client";

import { useState } from "react";
import Link from "next/link";
import { useStockFavorites } from "../use-stock-favorites";
import { useResearchLanguage } from "../use-research-language";
import ResearchToolShell from "../research-tool-shell";
import styles from "../research-tools.module.css";

type Company = { ticker: string; name: string; sector: { ja: string; en: string } };
export default function Watchlist({ companies }: { companies: Company[] }) {
  const [lang, setLang] = useResearchLanguage();
  const { favorites, toggle, error } = useStockFavorites();
  const [query, setQuery] = useState("");
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const filtered = companies.filter((company) => `${company.ticker} ${company.name} ${company.sector[lang]}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <ResearchToolShell lang={lang} setLang={setLang} title={t("お気に入り銘柄", "Favorite stocks")} description={t("よく見る銘柄を保存して、根拠付きの比較や公式資料へすぐ移動。", "Keep the companies you follow close to their research and official sources.")}>
    <p className={styles.notice}>{t("このブラウザーに保存します。別端末との同期や通知はありません。", "Saved in this browser. Cross-device sync and notifications are not enabled.")}</p>
    {error && <p role="alert" className={styles.error}>{t("保存できませんでした。ブラウザーの保存設定をご確認ください。", "Could not save. Check your browser storage settings.")}</p>}
    <section aria-labelledby="favorites-heading">
      <h2 id="favorites-heading">{t("保存した銘柄", "Saved companies")} <small aria-live="polite">{favorites.length}</small></h2>
      {favorites.length === 0 ? <div className={styles.empty}><strong>{t("まずは、気になる銘柄に☆を。", "Start with a company you follow.")}</strong><p>{t("下の一覧から追加できます。記事の「保存」とは別に管理します。", "Add companies from the list below. These are separate from saved articles.")}</p></div> : <ul className={styles.favorites}>{favorites.map((ticker) => {
        const company = companies.find((item) => item.ticker === ticker);
        return <li key={ticker}>{company ? <Link href={`/research/companies/${ticker}`}><strong>{ticker}</strong><span>{company.name}</span><small>{t("銘柄ページへ →", "Open research →")}</small></Link> : <div><strong>{ticker}</strong><span>{t("現在の監視対象外", "Outside current coverage")}</span></div>}<button onClick={() => toggle(ticker)} aria-label={t(`${ticker}をお気に入りから解除`, `Remove ${ticker} from favorites`)}>★</button></li>;
      })}</ul>}
    </section>
    <section className={styles.section} aria-labelledby="add-favorites-heading">
      <h2 id="add-favorites-heading">{t("お気に入りに追加", "Add favorites")}</h2>
      <p className={styles.description}>{t(`現在はTech Phaseの監視対象${companies.length}社から選べます。`, `Choose from the ${companies.length} companies currently covered by Tech Phase.`)}</p>
      <label className={styles.search}>{t("銘柄を絞り込む", "Filter companies")}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("MU、NVIDIA、半導体…", "MU, NVIDIA, semiconductors…")} /></label>
      <ul className={styles.companyChoices}>{filtered.map((company) => <li key={company.ticker}><button onClick={() => toggle(company.ticker)} aria-pressed={favorites.includes(company.ticker)} aria-label={t(`${company.ticker} ${company.name}をお気に入り${favorites.includes(company.ticker) ? "から解除" : "に追加"}`, `${favorites.includes(company.ticker) ? "Remove" : "Add"} ${company.ticker} ${company.name} ${favorites.includes(company.ticker) ? "from" : "to"} favorites`)}><span aria-hidden="true">{favorites.includes(company.ticker) ? "★" : "☆"}</span><strong>{company.ticker}</strong><span>{company.name}</span><small>{company.sector[lang]}</small></button></li>)}</ul>
      {!filtered.length && <p className={styles.empty}>{t("一致する銘柄がありません。検索語を変更してください。", "No matches. Try another search.")}</p>}
    </section>
  </ResearchToolShell>;
}
