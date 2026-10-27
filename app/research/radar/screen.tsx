"use client";
import { useEffect, useState } from "react";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { arrow, radarGenres, zoneName, zoneOf, xPosition, yPosition, type RadarDotPro, type RadarGenreId, type RadarPayload } from "@/lib/research/radar";
import RadarChart, { fmtCover, fmtPercent } from "./chart";
import styles from "./radar.module.css";

type Loaded = { genre: RadarGenreId; radar: RadarPayload } | "error";
const growthText = (g: number | null) => g === null ? "売上 —" : Math.abs(g) < 0.5 ? "売上 ±0%" : `売上 ${g > 0 ? "+" : "−"}${Math.abs(g).toFixed(0)}%`;
const monthOf = (date: string | null) => { const m = date ? /^(\d{4})-(\d{2})/.exec(date) : null; return m ? `${m[1]}年${Number(m[2])}月時点` : ""; };
const Arrow = ({ kind }: { kind: "up" | "down" | null }) => kind ? <i className={kind === "up" ? styles.up : styles.down} aria-label={kind === "up" ? "前回より上昇" : "前回より低下"}>{kind === "up" ? "↑" : "↓"}</i> : null;

export default function RadarScreen() {
  const [lang, setLang] = useResearchLanguage();
  const [genre, setGenre] = useState<RadarGenreId>(radarGenres[0].id);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/research/radar?genre=${genre}`, { cache: "no-store", signal: controller.signal })
      .then(response => response.json() as Promise<{ ok: boolean; radar?: RadarPayload }>)
      .then(body => setLoaded(body.ok && body.radar ? { genre, radar: body.radar } : "error"))
      .catch(error => { if ((error as Error).name !== "AbortError") setLoaded("error"); });
    return () => controller.abort();
  }, [genre]);
  const radar = loaded && loaded !== "error" && loaded.genre === genre ? loaded.radar : null;
  const pro = radar?.tier === "pro" ? radar : null;
  const ranking = pro ? [...pro.dots].sort((a, b) => a.rank - b.rank) : [];
  return <ResearchToolShell lang={lang} setLang={setLang} title="" description="" showHeading={false}>
    <div className={styles.page}>
      <p className={styles.eyebrow}>FINANCIAL RADAR</p>
      <h1>財務レーダー</h1>
      <p className={styles.lead}>稼ぐ力と守る力を、ジャンルごとに1枚で見比べます。点線は前の決算からの動きです。</p>
      <div className={styles.tabs} role="group" aria-label="ジャンル">
        {radarGenres.map(item => <button type="button" key={item.id} aria-pressed={item.id === genre} className={item.id === genre ? styles.on : ""} onClick={() => { setGenre(item.id); setSelected(null); }}>{item.ja}</button>)}
      </div>
      {loaded === "error" ? <p className={styles.note} role="alert">数値を取得できませんでした。しばらくしてからもう一度お試しください。</p>
        : !radar ? <p className={styles.note} role="status">開示資料を読み込み中…</p>
        : <>
          <section className={styles.card}>
            <p className={styles.axisY}>↑ 守る力 ｜ 現金÷(借入+リース)</p>
            <RadarChart dots={radar.dots} selected={pro ? selected : null} onSelect={pro ? setSelected : undefined} />
            <p className={styles.axisX}>稼ぐ力 ｜ 売上に対する営業キャッシュフロー →</p>
            <ul className={styles.legend}>
              <li><i style={{ background: "#59d6a6" }} />売上が前年より増加</li>
              <li><i style={{ background: "#f08a8a" }} />減少</li>
              <li><i className={styles.hollow} style={{ borderColor: "#cfd8e3" }} />大きさ=売上規模</li>
              <li><i className={styles.hollow} style={{ borderColor: "#59d6a6" }} />白抜き=売上の比較なし</li>
              {pro && <li><b aria-hidden="true">┈</b>点線=前の決算から</li>}
            </ul>
          </section>
          {pro ? <section className={styles.ranking}>
            <header><h2>体力ランキング</h2><small>最新の決算 ・ {monthOf(pro.asOf)}</small></header>
            {ranking.map(dot => <RankCard key={dot.ticker} dot={dot} />)}
            {pro.missing.length > 0
              ? <details className={styles.missing}><summary>データが足りない銘柄 ・ {pro.missing.length}件</summary><p>{pro.missing.join("　")}</p></details>
              : <p className={styles.missing}>データが足りない銘柄 ・ 0件</p>}
          </section> : <section className={styles.locked} aria-label="PRO限定">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            <span>PRO限定</span>
          </section>}
        </>}
      <p className={styles.foot}>数字は米SECの開示資料から計算しています。範囲を超える値はグラフの端に表示します。売買をすすめるものではありません。</p>
      <p className={styles.foot}>稼ぐ力は営業キャッシュフローの売上に対する割合です。守る力の現金は現金同等物と短期の投資、借入は短期・長期の借入とリース負債の合計です。売上や現金の流れは、年の決算の日は1年分、それ以外は直近4四半期分を使います。</p>
    </div>
  </ResearchToolShell>;
}

function RankCard({ dot }: { dot: RadarDotPro }) {
  const zone = zoneOf(dot.ocfMargin, dot.cover);
  const g = dot.growth;
  return <article className={styles.rank}>
    <div className={styles.rankTop}>
      <b>{dot.ticker}</b><span className={`${styles.chip} ${styles[zone]}`}>{zoneName[zone]}</span>
      <em className={g === null || Math.abs(g) < 0.5 ? styles.flat : g > 0 ? styles.up : styles.down}>{growthText(g)}</em>
    </div>
    <div className={styles.bar}><span>稼ぐ力</span><div><u className={styles.fcf} style={{ width: `${Math.max(3, xPosition(dot.ocfMargin) * 100)}%` }} /></div><strong>{fmtPercent(dot.ocfMargin)} <Arrow kind={arrow(dot.ocfMargin, dot.previous?.ocfMargin)} /></strong></div>
    <div className={styles.bar}><span>守る力</span><div><u className={styles.cover} style={{ width: `${Math.max(3, yPosition(dot.cover) * 100)}%` }} /></div><strong>{fmtCover(dot.cover)} <Arrow kind={arrow(dot.cover, dot.previous?.cover)} /></strong></div>
  </article>;
}
