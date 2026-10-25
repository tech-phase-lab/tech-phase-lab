"use client";
import { useMemo } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useFavoriteLists } from "../watchlist/use-favorite-lists";
import { useResearchLanguage } from "../use-research-language";
import { watchlistSlots } from "@/lib/research/favorite-lists";
import StockNotebook from "./stock-notebook";

export default function NotebookScreen() {
  const [lang, setLang] = useResearchLanguage();
  const t = (a: string, b: string) => lang === "ja" ? a : b;
  const { lists, ready } = useFavoriteLists();
  const tickers = useMemo(() => [...new Set(watchlistSlots(lists).flatMap(list => list.tickers))], [lists]);
  return <ResearchToolShell lang={lang} setLang={setLang} title={t("銘柄手帳", "Stock Notebook")}
    description={t("ウォッチリストの銘柄の、今週の動きをまとめて見られます。", "This week's moves for the stocks on your watchlist.")}>
    {!ready ? <p role="status">{t("確認中…", "Checking…")}</p>
      : tickers.length ? <StockNotebook tickers={tickers} lang={lang} />
      : <p>{t("ウォッチリストに銘柄を追加すると、ここに今週の動きが出ます。", "Add stocks to your watchlist to see their week here.")} <Link href="/research/watchlist">{t("ウォッチリストへ", "Go to Watchlist")}</Link></p>}
  </ResearchToolShell>;
}
