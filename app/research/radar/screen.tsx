"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { quarterOf } from "@/lib/research/radar-period";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { arrow, radarGenres, zoneLabel, zoneOf, xPosition, yPosition, type RadarDotPro, type RadarGenreId, type RadarPayload } from "@/lib/research/radar";
import RadarChart, { fmtCover, fmtPercent } from "./chart";
import GenrePicker from "./genre-picker";
import styles from "./radar.module.css";

const growthText = (g: number | null, ja: boolean) => { const label = ja ? "売上" : "Revenue"; return g === null ? `${label} —` : Math.abs(g) < 0.5 ? `${label} ±0%` : `${label} ${g > 0 ? "+" : "−"}${Math.abs(g).toFixed(0)}%`; };

const Arrow = ({ kind, ja }: { kind: "up" | "down" | null; ja: boolean }) => kind ? <i className={kind === "up" ? styles.up : styles.down} aria-label={kind === "up" ? (ja ? "前回より上昇" : "Up from the previous report") : (ja ? "前回より低下" : "Down from the previous report")}>{kind === "up" ? "↑" : "↓"}</i> : null;

type Payloads = Partial<Record<RadarGenreId, RadarPayload>>;

export default function RadarScreen({ initial }: { initial: RadarPayload | null }) {
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja", t = (a: string, b: string) => ja ? a : b;
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
      <h1>{t("財務レーダー", "Financial Radar")}</h1>
      <p className={styles.lead}>{t("稼ぐ力と守る力を、ジャンルごとに1枚で見比べます。点線は前の決算からの動きです。", "Compare cash generation and financial resilience for each category on one chart. Dotted lines show the move since the previous earnings report.")}</p>
      <GenrePicker lang={lang} value={genre} onChange={id => { setGenre(id); setSelected(null); }} />
      {!radar && failed === genre ? <p className={styles.note} role="alert">{t("数値を取得できませんでした。しばらくしてからもう一度お試しください。", "We couldn't load the figures. Please try again in a moment.")}</p>
        : !radar ? <section className={styles.card} aria-hidden="true"><div className={styles.skeleton} /></section>
        : <>
          <section className={styles.card}>
            <p className={styles.axisY}>{t("↑ 守る力 ｜ 現金÷(借入+リース)", "↑ Financial resilience | Cash ÷ (debt + leases)")}</p>
            <RadarChart dots={radar.dots} selected={pro ? selected : null} onSelect={pro ? setSelected : undefined} lang={lang} />
            <p className={styles.axisX}>{t("稼ぐ力 ｜ 売上に対する営業キャッシュフロー →", "Cash generation | Operating cash flow as % of revenue →")}</p>
            <ul className={styles.legend}>
              <li><i style={{ background: "#59d6a6" }} />{t("売上が前年より増加", "Revenue up from a year earlier")}</li>
              <li><i style={{ background: "#f08a8a" }} />{t("減少", "Down")}</li>
              <li><i className={styles.hollow} style={{ borderColor: "#cfd8e3" }} />{t("大きさ=売上規模", "Size = revenue")}</li>
              <li><i className={styles.hollow} style={{ borderColor: "#59d6a6" }} />{t("白抜き=売上の比較なし", "Hollow = no revenue comparison")}</li>
              {pro && <li><b aria-hidden="true">┈</b>{t("点線=前の決算から", "Dotted = since the previous report")}</li>}
            </ul>
          </section>
          {pro ? <section className={styles.ranking}>
            <header><h2>{t("体力ランキング", "Financial strength ranking")}</h2><small>{ja ? `最新の決算（${quarterOf(pro.asOf, true)}）・決算ごとに自動更新` : `Latest results (${quarterOf(pro.asOf, false)}) · updated with each report`}</small></header>
            <p className={styles.order}>{t("並び順:稼ぐ力と守る力の点数の平均。グラフの右上ほど上位です", "Ranked by the average of the cash-generation and resilience scores. The closer to the upper right, the higher the rank.")}</p>
            {ranked.map(dot => <RankCard key={dot.ticker} dot={dot} lang={lang} />)}
            {review.length > 0 && <h3 className={styles.reviewHead}>{t("要確認(順位外)", "Needs review (not ranked)")}</h3>}
            {review.map(dot => <RankCard key={dot.ticker} dot={dot} lang={lang} />)}
            {pro.missing.length > 0
              ? <details className={styles.missing}><summary>{t("データが足りない銘柄 ・ ", "Stocks with missing data · ")}{pro.missing.length}{t("件", "")}</summary><p>{pro.missing.join("　")}</p></details>
              : <p className={styles.missing}>{t("データが足りない銘柄 ・ 0件", "Stocks with missing data · 0")}</p>}
          </section> : !confirmed ? <section className={styles.rankWait} aria-hidden="true" /> : <section className={styles.locked} aria-label={t("PRO限定", "Available with PRO")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            <span>{t("PRO限定", "Available with PRO")}</span>
          </section>}
        </>}
      <p className={styles.foot}>{t("数字は米SECの開示資料から計算しています。範囲を超える値はグラフの端に表示します。売買をすすめるものではありません。", "Figures are calculated from U.S. SEC filings. Values outside the chart range appear at the edge. This is not a recommendation to buy or sell.")}</p>
      <p className={styles.foot}>{t("前受け金(顧客からの前払い)が大きい会社は、営業キャッシュフローが膨らんで見えます。稼ぐ力が100%を超える銘柄は「要確認」とし、順位からは外しています。", "Large customer prepayments can make operating cash flow look inflated. Stocks with cash generation above 100% are marked \"Needs review\" and left out of the ranking.")}</p>
      <p className={styles.foot}>{t("稼ぐ力は営業キャッシュフローの売上に対する割合です。守る力の現金は現金同等物と短期の投資、借入は短期・長期の借入とリース負債の合計です。売上や現金の流れは、年の決算の日は1年分、それ以外は直近4四半期分を使います。", "Cash generation is operating cash flow divided by revenue. Financial resilience compares cash (cash equivalents plus short-term investments) with debt (short- and long-term borrowings plus lease liabilities). Revenue and cash flow use the full year for annual reports and the latest four quarters otherwise.")}</p>
    </div>
  </ResearchToolShell>;
}

function RankCard({ dot, lang }: { dot: RadarDotPro; lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const zone = zoneOf(dot.ocfMargin, dot.cover);
  const g = dot.growth;
  return <article className={styles.rank}>
    <div className={styles.rankTop}>
      <b>{dot.ticker}</b><span className={`${styles.chip} ${styles[zone]}`}>{zoneLabel(zone, lang)}</span>
      <em className={g === null || Math.abs(g) < 0.5 ? styles.flat : g > 0 ? styles.up : styles.down}>{growthText(g, ja)}</em>
    </div>
    <div className={styles.bar}><span>{ja ? "稼ぐ力" : "Cash generation"}</span><div><u className={`${styles.fcf} ${dot.ocfMargin < 0 ? styles.negative : ""}`} style={{ width: `${Math.max(3, dot.noRevenue ? 0 : xPosition(dot.ocfMargin) * 100)}%` }} /></div><strong>{dot.review && !dot.noRevenue && <small className={styles.review}>{ja ? "要確認" : "Review"}</small>}{dot.noRevenue ? (ja ? "売上なし" : "No revenue") : fmtPercent(dot.ocfMargin)} <Arrow ja={ja} kind={dot.noRevenue ? null : arrow(dot.ocfMargin, dot.previous?.ocfMargin)} /></strong></div>
    <div className={styles.bar}><span>{ja ? "守る力" : "Resilience"}</span><div><u className={styles.cover} style={{ width: `${Math.max(3, yPosition(dot.cover) * 100)}%` }} /></div><strong>{fmtCover(dot.cover, lang)} <Arrow ja={ja} kind={arrow(dot.cover, dot.previous?.cover)} /></strong></div>
  </article>;
}
