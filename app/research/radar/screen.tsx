"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { quarterOf } from "@/lib/research/radar-period";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { arrow, radarGenres, zoneLabel, zoneOf, xPosition, yPosition, type RadarDotPro, type RadarGenreId, type RadarPayload } from "@/lib/research/radar";
import RadarChart, { RankChart, fmtCover, fmtPercent } from "./chart";
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
  const [about, setAbout] = useState(false);
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
  return <ResearchToolShell lang={lang} setLang={setLang} title="" description="" showHeading={false}>
    <div className={styles.page}>
      <p className={styles.eyebrow}>FINANCIAL RADAR</p>
      <div className={styles.headRow}>
        <h1>{t("財務レーダー", "Financial Radar")}</h1>
        <button type="button" className={styles.info} aria-expanded={about} aria-controls="radar-about" aria-label={t("計算方法と注意", "How it's calculated")} onClick={() => setAbout(open => !open)}>i</button>
      </div>
      <p className={styles.lead}>{t("稼ぐ力と守る力を、ジャンルの中で比べます", "Compare earning power and financial cushion within each genre.")}</p>
      {/* Owner, Nov 25: the three notes and the disclaimer leave the page and open from the 「i」 beside the heading (FREE and PRO). */}
      {about && <div id="radar-about" className={styles.about} role="region" aria-label={t("計算方法と注意", "How it's calculated")}>
        <p>{t("数字は米SECの開示資料から計算しています。範囲を超える値はグラフの端に表示します。売買をすすめるものではありません。", "Figures are calculated from U.S. SEC filings. Values outside the chart range appear at the edge. This is not a recommendation to buy or sell.")}</p>
        <p>{t("前受け金(顧客からの前払い)が大きい会社は、営業キャッシュフローが膨らんで見えます。1年間に受け取った前受け金が1年分の売上を超える会社は、その分を除いた営業キャッシュフローで稼ぐ力を計算し、「前受け金除く」と表示します。請求したまま未回収の分は、除く額から差し引きます。", "Large customer prepayments can make operating cash flow look inflated. When the prepayments received in a year exceed a full year of revenue, cash generation is calculated without them and marked \"Excl. prepayments\" (amounts billed but not yet collected are not taken out).")}</p>
        <p>{t("稼ぐ力は営業キャッシュフローの売上に対する割合です。守る力の現金は現金同等物と短期の投資、借入は短期・長期の借入とリース負債の合計です。売上や現金の流れは、年の決算の日は1年分、それ以外は直近4四半期分を使います。", "Cash generation is operating cash flow divided by revenue. Financial resilience compares cash (cash equivalents plus short-term investments) with debt (short- and long-term borrowings plus lease liabilities). Revenue and cash flow use the full year for annual reports and the latest four quarters otherwise.")}</p>
        <p>{t("FREEのグラフは、ジャンルの中の順位で点を並べています。", "On the free chart, dots are placed by their rank within the genre.")}</p>
      </div>}
      <GenrePicker lang={lang} value={genre} onChange={id => { setGenre(id); setSelected(null); }} />
      {!radar && failed === genre ? <p className={styles.note} role="alert">{t("数値を取得できませんでした。しばらくしてからもう一度お試しください。", "We couldn't load the figures. Please try again in a moment.")}</p>
        : !radar ? <section className={styles.card} aria-hidden="true"><div className={styles.skeleton} /></section>
        : <>
          {pro ? <section className={styles.card}>
            <p className={styles.axisY}>{t("↑ 守る力 ｜ 現金÷(借入+リース)", "↑ Financial resilience | Cash ÷ (debt + leases)")}</p>
            <RadarChart dots={pro.dots} selected={selected} onSelect={setSelected} lang={lang} />
            <p className={styles.axisX}>{t("稼ぐ力 ｜ 売上に対する営業キャッシュフロー →", "Cash generation | Operating cash flow as % of revenue →")}</p>
            <ul className={styles.legend}>
              <li><i style={{ background: "#59d6a6" }} />{t("売上が前年より増加", "Revenue up from a year earlier")}</li>
              <li><i style={{ background: "#f08a8a" }} />{t("減少", "Down")}</li>
              <li><i className={styles.hollow} style={{ borderColor: "#cfd8e3" }} />{t("大きさ=売上規模", "Size = revenue")}</li>
              <li><i className={styles.hollow} style={{ borderColor: "#59d6a6" }} />{t("白抜き=売上の比較なし", "Hollow = no revenue comparison")}</li>
              <li><b aria-hidden="true">┈</b>{t("点線=前の決算から", "Dotted = since the previous report")}</li>
            </ul>
          </section> : radar.tier === "free" && <section className={styles.card}>
            {/* FREE (owner, Nov 25): dots by rank inside the genre, so they spread over the whole chart; no figures, nothing to tap. */}
            <p className={styles.axisY}>{t("↑ 守る力　借金に対する手元の現金", "↑ Financial cushion — cash vs. debt")}</p>
            <RankChart dots={radar.dots} lang={lang} />
            <p className={styles.axisRow}><span>{t("低い", "Low")}</span><span>{t("稼ぐ力　売上のうち現金で残る割合 →", "Cash earning power — cash kept from sales →")}</span><span>{t("高い", "High")}</span></p>
            <p className={styles.legendLine}><span><i style={{ background: "#59d6a6" }} />{t("売上が増加", "Revenue up")}</span><span><i style={{ background: "#f08a8a" }} />{t("売上が減少", "Revenue down")}</span><span>{t("点の大きさ＝売上の規模", "Dot size = revenue")}</span></p>
          </section>}
          {pro ? <StrengthRanking pro={pro} lang={lang} /> : !confirmed ? <section className={styles.rankWait} aria-hidden="true" /> : <LockedRanking asOf={radar.asOf} lang={lang} />}
        </>}
    </div>
  </ResearchToolShell>;
}

