"use client";
import { useRef, useState, type PointerEvent } from "react";
import { overallComparison } from "@/lib/research/comparison-scorecard";
import { COMPARE_TICKERS, compareNow, compareSample, nextPicks } from "@/lib/research/pro-experience-sample-data";
import { CompanyScoreCard, ScoreHeadline, VerdictHeading, ScoreOverview, StatusOverlay } from "../../compare/comparison-visuals";
import DetailPanels from "../../compare/detail-panels";
import compareStyles from "../../compare/styles.module.css";
import styles from "./samples.module.css";

/** A finger that moves more than this between down and up is scrolling, not tapping. */
export const TAP_SLOP = 10;
/** The click that follows a tap already answered on pointerup is ignored within this time. */
export const CLICK_AFTER_TAP_MS = 800;

/** Two of NVDA, AMD, INTC and ARM (no other stock can be chosen); the result is the PRO comparison's own result page, from saved figures. */
export default function CompareSample({ lang }: { lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const [picked, setPicked] = useState<string[]>(["NVDA", "AMD"]);
  // In the order they were chosen (owner, Nov 16: 「数字がないので、どれが入れ替わるか分からない」): ① is the older choice, ② the newer.
  // A third choice drops ①; the old ② becomes ① and the new stock ②. The result keeps that order, so ① is the first (gold) company.
  const toggle = (ticker: string) => setPicked(current => nextPicks(current, ticker));
  // A finger's tap is taken on pointerup (owner's iPhone, Nov 16: a third stock could not be chosen there, while desktop and emulators
  // worked). iPhone Safari decides on its own whether a touch becomes a click (it can keep it as a hover, or drop it while the page below is
  // re-laid out), so the touch itself is answered and the click that may follow is ignored; a mouse or a keyboard still uses the click.
  const touch = useRef<{ id: number; x: number; y: number; ticker: string } | null>(null);
  const tapped = useRef<{ ticker: string; at: number } | null>(null);
  const handlers = (ticker: string) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      touch.current = event.pointerType === "mouse" ? null : { id: event.pointerId, x: event.clientX, y: event.clientY, ticker };
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      const start = touch.current;
      touch.current = null;
      if (!start || start.id !== event.pointerId || start.ticker !== ticker) return;
      if (Math.abs(event.clientX - start.x) > TAP_SLOP || Math.abs(event.clientY - start.y) > TAP_SLOP) return;
      tapped.current = { ticker, at: Date.now() };
      toggle(ticker);
    },
    onPointerCancel: () => { touch.current = null; },
    onClick: () => {
      const last = tapped.current;
      if (last && last.ticker === ticker && Date.now() - last.at < CLICK_AFTER_TAP_MS) { tapped.current = null; return; }
      toggle(ticker);
    },
  });
  const result = compareSample(picked);
  const now = compareNow;
  const assessment = result ? overallComparison(result.companies, lang, now) : null;
  return <div className={styles.compare}>
    <p className={styles.pickLabel}>{ja ? "2つ選んでください" : "Choose two"}</p>
    <div className={styles.pills} role="group" aria-label={ja ? "比較する銘柄" : "Stocks to compare"}>
      {COMPARE_TICKERS.map(ticker => {
        const order = picked.indexOf(ticker);
        return <button key={ticker} type="button" className={styles.pill} aria-pressed={order >= 0} {...handlers(ticker)}
          aria-label={order >= 0 ? (ja ? `${ticker}（${order + 1}つ目）` : `${ticker} (choice ${order + 1})`) : ticker}>
          {order >= 0 && <span className={styles.pickNo} data-slot={order} aria-hidden="true">{order + 1}</span>}{ticker}
        </button>;
      })}
    </div>
    <p className={styles.pickRule}>{ja ? "3つ目を選ぶと、①が外れて入れ替わります" : "Choosing a third stock replaces ①"}</p>
    <p className={styles.pickPro}>{ja ? "PROは全銘柄対応。3銘柄まで同時に比較できます。" : "PRO covers every stock. Compare up to three at once."}</p>
    {!result || !assessment ? <p className={styles.waiting}>{ja ? "もう1つ選ぶと、結果が開きます。" : "Choose one more to see the result."}</p>
      : <div className={`${compareStyles.results} ${compareStyles.resultView} ${styles.compareResult}`}>
        <VerdictHeading title={assessment.title} leader={assessment.leader} companies={result.companies} lang={lang} now={now} />
        <ScoreHeadline companies={result.companies} lang={lang} now={now} />
        <StatusOverlay companies={result.companies} lang={lang} now={now} />
        <section className={compareStyles.explain}><p>{assessment.description}</p>{assessment.note && <details><summary>{ja ? "比較条件・注意点" : "Comparison caveats"}</summary><ul><li>{assessment.note}</li></ul></details>}</section>
        <ScoreOverview companies={result.companies} lang={lang} now={now} missingNote={false} />
        <h2 className={compareStyles.companiesHeading}>{ja ? "会社ごとの長所と短所" : "Strengths and weaknesses by company"}</h2>
        <div className={compareStyles.companyCards}>{result.companies.map((c, i) => <CompanyScoreCard colorIndex={i} key={c.ticker} company={c} lang={lang} now={now} />)}</div>
        <DetailPanels lang={lang}>
          {result.companies.filter(c => c.preparedAnalysis?.items.length).map(c => <section key={c.ticker}>
            <h3>{c.name}（{c.ticker}）</h3>
            <small>{ja ? "決算期末" : "Period ended"} {c.preparedAnalysis!.periodEnd}</small>
            <ul>{c.preparedAnalysis!.items.map(item => <li key={item.id}><strong data-kind={item.kind}>{item.short[lang]}</strong><p>{item.detail[lang]}</p></li>)}</ul>
          </section>)}
        </DetailPanels>
      </div>}
  </div>;
}
