"use client";
import { useStockFavorites } from "../use-stock-favorites";
import { useResearchLanguage } from "../use-research-language";
import { useEffect, useState } from "react";
import styles from "./price.module.css";
import toastStyles from "../stocks/search-redesign.module.css";

const TOAST_EVENT = "tech-phase:watch-toast";
/** A short message at the bottom of the screen ("ウォッチリストに追加しました"), gone after two seconds. */
export function showWatchToast(message: string) { window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message })); }
export function WatchToast() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (event: Event) => { setMessage(String((event as CustomEvent).detail ?? "")); clearTimeout(timer); timer = setTimeout(() => setMessage(""), 2000); };
    window.addEventListener(TOAST_EVENT, show);
    return () => { window.removeEventListener(TOAST_EVENT, show); clearTimeout(timer); };
  }, []);
  return message ? <div className={toastStyles.toast} role="status"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" /></svg>{message}</div> : null;
}

/** ☆ / ★ at the top right of the stock-search card: adds the stock to the watchlist (the default list), or removes it from every list it is in. */
export default function StarButton({ ticker, name }: { ticker: string; name?: string }) {
  const [lang] = useResearchLanguage();
  const favorites = useStockFavorites();
  const registered = favorites.lists.some(list => list.tickers.includes(ticker));
  const ja = lang === "ja";
  const toggle = () => {
    if (registered) { for (const list of favorites.lists) if (list.tickers.includes(ticker)) favorites.setMembership(list.id, ticker, false); showWatchToast(ja ? "ウォッチリストから外しました" : "Removed from watchlist"); }
    else if (favorites.toggle(ticker, name ?? ticker)) showWatchToast(ja ? "ウォッチリストに追加しました" : "Added to watchlist");
  };
  return <button type="button" className={styles.eye} aria-pressed={registered} disabled={!favorites.editable} onClick={toggle}
    aria-label={registered ? (ja ? "ウォッチリストから外す" : "Remove from watchlist") : (ja ? "ウォッチリストに追加" : "Add to watchlist")} style={registered ? { color: "#f3d98b", borderColor: "rgba(243,217,139,.7)" } : undefined}>
    <svg width="22" height="22" viewBox="0 0 24 24" fill={registered ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" /></svg>
  </button>;
}
