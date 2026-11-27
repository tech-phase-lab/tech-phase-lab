"use client";
import { useLayoutEffect, useRef, useState } from "react";
import StockLogo from "../watchlist/stock-logo";
import type { Language } from "@/lib/research/data";
import { SEARCH_THEMES, THEME_NAMES } from "@/lib/research/search-themes";
import { focusLabel } from "@/lib/research/search-focus";
import type { FocusView } from "@/lib/research/search-focus-server";
import styles from "./stock-theme-discovery.module.css";

const ALL = "all";
const percent = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`;

function Row({ ticker, name, change, onSelect }: { ticker: string; name: string; change: number | null | undefined; onSelect: (ticker: string) => void }) {
  const tone = change == null || change === 0 ? styles.flat : change > 0 ? styles.up : styles.down;
  return <li><button type="button" className={styles.row} onClick={() => onSelect(ticker)}>
    <StockLogo ticker={ticker} className={styles.logo} />
    <span className={styles.names}><b>{ticker}</b><span data-fit="">{name}</span></span>
    {change != null && <span className={`${styles.change} ${tone}`}>{percent(change)}</span>}
  </button></li>;
}

/** 「テーマから探す」 (owner, Nov 26; sheet 01_銘柄検索_最初の画面): one panel of a fixed height. On the left 「すべて」 and the 17 themes, the only
 * part that scrolls, its lower edge darkened while more lie below; on the right the chosen theme's stocks, or for 「すべて」 「今日の注目」:
 * six stocks of the last close (live during the U.S. regular session, with its time) from the shared snapshot (lib/research/search-focus-server.ts). Nothing on this screen grows the page. */
export default function StockThemeDiscovery({ lang, onSelect, focus }: { lang: Language; onSelect: (ticker: string) => void; focus?: FocusView | null }) {
  const ja = lang === "ja";
  const [id, setId] = useState(ALL);
  const [end, setEnd] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const theme = SEARCH_THEMES.find(item => item.id === id);
  // A theme or company name that would not fit its line is set a little smaller (one line, never 「…」).
  useLayoutEffect(() => {
    for (const label of panel.current?.querySelectorAll<HTMLElement>("[data-name],[data-fit]") ?? []) {
      label.removeAttribute("data-tight");
      if (label.scrollWidth > label.clientWidth + 0.5) label.setAttribute("data-tight", "");
    }
  }, [lang, id, focus]);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const update = () => setEnd(element.scrollTop + element.clientHeight >= element.scrollHeight - 2);
    update();
    element.addEventListener("scroll", update, { passive: true });
    return () => element.removeEventListener("scroll", update);
  }, []);
  const themes = [{ id: ALL, label: ja ? "すべて" : "All" }, ...SEARCH_THEMES.map(item => ({ id: item.id, label: ja ? item.ja : item.short ?? item.en }))];
  const changes = focus?.changes ?? {};
  return <section className={styles.root} aria-labelledby="stock-themes-title">
    <div className={styles.heading}><h2 id="stock-themes-title">{ja ? "テーマから探す" : "Explore by theme"}</h2><span>{ja ? `${SEARCH_THEMES.length}テーマ` : `${SEARCH_THEMES.length} themes`}</span></div>
    <div ref={panel} className={styles.panel}>
      <div className={styles.themes} data-end={end || undefined}>
        <ul ref={list} aria-label={ja ? "テーマ" : "Themes"}>{themes.map(item => <li key={item.id}>
          <button type="button" aria-pressed={item.id === id} onClick={() => setId(item.id)}><span data-name="">{item.label}</span></button>
        </li>)}</ul>
      </div>
      <div className={styles.stocks}>
        {theme ? <ul className={styles.rows}>{theme.stocks.map(([ticker, name]) => <Row key={ticker} ticker={ticker} name={name} change={changes[ticker]} onSelect={onSelect} />)}</ul>
          : <>
            <div className={styles.focusHead}><h3>{ja ? "今日の注目" : "In focus today"}</h3>{focus?.session && <span>{focusLabel(focus, lang)}</span>}</div>
            {focus && focus.session && !focus.rows.length ? <p className={styles.quiet}>{ja ? "今日は大きな動きはありませんでした" : "No big moves today"}</p>
              : <ul className={`${styles.rows} ${styles.focusRows}`}>{(focus?.rows ?? []).map(row => <Row key={row.ticker} ticker={row.ticker} name={THEME_NAMES[row.ticker] ?? row.name} change={row.change} onSelect={onSelect} />)}</ul>}
          </>}
      </div>
    </div>
  </section>;
}