type ProRadar = Extract<RadarPayload, { tier: "pro" }>;

/** Fixed made-up figures for the blurred cards FREE sees: the real figures are never sent to a FREE visitor (owner, Nov 25). */
const sampleCard = (ticker: string, ocfMargin: number, cover: number, growth: number) => ({ ticker, ocfMargin, cover, growth, up: growth >= 0, tone: growth >= 0 ? "up" as const : "down" as const, size: 2 as const,
  asOf: "", basis: "ttm" as const, previous: null, rank: 1, score: 0, review: false }) as unknown as RadarDotPro; // no free-cash-flow figure: the cards never show one
const LOCKED_SAMPLE = [sampleCard("SAMPLE", 48.2, 2.4, 18), sampleCard("SAMPL", 31.5, 1.3, 9), sampleCard("SMPL", 12.8, 0.6, -4)];

/** FREE: the real ranking heading, then three blurred cards of the same shape with 「🔒 PRO」 and what PRO shows. No gold (FREE screen). */
function LockedRanking({ asOf, lang }: { asOf: string | null; lang: "ja" | "en" }) {
  const ja = lang === "ja", t = (a: string, b: string) => ja ? a : b;
  return <section className={styles.ranking} aria-label={t("体力ランキング（PRO限定）", "Financial strength ranking (PRO)")}>
    <header><h2>{t("体力ランキング", "Financial strength ranking")}</h2>{asOf && <small>{ja ? `最新の決算（${quarterOf(asOf, true)}）` : `Latest results (${quarterOf(asOf, false)})`}</small>}</header>
    <div className={styles.lockedRest}>
      <div className={styles.ghosts} aria-hidden="true" inert>{LOCKED_SAMPLE.map(dot => <RankCard key={dot.ticker} dot={dot} lang={lang} />)}</div>
      <div className={styles.lockCta}>
        <b>🔒 PRO</b>
        <p>{ja ? <>各銘柄の稼ぐ力・守る力の数字と<br />体力ランキング、前の決算からの動きが見られます</> : "See each stock's numbers, the strength ranking, and changes since the last report."}</p>
      </div>
    </div>
  </section>;
}
/** 体力ランキング: the PRO part of the radar (also shown by the PRO feature tour's fixed sample, with one genre of made-up figures). */
export function StrengthRanking({ pro, lang }: { pro: ProRadar; lang: "ja" | "en" }) {
  const ja = lang === "ja", t = (a: string, b: string) => ja ? a : b;
  const ranked = pro.dots.filter(dot => dot.rank !== null).sort((a, b) => a.rank! - b.rank!);
  // Only a company without revenue is unranked (earning power cannot be worked out): one plain line, not a card (owner, Nov 24).
  const unranked = pro.dots.filter(dot => dot.rank === null);
  return <section className={styles.ranking}>
    <header><h2>{t("体力ランキング", "Financial strength ranking")}</h2><small>{ja ? `最新の決算（${quarterOf(pro.asOf, true)}）・決算ごとに自動更新` : `Latest results (${quarterOf(pro.asOf, false)}) · updated with each report`}</small></header>
    <p className={styles.order}>{t("並び順:稼ぐ力と守る力の点数の平均。グラフの右上ほど上位です", "Ranked by the average of the cash-generation and resilience scores. The closer to the upper right, the higher the rank.")}</p>
    {ranked.map(dot => <RankCard key={dot.ticker} dot={dot} lang={lang} />)}
    {unranked.map(dot => <p key={dot.ticker} className={styles.unranked}><b>{dot.ticker}</b>{t(`売上がまだないため順位なし ・ 守る力 ${fmtCover(dot.cover, lang)}`, `Not ranked: no revenue yet · Resilience ${fmtCover(dot.cover, lang)}`)}</p>)}
    {pro.missing.length > 0
      ? <details className={styles.missing}><summary>{t("データが足りない銘柄 ・ ", "Stocks with missing data · ")}{pro.missing.length}{t("件", "")}</summary><p>{pro.missing.join("　")}</p></details>
      : <p className={styles.missing}>{t("データが足りない銘柄 ・ 0件", "Stocks with missing data · 0")}</p>}
  </section>;
}

