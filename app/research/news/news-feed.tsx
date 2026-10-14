"use client";
import type { InitialNewsSnapshot } from "@/lib/research/general-news";
import { useState } from "react";
import type { Language } from "@/lib/research/data";
import PriceTargetsPanel from "../price-targets-panel";
import GeneralNewsPanel from "./general-news-panel";
import styles from "./news-feed.module.css";
export default function NewsFeed({ lang, initialNews }: { lang: Language; initialNews?: InitialNewsSnapshot | null }) {
  const [view, setView] = useState<"all" | "official">("all");
  const ja = lang === "ja";
  return <>
    <section id="home-news" className={styles.feed} aria-label={ja ? "ニュース" : "News"}>
      <p className={styles.eyebrow}>NEWS</p>
      <h2>{ja ? "ニュース・企業の動き" : "News & company updates"}</h2>
      <div className={styles.tabs} role="group" aria-label={ja ? "表示するニュース" : "News filter"}>{(["all", "official"] as const).map(key => <button key={key} aria-pressed={key === view} onClick={() => setView(key)}>{key === "all" ? (ja ? "すべて" : "All") : (ja ? "公式発表" : "Official")}</button>)}</div>
      <div className={styles.newsSection}><GeneralNewsPanel initialNews={initialNews} lang={lang} officialOnly={view === "official"} /></div>
    </section>
    <PriceTargetsPanel lang={lang} />
  </>;
}
