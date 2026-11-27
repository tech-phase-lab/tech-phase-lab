"use client";
import { useEffect, useState } from "react";
import type { Language } from "@/lib/research/data";
import type { DeepAnalysis } from "@/lib/research/deep-analysis";
import { formatDisplay, zoneLabel } from "@/lib/research/display-time";
import MarketReactionView from "./market-reaction-view";
import styles from "./deep-analysis-panel.module.css";
import { useIdentitySignedIn } from "./identity-provider";

type State = { status: "loading" } | { status: "locked" } | { status: "unavailable" } | { status: "ready"; items: DeepAnalysis[] };

/** PRO deep analysis of earnings (by ticker) or U.S. indicators. */
export default function DeepAnalysisPanel({ lang, ticker, kind }: { lang: Language; ticker?: string; kind: "earnings" | "indicator" }) {
  const signedIn = useIdentitySignedIn();
  const [fetched, setState] = useState<State>({ status: "loading" });
  // Signed out: nothing, without asking the server (which would only answer 401).
  const state: State = signedIn === true ? fetched : signedIn === false ? { status: "locked" } : { status: "loading" };
  const ja = lang === "ja";
  useEffect(() => {
    if (signedIn !== true) return;
    const controller = new AbortController();
    fetch("/api/research/deep-analysis", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (response.status === 401 || response.status === 403) return setState({ status: "locked" });
        if (!response.ok) return setState({ status: "unavailable" });
        const { items } = await response.json() as { items: DeepAnalysis[] };
        setState({ status: "ready", items });
      })
      .catch(error => { if (!controller.signal.aborted) { void error; setState({ status: "unavailable" }); } });
    return () => controller.abort();
  }, [signedIn]);
  const title = kind === "earnings" ? (ja ? "決算の深掘り分析" : "Earnings deep dive") : (ja ? "経済指標の深掘り分析" : "Indicator deep dive");
  // Not PRO: nothing at all (FREE members already have the PRO trial; owner decision, Nov 2026).
  if (state.status !== "ready") return null;
  const items = state.items.filter(item => item.kind === kind && (!ticker || item.subject === ticker)).slice(0, 3);
  if (!items.length) return null;
  const format = (value: string) => formatDisplay(value, lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return <section className={styles.panel} aria-label={title}><span className={styles.badge}>PRO</span><h3>{title}</h3>
    {items.map(item => <DeepAnalysisArticle key={item.id} item={item} lang={lang} format={format} />)}
  </section>;
}

const CASE_LABEL = { base: { ja: "基本線", en: "Base" }, upside: { ja: "上振れ", en: "Upside" }, reassessment: { ja: "見直し", en: "Reassessment" } } as const;

/** One analysis as a short research note: the question, what changed, sections, conditional readings, unknowns, next checks, then the
 * next-day market reaction once that session has closed. An analysis stored before Nov 18 has only sections without headings and one next check. */
export function DeepAnalysisArticle({ item, lang, format }: { item: DeepAnalysis; lang: Language; format: (value: string) => string }) {
  const ja = lang === "ja";
  const sections = item.sections?.length ? item.sections : item.points.map(point => ({ ...point, heading: null }));
  const next = item.next?.length ? item.next : item.watch ? [item.watch] : [];
  const structured = sections.some(section => section.heading);
  return <article className={styles.item}>
      <p className={styles.kicker}>{item.subject}{ja ? (item.kind === "earnings" ? " · この決算の問い" : " · この発表の問い") : " · The question"}</p>
      <strong className={styles.question}>{item.headline[lang]}</strong>
      {item.summary && <p className={styles.summary}><span>{ja ? "何が変わったか" : "What changed"}</span>{item.summary[lang]}</p>}
      {structured
        ? sections.map((section, index) => <section key={index} className={styles.section}>
          <h4>{section.heading ? section.heading[lang] : (ja ? `論点 ${index + 1}` : `Point ${index + 1}`)}</h4><p>{section[lang]}</p></section>)
        : <ul>{sections.map((section, index) => <li key={index}>{section[lang]}</li>)}</ul>}
      {!!item.scenarios?.length && <div className={styles.block}><h4>{ja ? "読み方の分岐" : "How to read what comes next"}</h4>
        <p className={styles.blockNote}>{ja ? "次の開示で確かめる条件です。予想ではありません。" : "Conditions to test against the next disclosures, not forecasts."}</p>
        {item.scenarios.map(scenario => <p key={scenario.case} className={styles.scenario}><b>{CASE_LABEL[scenario.case][lang]}</b>{scenario[lang]}</p>)}</div>}
      {!!item.unknowns?.length && <div className={styles.block}><h4>{ja ? "わからないこと" : "What we cannot tell yet"}</h4>
        <ul>{item.unknowns.map((unknown, index) => <li key={index}>{unknown[lang]}</li>)}</ul></div>}
      {!!next.length && (structured || next.length > 1
        ? <div className={styles.block}><h4>{ja ? "次に見ること" : "What to check next"}</h4><ol>{next.map((check, index) => <li key={index}>{check[lang]}</li>)}</ol></div>
        : <p className={styles.watch}>{ja ? "次に見るべき点：" : "What to watch: "}{next[0][lang]}</p>)}
      {item.reaction && <MarketReactionView reaction={item.reaction} ticker={item.subject} lang={lang} />}
      <p className={styles.meta}>{ja ? "分析" : "Analysed"} {format(item.publishedAt)} {zoneLabel(lang)} · <a href={item.sourceUrl} target="_blank" rel="noreferrer">{ja ? "元の発表 ↗" : "Source ↗"}</a></p>
    </article>;
}
