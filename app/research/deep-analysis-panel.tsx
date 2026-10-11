"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Language } from "@/lib/research/data";
import type { DeepAnalysis } from "@/lib/research/deep-analysis";
import styles from "./deep-analysis-panel.module.css";

type State = { status: "loading" } | { status: "locked" } | { status: "unavailable" } | { status: "ready"; items: DeepAnalysis[] };

/** PRO deep analysis of earnings (by ticker) or U.S. indicators. */
export default function DeepAnalysisPanel({ lang, ticker, kind }: { lang: Language; ticker?: string; kind: "earnings" | "indicator" }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const ja = lang === "ja";
  useEffect(() => {
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
  }, []);
  const title = kind === "earnings" ? (ja ? "決算の深掘り分析" : "Earnings deep dive") : (ja ? "経済指標の深掘り分析" : "Indicator deep dive");
  if (state.status === "loading" || state.status === "unavailable") return null;
  if (state.status === "locked") {
    return <section className={styles.panel} aria-label={title}><span className={styles.badge}>PRO</span><h3>{title}</h3>
      <p className={styles.locked}>{ja ? "決算や重要指標の発表直後に、背景・前回との比較・次に見るべき点を深掘りした分析をPRO会員向けに提供しています。" : "PRO members get an in-depth reading of each earnings release and key indicator right after it is published."}{" "}
        <Link href="/research#tech-phase-pro">{ja ? "PROの案内を見る" : "See PRO"}</Link></p></section>;
  }
  const items = state.items.filter(item => item.kind === kind && (!ticker || item.subject === ticker)).slice(0, 3);
  if (!items.length) return null;
  const format = (value: string) => new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  return <section className={styles.panel} aria-label={title}><span className={styles.badge}>PRO</span><h3>{title}</h3>
    {items.map(item => <article key={item.id} className={styles.item}>
      <strong>{item.headline[lang]}</strong>
      <ul>{item.points.map((point, index) => <li key={index}>{point[lang]}</li>)}</ul>
      {item.watch && <p className={styles.watch}>{ja ? "次に見るべき点：" : "What to watch: "}{item.watch[lang]}</p>}
      <p className={styles.meta}>{ja ? "分析" : "Analysed"} {format(item.publishedAt)} JST · <a href={item.sourceUrl} target="_blank" rel="noreferrer">{ja ? "元の発表 ↗" : "Source ↗"}</a></p>
    </article>)}
  </section>;
}
