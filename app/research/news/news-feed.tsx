"use client";
import { useState } from "react";
import type { Language } from "@/lib/research/data";
import PriceTargetsPanel from "../price-targets-panel";
import GeneralNewsPanel from "./general-news-panel";
import styles from "./news-feed.module.css";
export default function NewsFeed({ lang }: { lang: Language }) {
  const [view, setView] = useState<"all" | "official" | "targets">("all");
  const ja = lang === "ja";
  return <section className={styles.feed} aria-label={ja ? "ニュースと目標株価" : "News and price targets"}>
    <h2>{ja ? "ニュース・企業の動き" : "News & company updates"}</h2>
    <div className={styles.tabs} role="group" aria-label={ja ? "表示するニュース" : "News filter"}>{(["all", "official", "targets"] as const).map(key => <button key={key} aria-pressed={key === view} onClick={() => setView(key)}>{key === "all" ? (ja ? "すべて" : "All") : key === "official" ? (ja ? "公式発表" : "Official") : (ja ? "目標株価" : "Price targets")}</button>)}</div>
    {view !== "targets" && <GeneralNewsPanel lang={lang} officialOnly={view === "official"} />}
    {view !== "official" && <PriceTargetsPanel lang={lang} />}
  </section>;
}
