"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { valueHoldings, weights } from "@/lib/portfolio/calc";
import { PORTFOLIO_IMAGE, READING_STEPS_MS, portfolioHoldings, portfolioMarket } from "@/lib/research/pro-experience-sample-data";
import { COLORS, List, Reading } from "../../portfolio/screen";
import portfolioStyles from "../../portfolio/portfolio.module.css";
import styles from "./samples.module.css";

type Phase = "idle" | "preparing" | "reading" | "done";

/** The sample screenshot and 「この画像で試す」: the real reading animation for about two seconds, then the holdings in the real portfolio list.
 * Nothing is uploaded and no reading service is called; there is no field for your own image. */
export default function PortfolioSample({ lang }: { lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const [phase, setPhase] = useState<Phase>("idle");
  const [hide, setHide] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stop = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => stop, []);
  const start = () => {
    stop();
    setPhase("preparing");
    timers.current = [setTimeout(() => setPhase("reading"), READING_STEPS_MS[0]), setTimeout(() => setPhase("done"), READING_STEPS_MS[0] + READING_STEPS_MS[1])];
  };
  const { rows, totals } = useMemo(() => valueHoldings(portfolioHoldings, portfolioMarket.quotes, portfolioMarket.usdJpy), []);
  const shares = useMemo(() => weights(rows), [rows]);
  const colorOf = (ticker: string) => COLORS[Math.max(0, portfolioHoldings.findIndex(h => h.ticker === ticker)) % COLORS.length];
  return <div className={`${portfolioStyles.page} ${styles.portfolio}`}>
    <div className={styles.shot}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={PORTFOLIO_IMAGE} alt={ja ? "証券アプリの保有銘柄の画面（サンプル）" : "A broker app's holdings screen (sample)"} width={1206} height={2403} />
      <div className={styles.shotSide}>
        <p>{ja ? "証券アプリの保有銘柄の画面です（サンプル）" : "A broker app's holdings screen (sample)"}</p>
        <button type="button" className={styles.tryButton} onClick={start} disabled={phase === "preparing" || phase === "reading"}>{ja ? "この画像で試す" : "Try this image"}</button>
      </div>
    </div>
    {(phase === "preparing" || phase === "reading") && <div className={styles.portfolioStage}><Reading ja={ja} stage={phase} onCancel={() => { stop(); setPhase("idle"); }} /></div>}
    {phase === "done" && <div className={styles.portfolioStage}>
      <List ja={ja} rows={rows} totals={totals} shares={shares} hide={hide} market={portfolioMarket} marketError={false} onRetry={() => {}} pick={() => {}} onManual={() => {}}
        colorOf={colorOf} onClear={() => {}} sample onToggleHide={() => setHide(value => !value)} />
    </div>}
  </div>;
}
