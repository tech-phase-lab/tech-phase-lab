"use client";
import { useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useFavoriteLists } from "../watchlist/use-favorite-lists";
import { useResearchLanguage } from "../use-research-language";
import ListWheel from "../watchlist/list-wheel";
import { watchlistSlots } from "@/lib/research/favorite-lists";
import { WEEK_TICKER_LIMIT } from "@/lib/research/watchlist-week";
import { weekRangeLabel } from "@/lib/research/stock-notebook";
import StockNotebook from "./stock-notebook";
import WeekMoves from "./week-moves";
import EmptyNotebook from "./empty-notebook";
import styles from "./screen.module.css";

const ALL = "all";
const WEEKS_BACK_LIMIT = 4;
/** A list a person made while trying the sync out is not something to show a reader. */
const looksLikeTest = (name: string) => /同期確認|テスト|\btest\b/i.test(name);

export default function NotebookScreen() {
  const [lang, setLang] = useResearchLanguage();
  const t = (a: string, b: string) => lang === "ja" ? a : b;
  const { lists, ready } = useFavoriteLists();
  const [choice, setChoice] = useState(ALL);
  const [weeksBack, setWeeksBack] = useState(0);
  const [now] = useState(() => Date.now());
  // A member can keep up to seven lists; the notebook reads one list at a time, or all of them together.
  const filled = watchlistSlots(lists).map((list, index) => ({ id: list.id, tickers: list.tickers, name: list.name, label: list.name || t(`マイリスト${index + 1}`, `My list ${index + 1}`) }))
    .filter(list => list.tickers.length > 0 && !looksLikeTest(list.name));
  const everything = [...new Set(filled.flatMap(list => list.tickers))].sort();
  const selected = filled.find(list => list.id === choice);
  const tickers = (selected ? [...selected.tickers].sort() : everything).slice(0, WEEK_TICKER_LIMIT);
  const wheel = [...(filled.length > 1 ? [{ id: ALL, label: t("すべて", "All"), count: everything.length }] : []), ...filled.map(list => ({ id: list.id, label: list.label, count: list.tickers.length }))];
  const range = weekRangeLabel(now, weeksBack);

  return <ResearchToolShell lang={lang} setLang={setLang} title={t("銘柄手帳", "Stock Notebook")} description="" showHeading={false}>
    <div className={styles.page}>
      <span className={styles.ribbon} aria-hidden="true" />
      <p className={styles.eyebrow}>STOCK NOTEBOOK</p>
      <h1>{t("銘柄手帳", "Stock Notebook")}</h1>
      <p className={styles.lead}>{t("ウォッチリストの銘柄の、今週の動きを一冊にまとめます。", "This week's moves for the stocks on your watchlist, in one book.")}</p>
      {!ready ? <p role="status" className={styles.status}>{t("確認中…", "Checking…")}</p>
        : everything.length ? <>
          <div className={styles.controls}>
            <div className={styles.week}>
              <button type="button" aria-label={t("前の週", "Previous week")} disabled={weeksBack >= WEEKS_BACK_LIMIT} onClick={() => setWeeksBack(value => value + 1)}>‹</button>
              <time>{range}</time>
              <button type="button" aria-label={t("次の週", "Next week")} disabled={weeksBack === 0} onClick={() => setWeeksBack(value => Math.max(0, value - 1))}>›</button>
            </div>
            {wheel.length > 0 && <ListWheel triggerClass={styles.listButton} items={wheel} value={selected ? selected.id : filled.length > 1 ? ALL : filled[0].id}
              title={t("リストを選ぶ", "Choose a list")} doneLabel={t("決定", "Done")} stocksLabel={count => t(`${count}銘柄`, `${count}`)} onChange={id => setChoice(id)} />}
          </div>
          {everything.length > WEEK_TICKER_LIMIT && !selected && <p className={styles.cap}>{t(`登録が多いため、先頭の${WEEK_TICKER_LIMIT}銘柄を集計しています。リストを選ぶと、そのリストの分を集計します。`, `Showing the first ${WEEK_TICKER_LIMIT} stocks. Pick a list to see that list.`)}</p>}
          {weeksBack === 0 ? <WeekMoves key={tickers.join(",")} tickers={tickers} lang={lang} /> : <p className={styles.cap}>{t("値動きは、今週の分だけ表示します。", "Price moves are shown for this week only.")}</p>}
          <StockNotebook key={`${tickers.join(",")}:${weeksBack}`} tickers={tickers} lang={lang} weeksBack={weeksBack} />
        </>
        : <EmptyNotebook lang={lang} range={range} />}
      <p className={styles.notice}><span aria-hidden="true">🔔</span><span>{t("日曜の夜に、今週のまとめをスマホへ通知できます", "Get a phone notice on Sunday night when this week's recap is ready")}</span><Link href="/research/notifications">{t("設定へ ›", "Settings ›")}</Link></p>
    </div>
  </ResearchToolShell>;
}
