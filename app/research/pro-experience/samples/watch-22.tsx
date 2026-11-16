"use client";
import { useState } from "react";
import type { WatchView } from "@/lib/research/company-watch";
import sample from "@/lib/research/pro-experience-samples/watch22.json";
import CompanyDirectory, { type DirectoryCompany } from "../../companies/company-directory";
import { WatchEarnings } from "../../companies/company-watch";
import { PRO_ONLY_VIEW, useProOnly } from "./frame";
import styles from "./samples.module.css";

const companies = sample.companies as DirectoryCompany[];
const summaries = sample.summaries as unknown as WatchView[];

/** The 22 stocks at one fixed moment. NVDA and AMD open their saved post-earnings summary; any other stock says 「PROで見られます」. */
export default function Watch22Sample({ lang }: { lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const proOnly = useProOnly();
  const [open, setOpen] = useState<string | null>(null);
  const watch = summaries.find(item => item.ticker === open);
  if (watch) return <div className={styles.watch}>
    <button type="button" className={styles.backButton} onClick={() => setOpen(null)}><span aria-hidden="true">‹</span>{ja ? "監視22銘柄" : "22 Tracked Stocks"}</button>
    <h3 className={styles.watchName}>{watch.name}（{watch.ticker}）</h3>
    <WatchEarnings watch={watch} titles={(watch.cards ?? []).map(card => card.title)} lang={lang} />
  </div>;
  return <div className={styles.watch}>
    <CompanyDirectory companies={companies} lang={lang} onOpen={ticker => summaries.some(item => item.ticker === ticker) ? setOpen(ticker) : proOnly(PRO_ONLY_VIEW)} />
  </div>;
}
