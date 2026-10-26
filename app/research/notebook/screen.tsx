"use client";
import { useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useFavoriteLists } from "../watchlist/use-favorite-lists";
import { useResearchLanguage } from "../use-research-language";
import { watchlistSlots } from "@/lib/research/favorite-lists";
import { WEEK_TICKER_LIMIT } from "@/lib/research/watchlist-week";
import StockNotebook from "./stock-notebook";
import WeekMoves from "./week-moves";
import styles from "./screen.module.css";

const ALL = "all";

export default function NotebookScreen() {
  const [lang, setLang] = useResearchLanguage();
  const t = (a: string, b: string) => lang === "ja" ? a : b;
  const { lists, ready } = useFavoriteLists();
  const [choice, setChoice] = useState(ALL);
  // A member can keep up to seven lists; the notebook reads one list at a time, or all of them together.
  const filled = watchlistSlots(lists).map((list, index) => ({ id: list.id, tickers: list.tickers, label: list.name || t(`マイリスト${index + 1}`, `My list ${index + 1}`) })).filter(list => list.tickers.length > 0);
  const everything = [...new Set(filled.flatMap(list => list.tickers))].sort();
  const selected = filled.find(list => list.id === choice);
  const tickers = (selected ? [...selected.tickers].sort() : everything).slice(0, WEEK_TICKER_LIMIT);
  return <ResearchToolShell lang={lang} setLang={setLang} title={t("銘柄手帳", "Stock Notebook")}
    description={t("ウォッチリストの銘柄の、今週の動きをまとめて見られます。", "This week's moves for the stocks on your watchlist.")}>
    {!ready ? <p role="status">{t("確認中…", "Checking…")}</p>
      : everything.length ? <>
        {filled.length > 1 && <div className={styles.chips} role="group" aria-label={t("対象のリスト", "List")}>
          <button type="button" aria-pressed={!selected} className={!selected ? styles.on : ""} onClick={() => setChoice(ALL)}>{t("すべて", "All")}</button>
          {filled.map(list => <button type="button" key={list.id} aria-pressed={selected?.id === list.id} className={selected?.id === list.id ? styles.on : ""} onClick={() => setChoice(list.id)}>{list.label}</button>)}
        </div>}
        {everything.length > WEEK_TICKER_LIMIT && !selected && <p className={styles.cap}>{t(`登録が多いため、先頭の${WEEK_TICKER_LIMIT}銘柄を集計しています。リストを選ぶと、そのリストの分を集計します。`, `Showing the first ${WEEK_TICKER_LIMIT} stocks. Pick a list to see that list.`)}</p>}
        <WeekMoves key={tickers.join(",")} tickers={tickers} lang={lang} />
        <StockNotebook tickers={tickers} lang={lang} />
      </>
      : <p>{t("ウォッチリストに銘柄を追加すると、ここに今週の動きが出ます。", "Add stocks to your watchlist to see their week here.")} <Link href="/research/watchlist">{t("ウォッチリストへ", "Go to Watchlist")}</Link></p>}
  </ResearchToolShell>;
}
