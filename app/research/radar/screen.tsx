"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { arrow, radarGenres, zoneName, zoneOf, xPosition, yPosition, type RadarDotPro, type RadarGenreId, type RadarPayload } from "@/lib/research/radar";
import RadarChart, { fmtCover, fmtPercent } from "./chart";
import GenrePicker from "./genre-picker";
import styles from "./radar.module.css";

const growthText = (g: number | null) => g === null ? "売上 —" : Math.abs(g) < 0.5 ? "売上 ±0%" : `売上 ${g > 0 ? "+" : "−"}${Math.abs(g).toFixed(0)}%`;
const monthOf = (date: string | null) => { const m = date ? /^(\d{4})-(\d{2})/.exec(date) : null; return m ? `${m[1]}年${Number(m[2])}月時点` : ""; };
const Arrow = ({ kind }: { kind: "up" | "down" | null }) => kind ? <i className={kind === "up" ? styles.up : styles.down} aria-label={kind === "up" ? "前回より上昇" : "前回より低下"}>{kind === "up" ? "↑" : "↓"}</i> : null;

type Payloads = Partial<Record<RadarGenreId, RadarPayload>>;

export default function RadarScreen({ initial }: { initial: RadarPayload | null }) {
  const [lang, setLang] = useResearchLanguage();
  const [genre, setGenre] = useState<RadarGenreId>(radarGenres[0].id);
  // The page arrives with the first genre's dots (FREE view). The API then confirms the plan and adds the PRO parts.
  const [payloads, setPayloads] = useState<Payloads>(() => initial ? { [initial.genre]: initial } : {});
  const [confirmed, setConfirmed] = useState(false);
  const [failed, setFailed] = useState<RadarGenreId | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const requested = useRef(new Set<RadarGenreId>());
  const request = useCallback(async (id: RadarGenreId) => {
    if (requested.current.has(id)) return;
    requested.current.add(id);
    try {
      const response = await fetch(`/api/research/radar?genre=${id}`, { cache: "no-store" });
      const body = await response.json() as { ok: boolean; radar?: RadarPayload };
      if (!body.ok || !body.radar) throw new Error("radar");
      setPayloads(current => ({ ...current, [id]: body.radar }));
      setConfirmed(true);
    } catch { requested.current.delete(id); setFailed(id); }
  }, []);
  // The tab in view first, then the other genres one by one in the background, so that switching is instant.
  useEffect(() => { setFailed(null); void request(genre); }, [genre, request]);
  useEffect(() => {
    if (!confirmed) return;
    void (async () => { for (const item of radarGenres) await request(item.id); })();
  }, [confirmed, request]);
  const radar = payloads[genre] ?? null;
  const pro = radar?.tier === "pro" ? radar : null;
  const ranked = pro ? pro.dots.filter(dot => dot.rank !== null).sort((a, b) => a.rank! - b.rank!) : [];
  const review = pro ? pro.dots.filter(dot => dot.review) : [];
  return <ResearchToolShell lang={lang} setLang={setLang} title="" description="" showHeading={false}>
    <div className={styles.page}>
      <p className={styles.eyebrow}>FINANCIAL RADAR</p>
      <h1>財務レーダー</h1>
      <p className={styles.lead}>稼ぐ力と守る力を、ジャンルごとに1枚で見比べます。点線は前の決算からの動きです。</p>
      <GenrePicker lang={lang} value={genre} onChange={id => { setGenre(id); setSelected(null); }} />
      {!radar && failed === genre ? <p className={styles.note} role="alert">数値を取得できませんでした。しばらくしてからもう一度お試しください。</p>
        : !radar ? <section className={styles.card} aria-hidden="true"><div className={styles.skeleton} /></section>
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
            <p className={styles.order}>並び順:稼ぐ力と守る力の点数の平均。グラフの右上ほど上位です</p>
            {ranked.map(dot => <RankCard key={dot.ticker} dot={dot} />)}
            {review.length > 0 && <h3 className={styles.reviewHead}>要確認(順位外)</h3>}
            {review.map(dot => <RankCard key={dot.ticker} dot={dot} />)}
            {pro.missing.length > 0
              ? <details className={styles.missing}><summary>データが足りない銘柄 ・ {pro.missing.length}件</summary><p>{pro.missing.join("　")}</p></details>
              : <p className={styles.missing}>データが足りない銘柄 ・ 0件</p>}
          </section> : !confirmed ? <section className={styles.rankWait} aria-hidden="true" /> : <section className={styles.locked} aria-label="PRO限定">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            <span>PRO限定</span>
          </section>}
        </>}
      <p className={styles.foot}>数字は米SECの開示資料から計算しています。範囲を超える値はグラフの端に表示します。売買をすすめるものではありません。</p>
      <p className={styles.foot}>前受け金(顧客からの前払い)が大きい会社は、営業キャッシュフローが膨らんで見えます。稼ぐ力が100%を超える銘柄は「要確認」とし、順位からは外しています。</p>
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
    <div className={styles.bar}><span>稼ぐ力</span><div><u className={`${styles.fcf} ${dot.ocfMargin < 0 ? styles.negative : ""}`} style={{ width: `${Math.max(3, dot.noRevenue ? 0 : xPosition(dot.ocfMargin) * 100)}%` }} /></div><strong>{dot.review && !dot.noRevenue && <small className={styles.review}>要確認</small>}{dot.noRevenue ? "売上なし" : fmtPercent(dot.ocfMargin)} <Arrow kind={dot.noRevenue ? null : arrow(dot.ocfMargin, dot.previous?.ocfMargin)} /></strong></div>
    <div className={styles.bar}><span>守る力</span><div><u className={styles.cover} style={{ width: `${Math.max(3, yPosition(dot.cover) * 100)}%` }} /></div><strong>{fmtCover(dot.cover)} <Arrow kind={arrow(dot.cover, dot.previous?.cover)} /></strong></div>
  </article>;
}
