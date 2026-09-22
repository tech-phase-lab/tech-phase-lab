"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Language } from "@/lib/research/data";
import styles from "./company-switcher.module.css";
import { useStockFavorites } from "../use-stock-favorites";

export type CompanyOption = { ticker: string; name: string };

export default function CompanySwitcher({ ticker, companies, lang }: { ticker: string; companies: CompanyOption[]; lang: Language }) {
  const router = useRouter();
  const { favorites, toggle, error } = useStockFavorites();
  return <div className={styles.bar}>
    <Link href="/research#monitored-companies">← {lang === "ja" ? `監視対象${companies.length}社` : `${companies.length} monitored companies`}</Link>
    <button className={styles.favorite} onClick={() => toggle(ticker)} aria-pressed={favorites.includes(ticker)}>{favorites.includes(ticker) ? "★" : "☆"} {lang === "ja" ? "お気に入り" : "Favorite"}</button>
    <label>
      <span>{lang === "ja" ? "銘柄を切り替える" : "Choose company"}</span>
      <select value={ticker} onChange={(event) => {
        const next = companies.find((company) => company.ticker === event.target.value);
        if (next && next.ticker !== ticker) router.push(`/research/companies/${encodeURIComponent(next.ticker)}`);
      }}>
        {companies.map((company) => <option key={company.ticker} value={company.ticker}>{company.ticker} · {company.name}</option>)}
      </select>
    </label>
    {error && <p role="alert">{lang === "ja" ? "お気に入りを保存できませんでした。" : "Could not save favorite."}</p>}
  </div>;
}
