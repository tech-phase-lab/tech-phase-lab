"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useMemberDisplay, useOwnerAccount } from "../member-display-provider";
import { useResearchLanguage } from "../use-research-language";
import { healthGenres, isClamped, quadrant, xPosition, yPosition, type HealthGenreId, type HealthPoint } from "@/lib/research/health-map";
import styles from "./screen.module.css";

type Loaded = { genre: HealthGenreId; points: HealthPoint[] } | "error";
const W = 100;

export default function HealthScreen() {
  const [lang, setLang] = useResearchLanguage();
  const t = (a: string, b: string) => lang === "ja" ? a : b;
  const plan = useMemberDisplay();
  const owner = useOwnerAccount();
  const membership = owner ? "pro" : plan ?? "loading";
  const [genre, setGenre] = useState<HealthGenreId>(healthGenres[0].id);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (membership !== "pro") return;
    const controller = new AbortController();
    fetch(`/api/research/health?genre=${genre}`, { cache: "no-store", signal: controller.signal })
      .then(response => response.json() as Promise<{ ok: boolean; points?: HealthPoint[] }>)
      .then(body => setLoaded(body.ok && body.points ? { genre, points: body.points } : "error"))
      .catch(error => { if ((error as Error).name !== "AbortError") setLoaded("error"); });
    return () => controller.abort();
  }, [genre, membership]);
  const ready = loaded && loaded !== "error" && loaded.genre === genre ? loaded.points : null;
  const plotted = ready?.filter(point => point.fcfMargin !== null && point.cover !== null) ?? [];
  const pct = (n: number | null) => n === null ? "—" : `${n.toFixed(1)}%`;
  const label = (id: string) => id === "strong" ? t("稼ぎも余裕もある", "Earning and cushioned") : id === "cushion" ? t("余裕はあるが稼げていない", "Cushioned, not yet earning") : id === "earning" ? t("稼いでいるが借入が重い", "Earning, heavy borrowing") : t("稼げず余裕も小さい", "Not earning, thin cushion");
  return <ResearchToolShell lang={lang} setLang={setLang} title={t("財務健全性マップ", "Financial Health Map")}
    description={t("ジャンルごとに、稼ぐ力と財務の余裕を1枚で見比べます。数字は米SECの開示資料から取得します。", "Earning power against financial cushion, by genre, from SEC filings.")}>
    {membership === "loading" && <p role="status">{t("会員情報を確認中…", "Checking membership…")}</p>}
    {membership === "free" && <section className={styles.lock}><h2>{t("PRO会員限定", "Exclusive to PRO")}</h2><p>{t("ジャンル別に、各社の稼ぐ力と財務の余裕を見比べられます。", "Compare each company's earning power and financial cushion by genre.")}</p><Link href="/research/account">{t("ログイン・会員情報", "Sign in / Membership")}</Link></section>}
    {membership === "pro" && <>
      <div className={styles.chips} role="group" aria-label={t("ジャンル", "Genre")}>
        {healthGenres.map(item => <button type="button" key={item.id} aria-pressed={item.id === genre} className={item.id === genre ? styles.on : ""} onClick={() => setGenre(item.id)}>{lang === "ja" ? item.ja : item.en}</button>)}
      </div>
      {loaded === "error" ? <p className={styles.note} role="alert">{t("数値を取得できませんでした。しばらくしてからもう一度お試しください。", "Figures could not be loaded. Please try again shortly.")}</p>
        : !ready ? <p role="status">{t("開示資料を読み込み中…", "Reading filings…")}</p>
        : <>
          <div className={styles.chart}>
            <svg viewBox={`0 0 ${W} ${W}`} preserveAspectRatio="none" role="img" aria-label={t("横軸がフリーキャッシュフロー率、縦軸が現金÷借入の散布図", "Scatter of free cash flow margin against cash over borrowings")}>
              <line x1={W * xPosition(0)} y1="0" x2={W * xPosition(0)} y2={W} stroke="#2d3948" strokeDasharray="1.5 1.5" strokeWidth="0.3" />
              <line x1="0" y1={W * (1 - yPosition(1))} x2={W} y2={W * (1 - yPosition(1))} stroke="#2d3948" strokeDasharray="1.5 1.5" strokeWidth="0.3" />
              {plotted.map(point => <circle key={point.ticker} cx={4 + (W - 8) * xPosition(point.fcfMargin!)} cy={4 + (W - 8) * (1 - yPosition(point.cover!))} r="1.7" fill={(point.revenueGrowth ?? 0) >= 0 ? "#59d6a6" : "#f08a8a"} />)}
            </svg>
            {plotted.map(point => <span key={point.ticker} style={{ position: "absolute", left: `${4 + (W - 8) * xPosition(point.fcfMargin!)}%`, top: `${4 + (W - 8) * (1 - yPosition(point.cover!))}%`, transform: "translate(6px,-50%)", fontSize: 11, fontFamily: "var(--font-geist-mono, monospace)", color: "#e8eef5", pointerEvents: "none" }}>{point.ticker}{isClamped(point) ? "*" : ""}</span>)}
            <p className={`${styles.quad} ${styles.tl}`}><b>{label("cushion")}</b></p>
            <p className={`${styles.quad} ${styles.tr}`}><b>{label("strong")}</b></p>
            <p className={`${styles.quad} ${styles.bl}`}><b>{label("watch")}</b></p>
            <p className={`${styles.quad} ${styles.br}`}><b>{label("earning")}</b></p>
            <span className={styles.axisX}>{t("稼ぐ力（売上に対するフリーキャッシュフロー）→", "Earning power (free cash flow / revenue) →")}</span>
          </div>
          <p className={styles.cap}>{t("縦軸は「現金 ÷ （借入＋リース）」。点線は 0%（横）と 1倍（縦）。*は表示範囲を超えた値です。緑は売上が前年より増加、赤は減少。", "Vertical: cash ÷ (borrowings + leases). Dotted lines mark 0% and 1×. * means beyond the plotted range. Green: revenue up year on year, red: down.")}</p>
          <ul className={styles.list}>
            {ready.map(point => {
              const q = quadrant(point);
              return <li key={point.ticker}><b>{point.ticker}</b><span>{q ? label(q) : t("開示から算出できません", "Not derivable from filings")}<br /><small>{t("FCF率", "FCF margin")} {pct(point.fcfMargin)} · {t("現金÷借入", "Cash ÷ debt")} {point.cover === null ? "—" : `${point.cover.toFixed(2)}×`}{point.asOf ? ` · ${point.asOf}` : ""}</small></span>
                <span className={(point.revenueGrowth ?? 0) >= 0 ? styles.up : styles.down}>{point.revenueGrowth === null ? "—" : `${point.revenueGrowth >= 0 ? "+" : ""}${point.revenueGrowth.toFixed(0)}%`}</span></li>;
            })}
          </ul>
        </>}
      <p className={styles.disc}>{t("米SECの提出書類にある数字を、そのまま計算しています。決算期の違いや会計基準の差があり、投資判断を示すものではありません。", "Figures are computed from SEC filings as filed. Fiscal periods and accounting bases differ, and this is not investment advice.")}</p>
    </>}
  </ResearchToolShell>;
}
