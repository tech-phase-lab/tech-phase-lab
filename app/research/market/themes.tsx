"use client";
import { useState } from "react";
import styles from "./market.module.css";

const themes = [
  ["memory", "メモリ", "Memory", "MU · SNDK · WDC · STX"],
  ["cloud", "AIクラウド", "AI cloud", "NBIS · CRWV · IREN"],
  ["optical", "光通信", "Optical links", "LITE · COHR · CRDO"],
  ["chips", "AI半導体", "AI chips", "NVDA · AMD · AVGO · MRVL"],
  ["security", "サイバーセキュリティ", "Cybersecurity", "CRWD · PANW · ZS · FTNT"],
  ["gold", "金鉱山", "Gold miners", "NEM · AEM · KGC"],
  ["software", "ソフトウェア", "Software", "MSFT · CRM · NOW · ADBE"],
  ["space", "宇宙関連", "Space", "RKLB · ASTS · IRDM"],
  ["power", "電力・冷却", "Power & cooling", "VRT · GEV · BE · VST"],
];
export default function ThemeExplorer({ lang, view }: { lang: "ja" | "en"; view: "themes" | "heatmap" }) {
  const [theme, setTheme] = useState("memory");
  const ja = lang === "ja";
  const selected = themes.find(item => item[0] === theme)!;
  return <section id="market-themes" className={styles.explorer} aria-labelledby="theme-heading">
    <h2 id="theme-heading" className={styles.marketHeading}>{view === "themes" ? (ja ? "セクター別騰落率" : "Sector performance") : (ja ? "ヒートマップ" : "Heatmap")}</h2>
    {view === "themes" ? <>
      <div className={styles.themePicker}>
        <select aria-label={ja ? "テーマを選択" : "Choose a theme"} value={theme} onChange={event => setTheme(event.target.value)}>{themes.map(item => <option key={item[0]} value={item[0]}>{item[ja ? 1 : 2]}</option>)}</select>
      </div>
      <iframe key={`${lang}-${theme}`} className={styles.themeWidget} src={`/research/market/themes-widget?lang=${lang}&theme=${theme}`} title={`${selected[ja ? 1 : 2]} · TradingView`} />
    </> : <>
      <iframe key={lang} className={styles.heatmapWidget} src={`/research/market/themes-widget?lang=${lang}&view=heatmap`} title={ja ? "S&P 500 セクターヒートマップ" : "S&P 500 sector heatmap"} />
    </>}
  </section>;
}