/** One stock's card in the ranking (also shown by the PRO feature tour's fixed sample). */
export function RankCard({ dot, lang }: { dot: RadarDotPro; lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const zone = zoneOf(dot.ocfMargin, dot.cover);
  const g = dot.growth;
  return <article className={styles.rank}>
    <div className={styles.rankTop}>
      <b>{dot.ticker}</b><span className={`${styles.chip} ${styles[zone]}`}>{zoneLabel(zone, lang)}</span>
      <em className={g === null || Math.abs(g) < 0.5 ? styles.flat : g > 0 ? styles.up : styles.down}>{growthText(g, ja)}</em>
    </div>
    {/* Owner, Nov 25: the prepayment mark sits under 「稼ぐ力」, not beside the number, and the number column has a fixed width (IREN overflowed). */}
    <div className={styles.bar}><span>{ja ? "稼ぐ力" : "Cash generation"}{dot.prepaid && <small className={styles.review}>{ja ? "前受け金除く" : "Excl. prepayments"}</small>}{dot.review && <small className={styles.review}>{ja ? "前受け金込み" : "Incl. prepayments"}</small>}</span><div><u className={`${styles.fcf} ${dot.ocfMargin < 0 ? styles.negative : ""}`} style={{ width: `${Math.max(3, dot.noRevenue ? 0 : xPosition(dot.ocfMargin) * 100)}%` }} /></div><strong>{dot.noRevenue ? (ja ? "売上なし" : "No revenue") : fmtPercent(dot.ocfMargin)} <Arrow ja={ja} kind={dot.noRevenue ? null : arrow(dot.ocfMargin, dot.previous?.ocfMargin)} /></strong></div>
    <div className={styles.bar}><span>{ja ? "守る力" : "Resilience"}</span><div><u className={styles.cover} style={{ width: `${Math.max(3, yPosition(dot.cover) * 100)}%` }} /></div><strong>{fmtCover(dot.cover, lang)} <Arrow ja={ja} kind={arrow(dot.cover, dot.previous?.cover)} /></strong></div>
  </article>;
}
