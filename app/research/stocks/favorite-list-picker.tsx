"use client";

import { useState } from "react";
import { favoriteListLimit } from "@/lib/research/favorite-lists";
import type { useStockFavorites } from "../use-stock-favorites";
import styles from "./favorite-list-picker.module.css";

type Props = { ticker: string; name: string; lang: "ja" | "en"; favorites: ReturnType<typeof useStockFavorites> };

export function FavoriteListPicker({ ticker, name, lang, favorites }: Props) {
  const [edited, setEdited] = useState(false);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const saved = favorites.lists.some(list => list.tickers.includes(ticker));
  return <details className={styles.picker} onKeyDown={event => {
    if (event.key === "Escape") {
      event.currentTarget.open = false;
      event.currentTarget.querySelector("summary")?.focus();
    }
  }}>
    <summary className={styles.trigger} data-saved={saved}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2-4.5-4.4 6.3-.9Z" /></svg>
      {t("ウォッチリスト", "Watchlist")}<span className={styles.chevron} aria-hidden="true">⌄</span>
    </summary>
    <div className={styles.panel}>
      <p className={styles.caption}>{t("登録するリスト", "Save to lists")}</p>
      <div className={styles.options}>
        {favorites.lists.map((list, index) => {
          const included = list.tickers.includes(ticker);
          const full = !included && list.tickers.length >= favoriteListLimit;
          const label = list.name || t(`マイリスト${index + 1}`, `My list ${index + 1}`);
          return <label key={list.id} className={styles.option}>
            <input type="checkbox" checked={included} disabled={!favorites.editable || full}
              onChange={event => { if (favorites.setMembership(list.id, ticker, event.target.checked, name)) setEdited(true); }} />
            <span>{label}</span>{full && <small>{t("上限", "Full")}</small>}
          </label>;
        })}
      </div>
      {!favorites.lists.length && <p role="status">{t("リストを確認中…", "Loading lists…")}</p>}
      {favorites.error ? <p className={styles.status} role="alert">
        {favorites.status === "conflict" ? <a href="/research/watchlist">{t("ウォッチリストで保存内容を確認", "Review changes in your watchlist")}</a>
          : <>{t("保存できていません。", "Not saved. ")}<button type="button" onClick={favorites.retry}>{t("再試行", "Retry")}</button></>}
      </p> : <p className={styles.status} role="status">{favorites.status === "saving" ? t("保存中…", "Saving…")
        : edited ? t(favorites.status === "guest" ? "この端末に保存しました" : "保存しました", favorites.status === "guest" ? "Saved on this device" : "Saved") : ""}</p>}
    </div>
  </details>;
}
