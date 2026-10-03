"use client";

import { useEffect, useState } from "react";
import styles from "./styles.module.css";

type Company = { ticker: string; name: string; exchange?: string };

export default function TickerSearch({ lang, selection, onSelect }: { lang: "ja" | "en"; selection: string[]; onSelect: (slot: number, company: Company) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Company[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;

  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/research/stocks?q=${encodeURIComponent(query)}&limit=20`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || !data.ok || !Array.isArray(data.results)) throw Error();
        setResults(data.results); setStatus("ready");
      } catch { if (!controller.signal.aborted) setStatus("error"); }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  return <details className={styles.tickerSearch}>
    <summary>{t("ティッカー検索", "Find a ticker")}</summary>
    <input id="comparison-ticker-search" type="search" aria-label={t("ティッカー検索", "Find a ticker")} value={query} autoComplete="off" spellCheck={false} placeholder={t("例：テスラ、Tesla、TSLA", "e.g. Tesla, TSLA, テスラ")} onChange={event => {
      const value = event.target.value; setQuery(value); setResults([]); setStatus(value.trim() ? "loading" : "idle");
    }} />
    <small>{t("日本語名、英語名どちらでも検索できます。", "Search by Japanese or English company name.")}</small>
    <div role="status" aria-live="polite">
      {status === "loading" && <p>{t("検索中…", "Searching…")}</p>}
      {status === "error" && <p>{t("検索結果を取得できませんでした。もう一度入力してください。", "Could not retrieve results. Please enter your search again.")}</p>}
      {status === "ready" && !results.length && <p>{t("該当する銘柄が見つかりません。英語名や別の表記もお試しください。", "No matching stocks found. Try the English name or another spelling.")}</p>}
    </div>
    {results.length > 0 && <ul className={styles.tickerResults}>{results.map(company => <li key={company.ticker}>
      <div><strong>{company.name} ({company.ticker})</strong><small>{company.exchange}</small></div>
      <div className={styles.tickerActions}>{[0, 1, 2].map(slot => <button key={slot} type="button" disabled={selection.some(ticker => ticker === company.ticker)} onClick={() => onSelect(slot, company)} aria-label={t(`${company.ticker}を${slot + 1}社目に追加`, `Add ${company.ticker} as Company ${slot + 1}`)}>{t(`${slot + 1}社目へ`, `Company ${slot + 1}`)}</button>)}</div>
    </li>)}</ul>}
  </details>;
}
