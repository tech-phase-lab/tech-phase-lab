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
      <div className={styles.themeChips} role="group" aria-label={ja ? "テーマを選択" : "Choose a theme"}>{themes.map(item => <button key={item[0]} aria-pressed={theme === item[0]} onClick={() => setTheme(item[0])}>{item[ja ? 1 : 2]}</button>)}</div>
      <div className={styles.themeHeading}><h3>{selected[ja ? 1 : 2]}</h3><span>{selected[3]}</span></div>
      <iframe key={`${lang}-${theme}`} className={styles.themeWidget} src={`/research/market/themes-widget?lang=${lang}&theme=${theme}`} title={`${selected[ja ? 1 : 2]} · TradingView`} />
      <p className={styles.note}>{ja ? "選定した関連銘柄の騰落率です。セクター全体の平均ではありません。" : "Shows individual stock performance, not a theme average or ranked returns. Constituents are illustrative selections."}</p>
    </> : <>
      <p className={styles.heatmapHint}>{ja ? "S&P 500の構成銘柄をセクター別に表示。大きさは時価総額、色は騰落率です。タップして詳しく見られます。" : "S&P 500 stocks grouped by sector. Size reflects market cap; color shows performance. Tap to explore."}</p>
      <iframe key={lang} className={styles.heatmapWidget} src={`/research/market/themes-widget?lang=${lang}&view=heatmap`} title={ja ? "S&P 500 セクターヒートマップ" : "S&P 500 sector heatmap"} />
    </>}
    <p className={styles.note}>{ja ? "データ：TradingView。更新時刻・遅延は各表示をご確認ください。未対応銘柄は表示されない場合があります。" : "Data by TradingView. Check each display for timestamps and delays. Some symbols may be unavailable."} <a href={view === "heatmap" ? "https://www.tradingview.com/heatmap/stock/" : "https://www.tradingview.com/markets/stocks-usa/"} target="_blank" rel="noopener noreferrer">{ja ? "TradingViewで開く" : "Open TradingView"}</a></p>
  </section>;
}
